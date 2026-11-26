#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { applyPatch, undoLastPatch } from "./core/patcher.js";
import { runDiagnosisPipeline, type PipelineOutput } from "./core/pipeline.js";
import { copyToClipboard } from "./core/promptGen.js";
import { AVILOG_VERSION } from "./index.js";
import { runBenchSuite } from "./modes/benchMode.js";
import { runCiMode } from "./modes/ciMode.js";
import { runWatchMode } from "./modes/watchMode.js";
import { startUiServer } from "./server/uiServer.js";
import type { CliOptions, PromptTarget } from "./types/core.js";

const VALID_TARGETS = new Set<PromptTarget>(["cursor", "claude", "gemini", "issue", "raw"]);

export function formatHelp(): string {
  return [
    `avilog v${AVILOG_VERSION} — Deterministic log compactor & AI fix prompt engine`,
    "",
    "Usage:",
    "  avilog -- <command> [args...]     Run command and diagnose on failure",
    "  <cmd> 2>&1 | avilog               Read piped logs from stdin",
    "  avilog analyze <logfile>          Analyze an existing log file",
    "  avilog watch -- <command>         Watch dev server and capture runtime errors",
    "  avilog ci [logfile]               Run non-interactive CI/CD PR diagnosis",
    "  avilog undo                       Revert the last applied patch",
    "  avilog bench                      Run benchmark suite against fixtures",
    "",
    "Flags:",
    "  --target <cursor|claude|gemini|issue|raw>  Format prompt for target assistant",
    "  --local                           Use local Ollama model offline",
    "  --fresh                           Bypass local fingerprint cache",
    "  --ui                              Open local Web Inspector on localhost:4321",
    "  -v, --version                     Show version",
    "  -h, --help                        Show help"
  ].join("\n");
}

export function parseCliArgs(argv: string[], stdinIsTTY = process.stdin.isTTY): CliOptions {
  let target: PromptTarget = "cursor";
  let local = false;
  let fresh = false;
  let ui = false;
  const positional: string[] = [];
  let command: string[] | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") {
      command = argv.slice(i + 1);
      break;
    }
    if (arg === "-v" || arg === "--version") {
      return { mode: "version", target, local, fresh, ui };
    }
    if (arg === "-h" || arg === "--help") {
      return { mode: "help", target, local, fresh, ui };
    }
    if (arg === "--local") {
      local = true;
      continue;
    }
    if (arg === "--fresh") {
      fresh = true;
      continue;
    }
    if (arg === "--ui") {
      ui = true;
      continue;
    }
    if (arg === "--target" && argv[i + 1]) {
      const candidate = argv[i + 1] as PromptTarget;
      if (VALID_TARGETS.has(candidate)) target = candidate;
      i++;
      continue;
    }
    if (arg.startsWith("--target=")) {
      const candidate = arg.slice(9) as PromptTarget;
      if (VALID_TARGETS.has(candidate)) target = candidate;
      continue;
    }
    positional.push(arg);
  }

  const sub = positional[0];
  if (sub === "watch") {
    return { mode: "watch", target, local, fresh, ui, command: command ?? positional.slice(1) };
  }
  if (sub === "ci") {
    return { mode: "ci", target, local, fresh, ui, filePath: positional[1] };
  }
  if (sub === "undo") {
    return { mode: "undo", target, local, fresh, ui };
  }
  if (sub === "bench") {
    return { mode: "bench", target, local, fresh, ui };
  }
  if (sub === "analyze") {
    return { mode: "analyze", target, local, fresh, ui, filePath: positional[1] };
  }
  if (command && command.length > 0) {
    return { mode: "wrap", target, local, fresh, ui, command };
  }
  if (!stdinIsTTY) {
    return { mode: "pipe", target, local, fresh, ui };
  }

  return { mode: "help", target, local, fresh, ui };
}

function printDiagnosisCard(output: PipelineOutput): void {
  const { compacted, diagnosis, redactedCount, copiedToClipboard } = output;
  const topUserFrame = compacted.primaryCluster.frames.find((f) => f.isUserLand);
  const frameLoc = topUserFrame ? `${topUserFrame.file}:${topUserFrame.line}` : "N/A";

  console.error("\n┌─────────────────────────────────────────────────────────────────────────┐");
  console.error(`│ avilog diagnosis (${diagnosis.source}, ${diagnosis.inferenceTimeMs}ms)`);
  console.error("├─────────────────────────────────────────────────────────────────────────┤");
  console.error(`│ Root Cause : ${diagnosis.rootCauseTitle}`);
  console.error(`│ Runtime    : ${compacted.runtime} | Top Frame: ${frameLoc}`);
  console.error(
    `│ Compaction : ${compacted.totalRawLines} -> ${compacted.compactedLines} lines (${compacted.reductionPercent}% reduced)`
  );
  console.error(`│ Secrets    : ${redactedCount} redacted | Clipboard: ${copiedToClipboard ? "COPIED" : "NOT COPIED"}`);
  console.error("├─────────────────────────────────────────────────────────────────────────┤");
  console.error(`│ ${diagnosis.explanation}`);
  if (diagnosis.fixSteps.length > 0) {
    console.error("│ Fix Steps:");
    for (const step of diagnosis.fixSteps.slice(0, 3)) {
      console.error(`│   • ${step}`);
    }
  }
  console.error("└─────────────────────────────────────────────────────────────────────────┘");
}

async function launchWebUi(output: PipelineOutput): Promise<void> {
  const handle = await startUiServer(output, 4321);
  console.error(`\n[avilog] Web Inspector running at ${handle.url} (press Ctrl+C to stop)`);
  await new Promise<void>((resolveStop) => {
    process.once("SIGINT", () => {
      void handle.close().then(resolveStop);
    });
  });
}

async function promptInteractiveActions(output: PipelineOutput): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY || process.env.CI || process.env.NODE_ENV === "test") return;

  console.error("[a] Apply Patch   [c] Re-copy AI Prompt   [u] Open in Web UI   [q] Quit");
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise<string>((resolveAnswer) => {
    rl.question("> ", (ans) => {
      rl.close();
      resolveAnswer(ans.trim().toLowerCase());
    });
  });

  if (answer === "c") {
    const ok = copyToClipboard(output.diagnosis.targetPrompt);
    console.error(ok ? "Copied AI prompt to clipboard." : "Clipboard unavailable.");
  } else if (answer === "u") {
    await launchWebUi(output);
  } else if (answer === "a") {
    if (!output.diagnosis.unifiedDiff) {
      console.error("No unified diff was generated for this diagnosis. Use the clipboard prompt instead.");
      return;
    }
    const res = applyPatch(output.diagnosis.unifiedDiff);
    console.error(res.message);
  }
}

async function readStdinText(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function runWrapCommand(command: string[]): Promise<{ exitCode: number; capturedOutput: string }> {
  const [cmd, ...rawArgs] = command;
  if (!cmd) return { exitCode: 1, capturedOutput: "" };

  const args =
    process.platform === "win32"
      ? rawArgs.map((a) => (/\s/.test(a) && !a.startsWith('"') ? `"${a}"` : a))
      : rawArgs;

  const child = spawn(cmd, args, {
    stdio: ["inherit", "pipe", "pipe"],
    shell: process.platform === "win32"
  });

  const chunks: string[] = [];
  child.stdout?.on("data", (d: Buffer) => {
    const s = d.toString("utf8");
    process.stdout.write(s);
    chunks.push(s);
  });
  child.stderr?.on("data", (d: Buffer) => {
    const s = d.toString("utf8");
    process.stderr.write(s);
    chunks.push(s);
  });

  const exitCode = await new Promise<number>((resolveCode) => {
    child.on("close", (code) => resolveCode(code ?? 1));
  });

  return { exitCode, capturedOutput: chunks.join("") };
}

export async function runCli(argv: string[], options?: { interactive?: boolean }): Promise<number> {
  const interactive = options?.interactive ?? true;
  const opts = parseCliArgs(argv);

  if (opts.mode === "version") {
    console.log(`avilog v${AVILOG_VERSION}`);
    return 0;
  }

  if (opts.mode === "help") {
    console.log(formatHelp());
    return 0;
  }

  if (opts.mode === "undo") {
    const res = undoLastPatch();
    console.log(res.message);
    return res.restored ? 0 : 1;
  }

  if (opts.mode === "bench") {
    const here = dirname(fileURLToPath(import.meta.url));
    const fixturesDir = resolve(here, "../tests/fixtures");
    const summary = runBenchSuite(existsSync(fixturesDir) ? fixturesDir : undefined);
    console.log(`avilog bench (${summary.fixturesRun} fixtures)`);
    console.log(`Average reduction : ${summary.avgReductionPercent}%`);
    console.log(`Average parse time: ${summary.avgParseTimeMs} ms`);
    for (const r of summary.results) {
      console.log(
        `  - ${r.name}: ${r.rawLines} -> ${r.compactedLines} lines (${r.reductionPercent}%) in ${r.parseTimeMs}ms [${r.redactedCount} secrets]`
      );
    }
    return 0;
  }

  if (opts.mode === "watch") {
    return await runWatchMode({
      command: opts.command ?? [],
      target: opts.target,
      localOnly: opts.local,
      fresh: opts.fresh
    });
  }

  if (opts.mode === "ci") {
    let logText = "";
    if (opts.filePath) {
      if (!existsSync(opts.filePath)) {
        console.error(`avilog ci: file not found: ${opts.filePath}`);
        return 1;
      }
      logText = readFileSync(opts.filePath, "utf8");
    } else {
      logText = await readStdinText();
    }
    const res = await runCiMode({
      logText,
      target: opts.target,
      localOnly: opts.local,
      fresh: opts.fresh
    });
    return res.exitCode;
  }

  if (opts.mode === "analyze") {
    if (!opts.filePath || !existsSync(opts.filePath)) {
      console.error(`avilog analyze: file not found: ${opts.filePath ?? "(none)"}`);
      return 1;
    }
    const text = readFileSync(opts.filePath, "utf8");
    const output = await runDiagnosisPipeline({
      text,
      target: opts.target,
      localOnly: opts.local,
      fresh: opts.fresh
    });
    printDiagnosisCard(output);
    if (opts.ui) {
      await launchWebUi(output);
    } else if (interactive) {
      await promptInteractiveActions(output);
    }
    return 0;
  }

  if (opts.mode === "pipe") {
    const text = await readStdinText();
    const output = await runDiagnosisPipeline({
      text,
      target: opts.target,
      localOnly: opts.local,
      fresh: opts.fresh
    });
    printDiagnosisCard(output);
    if (opts.ui) {
      await launchWebUi(output);
    }
    return 0;
  }

  if (opts.mode === "wrap" && opts.command) {
    const { exitCode, capturedOutput } = await runWrapCommand(opts.command);
    if (exitCode === 0) return 0;

    const output = await runDiagnosisPipeline({
      text: capturedOutput,
      target: opts.target,
      localOnly: opts.local,
      fresh: opts.fresh
    });
    printDiagnosisCard(output);
    if (opts.ui) {
      await launchWebUi(output);
    } else if (interactive) {
      await promptInteractiveActions(output);
    }
    return exitCode;
  }

  console.log(formatHelp());
  return 0;
}

if (import.meta.main) {
  const code = await runCli(process.argv.slice(2));
  process.exit(code);
}
