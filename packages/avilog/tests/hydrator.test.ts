import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hydrateFrames } from "../src/core/hydrator.js";
import type { StackFrame } from "../src/types/core.js";

describe("local code & git hydrator", () => {
  test("extracts ±20 lines with >>> pointer and blocks path traversal", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "avilog-hydrator-"));
    try {
      mkdirSync(join(tempRoot, "src"), { recursive: true });
      const lines = Array.from({ length: 50 }, (_, idx) => `const line${idx + 1} = ${idx + 1};`);
      writeFileSync(join(tempRoot, "src", "app.ts"), lines.join("\n"), "utf8");

      const frames: StackFrame[] = [
        {
          file: "../../etc/passwd",
          line: 1,
          isUserLand: true,
          rawLine: "at bad (../../etc/passwd:1:1)"
        },
        {
          file: "node_modules/pkg/index.js",
          line: 5,
          isUserLand: false,
          rawLine: "at vendor (node_modules/pkg/index.js:5:1)"
        },
        {
          file: "src/app.ts",
          line: 25,
          functionName: "run",
          isUserLand: true,
          rawLine: "at run (src/app.ts:25:1)"
        }
      ];

      const contexts = hydrateFrames(frames, tempRoot);
      expect(contexts).toHaveLength(1);
      expect(contexts[0]?.file).toBe("src/app.ts");
      expect(contexts[0]?.line).toBe(25);
      expect(contexts[0]?.codeWindow).toContain(">>> 25 | const line25 = 25;");
      expect(contexts[0]?.codeWindow).toContain("     5 | const line5 = 5;");
      expect(contexts[0]?.codeWindow).toContain("    45 | const line45 = 45;");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
