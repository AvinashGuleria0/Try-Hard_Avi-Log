# avilog

**Deterministic Log Compaction, Root-Cause Pinpointing & Context-Aware AI Fix Prompt Engine**

`avilog` is a local-first Bun/Node.js CLI tool, runtime SDK, and local web inspector that turns massive, noisy crash logs into surgical, ready-to-paste AI fix prompts. It deterministically compacts repetitive logs by **95%+**, scrubs secrets locally before any external call, correlates user-land stack frames with your local source code (`±20` lines) and recent `git diff` history, and outputs a targeted fix prompt directly to your clipboard.

---

## Features

- **Streaming Log Compactor:** Streams logs via `ReadableStream`, strips ANSI escape codes, collapses repetitive loops with a 64-entry LRU sliding window, and ranks the earliest causal root cause separately from downstream cascades.
- **Multi-Runtime Parsers:**
  - **JS / TS:** Node.js, Bun, Next.js, Vite, and Prisma stack traces (separating user-land frames from `node_modules` / `node:` / `bun:`).
  - **Python:** FastAPI, Django, and standard tracebacks (automatically reversing Python's top-down trace order so the terminal exception & frame are prioritized first).
  - **Docker & Package Managers:** `Dockerfile` step failures (`#N ERROR:`, `executor failed running`) and `npm` / `pnpm` / `bun` dependency conflicts (`ERESOLVE`, `ERR_PNPM_`).
- **Two-Pass Secret & PII Scrubber:** Redacts API keys (`sk-`, `ghp_`, `AIza`, `xox`), JWTs, database URIs, `.env` assignments, and high-entropy tokens ($H(X) > 4.2$) into reversible local placeholders (`[SECRET_*]`) before any LLM call.
- **Local Code & Git Hydrator:** Extracts `±20` lines around the top 3 unique user-land frames (with path-traversal protection) and attaches `git log` / `git diff HEAD~1` context.
- **Local Crash Knowledge Base:** Caches normalized SHA-256 error fingerprints in `~/.avilog/history.db` via `bun:sqlite` (with automatic JSON fallback in `~/.avilog/history.json` under Node.js).
- **Dual-Engine AI Router + Deterministic Fallback:**
  1. **Local Ollama** (`--local` or `AVILOG_MODE=local`, default `qwen2.5-coder:3b`)
  2. **Cloud LLMs** (`GEMINI_API_KEY`, `GROQ_API_KEY`, or `OPENAI_API_KEY`)
  3. **Zero-API Deterministic Fallback** (always succeeds offline without an LLM)
- **Target-Aware Prompt Generator:** Formats surgical prompts for `--target cursor|claude|gemini|issue|raw` and copies them to the OS clipboard.
- **Safe Patcher & Rollback:** Validates unified diffs against workspace boundaries, snapshots original files to `~/.avilog/backups/`, applies patches, and supports single-command rollback via `avilog undo`.
- **Execution Modes:** Wrapper (`avilog -- <cmd>`), Pipe (`stdin`), Analyze (`avilog analyze <file>`), Watch (`avilog watch -- <cmd>`), CI/CD PR Commenter (`avilog ci`), and Benchmark (`avilog bench`).
- **Local Web Inspector (`--ui`):** Launches a dark-mode React + Tailwind dashboard on `http://localhost:4321` with log-reduction metrics, stack-frame filtering, local code viewer, and one-click prompt target switching.
- **Runtime SDK:** `attachAvilog()` and `captureError()` for programmatic error capture in Bun/Node apps.

---

## Repository Structure

```text
avilog/
├── package.json                  # Bun workspace root
├── tsconfig.base.json            # Strict TypeScript config
├── docs/                         # Product description, HLD, and LLD
├── mock-test/                    # Sample buggy scripts for local testing
├── packages/
│   └── avilog/                   # Core CLI, SDK, parsers, AI router, UI server, & tests
└── apps/
    └── web-inspector/            # Vite + React + Tailwind v4 Web Inspector UI
```

---

## Getting Started

### Prerequisites
- [Bun](https://bun.sh/) `1.4+` (or Node.js `22+` for running the built bundle)

### Install & Build
```powershell
# Install workspace dependencies
bun install

# Build the Web Inspector UI (outputs to packages/avilog/dist/ui)
bun run build:ui

# Build CLI & SDK (outputs to packages/avilog/dist/)
bun run build
```

### Typecheck & Test
```powershell
bun run typecheck
bun test
```

---

## CLI Usage

Run from the repository root with `bun run packages/avilog/src/cli.ts` (or `avilog` if linked globally via `bun link` inside `packages/avilog`):

```powershell
# 1. Wrapper Mode: run any command; auto-diagnose & copy fix prompt on failure
bun run packages/avilog/src/cli.ts -- bun run mock-test/null-crash.ts

# 2. Wrapper Mode + Local Web Inspector (http://localhost:4321)
bun run packages/avilog/src/cli.ts --ui -- bun run mock-test/noisy-retry-crash.ts

# 3. Analyze an existing log file
bun run packages/avilog/src/cli.ts analyze packages/avilog/tests/fixtures/node-prisma-crash.log

# 4. Pipe Mode (stdin)
Get-Content packages/avilog/tests/fixtures/python-fastapi-crash.log | bun run packages/avilog/src/cli.ts

# 5. Watch Mode: supervise a dev server & capture runtime errors
bun run packages/avilog/src/cli.ts watch -- bun run dev

# 6. CI/CD Mode: output collapsible Markdown & post GitHub PR comment
bun run packages/avilog/src/cli.ts ci packages/avilog/tests/fixtures/node-prisma-crash.log

# 7. Revert the last auto-applied patch
bun run packages/avilog/src/cli.ts undo

# 8. Run the 15-fixture compaction & latency benchmark
bun run packages/avilog/src/cli.ts bench
```

### Flags

| Flag | Description |
| --- | --- |
| `--target <cursor\|claude\|gemini\|issue\|raw>` | Format the generated prompt for a specific assistant or issue tracker (default: `cursor`) |
| `--local` | Force offline inference via local Ollama |
| `--fresh` | Bypass the local SQLite/JSON fingerprint cache |
| `--ui` | Launch the Local Web Inspector on `http://localhost:4321` |
| `-v, --version` | Print version |
| `-h, --help` | Print CLI help |

---

## Runtime SDK

```ts
import { attachAvilog, captureError } from "avilog";

// Automatically capture uncaughtException & unhandledRejection
attachAvilog({ target: "cursor" });

// Or capture a caught error manually
try {
  // ...
} catch (err) {
  const result = await captureError(err, { target: "claude" });
  console.log(result.diagnosis.rootCauseTitle);
}
```

---

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `AVILOG_MODE` | Set to `local` to force Ollama offline mode |
| `AVILOG_OLLAMA_URL` | Custom Ollama endpoint (default: `http://localhost:11434/api/chat`) |
| `AVILOG_OLLAMA_MODEL` | Ollama model name (default: `qwen2.5-coder:3b`) |
| `GEMINI_API_KEY` | Enables Google Gemini cloud diagnosis (`AVILOG_GEMINI_MODEL`, default `gemini-2.5-flash`) |
| `GROQ_API_KEY` | Enables Groq cloud diagnosis (`AVILOG_GROQ_MODEL`, default `llama-3.3-70b-versatile`) |
| `OPENAI_API_KEY` | Enables OpenAI cloud diagnosis (`AVILOG_OPENAI_MODEL`, default `gpt-4o-mini`) |
| `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, `GITHUB_EVENT_PATH` | Used by `avilog ci` to post/update PR diagnosis comments |

---

## Trying the `mock-test/` Playground

```powershell
# Dereferencing undefined nested property
bun run packages/avilog/src/cli.ts -- bun run mock-test/null-crash.ts

# 300+ ANSI-colored retry lines + embedded fake secrets + ECONNREFUSED
bun run packages/avilog/src/cli.ts -- bun run mock-test/noisy-retry-crash.ts

# Unhandled promise rejection
bun run packages/avilog/src/cli.ts -- bun run mock-test/async-rejection.ts

# Runtime SDK captureError() demo
bun run mock-test/sdk-demo.ts
```

---

## Documentation

- [Project Description](docs/description.md)
- [High-Level Design (HLD)](docs/hld.md)
- [Low-Level Design (LLD)](docs/lld.md)
