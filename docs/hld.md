## Part 1: High-Level Design (HLD) — `avilog`

### 1. System Context & Architecture Overview

`avilog` is designed as a **local-first, zero-configuration developer tool** distributed via the npm registry (`bunx avilog` / `npx avilog`). It sits between raw execution streams (CLI commands, log files, dev servers, CI runners) and AI reasoning engines, ensuring **95%+ deterministic noise reduction** and **100% secret redaction** before any data reaches an LLM.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         INPUT / INGESTION LAYER                              │
│  [1] Wrapper Mode (`avilog -- cmd`)   [2] Pipe/File (`cat x.log | avilog`)   │
│  [3] Watch Sentinel (`avilog watch`)  [4] CI/CD Runner (`avilog ci`)         │
│  [5] Runtime SDK (`attachAvilog()`)                                          │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                    DETERMINISTIC PRE-PROCESSING PIPELINE                     │
│  ┌──────────────────────┐   ┌──────────────────────┐   ┌──────────────────┐  │
│  │ Streaming Compactor  │──▶│ Multi-Runtime Parser │──▶│  Causal Ranker   │  │
│  │ (ANSI strip, loop    │   │ (JS/TS, Python,      │   │ (First Error vs. │  │
│  │  dedup, ring buffer) │   │  Docker/Build)       │   │  Cascade Noise)  │  │
│  └──────────────────────┘   └──────────────────────┘   └────────┬─────────┘  │
└─────────────────────────────────────────────────────────────────┼────────────┘
                                                                  ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                  CONTEXT HYDRATION & PRIVACY SECURITY LAYER                  │
│  ┌──────────────────────┐   ┌──────────────────────┐   ┌──────────────────┐  │
│  │ Local SQLite Cache   │   │  AST & Git Hydrator  │   │ Secret Scrubber  │  │
│  │ (~/.avilog/history)  │──▶│  (±20 lines code +   │──▶│ (Regex + Entropy │  │
│  │ <3ms instant hit     │   │   git diff / blame)  │   │  redaction map)  │  │
│  └──────────────────────┘   └──────────────────────┘   └────────┬─────────┘  │
└─────────────────────────────────────────────────────────────────┼────────────┘
                                                                  ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                        DUAL-ENGINE AI ROUTING LAYER                          │
│        ┌─────────────────────┬─────────────────────┬───────────────────┐     │
│        ▼                     ▼                     ▼                   │     │
│  [Local Ollama]       [Cloud LLM APIs]     [Deterministic Fallback]    │     │
│  (Offline / Zero-     (Gemini / Groq /     (Zero-API heuristic         │     │
│   Cost / Airgapped)    OpenAI JSON mode)    frame + prompt builder)    │     │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                      ACTIONABLE OUTPUT & DELIVERY LAYER                      │
│  • Terminal TUI Card      • Clipboard AI Prompt (`--target cursor|claude`)   │
│  • Safe `patch.diff`      • Local Web Inspector (`--ui` on localhost:4321)   │
│  • GitHub PR Comment (`avilog ci`)                                           │
└──────────────────────────────────────────────────────────────────────────────┘

```

---

### 2. Core Architectural Layers & Responsibilities

1. **Ingestion & Process Supervision Layer:**
* **Non-Intrusive Teeing:** Spawns child commands (`bun test`, `next build`, `python app.py`) with transparent `stdout`/`stderr` pass-through so developer ergonomics remain unchanged on `exitCode === 0`.
* **Watch Daemon (`avilog watch`):** Acts like `nodemon` with a rolling 2,000-line memory ring buffer, capturing asynchronous crashes (`unhandledRejection`, `500` stack traces) in running dev servers without terminating the process.


2. **Deterministic Pre-Processing Layer (Zero AI Cost):**
* **Streaming Memory Bound:** Processes 100 MB+ log files via `ReadableStream` chunks, capping heap memory under `40 MB`.
* **Causal Graph Extraction:** Separates third-party library frames (`node_modules`, `site-packages`) from **user-land frames**, identifies the chronological root trigger, and collapses repetitive downstream cascades (`[repeated 1,204x]`).


3. **Security & Local Context Layer:**
* **Zero-Leak Guarantee:** Masks API keys, JWTs, database URIs, and high-entropy secrets into reversible local placeholders (`[SECRET_1]`) *before* external API transmission, restoring exact variable/file tokens locally after inference.
* **Codebase Awareness:** Reads surrounding source code (`±20` lines) and recent `git diff` commits for implicated user-land files so diagnosis reflects actual recent edits.


4. **Hybrid AI & Local Knowledge Layer:**
* **Fingerprint Caching (`bun:sqlite`):** Hashes normalized error signatures to resolve recurring errors in `< 3ms` locally without hitting an LLM.
* **Airgapped + Cloud Flexibility:** Supports local **Ollama** (`qwen2.5-coder` / `gemma4`) for offline/enterprise privacy, fast cloud inference (Gemini / Groq), and a zero-LLM deterministic fallback.


5. **Action & Visualization Layer:**
* **Surgical Prompt Engine:** Formats high-signal context tailored to `--target cursor`, `claude`, `gemini`, or `issue` and writes directly to the OS clipboard.
* **Atomic Patching (`[a] Apply` / `avilog undo`):** Validates unified Git diffs (`patch.diff`), snapshots target files into `~/.avilog/backups/`, and supports one-command rollback.
* **Local Web Inspector (`--ui`):** Serves a lightweight React + Tailwind dashboard via `Bun.serve()` for visual log-funnel inspection and interactive stack-frame exploration.



---

### 3. Deployment & Distribution Topology

| Component | Deployment Target | Runtime / Access |
| --- | --- | --- |
| **Core CLI & SDK (`avilog`)** | Public **npm Registry** (`npm publish`) | Executed globally via `bunx avilog` or `npx avilog` (dual-bundled for Bun & Node.js) |
| **Web Inspector (`--ui`)** | Bundled static assets inside npm package | Served locally on `http://localhost:4321` via `Bun.serve()` / Node HTTP |
| **Local State & Cache** | User home directory (`~/.avilog/`) | `history.db` (`bun:sqlite`) + `backups/` snapshots (100% local, zero telemetry) |
| **CI/CD Integration** | GitHub Actions Runner | Executed via `bunx avilog ci` using ephemeral `GITHUB_TOKEN` |

---
6. Tech Stack
Core Runtime & Language: Bun 1.4+, TypeScript (strict mode, dual-bundled for Bun & Node.js compatibility)

Local Storage & Caching: bun:sqlite (with automatic JSON store fallback for Node.js)

AI Inference: Local Ollama REST API (qwen2.5-coder / gemma4), Google Gemini API, Groq API

Web Inspector (--ui): Vite, React, TypeScript, Tailwind CSS, Bun.serve()

Testing & Benchmarking: bun test, Playwright E2E suite, custom 15-fixture log benchmark harness (avilog bench)

7. Built-In Monitoring & Performance Evidence (avilog bench)
To validate real-world reliability and performance, avilog ships with an automated benchmark suite (avilog bench) tested across 15 multi-runtime crash logs (5,000 to 50,000 lines each):

Log Compaction Efficiency: 95% – 99.6% line and token reduction across noisy stack traces.

Deterministic Pre-Processing Latency: < 15ms for a 20,000-line log file (> 120 MB/s streaming throughput).

Secret Redaction Precision: 100% masking of injected API keys, JWTs, and database URIs prior to external inference.

Local Fingerprint Cache Latency: < 3ms recall via bun:sqlite. 