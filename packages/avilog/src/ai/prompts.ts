import type { CompactedLog, DiagnosisResult, HydratedContext } from "../types/core.js";

export const SYSTEM_PROMPT = `You are avilog, an expert root-cause debugging engine.
Analyze the compacted error log and hydrated local source code.
Respond ONLY with a valid JSON object matching this exact schema:
{
  "confidence": number (0-100),
  "rootCauseTitle": string (concise 4-10 word title),
  "explanation": string (clear 1-3 sentence root cause explanation),
  "causalChain": string[] (ordered steps from initial trigger to crash),
  "fixSteps": string[] (concrete actionable fix steps),
  "unifiedDiff": string | null (optional valid unified git diff starting with --- a/... and +++ b/... if a clear minimal fix exists, otherwise null)
}`;

export function buildAiDiagnosisMessages(
  compacted: CompactedLog,
  contexts: HydratedContext[]
): { system: string; user: string } {
  const cascades = compacted.cascadeClusters
    .map((c) => `- [${c.level}] ${c.header} (repeated ${c.repeatCount}x)`)
    .join("\n");

  const contextSection = contexts
    .map((c) => {
      const meta = c.lastCommitMeta ? `Last commit: ${c.lastCommitMeta}\n` : "";
      const diff = c.gitDiff ? `Git diff:\n${c.gitDiff}\n` : "";
      return `=== ${c.file}:${c.line} ===\n${meta}${c.codeWindow}\n${diff}`;
    })
    .join("\n");

  const user = [
    `Runtime: ${compacted.runtime}`,
    `Primary Error Header: ${compacted.primaryCluster.header}`,
    `Repeat Count: ${compacted.primaryCluster.repeatCount}`,
    "",
    "Primary Snippet:",
    compacted.primaryCluster.rawSnippet.join("\n"),
    cascades ? `\nDownstream Cascades:\n${cascades}` : "",
    contextSection ? `\nHydrated Local Code:\n${contextSection}` : ""
  ]
    .filter(Boolean)
    .join("\n");

  return { system: SYSTEM_PROMPT, user };
}

interface RawAiPayload {
  confidence?: unknown;
  rootCauseTitle?: unknown;
  explanation?: unknown;
  causalChain?: unknown;
  fixSteps?: unknown;
  unifiedDiff?: unknown;
}

export function parseDiagnosisJson(
  rawText: string,
  source: DiagnosisResult["source"],
  inferenceTimeMs: number
): Omit<DiagnosisResult, "targetPrompt"> | null {
  const trimmed = rawText.trim();
  const jsonText = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "");

  let parsed: RawAiPayload;
  try {
    parsed = JSON.parse(jsonText) as RawAiPayload;
  } catch {
    return null;
  }

  if (typeof parsed.rootCauseTitle !== "string" || typeof parsed.explanation !== "string") {
    return null;
  }

  const confidence =
    typeof parsed.confidence === "number"
      ? Math.max(0, Math.min(100, Math.round(parsed.confidence)))
      : 80;

  const causalChain = Array.isArray(parsed.causalChain)
    ? parsed.causalChain.filter((x): x is string => typeof x === "string")
    : [];

  const fixSteps = Array.isArray(parsed.fixSteps)
    ? parsed.fixSteps.filter((x): x is string => typeof x === "string")
    : [];

  const unifiedDiff =
    typeof parsed.unifiedDiff === "string" && parsed.unifiedDiff.includes("@@")
      ? parsed.unifiedDiff
      : undefined;

  return {
    source,
    confidence,
    rootCauseTitle: parsed.rootCauseTitle,
    explanation: parsed.explanation,
    causalChain,
    fixSteps,
    unifiedDiff,
    inferenceTimeMs
  };
}
