import type { RuntimeType } from "../../types/core.js";
import { dockerParser } from "./dockerParser.js";
import { jsParser } from "./jsParser.js";
import { pyParser } from "./pyParser.js";
import type { RuntimeParser } from "./types.js";

const PARSERS: RuntimeParser[] = [jsParser, pyParser, dockerParser];

export const unknownParser: RuntimeParser = {
  runtime: "unknown",
  score: () => 0,
  isHeaderLine: (line: string) => /\b(?:FATAL|ERROR|CRITICAL|PANIC|Exception)\b/i.test(line),
  parseFrame: () => null
};

export function detectRuntime(lines: string[]): RuntimeType {
  let bestRuntime: RuntimeType = "unknown";
  let bestScore = 0;

  for (const parser of PARSERS) {
    const s = parser.score(lines);
    if (s > bestScore) {
      bestScore = s;
      bestRuntime = parser.runtime;
    }
  }

  return bestRuntime;
}

export function getParser(runtime: RuntimeType): RuntimeParser {
  return PARSERS.find((p) => p.runtime === runtime) ?? unknownParser;
}

export type { RuntimeParser };
