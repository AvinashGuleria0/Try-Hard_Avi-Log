import type { RuntimeType, StackFrame } from "../../types/core.js";

export interface RuntimeParser {
  runtime: RuntimeType;
  score(lines: string[]): number;
  isHeaderLine(line: string): boolean;
  parseFrame(line: string): StackFrame | null;
  postProcessFrames?(frames: StackFrame[]): StackFrame[];
}

export function normalizeFramePath(rawPath: string): string {
  let cleaned = rawPath.trim().replace(/^file:\/\/\//, "").replace(/^file:\/\//, "");
  // Convert Windows backslashes to forward slashes for consistent matching
  cleaned = cleaned.replace(/\\/g, "/");
  // Strip webpack/turbopack/rsc prefixes if present
  cleaned = cleaned.replace(/^(?:webpack-internal:\/\/\/|rsc:\/\/\/|\(rsc\)\/)/, "");
  return cleaned;
}
