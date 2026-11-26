Here are all the essential commands for building, testing, and running `avilog`:

### 1. Setup, Build & Test
```powershell
# Install workspace dependencies
bun install

# Build the Web Inspector UI (outputs to packages/avilog/dist/ui)
bun run build:ui

# Build CLI & SDK (outputs to packages/avilog/dist/)
bun run build

# Typecheck & run all 25 unit/E2E tests
bun run typecheck
bun test
```

---

### 2. Running `avilog` CLI
*(Run from the repo root using `bun run packages/avilog/src/cli.ts`, or `avilog` if linked globally via `bun link`)*

```powershell
# Wrapper mode: run any command, diagnose & copy fix prompt on failure
bun run packages/avilog/src/cli.ts -- bun run mock-test/null-crash.ts

# Wrapper mode + launch Local Web Inspector (http://localhost:4321)
bun run packages/avilog/src/cli.ts --ui -- bun run mock-test/noisy-retry-crash.ts

# Analyze an existing log file
bun run packages/avilog/src/cli.ts analyze packages/avilog/tests/fixtures/node-prisma-crash.log

# Pipe mode (read from stdin)
Get-Content packages/avilog/tests/fixtures/python-fastapi-crash.log | bun run packages/avilog/src/cli.ts

# Target a specific AI assistant (cursor | claude | gemini | issue | raw)
bun run packages/avilog/src/cli.ts --target claude -- bun run mock-test/null-crash.ts

# Force offline local Ollama or bypass SQLite cache
bun run packages/avilog/src/cli.ts --local --fresh analyze packages/avilog/tests/fixtures/docker-build-crash.log

# Watch mode (supervise a dev server & capture runtime errors)
bun run packages/avilog/src/cli.ts watch -- bun run dev

# CI/CD mode (outputs collapsible Markdown report; posts PR comment if GITHUB_TOKEN is set)
bun run packages/avilog/src/cli.ts ci packages/avilog/tests/fixtures/node-prisma-crash.log

# Revert the last auto-applied patch
bun run packages/avilog/src/cli.ts undo

# Run 15-fixture compaction & latency benchmark
bun run packages/avilog/src/cli.ts bench
```

---

### 3. Testing the `mock-test/` Playground & SDK
```powershell
# Null dereference crash
bun run packages/avilog/src/cli.ts -- bun run mock-test/null-crash.ts

# 300+ ANSI-colored retry lines + embedded secrets + ECONNREFUSED
bun run packages/avilog/src/cli.ts -- bun run mock-test/noisy-retry-crash.ts

# Unhandled promise rejection
bun run packages/avilog/src/cli.ts -- bun run mock-test/async-rejection.ts

# Runtime SDK (captureError) demo
bun run mock-test/sdk-demo.ts
```