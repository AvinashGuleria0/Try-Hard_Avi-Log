import { generateTargetPrompt } from "../core/promptGen.js";
import type { CompactedLog, DiagnosisResult, HydratedContext, PromptTarget } from "../types/core.js";

function inferHeuristicHints(header: string): { title: string; fixSteps: string[] } {
  if (/PrismaClient\w*Error/i.test(header) || /does not exist in the current database/i.test(header)) {
    return {
      title: "Database schema / Prisma client mismatch",
      fixSteps: [
        "Verify your Prisma schema matches the target database columns.",
        "Run `bunx prisma migrate dev` or `bunx prisma db push` and regenerate the client with `bunx prisma generate`."
      ]
    };
  }
  if (/ECONNREFUSED/i.test(header)) {
    return {
      title: "Connection refused to downstream service",
      fixSteps: [
        "Verify the target database or service is running and listening on the expected host/port.",
        "Check `.env` connection strings and retry/healthcheck configuration."
      ]
    };
  }
  if (/\b(?:ERESOLVE|peer dependency|peerDependencies)\b/i.test(header)) {
    return {
      title: "Package peer-dependency resolution conflict",
      fixSteps: [
        "Align the conflicting package versions in `package.json`.",
        "Check if an override/resolution or compatible library version resolves the peer constraint."
      ]
    };
  }
  if (/KeyError:/i.test(header)) {
    return {
      title: "Missing dictionary key lookup (KeyError)",
      fixSteps: [
        "Use `.get(key, default)` or validate the key exists before indexing.",
        "Verify upstream payload or configuration includes the missing key."
      ]
    };
  }
  if (/TypeError: Cannot read properties of (?:undefined|null)/i.test(header)) {
    return {
      title: "Null or undefined property dereference",
      fixSteps: [
        "Add a null/undefined guard or optional chaining (`?.`) at the offending line.",
        "Trace why the upstream caller returned `undefined`/`null`."
      ]
    };
  }

  return {
    title: header.slice(0, 72) || "Unhandled runtime failure",
    fixSteps: [
      "Inspect the primary user-land stack frame and surrounding local code window.",
      "Review any recent `git diff` changes in the implicated file."
    ]
  };
}

export function buildDeterministicDiagnosis(
  compacted: CompactedLog,
  contexts: HydratedContext[],
  target: PromptTarget
): DiagnosisResult {
  const start = performance.now();
  const header = compacted.primaryCluster.header;
  const topFrame = compacted.primaryCluster.frames.find((f) => f.isUserLand) ?? compacted.primaryCluster.frames[0];
  const hints = inferHeuristicHints(header);

  const location = topFrame ? `${topFrame.file}:${topFrame.line}` : "unknown location";
  const explanation = `Deterministic analysis (${compacted.runtime}) isolated "${header}" at ${location} after compacting ${compacted.totalRawLines} lines to ${compacted.compactedLines} (${compacted.reductionPercent}% reduction).`;

  const causalChain = [
    `Primary trigger: ${header}`,
    ...(topFrame ? [`First implicated frame: ${location}`] : []),
    ...compacted.cascadeClusters.slice(0, 2).map((c) => `Cascade: ${c.header} (${c.repeatCount}x)`)
  ];

  const targetPrompt = generateTargetPrompt(target, compacted, contexts, {
    rootCauseTitle: hints.title,
    explanation,
    fixSteps: hints.fixSteps
  });

  return {
    source: "deterministic-fallback",
    confidence: topFrame?.isUserLand ? 75 : 55,
    rootCauseTitle: hints.title,
    explanation,
    causalChain,
    fixSteps: hints.fixSteps,
    targetPrompt,
    inferenceTimeMs: Number((performance.now() - start).toFixed(2))
  };
}
