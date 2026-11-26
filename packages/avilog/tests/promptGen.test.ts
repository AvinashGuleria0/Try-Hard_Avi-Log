import { describe, expect, test } from "bun:test";
import { buildDeterministicDiagnosis } from "../src/ai/fallback.js";
import { parseDiagnosisJson } from "../src/ai/prompts.js";
import { compactText } from "../src/core/compactor.js";
import { generateTargetPrompt } from "../src/core/promptGen.js";

describe("prompt generator & deterministic fallback", () => {
  const sampleLog = [
    "TypeError: Cannot read properties of undefined (reading 'map')",
    "    at renderList (src/components/List.tsx:14:9)"
  ].join("\n");

  test("buildDeterministicDiagnosis produces structured result and cursor prompt", () => {
    const compacted = compactText(sampleLog);
    const result = buildDeterministicDiagnosis(compacted, [], "cursor");

    expect(result.source).toBe("deterministic-fallback");
    expect(result.rootCauseTitle).toContain("Null or undefined");
    expect(result.targetPrompt).toContain("surgical change");
    expect(result.targetPrompt).toContain("src/components/List.tsx:14");
  });

  test("generateTargetPrompt formats issue and raw targets distinctly", () => {
    const compacted = compactText(sampleLog);
    const summary = {
      rootCauseTitle: "Undefined list prop",
      explanation: "List prop is undefined on initial render.",
      fixSteps: ["Default items to []"]
    };

    const issuePrompt = generateTargetPrompt("issue", compacted, [], summary);
    expect(issuePrompt).toContain("### Bug Report: Undefined list prop");

    const rawPrompt = generateTargetPrompt("raw", compacted, [], summary);
    expect(rawPrompt).toContain("Root Cause: Undefined list prop");
  });

  test("parseDiagnosisJson parses fenced JSON responses cleanly", () => {
    const raw = '```json\n{"confidence":91,"rootCauseTitle":"Missing env","explanation":"DB_URL missing","causalChain":["boot"],"fixSteps":["set DB_URL"],"unifiedDiff":null}\n```';
    const parsed = parseDiagnosisJson(raw, "cloud", 120);
    expect(parsed).not.toBeNull();
    expect(parsed?.confidence).toBe(91);
    expect(parsed?.rootCauseTitle).toBe("Missing env");
  });
});
