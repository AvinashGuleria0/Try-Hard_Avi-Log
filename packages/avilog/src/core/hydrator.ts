import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import type { HydratedContext, StackFrame } from "../types/core.js";

function isInsideRoot(targetPath: string, rootPath: string): boolean {
  const normalizedTarget = resolve(targetPath);
  const normalizedRoot = resolve(rootPath);
  return (
    normalizedTarget === normalizedRoot ||
    normalizedTarget.startsWith(normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`)
  );
}

function buildCodeWindow(content: string, targetLine: number, radius = 20): string {
  const lines = content.split(/\r?\n/);
  const start = Math.max(1, targetLine - radius);
  const end = Math.min(lines.length, targetLine + radius);
  const width = String(end).length;

  const formatted: string[] = [];
  for (let lineNum = start; lineNum <= end; lineNum++) {
    const marker = lineNum === targetLine ? ">>> " : "    ";
    const paddedNum = String(lineNum).padStart(width, " ");
    formatted.push(`${marker}${paddedNum} | ${lines[lineNum - 1] ?? ""}`);
  }
  return formatted.join("\n");
}

function getGitMeta(relFile: string, cwd: string): { lastCommitMeta?: string; gitDiff?: string } {
  const logRes = spawnSync(
    "git",
    ["log", "-n", "1", "--pretty=format:%h (%ar): %s", "--", relFile],
    { cwd, encoding: "utf8", timeout: 2000 }
  );
  if (logRes.status !== 0) {
    return {};
  }

  const diffRes = spawnSync("git", ["diff", "HEAD~1", "--", relFile], {
    cwd,
    encoding: "utf8",
    timeout: 2000
  });

  const lastCommitMeta = logRes.stdout?.trim() || undefined;
  const rawDiff = diffRes.status === 0 ? diffRes.stdout?.trim() : undefined;
  const gitDiff = rawDiff && rawDiff.length > 0 ? rawDiff.slice(0, 4000) : undefined;

  return { lastCommitMeta, gitDiff };
}

export function hydrateFrames(
  frames: StackFrame[],
  cwd: string = process.cwd(),
  maxFrames = 3
): HydratedContext[] {
  const root = resolve(cwd);
  const seenFiles = new Set<string>();
  const contexts: HydratedContext[] = [];

  for (const frame of frames) {
    if (!frame.isUserLand) continue;

    const candidatePath = resolve(root, frame.file);
    if (!isInsideRoot(candidatePath, root)) continue;
    if (!existsSync(candidatePath)) continue;

    try {
      if (!statSync(candidatePath).isFile()) continue;
    } catch {
      continue;
    }

    const relFile = relative(root, candidatePath).replace(/\\/g, "/");
    if (seenFiles.has(relFile)) continue;
    seenFiles.add(relFile);

    frame.absolutePath = candidatePath;
    const content = readFileSync(candidatePath, "utf8");
    const codeWindow = buildCodeWindow(content, frame.line);
    const { lastCommitMeta, gitDiff } = getGitMeta(relFile, root);

    contexts.push({
      file: relFile,
      line: frame.line,
      codeWindow,
      gitDiff,
      lastCommitMeta
    });

    if (contexts.length >= maxFrames) break;
  }

  return contexts;
}
