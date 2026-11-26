import type { StackFrame } from "../../types/core.js";
import { normalizeFramePath, type RuntimeParser } from "./types.js";

const DOCKER_ERROR_RE =
  /^(?:#\d+\s+ERROR:|ERROR:\s+failed to solve:|executor failed running|COPY failed:|npm error\b|npm ERR!|ERR_PNPM_|ERESOLVE\b|error:\s+bun\b|Killed\b|OOMKilled\b)/i;
const DOCKERFILE_REF_RE = /(Dockerfile(?:\.[a-zA-Z0-9_-]+)?):(\d+)/;

export const dockerParser: RuntimeParser = {
  runtime: "docker-build",

  score(lines: string[]): number {
    let hits = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^#\d+\s+\[/.test(trimmed) || /^#\d+\s+ERROR:/.test(trimmed)) hits += 4;
      else if (DOCKER_ERROR_RE.test(trimmed)) hits += 3;
    }
    return hits;
  },

  isHeaderLine(line: string): boolean {
    return DOCKER_ERROR_RE.test(line.trim());
  },

  parseFrame(line: string): StackFrame | null {
    const match = DOCKERFILE_REF_RE.exec(line);
    if (!match) return null;
    const [, rawFile, lineStr] = match;
    const file = normalizeFramePath(rawFile ?? "Dockerfile");
    return {
      file,
      line: Number(lineStr),
      isUserLand: true,
      rawLine: line
    };
  }
};
