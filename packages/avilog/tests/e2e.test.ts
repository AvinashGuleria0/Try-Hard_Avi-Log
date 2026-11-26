import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseCliArgs, runCli } from "../src/cli.js";
import { captureError } from "../src/index.js";
import { runBenchSuite } from "../src/modes/benchMode.js";
import { formatCiMarkdown } from "../src/modes/ciMode.js";
import { runDiagnosisPipeline } from "../src/core/pipeline.js";

const FIXTURES_DIR = join(import.meta.dir, "fixtures");
const MOCK_TEST_DIR = resolve(import.meta.dir, "../../../mock-test");

describe("CLI, modes, SDK, and E2E pipeline", () => {
  test("parseCliArgs parses commands and flags accurately", () => {
    const wrap = parseCliArgs(["--target", "claude", "--local", "--", "bun", "test"], true);
    expect(wrap.mode).toBe("wrap");
    expect(wrap.target).toBe("claude");
    expect(wrap.local).toBe(true);
    expect(wrap.command).toEqual(["bun", "test"]);

    const analyze = parseCliArgs(["analyze", "./crash.log", "--fresh"], true);
    expect(analyze.mode).toBe("analyze");
    expect(analyze.filePath).toBe("./crash.log");
    expect(analyze.fresh).toBe(true);

    const bench = parseCliArgs(["bench"], true);
    expect(bench.mode).toBe("bench");
  });

  test("runBenchSuite executes 15 fixtures with >99% reduction on large logs", () => {
    const summary = runBenchSuite(FIXTURES_DIR);
    expect(summary.fixturesRun).toBe(15);
    expect(summary.avgReductionPercent).toBeGreaterThan(85);
    const largeLogs = summary.results.filter((r) => r.rawLines >= 5000);
    expect(largeLogs.length).toBeGreaterThanOrEqual(12);
    expect(largeLogs.every((r) => r.reductionPercent > 99)).toBe(true);
  });

  test("runDiagnosisPipeline processes fixture end-to-end and caches in temp dir", async () => {
    const tempKb = mkdtempSync(join(tmpdir(), "avilog-e2e-kb-"));
    try {
      const first = await runDiagnosisPipeline({
        text: "TypeError: Cannot read properties of undefined (reading 'id')\n    at getUser (src/user.ts:10:5)",
        target: "gemini",
        copyClipboard: false,
        avilogDir: tempKb
      });
      expect(first.diagnosis.source).toBe("deterministic-fallback");
      expect(first.diagnosis.targetPrompt).toContain("src/user.ts:10");

      const second = await runDiagnosisPipeline({
        text: "TypeError: Cannot read properties of undefined (reading 'id')\n    at getUser (src/user.ts:10:5)",
        target: "gemini",
        copyClipboard: false,
        avilogDir: tempKb
      });
      expect(second.diagnosis.source).toBe("cache");
    } finally {
      rmSync(tempKb, { recursive: true, force: true });
    }
  });

  test("formatCiMarkdown builds collapsible PR comment with metrics", async () => {
    const tempKb = mkdtempSync(join(tmpdir(), "avilog-ci-kb-"));
    try {
      const out = await runDiagnosisPipeline({
        text: "Error: ECONNREFUSED 127.0.0.1:5432\n    at connect (src/db.ts:8:3)",
        target: "issue",
        copyClipboard: false,
        avilogDir: tempKb
      });
      const md = formatCiMarkdown(out);
      expect(md).toContain("<!-- avilog-ci-report -->");
      expect(md).toContain("<details>");
      expect(md).toContain("Copy-Paste AI Fix Prompt");
    } finally {
      rmSync(tempKb, { recursive: true, force: true });
    }
  });

  test("wrapper mode returns 0 on passing command and diagnoses failing mock-test script", async () => {
    const okCode = await runCli(["--", "bun", "--version"]);
    expect(okCode).toBe(0);

    const failCode = await runCli(["--", "bun", "run", join(MOCK_TEST_DIR, "null-crash.ts")]);
    expect(failCode).not.toBe(0);
  });

  test("captureError SDK diagnoses error object cleanly", async () => {
    const err = new TypeError("Cannot read properties of undefined (reading 'plan')");
    const out = await captureError(err, { copyClipboard: false });
    expect(out.diagnosis.rootCauseTitle).toContain("Null or undefined");
  });
});
