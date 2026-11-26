## Low-Level Design (LLD) — `avilog`

This document specifies the exact module boundaries, TypeScript interfaces, deterministic algorithms, storage schemas, CLI command contracts, and error-handling flows for **`avilog`** (built in **Bun + TypeScript**, bundled to be dual-compatible with `bunx avilog` and `npx avilog`).

---

### 1. Monorepo & Package Directory Layout

```text
avilog/
├── package.json                      # Bun workspace root
├── tsconfig.base.json                # Strict TS config (ESNext, bundler resolution)
├── packages/
│   └── avilog/                       # Publishable npm package ("avilog")
│       ├── package.json              # bin: { "avilog": "./dist/cli.js" }, exports: "./dist/index.js"
│       ├── src/
│       │   ├── cli.ts                # Entrypoint: argument parser, mode dispatcher, TUI prompts
│       │   ├── index.ts              # Runtime SDK: attachAvilog(), captureError()
│       │   ├── types/
│       │   │   └── core.ts           # Shared interfaces (CompactedLog, StackFrame, Diagnosis, Patch)
│       │   ├── core/
│       │   │   ├── compactor.ts      # Streaming ANSI stripper, loop deduplicator, causal ranker
│       │   │   ├── scrubber.ts       # Regex + Shannon entropy secret/PII redactor & token map
│       │   │   ├── hydrator.ts       # Local AST/line reader (±20 lines) + git diff/blame runner
│       │   │   ├── knowledge.ts      # bun:sqlite (with JSON fallback) error fingerprint store
│       │   │   ├── patcher.ts        # Unified diff generator, safe apply, backup & `avilog undo`
│       │   │   ├── promptGen.ts      # Target-aware surgical prompt builder + clipboard writer
│       │   │   └── parsers/
│       │   │       ├── index.ts      # Runtime auto-detector & parser registry
│       │   │       ├── jsParser.ts   # Node, Bun, Next.js, Vite, Prisma stack parser
│       │   │       ├── pyParser.ts   # Python / FastAPI / PyTorch (bottom-up trace reverser)
│       │   │       └── dockerParser.ts # Dockerfile step & npm/bun install dependency parser
│       │   ├── modes/
│       │   │   ├── watchMode.ts      # Child process supervisor (nodemon-style) + silent error hook
│       │   │   ├── ciMode.ts         # GitHub Actions log analyzer + PR comment poster (GITHUB_TOKEN)
│       │   │   └── benchMode.ts      # Benchmark runner across fixture logs (outputs metrics JSON/MD)
│       │   ├── ai/
│       │   │   ├── router.ts         # Dual-engine router: Local Ollama vs Cloud (Gemini/Groq/OpenAI)
│       │   │   ├── prompts.ts        # System prompt + strict JSON schema enforcement
│       │   │   └── fallback.ts       # Zero-LLM deterministic heuristic diagnosis fallback
│       │   └── server/
│       │       └── uiServer.ts       # Bun.serve() / Node HTTP server for `avilog --ui`
│       └── tests/
│           ├── fixtures/             # Real-world 5k–50k line crash dumps (Next, Prisma, Py, Docker)
│           ├── compactor.test.ts
│           ├── scrubber.test.ts
│           ├── patcher.test.ts
│           └── e2e.test.ts
└── apps/
    └── web-inspector/                # Vite + React + Tailwind dark-mode inspector (builds to dist/ui)

```

---

### 2. Core Data Contracts (`src/types/core.ts`)

```typescript
export type RuntimeType = "js-ts" | "python" | "docker-build" | "unknown";
export type PromptTarget = "cursor" | "claude" | "gemini" | "issue" | "raw";

export interface StackFrame {
  file: string;              // Normalized relative path (e.g., "src/db/schema.ts")
  absolutePath?: string;     // Resolved local path if exists on disk
  line: number;
  column?: number;
  functionName?: string;
  isUserLand: boolean;       // True if not inside node_modules, site-packages, or internal runtime
  rawLine: string;
}

export interface LogCluster {
  id: string;
  firstSeenLine: number;
  timestamp?: string;
  level: "FATAL" | "ERROR" | "WARN" | "INFO";
  header: string;            // Primary error message line
  repeatCount: number;       // Number of identical/structurally similar cascades collapsed
  frames: StackFrame[];
  rawSnippet: string[];      // Max 15 high-signal lines
  isPrimaryCause: boolean;   // Marked true for earliest causal error cluster
}

export interface CompactedLog {
  runtime: RuntimeType;
  totalRawLines: number;
  compactedLines: number;
  reductionPercent: number;
  parseTimeMs: number;
  fingerprintHash: string;   // SHA-256 of normalized error header + top 3 user-land frames
  primaryCluster: LogCluster;
  cascadeClusters: LogCluster[];
}

export interface RedactionMap {
  tokenToOriginal: Map<string, string>; // e.g., "[SECRET_KEY_1]" -> "sk-live-98a..."
  redactedCount: number;
}

export interface HydratedContext {
  file: string;
  line: number;
  codeWindow: string;        // ±20 lines with line numbers and ">>>" pointer on offending line
  gitDiff?: string;          // Output of `git diff HEAD~1 -- <file>`
  lastCommitMeta?: string;   // e.g., "8f3a1c (2 mins ago): add tenantId filter"
}

export interface DiagnosisResult {
  source: "cache" | "ollama" | "cloud" | "deterministic-fallback";
  confidence: number;        // 0 to 100
  rootCauseTitle: string;
  explanation: string;
  causalChain: string[];     // Ordered steps from initial trigger to terminal crash
  fixSteps: string[];
  unifiedDiff?: string;      // Valid git apply unified diff string
  targetPrompt: string;      // Ready-to-paste surgical prompt for coding agents
  inferenceTimeMs: number;
}

```

---

### 3. Module-by-Module Low-Level Specifications

#### **Module A: Streaming Log Compactor (`src/core/compactor.ts`)**

* **Input:** `ReadableStream<Uint8Array>` (from `process.stdin`, `Bun.file(path).stream()`, or spawned child `stdout`/`stderr`) + optional `maxBufferLines = 50_000`.
* **Algorithm:**
1. **Streaming Line Splitter & ANSI Stripper:** Decode chunks via `TextDecoder` and strip ANSI escape codes using `/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g`.
2. **Structural Normalization (for Deduplication):** Replace volatile tokens (UUIDs, ISO timestamps, hex memory addresses `0x[0-9a-f]+`, port numbers, request IDs) with placeholders (`<UUID>`, `<TS>`, `<HEX>`) solely to compute a rolling line signature.
3. **Adjacent & Sliding-Window Loop Collapsing:** Maintain an LRU cache of the last 64 normalized error signatures. If an identical signature repeats consecutively or within 50 lines, increment `repeatCount` instead of emitting duplicate lines.
4. **Runtime Classification & Stack Extraction:** Pass lines through `parsers/index.ts`:
* **`jsParser.ts`:** Matches `at (?:async )?(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?`. Marks `isUserLand = !file.includes("node_modules") && !file.startsWith("node:")`.
* **`pyParser.ts`:** Detects `Traceback (most recent call last):` and matches `File "(.+?)", line (\d+), in (.+)`. **Crucial logic:** Reverses frame priority so the *final* exception line at the bottom of a Python traceback is anchored as the causal trigger rather than the top entrypoint.
* **`dockerParser.ts`:** Matches `#\d+ ERROR:` / `executor failed running` / `ERR_PNPM` / `ERESOLVE` blocks.


5. **Causal Ranking:**
* Score clusters by `(isFirstChronologicalError ? +50 : 0) + (hasUserLandFrames ? +30 : 0) + (isFatalLevel ? +20 : 0)`.
* Select highest-scoring earliest cluster as `primaryCluster`; retain top 4 downstream clusters in `cascadeClusters`.


6. **Fingerprint Hashing:** Compute `SHA-256` over `primaryCluster.header` (normalized) + top 3 user-land `file:function` pairs.



---

#### **Module B: Secret & PII Scrubber (`src/core/scrubber.ts`)**

* **Purpose:** Guarantees zero credential leakage before sending compacted context to cloud LLMs (and redacts in `--ui` unless revealed).
* **Two-Pass Detection:**
1. **Deterministic Pattern Pass:**
* API Keys / Tokens: `/(sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|AIza[0-9A-Za-z-_]{35}|xox[baprs]-[0-9a-zA-Z-]+)/g`
* Bearer / JWTs: `/eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g`
* Database & Auth URIs: `/(postgres(?:ql)?|mongodb(?:\+srv)?|mysql|redis):\/\/[^\s"'`]+/g`
* Env Assignments: `/([A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PWD|CREDENTIAL)[A-Z0-9_]*\s*=\s*)([^\s"'`]+)/gi`


2. **Shannon Entropy Pass:**
* For standalone alphanumeric strings of length `>= 24` inside key-value pairs or headers, calculate Shannon entropy $H(X) = -\sum p(x_i)\log_2 p(x_i)$. If $H(X) > 4.2$ and string is not a valid local file path, replace with `[HIGH_ENTROPY_SECRET_N]`.




* **Reversibility:** Stores `tokenToOriginal` in memory so local terminal output and local `patch.diff` restore exact variable/file references without ever transmitting secrets over HTTP.

---

#### **Module C: Local AST/Code & Git Context Hydrator (`src/core/hydrator.ts`)**

* **Input:** Top 3 unique `StackFrame` entries where `frame.isUserLand === true`.
* **Execution Steps:**
1. Resolve `frame.file` against `process.cwd()`. Verify file exists and is inside workspace root (prevents path traversal).
2. Read lines `[Math.max(1, line - 20), line + 20]`, format with line numbers, and prefix the target line with `>>> `.
3. Spawn lightweight Git inspection (`Bun.spawnSync(["git", "log", "-n", "1", "--pretty=format:%h (%ar): %s", "--", file])` and `git diff HEAD~1 -- <file>`). Silently skip if not inside a Git repo.



---

#### **Module D: Safe Diff Generator & Undo Manager (`src/core/patcher.ts`)**

* **Diff Validation:** Parses LLM-returned `unifiedDiff` to verify valid `--- a/<file>`, `+++ b/<file>`, and `@@ -start,count +start,count @@` hunk headers, and ensures all modified paths reside inside `process.cwd()`.
* **Atomic Backup & Apply (`applyPatch(diff)`):**
1. Before touching any file, copy target files to `~/.avilog/backups/<timestamp>/` alongside a `manifest.json`.
2. Apply patch using `git apply --whitespace=nowarn` (with pure-TS line-hunk fallback if `git` is unavailable).
3. If `git apply --check` fails (e.g., line drift), gracefully fall back to printing the suggested code snippet and keeping the surgical prompt in clipboard.


* **Rollback (`avilog undo`):** Reads the latest entry in `~/.avilog/backups/` and restores original files immediately.

---

#### **Module E: Local Crash Knowledge Base (`src/core/knowledge.ts`)**

* **Storage:** `~/.avilog/history.db` using `bun:sqlite` (with automatic fallback to `~/.avilog/history.json` under Node.js).
* **Schema:**
```sql
CREATE TABLE IF NOT EXISTS crash_history (
  fingerprint TEXT PRIMARY KEY,
  runtime TEXT NOT NULL,
  error_header TEXT NOT NULL,
  root_cause_title TEXT NOT NULL,
  explanation TEXT NOT NULL,
  fix_steps_json TEXT NOT NULL,
  unified_diff TEXT,
  target_prompt TEXT NOT NULL,
  hit_count INTEGER DEFAULT 1,
  last_seen_at INTEGER NOT NULL
);

```


* **Lookup Flow:** If `fingerprintHash` exists in `crash_history` and `--fresh` flag is not passed, return cached `DiagnosisResult` in **< 3ms** (`source: "cache"`), increment `hit_count`, and skip LLM inference completely.

---

#### **Module F: Dual-Engine AI Router (`src/ai/router.ts`)**

* **Priority Order:**
1. `--local` flag or `AVILOG_MODE=local` -> POST `http://localhost:11434/api/chat` (Ollama, default model `qwen2.5-coder:3b` or `gemma4`, `format: "json"`).
2. `GEMINI_API_KEY` / `GROQ_API_KEY` / `OPENAI_API_KEY` present -> Call configured cloud endpoint with `response_format: { type: "json_object" }` and `temperature: 0.1`.
3. **Offline Deterministic Fallback (`src/ai/fallback.ts`):** If no Ollama daemon or API key is available, construct a clean structural diagnosis directly from `primaryCluster` + `HydratedContext` + `promptGen.ts` so the CLI **never fails**.



---

#### **Module G: Specialized Execution Modes (`src/modes/`)**

1. **Wrapper Mode (`avilog -- <cmd> [args...]`):**
* Spawns `<cmd>` with `stdio: ["inherit", "pipe", "pipe"]`, teeing live output directly to user's `process.stdout`/`process.stderr` while buffering into `compactor.ts`.
* On `exitCode === 0`: Exits immediately with `0` (zero overhead).
* On `exitCode !== 0`: Runs `hydrate -> knowledge lookup -> scrub -> AI diagnose -> promptGen -> clipboard copy` and renders interactive TUI options:
`[a] Preview & Apply Patch   [c] Re-copy AI Prompt   [u] Open in Web UI   [q] Quit`


2. **Watch Mode (`avilog watch -- <cmd>`):**
* Runs `<cmd>` continuously like `nodemon` (restarting on file changes in `src/`).
* Maintains a rolling 2,000-line ring buffer. Whenever an error pattern (`UnhandledPromiseRejection`, `Error:`, `Traceback`, `500 Internal Server Error`) appears without crashing the server, debounces for `800ms` to capture the full stack trace, runs diagnosis in a background worker, copies the fix prompt to clipboard, and prints a compact banner without killing the dev server.


3. **CI/CD Mode (`avilog ci < build.log`):**
* Non-interactive mode. Reads `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, and `GITHUB_EVENT_PATH` (to extract PR number).
* Formats `DiagnosisResult` into a collapsible Markdown PR comment (including compression stats, root cause, and copy-paste prompt) and posts/updates via GitHub REST API (`POST /repos/{owner}/{repo}/issues/{pr}/comments`).



---

### 4. CLI Command & Flag Matrix (`src/cli.ts`)

| Command | Behavior |
| --- | --- |
| `avilog -- <command>` | Runs `<command>`, streams output live, diagnoses automatically on non-zero exit |
| `<cmd> 2>&1 | avilog` | Pipe mode: reads `stdin` stream, compacts, diagnoses, copies fix prompt |
| `avilog analyze <logfile>` | Analyzes an existing `.log` / `.txt` file on disk |
| `avilog watch -- <command>` | Continuous dev-server sentinel; catches runtime crashes & auto-copies fix prompt |
| `avilog ci [logfile]` | Non-interactive CI/CD mode; outputs Markdown report & posts GitHub PR comment |
| `avilog undo` | Reverts the last code patch applied via `[a] Apply Patch` |
| `avilog bench` | Executes benchmark suite against `tests/fixtures/` and prints latency/token metrics |
| `--target <cursor|claude|gemini|issue>` | Formats generated clipboard prompt specifically for target coding assistant |
| `--local` / `--fresh` / `--ui` | Force local Ollama / bypass SQLite cache / launch `Bun.serve` Web Inspector |