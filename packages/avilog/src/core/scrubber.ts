import type { CompactedLog, HydratedContext, LogCluster, RedactionMap } from "../types/core.js";

const API_KEY_RE = /(sk-[a-zA-Z0-9_-]{20,}|ghp_[a-zA-Z0-9]{36}|AIza[0-9A-Za-z_-]{35}|xox[baprs]-[0-9a-zA-Z-]{10,})/g;
const JWT_RE = /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g;
const DB_URI_RE = /(postgres(?:ql)?|mongodb(?:\+srv)?|mysql|redis):\/\/[^\s"'`<>]+/gi;
const ENV_SECRET_RE =
  /(\b[A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PWD|CREDENTIAL)[A-Z0-9_]*\s*[=:]\s*)(["']?)([^\s"'`]+)\2/gi;
const HIGH_ENTROPY_CANDIDATE_RE = /\b[A-Za-z0-9+/=_-]{24,}\b/g;

export function createRedactionMap(): RedactionMap {
  return {
    tokenToOriginal: new Map<string, string>(),
    redactedCount: 0
  };
}

export function shannonEntropy(input: string): number {
  if (!input.length) return 0;
  const freq = new Map<string, number>();
  for (const ch of input) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }
  let entropy = 0;
  const len = input.length;
  for (const count of freq.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function isLikelyFilePathOrHashPlaceholder(token: string): boolean {
  if (token.includes("/") || token.includes("\\")) return true;
  if (/^\[.*\]$/.test(token)) return true;
  // Pure lowercase hex SHA-256 (64 chars) or similar fingerprint hashes
  if (/^[0-9a-f]{32,64}$/.test(token)) return true;
  return false;
}

function registerSecret(original: string, prefix: string, map: RedactionMap): string {
  for (const [token, existing] of map.tokenToOriginal.entries()) {
    if (existing === original) return token;
  }
  map.redactedCount += 1;
  const token = `[${prefix}_${map.redactedCount}]`;
  map.tokenToOriginal.set(token, original);
  return token;
}

export function scrubText(
  input: string,
  map: RedactionMap = createRedactionMap()
): { scrubbed: string; map: RedactionMap } {
  let result = input;

  // Pass 1: Deterministic patterns
  result = result.replace(JWT_RE, (match) => registerSecret(match, "SECRET_JWT", map));
  result = result.replace(DB_URI_RE, (match) => registerSecret(match, "SECRET_URI", map));
  result = result.replace(API_KEY_RE, (match) => registerSecret(match, "SECRET_KEY", map));
  result = result.replace(ENV_SECRET_RE, (_full, lhs: string, quote: string, val: string) => {
    if (val.startsWith("[SECRET_") || val.startsWith("[HIGH_ENTROPY_SECRET_")) {
      return `${lhs}${quote}${val}${quote}`;
    }
    const token = registerSecret(val, "SECRET_ENV", map);
    return `${lhs}${quote}${token}${quote}`;
  });

  // Pass 2: Shannon entropy analysis on remaining standalone tokens >= 24 chars
  result = result.replace(HIGH_ENTROPY_CANDIDATE_RE, (candidate) => {
    if (isLikelyFilePathOrHashPlaceholder(candidate)) return candidate;
    if (shannonEntropy(candidate) > 4.2) {
      return registerSecret(candidate, "HIGH_ENTROPY_SECRET", map);
    }
    return candidate;
  });

  return { scrubbed: result, map };
}

export function restoreText(input: string, map: RedactionMap): string {
  let result = input;
  for (const [token, original] of map.tokenToOriginal.entries()) {
    if (result.includes(token)) {
      result = result.split(token).join(original);
    }
  }
  return result;
}

function scrubCluster(cluster: LogCluster, map: RedactionMap): LogCluster {
  return {
    ...cluster,
    header: scrubText(cluster.header, map).scrubbed,
    rawSnippet: cluster.rawSnippet.map((line) => scrubText(line, map).scrubbed),
    frames: cluster.frames.map((frame) => ({
      ...frame,
      rawLine: scrubText(frame.rawLine, map).scrubbed
    }))
  };
}

export function scrubCompactedLog(
  log: CompactedLog,
  map: RedactionMap = createRedactionMap()
): { log: CompactedLog; map: RedactionMap } {
  return {
    log: {
      ...log,
      primaryCluster: scrubCluster(log.primaryCluster, map),
      cascadeClusters: log.cascadeClusters.map((c) => scrubCluster(c, map))
    },
    map
  };
}

export function scrubHydratedContexts(
  contexts: HydratedContext[],
  map: RedactionMap
): HydratedContext[] {
  return contexts.map((ctx) => ({
    ...ctx,
    codeWindow: scrubText(ctx.codeWindow, map).scrubbed,
    gitDiff: ctx.gitDiff ? scrubText(ctx.gitDiff, map).scrubbed : undefined
  }));
}
