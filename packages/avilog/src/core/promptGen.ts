import { spawnSync } from "node:child_process";
import type { CompactedLog, HydratedContext, PromptTarget } from "../types/core.js";

export interface PromptDiagnosisSummary {
  rootCauseTitle: string;
  explanation: string;
  fixSteps: string[];
}

export function generateTargetPrompt(
  target: PromptTarget,
  compacted: CompactedLog,
  contexts: HydratedContext[],
  diagnosis: PromptDiagnosisSummary
): string {
  const userFrames = compacted.primaryCluster.frames
    .filter((f) => f.isUserLand)
    .slice(0, 5)
    .map((f) => `- ${f.file}:${f.line}${f.functionName ? ` (${f.functionName})` : ""}`)
    .join("\n");

  const codeBlocks = contexts
    .map((ctx) => {
      const meta = ctx.lastCommitMeta ? `\nLast commit: ${ctx.lastCommitMeta}` : "";
      const diff = ctx.gitDiff ? `\nRecent git diff:\n\`\`\`diff\n${ctx.gitDiff}\n\`\`\`` : "";
      return `File: ${ctx.file}:${ctx.line}${meta}\n\`\`\`\n${ctx.codeWindow}\n\`\`\`${diff}`;
    })
    .join("\n\n");

  const snippet = compacted.primaryCluster.rawSnippet.join("\n");
  const steps = diagnosis.fixSteps.map((s, i) => `${i + 1}. ${s}`).join("\n");

  if (target === "raw") {
    return [
      `Root Cause: ${diagnosis.rootCauseTitle}`,
      `Runtime: ${compacted.runtime} | Reduced ${compacted.totalRawLines} -> ${compacted.compactedLines} lines (${compacted.reductionPercent}%)`,
      "",
      diagnosis.explanation,
      "",
      "Error Snippet:",
      snippet,
      userFrames ? `\nUser-Land Frames:\n${userFrames}` : "",
      codeBlocks ? `\nCode Context:\n${codeBlocks}` : ""
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (target === "issue") {
    return [
      `### Bug Report: ${diagnosis.rootCauseTitle}`,
      "",
      `**Runtime:** \`${compacted.runtime}\` | **Log Reduction:** ${compacted.totalRawLines} -> ${compacted.compactedLines} lines (${compacted.reductionPercent}%)`,
      "",
      "#### Summary",
      diagnosis.explanation,
      "",
      "#### Primary Error",
      "```",
      snippet,
      "```",
      userFrames ? `\n#### Implicated Files\n${userFrames}` : "",
      steps ? `\n#### Suggested Fix Steps\n${steps}` : ""
    ]
      .filter(Boolean)
      .join("\n");
  }

  const assistantHeader: Record<Exclude<PromptTarget, "raw" | "issue">, string> = {
    cursor: "You are fixing a bug in my workspace. Apply the minimal, surgical change directly to the implicated file(s) without refactoring unrelated code.",
    claude: "Diagnose and fix the root cause below. Prefer a minimal diff on the implicated user-land file(s) and explain any edge cases.",
    gemini: "Analyze the root cause and local code context below, then provide the exact minimal fix for the implicated file(s)."
  };

  return [
    assistantHeader[target],
    "",
    `## Root Cause: ${diagnosis.rootCauseTitle}`,
    diagnosis.explanation,
    "",
    `## Primary Error (${compacted.runtime})`,
    "```",
    snippet,
    "```",
    userFrames ? `\n## Implicated User-Land Frames\n${userFrames}` : "",
    codeBlocks ? `\n## Local Source Context\n${codeBlocks}` : "",
    steps ? `\n## Recommended Fix Steps\n${steps}` : "",
    "",
    "## Constraints",
    "- Only modify files inside the workspace.",
    "- Preserve existing public interfaces and unrelated behavior."
  ]
    .filter(Boolean)
    .join("\n");
}

export function copyToClipboard(text: string): boolean {
  const platform = process.platform;
  try {
    if (platform === "win32") {
      const res = spawnSync("clip", [], { input: text, encoding: "utf8" });
      return res.status === 0;
    }
    if (platform === "darwin") {
      const res = spawnSync("pbcopy", [], { input: text, encoding: "utf8" });
      return res.status === 0;
    }
    for (const [cmd, args] of [
      ["wl-copy", []],
      ["xclip", ["-selection", "clipboard"]],
      ["xsel", ["--clipboard", "--input"]]
    ] as const) {
      const res = spawnSync(cmd, [...args], { input: text, encoding: "utf8" });
      if (res.status === 0) return true;
    }
  } catch {
    return false;
  }
  return false;
}
