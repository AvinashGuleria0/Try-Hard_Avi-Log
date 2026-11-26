import { spawn } from "node:child_process";
import { runDiagnosisPipeline } from "../core/pipeline.js";
import type { PromptTarget } from "../types/core.js";

const ERROR_TRIGGER_RE = /\b(?:UnhandledPromiseRejection|Error:|Traceback\s+\(most recent call last\):|500 Internal Server Error|FATAL|PrismaClient\w*Error)\b/;

export interface WatchOptions {
  command: string[];
  target: PromptTarget;
  localOnly: boolean;
  fresh: boolean;
  cwd?: string;
}

export async function runWatchMode(options: WatchOptions): Promise<number> {
  const [cmd, ...rawArgs] = options.command;
  if (!cmd) {
    console.error("avilog watch: missing command after --");
    return 1;
  }

  const args =
    process.platform === "win32"
      ? rawArgs.map((a) => (/\s/.test(a) && !a.startsWith('"') ? `"${a}"` : a))
      : rawArgs;

  console.log(`[avilog watch] Supervising: ${cmd} ${rawArgs.join(" ")}`);

  const child = spawn(cmd, args, {
    cwd: options.cwd ?? process.cwd(),
    stdio: ["inherit", "pipe", "pipe"],
    shell: process.platform === "win32"
  });

  const ringBuffer: string[] = [];
  const maxLines = 2000;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let diagnosing = false;

  const pushChunk = (chunk: Buffer, isErr: boolean) => {
    const text = chunk.toString("utf8");
    if (isErr) process.stderr.write(text);
    else process.stdout.write(text);

    const lines = text.split(/\r?\n/);
    let triggered = false;
    for (const line of lines) {
      if (!line) continue;
      ringBuffer.push(line);
      if (ringBuffer.length > maxLines) ringBuffer.shift();
      if (ERROR_TRIGGER_RE.test(line)) triggered = true;
    }

    if (triggered && !diagnosing) {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        diagnosing = true;
        try {
          const snapshot = ringBuffer.join("\n");
          const result = await runDiagnosisPipeline({
            text: snapshot,
            target: options.target,
            localOnly: options.localOnly,
            fresh: options.fresh,
            cwd: options.cwd
          });
          console.error(
            `\n[avilog watch] Detected: ${result.diagnosis.rootCauseTitle} (${result.compacted.reductionPercent}% compacted${result.copiedToClipboard ? ", prompt copied" : ""})`
          );
        } finally {
          diagnosing = false;
        }
      }, 800);
    }
  };

  child.stdout?.on("data", (d: Buffer) => pushChunk(d, false));
  child.stderr?.on("data", (d: Buffer) => pushChunk(d, true));

  return await new Promise<number>((resolve) => {
    child.on("close", (code) => {
      if (debounceTimer) clearTimeout(debounceTimer);
      resolve(code ?? 0);
    });
  });
}
