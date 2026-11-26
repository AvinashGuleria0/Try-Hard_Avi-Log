import { createHash } from "node:crypto";
import type { CompactedLog, LogCluster, LogLevel, StackFrame } from "../types/core.js";
import { detectRuntime, getParser } from "./parsers/index.js";

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ISO_TS_RE = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g;
const HEX_RE = /\b0x[0-9a-fA-F]+\b/g;
const PORT_RE = /:(\d{4,5})\b/g;
const REQ_ID_RE = /\b(?:req|request|trace|span)[-_]?(?:id)?[:=]\s*[a-zA-Z0-9_-]+/gi;
const NUM_RE = /\b\d+\b/g;
const TIMESTAMP_EXTRACT_RE = /\b(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\b/;

export interface CompactorOptions {
  maxBufferLines?: number;
  maxCascadeClusters?: number;
  maxSnippetLines?: number;
}

export function stripAnsi(input: string): string {
  return input.replace(ANSI_RE, "");
}

export function normalizeForDedup(line: string): string {
  return line
    .replace(UUID_RE, "<UUID>")
    .replace(ISO_TS_RE, "<TS>")
    .replace(HEX_RE, "<HEX>")
    .replace(REQ_ID_RE, "<REQ_ID>")
    .replace(PORT_RE, ":<PORT>")
    .replace(NUM_RE, "<N>")
    .replace(/\s+/g, " ")
    .trim();
}

function inferLogLevel(line: string): LogLevel {
  const upper = line.toUpperCase();
  if (/\b(FATAL|PANIC|CRITICAL|OOMKILLED|SIGSEGV)\b/.test(upper)) return "FATAL";
  if (/\b(ERROR|ERR!|EXCEPTION|TRACEBACK|UNHANDLED)\b/.test(upper) || /Error:/.test(line)) return "ERROR";
  if (/\bWARN(?:ING)?\b/.test(upper)) return "WARN";
  return "INFO";
}

function computeFingerprint(header: string, frames: StackFrame[]): string {
  const normalizedHeader = normalizeForDedup(header);
  const topUserFrames = frames
    .filter((f) => f.isUserLand)
    .slice(0, 3)
    .map((f) => `${f.file}:${f.functionName ?? "anonymous"}`)
    .join("|");

  return createHash("sha256")
    .update(`${normalizedHeader}::${topUserFrames}`)
    .digest("hex");
}

function createEmptyCluster(totalRawLines: number): LogCluster {
  return {
    id: "cluster-0",
    firstSeenLine: totalRawLines > 0 ? 1 : 0,
    level: "INFO",
    header: "No errors detected",
    repeatCount: 1,
    frames: [],
    rawSnippet: [],
    isPrimaryCause: true
  };
}

export function compactLines(rawLines: string[], totalRawLines: number, options: CompactorOptions = {}): CompactedLog {
  const start = performance.now();
  const maxCascadeClusters = options.maxCascadeClusters ?? 4;
  const maxSnippetLines = options.maxSnippetLines ?? 15;

  const sample = rawLines.slice(0, 400);
  const runtime = detectRuntime(sample);
  const parser = getParser(runtime);

  const clusters: LogCluster[] = [];
  const lru = new Map<string, { clusterIndex: number; lastLine: number }>();
  let activeCluster: LogCluster | null = null;
  let inTraceback = false;

  const touchLru = (sig: string, clusterIndex: number, lineNum: number) => {
    if (lru.has(sig)) lru.delete(sig);
    lru.set(sig, { clusterIndex, lastLine: lineNum });
    if (lru.size > 64) {
      const oldestKey = lru.keys().next().value;
      if (oldestKey !== undefined) lru.delete(oldestKey);
    }
  };

  for (let i = 0; i < rawLines.length; i++) {
    const lineNum = i + 1;
    const line = rawLines[i] ?? "";
    const trimmed = line.trim();
    if (!trimmed) {
      inTraceback = false;
      continue;
    }

    const frame = parser.parseFrame(line);
    if (frame) {
      if (!activeCluster) {
        activeCluster = {
          id: `cluster-${clusters.length + 1}`,
          firstSeenLine: lineNum,
          level: "ERROR",
          header: trimmed,
          repeatCount: 1,
          frames: [],
          rawSnippet: [line],
          isPrimaryCause: false
        };
        clusters.push(activeCluster);
      }
      activeCluster.frames.push(frame);
      if (activeCluster.rawSnippet.length < maxSnippetLines) {
        activeCluster.rawSnippet.push(line);
      }
      continue;
    }

    const isHeader = parser.isHeaderLine(line);
    const sig = normalizeForDedup(trimmed);
    const existing = lru.get(sig);

    if (existing && lineNum - existing.lastLine <= 50) {
      const targetCluster = clusters[existing.clusterIndex];
      if (targetCluster) {
        targetCluster.repeatCount += 1;
        touchLru(sig, existing.clusterIndex, lineNum);
        activeCluster = targetCluster;
        continue;
      }
    }

    // For Python, if we are inside a Traceback block and hit the terminal exception line,
    // promote that exception line to be the cluster header.
    if (runtime === "python" && inTraceback && activeCluster && isHeader && !/^Traceback\s+\(/.test(trimmed)) {
      activeCluster.header = trimmed;
      activeCluster.level = inferLogLevel(trimmed);
      if (activeCluster.rawSnippet.length < maxSnippetLines) {
        activeCluster.rawSnippet.push(line);
      }
      inTraceback = false;
      continue;
    }

    if (isHeader) {
      const tsMatch = TIMESTAMP_EXTRACT_RE.exec(line);
      const newCluster: LogCluster = {
        id: `cluster-${clusters.length + 1}`,
        firstSeenLine: lineNum,
        timestamp: tsMatch?.[1],
        level: inferLogLevel(trimmed),
        header: trimmed,
        repeatCount: 1,
        frames: [],
        rawSnippet: [line],
        isPrimaryCause: false
      };
      const idx = clusters.length;
      clusters.push(newCluster);
      touchLru(sig, idx, lineNum);
      activeCluster = newCluster;
      inTraceback = runtime === "python" && /^Traceback\s+\(/.test(trimmed);
      continue;
    }

    // Attach contextual lines (e.g. code snippet line in Python traceback or Caused by:) to active cluster
    if (activeCluster && activeCluster.rawSnippet.length < maxSnippetLines) {
      if (inTraceback || /^\s*(?:Caused by:|Code:|Hint:|Detail:|\^+|~+)/.test(line)) {
        activeCluster.rawSnippet.push(line);
      }
    }
  }

  // Post-process frames (e.g. reverse Python tracebacks)
  if (parser.postProcessFrames) {
    for (const c of clusters) {
      if (c.frames.length > 0) {
        c.frames = parser.postProcessFrames(c.frames);
      }
    }
  }

  if (clusters.length === 0) {
    const fallback = createEmptyCluster(totalRawLines);
    const compactedLines = Math.min(totalRawLines, 1);
    const reductionPercent =
      totalRawLines > 0 ? Number((((totalRawLines - compactedLines) / totalRawLines) * 100).toFixed(2)) : 0;
    return {
      runtime,
      totalRawLines,
      compactedLines,
      reductionPercent,
      parseTimeMs: Number((performance.now() - start).toFixed(2)),
      fingerprintHash: computeFingerprint(fallback.header, []),
      primaryCluster: fallback,
      cascadeClusters: []
    };
  }

  // Causal ranking
  const firstErrorIdx = clusters.findIndex((c) => c.level === "ERROR" || c.level === "FATAL");
  let bestIdx = 0;
  let bestScore = -1;

  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i]!;
    const isFirstError = i === (firstErrorIdx === -1 ? 0 : firstErrorIdx);
    const hasUserLand = c.frames.some((f) => f.isUserLand);
    const isFatal = c.level === "FATAL";
    const score = (isFirstError ? 50 : 0) + (hasUserLand ? 30 : 0) + (isFatal ? 20 : 0);

    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  const primaryCluster = clusters[bestIdx]!;
  primaryCluster.isPrimaryCause = true;

  const cascadeClusters = clusters
    .filter((_, idx) => idx !== bestIdx)
    .slice(0, maxCascadeClusters);

  const compactedLines =
    primaryCluster.rawSnippet.length +
    cascadeClusters.reduce((sum, c) => sum + c.rawSnippet.length, 0);

  const reductionPercent =
    totalRawLines > 0
      ? Math.max(0, Math.min(100, Number((((totalRawLines - compactedLines) / totalRawLines) * 100).toFixed(2))))
      : 0;

  return {
    runtime,
    totalRawLines,
    compactedLines,
    reductionPercent,
    parseTimeMs: Number((performance.now() - start).toFixed(2)),
    fingerprintHash: computeFingerprint(primaryCluster.header, primaryCluster.frames),
    primaryCluster,
    cascadeClusters
  };
}

export async function compactStream(
  stream: ReadableStream<Uint8Array>,
  options: CompactorOptions = {}
): Promise<CompactedLog> {
  const maxBufferLines = options.maxBufferLines ?? 50_000;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const lines: string[] = [];
  let totalRawLines = 0;
  let leftover = "";

  const pushLine = (rawLine: string) => {
    totalRawLines += 1;
    const clean = stripAnsi(rawLine.replace(/\r$/, ""));
    if (lines.length < maxBufferLines) {
      lines.push(clean);
    } else {
      // Rolling ring buffer behavior when exceeding maxBufferLines
      lines.shift();
      lines.push(clean);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    leftover += decoder.decode(value, { stream: true });
    let newlineIdx = leftover.indexOf("\n");
    while (newlineIdx !== -1) {
      pushLine(leftover.slice(0, newlineIdx));
      leftover = leftover.slice(newlineIdx + 1);
      newlineIdx = leftover.indexOf("\n");
    }
  }

  leftover += decoder.decode();
  if (leftover.length > 0) {
    pushLine(leftover);
  }

  return compactLines(lines, totalRawLines, options);
}

export function compactText(rawText: string, options: CompactorOptions = {}): CompactedLog {
  const maxBufferLines = options.maxBufferLines ?? 50_000;
  const split = rawText.split(/\r?\n/);
  const totalRawLines = split.length;
  const cleaned = split.slice(-maxBufferLines).map(stripAnsi);
  return compactLines(cleaned, totalRawLines, options);
}
