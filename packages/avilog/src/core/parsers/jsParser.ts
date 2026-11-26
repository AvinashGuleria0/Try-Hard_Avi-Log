import type { StackFrame } from "../../types/core.js";
import { normalizeFramePath, type RuntimeParser } from "./types.js";

const JS_FRAME_WITH_FN = /^\s*at\s+(?:async\s+)?(.+?)\s+\((.+?):(\d+):(\d+)\)\s*$/;
const JS_FRAME_BARE = /^\s*at\s+(?:async\s+)?(.+?):(\d+):(\d+)\s*$/;
const JS_HEADER_RE =
  /^(?:[A-Z][a-zA-Z0-9_]*(?:Error|Exception)|PrismaClient\w*Error|UnhandledPromiseRejection|Error:|⨯\s+|\[ERROR\]|FATAL)/;

function isJsUserLand(normalizedFile: string): boolean {
  if (!normalizedFile) return false;
  if (
    normalizedFile.includes("/node_modules/") ||
    normalizedFile.startsWith("node_modules/") ||
    normalizedFile.startsWith("node:") ||
    normalizedFile.startsWith("bun:") ||
    normalizedFile.startsWith("internal/") ||
    normalizedFile === "<anonymous>"
  ) {
    return false;
  }
  return true;
}

export const jsParser: RuntimeParser = {
  runtime: "js-ts",

  score(lines: string[]): number {
    let hits = 0;
    for (const line of lines) {
      if (JS_FRAME_WITH_FN.test(line) || JS_FRAME_BARE.test(line)) {
        hits += 3;
      } else if (JS_HEADER_RE.test(line.trim())) {
        hits += 1;
      }
    }
    return hits;
  },

  isHeaderLine(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("at ")) return false;
    return (
      JS_HEADER_RE.test(trimmed) ||
      /\b(?:Error|Exception):\s+/.test(trimmed) ||
      /\b(?:FATAL|ERROR|CRITICAL)\b/.test(trimmed)
    );
  },

  parseFrame(line: string): StackFrame | null {
    const withFn = JS_FRAME_WITH_FN.exec(line);
    if (withFn) {
      const [, fnName, rawFile, lineStr, colStr] = withFn;
      const file = normalizeFramePath(rawFile ?? "");
      return {
        file,
        line: Number(lineStr),
        column: Number(colStr),
        functionName: fnName?.trim(),
        isUserLand: isJsUserLand(file),
        rawLine: line
      };
    }

    const bare = JS_FRAME_BARE.exec(line);
    if (bare) {
      const [, rawFile, lineStr, colStr] = bare;
      const file = normalizeFramePath(rawFile ?? "");
      return {
        file,
        line: Number(lineStr),
        column: Number(colStr),
        isUserLand: isJsUserLand(file),
        rawLine: line
      };
    }

    return null;
  }
};
