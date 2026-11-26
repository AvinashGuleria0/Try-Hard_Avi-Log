# avilog — Deterministic Log Compaction, Root-Cause Pinpointing & Context-Aware AI Fix Prompt Engine

## 1. Executive Summary
`avilog` is an open-source Bun/npm CLI tool, runtime SDK, and local web inspector built to eliminate the most frustrating bottleneck in software debugging: digging through thousands of lines of noisy stack traces to find what actually broke.

Instead of blindly dumping massive raw logs into AI chatbots—which wastes tokens, triggers context-window truncation, lacks local source code context, and risks leaking `.env` credentials—`avilog` deterministically compacts logs by **over 95%**, scrubs secrets locally, correlates user-land stack frames with your actual files and recent `git diff` history, pinpoints the exact root cause, and copies a surgical, ready-to-paste AI fix prompt directly to your clipboard.

---

## 2. The Problem We Solve
1. **Stack-Trace Noise & Cascade Blindness:** Modern frameworks (Next.js, Prisma, Bun, FastAPI, Docker) emit thousands of lines of cascading errors when a single root failure occurs. Developers waste valuable time scrolling past downstream noise to locate the first causal trigger.
2. **Broken AI Debugging Workflows:** Manually copying raw terminal output into Cursor, Claude, or ChatGPT frequently overflows token limits, strips out the actual local source files and recent Git changes, and forces developers to repeatedly re-explain project context.
3. **Credential & PII Exposure:** Raw server and build logs routinely contain database connection strings, JWTs, API keys, and user PII—creating severe security risks when pasted into external AI tools.
4. **Slow CI/CD Triage:** Failing GitHub Actions workflows bury single-line build errors inside collapsed 15,000-line runner logs.

---

## 3. What `avilog` Finds & Analyzes
When given a failing command, log file, live dev server, or CI build output, `avilog` extracts and surfaces:
- **The Exact Root Cause:** The earliest chronological failure separated from secondary cascading exceptions.
- **User-Land vs. Vendor Frame Separation:** Filters out internal runtime/library noise (`node_modules`, `site-packages`) to highlight the exact file, function, and line number in *your* codebase.
- **Recent Regression Context (`git diff` & `git log`):** Identifies whether the implicated file was modified recently and correlates the crash with recent code changes.
- **Multi-Runtime Error Structures:**
  - **JavaScript / TypeScript:** Node.js, Bun, Next.js SSR/hydration errors, Vite build failures, Prisma schema/migration mismatches.
  - **Python:** FastAPI, Django, and PyTorch tracebacks (automatically reversing Python's bottom-up trace order to prioritize the terminal exception).
  - **Docker & Package Managers:** Multi-stage `Dockerfile` step failures, `bun install` / `npm` peer-dependency conflicts, and OOM exits.
- **Sensitive Credentials & Secrets:** Detects and masks API keys, bearer tokens, database URIs, and high-entropy secrets before any external AI call.

---

## 4. Complete Feature Set

### Core Engine Features
1. **Deterministic Streaming Log Compactor (Zero-AI Pre-Processor):**
   - Streams multi-megabyte logs with flat memory usage (`< 40 MB` RAM).
   - Strips ANSI color sequences, collapses repetitive error loops (`[repeated 1,204x]`), and achieves **95%–99% line/token reduction** before invoking any LLM.
2. **Automatic Secret & PII Scrubber (Security-First by Default):**
   - Two-pass redaction combining deterministic regex patterns (API keys, JWTs, Postgres/Mongo URIs, `.env` values) and Shannon entropy analysis.
   - Maintains a local in-memory map so secrets never leave your machine while keeping local terminal outputs readable.
3. **Git Blame & Local Code Context Hydrator:**
   - Reads `±20` lines around implicated user-land stack frames and inspects recent `git diff` / commit metadata to catch self-inflicted regressions immediately.
4. **Target-Aware Surgical AI Prompt Generator (`--target cursor|claude|gemini|issue`):**
   - Automatically builds and copies a structured, high-precision prompt to the system clipboard containing the root-cause summary, compressed frames, exact code snippets, and strict editing constraints tailored to your chosen AI coding assistant.
5. **Dual-Engine AI Router (Offline Ollama + Cloud LLMs + Deterministic Fallback):**
   - **Local Mode (`--local`):** Runs 100% offline against local Ollama models (`qwen2.5-coder`, `gemma4`) for airgapped or proprietary codebases.
   - **Cloud Mode:** Supports Gemini, Groq, and OpenAI APIs with strict JSON schema enforcement.
   - **Zero-API Fallback:** Automatically generates structured root-cause reports and fix prompts from deterministic stack/Git analysis even when offline without Ollama.
6. **Local Crash Knowledge Base (`~/.avilog/history.db` via `bun:sqlite`):**
   - Hashes normalized error fingerprints locally. Recurring errors resolve in **`< 3ms`** from local cache without redundant LLM calls.

### Developer Workflow & Productivity Features
7. **Interactive Safe-Patch Mode (`[a] Apply Patch` & `avilog undo`):**
   - Generates a valid unified Git diff (`patch.diff`) for straightforward fixes, snapshots original files to `~/.avilog/backups/` before patching, and supports instant single-command rollback (`avilog undo`).
8. **Live Dev-Server Sentinel (`avilog watch -- <cmd>`):**
   - Works like `nodemon`—monitors long-running dev servers silently and triggers instant root-cause diagnosis + clipboard prompt updates the moment an unhandled rejection or 500 error occurs.
9. **GitHub Actions / CI-CD PR Commenter (`avilog ci`):**
   - Parses failing CI logs and posts a clean, collapsible root-cause diagnosis and copy-paste fix prompt directly onto the Pull Request comment thread.
10. **Local Web Inspector (`avilog --ui`):**
    - Launches a dark-mode local React + Tailwind dashboard (`localhost:4321`) featuring a visual log-compression funnel, interactive stack-frame code viewer, causal timeline, and one-click prompt customizer.
11. **Drop-In Runtime SDK (`attachAvilog()`):**
    - Programmatic hook for Bun, Node.js, Express, and Hono apps to capture `uncaughtException` and `unhandledRejection` events automatically during development.

---

## 5. CLI Usage Reference

```bash
# 1. Wrapper Mode: Run any command; auto-diagnose & copy fix prompt on failure
bunx avilog -- bun run build
npx avilog -- pytest

# 2. Pipe / File Mode: Analyze existing logs or piped output
cat crash.log | bunx avilog
bunx avilog analyze ./logs/server-error.log

# 3. Watch Mode: Silent dev-server sentinel (like nodemon with AI root-cause detection)
bunx avilog watch -- bun run dev

# 4. Target-Specific Prompt Formatting
bunx avilog --target cursor -- bun test
bunx avilog --target claude -- docker build .

# 5. Offline Local Mode (via Ollama) & Visual Web Inspector
bunx avilog --local --ui analyze ./logs/prod.log

# 6. Revert an Auto-Applied Patch
bunx avilog undo

# 7. CI/CD Mode & Performance Benchmarks
bunx avilog ci ./build.log
bunx avilog bench