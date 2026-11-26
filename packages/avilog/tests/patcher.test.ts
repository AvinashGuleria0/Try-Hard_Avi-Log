import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPatch, undoLastPatch, validateUnifiedDiff } from "../src/core/patcher.js";

describe("safe patcher & undo manager", () => {
  test("validateUnifiedDiff rejects path traversal outside cwd", () => {
    const badDiff = [
      "--- a/../../etc/hosts",
      "+++ b/../../etc/hosts",
      "@@ -1,1 +1,1 @@",
      "-127.0.0.1 localhost",
      "+0.0.0.0 evil"
    ].join("\n");

    const res = validateUnifiedDiff(badDiff, process.cwd());
    expect(res.valid).toBe(false);
    expect(res.reason).toContain("Path traversal blocked");
  });

  test("applyPatch creates backup, modifies file, and undoLastPatch restores original", () => {
    const workDir = mkdtempSync(join(tmpdir(), "avilog-patch-work-"));
    const backupDir = mkdtempSync(join(tmpdir(), "avilog-patch-bak-"));

    try {
      mkdirSync(join(workDir, "src"), { recursive: true });
      const targetFile = join(workDir, "src", "calc.ts");
      writeFileSync(targetFile, "export function add(a: number, b: number) {\n  return a - b;\n}\n", "utf8");

      const diff = [
        "--- a/src/calc.ts",
        "+++ b/src/calc.ts",
        "@@ -1,3 +1,3 @@",
        " export function add(a: number, b: number) {",
        "-  return a - b;",
        "+  return a + b;",
        " }"
      ].join("\n");

      const applied = applyPatch(diff, workDir, backupDir);
      expect(applied.applied).toBe(true);
      expect(readFileSync(targetFile, "utf8")).toContain("return a + b;");

      const undone = undoLastPatch(backupDir);
      expect(undone.restored).toBe(true);
      expect(readFileSync(targetFile, "utf8")).toContain("return a - b;");
    } finally {
      rmSync(workDir, { recursive: true, force: true });
      rmSync(backupDir, { recursive: true, force: true });
    }
  });
});
