import type { StackFrame } from "../../types/core.js";
import { normalizeFramePath, type RuntimeParser } from "./types.js";

const PY_FRAME_RE = /^\s*File\s+"(.+?)",\s+line\s+(\d+)(?:,\s+in\s+(.+))?$/;
const PY_TRACEBACK_RE = /^Traceback\s+\(most recent call last\):/;
const PY_EXCEPTION_RE = /^[A-Za-z_][A-Za-z0-9_.]*(?:Error|Exception|Warning|Exit|Interrupt):/;

function isPyUserLand(normalizedFile: string): boolean {
  if (!normalizedFile) return false;
  if (
    normalizedFile.includes("/site-packages/") ||
    normalizedFile.includes("/dist-packages/") ||
    normalizedFile.includes("/lib/python") ||
    normalizedFile.startsWith("<frozen ")
  ) {
    return false;
  }
  return true;
}

export const pyParser: RuntimeParser = {
  runtime: "python",

  score(lines: string[]): number {
    let hits = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (PY_TRACEBACK_RE.test(trimmed)) hits += 5;
      else if (PY_FRAME_RE.test(line)) hits += 3;
      else if (PY_EXCEPTION_RE.test(trimmed)) hits += 2;
    }
    return hits;
  },

  isHeaderLine(line: string): boolean {
    const trimmed = line.trim();
    return PY_TRACEBACK_RE.test(trimmed) || PY_EXCEPTION_RE.test(trimmed);
  },

  parseFrame(line: string): StackFrame | null {
    const match = PY_FRAME_RE.exec(line);
    if (!match) return null;
    const [, rawFile, lineStr, fnName] = match;
    const file = normalizeFramePath(rawFile ?? "");
    return {
      file,
      line: Number(lineStr),
      functionName: fnName?.trim(),
      isUserLand: isPyUserLand(file),
      rawLine: line
    };
  },

  /**
   * Python tracebacks are printed top-down (entrypoint first, actual crash last).
   * Reverse frames so the terminal/root-cause frame is prioritized first.
   */
  postProcessFrames(frames: StackFrame[]): StackFrame[] {
    return [...frames].reverse();
  }
};
