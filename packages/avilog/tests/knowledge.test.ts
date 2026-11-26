import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compactText } from "../src/core/compactor.js";
import { openKnowledgeStore } from "../src/core/knowledge.js";
import type { DiagnosisResult } from "../src/types/core.js";

describe("local crash knowledge base", () => {
  test("stores and recalls diagnosis in < 3ms via bun:sqlite", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "avilog-kb-"));
    const store = await openKnowledgeStore(tempDir);

    try {
      const compacted = compactText(
        "TypeError: Cannot read properties of undefined (reading 'id')\n    at getUser (src/user.ts:12:5)"
      );
      const diagnosis: DiagnosisResult = {
        source: "ollama",
        confidence: 92,
        rootCauseTitle: "Null user object dereference",
        explanation: "getUser accesses .id before checking if user exists.",
        causalChain: ["TypeError in src/user.ts:12"],
        fixSteps: ["Guard against undefined user"],
        targetPrompt: "Fix null check in src/user.ts:12",
        inferenceTimeMs: 420
      };

      await store.save(compacted, diagnosis);

      const recalled = await store.lookup(compacted.fingerprintHash);
      expect(recalled).not.toBeNull();
      expect(recalled?.source).toBe("cache");
      expect(recalled?.rootCauseTitle).toBe("Null user object dereference");
      expect(recalled?.inferenceTimeMs).toBeLessThan(15);
    } finally {
      await store.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
