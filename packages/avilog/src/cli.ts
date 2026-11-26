#!/usr/bin/env node
import { AVILOG_VERSION } from "./index.js";

export function formatHelp(): string {
  return [
    `avilog v${AVILOG_VERSION} — Deterministic log compactor & AI fix prompt engine`,
    "",
    "Usage:",
    "  avilog -- <command> [args...]     Run command and diagnose on failure",
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

export async function runCli(argv: string[]): Promise<number> {
  if (argv.includes("-v") || argv.includes("--version")) {
    console.log(`avilog v${AVILOG_VERSION}`);
    return 0;
  }

  console.log(formatHelp());
  return 0;
}

if (import.meta.main) {
  const code = await runCli(process.argv.slice(2));
  process.exit(code);
}
