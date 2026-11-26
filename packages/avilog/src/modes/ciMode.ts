import { readFileSync } from "node:fs";
import { runDiagnosisPipeline, type PipelineOutput } from "../core/pipeline.js";
import type { PromptTarget } from "../types/core.js";

export function formatCiMarkdown(output: PipelineOutput): string {
  const { compacted, diagnosis, redactedCount } = output;
  const userFrames = compacted.primaryCluster.frames
    .filter((f) => f.isUserLand)
    .slice(0, 5)
    .map((f) => `- \`${f.file}:${f.line}\`${f.functionName ? ` (${f.functionName})` : ""}`)
    .join("\n");

  return [
    "<!-- avilog-ci-report -->",
    `## avilog CI Root-Cause Diagnosis: ${diagnosis.rootCauseTitle}`,
    "",
    `| Metric | Value |`,
    `| --- | --- |`,
    `| Runtime | \`${compacted.runtime}\` |`,
    `| Log Compaction | ${compacted.totalRawLines} -> ${compacted.compactedLines} lines (**${compacted.reductionPercent}%** reduced) |`,
    `| Secrets Redacted | ${redactedCount} |`,
    `| Diagnosis Source | \`${diagnosis.source}\` (${diagnosis.inferenceTimeMs}ms) |`,
    "",
    `**Explanation:** ${diagnosis.explanation}`,
    userFrames ? `\n**Implicated User-Land Frames:**\n${userFrames}` : "",
    "",
    "<details>",
    "<summary>Copy-Paste AI Fix Prompt</summary>",
    "",
    "```markdown",
    diagnosis.targetPrompt,
    "```",
    "",
    "</details>"
  ]
    .filter(Boolean)
    .join("\n");
}

function extractPrNumber(eventPath?: string): number | null {
  if (!eventPath) return null;
  try {
    const payload = JSON.parse(readFileSync(eventPath, "utf8")) as {
      pull_request?: { number?: number };
      number?: number;
    };
    return payload.pull_request?.number ?? payload.number ?? null;
  } catch {
    return null;
  }
}

export async function postGithubPrComment(markdown: string): Promise<boolean> {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const prNumber = extractPrNumber(process.env.GITHUB_EVENT_PATH);

  if (!token || !repo || !prNumber) return false;

  const url = `https://api.github.com/repos/${repo}/issues/${prNumber}/comments`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "avilog-ci"
      },
      body: JSON.stringify({ body: markdown })
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function runCiMode(options: {
  logText: string;
  target: PromptTarget;
  localOnly: boolean;
  fresh: boolean;
}): Promise<{ exitCode: number; markdown: string; posted: boolean }> {
  const output = await runDiagnosisPipeline({
    text: options.logText,
    target: options.target,
    localOnly: options.localOnly,
    fresh: options.fresh,
    copyClipboard: false
  });

  const markdown = formatCiMarkdown(output);
  const posted = await postGithubPrComment(markdown);
  console.log(markdown);

  return { exitCode: 0, markdown, posted };
}
