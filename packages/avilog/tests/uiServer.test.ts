import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDiagnosisPipeline } from "../src/core/pipeline.js";
import { startUiServer } from "../src/server/uiServer.js";

describe("local web inspector server", () => {
  test("serves HTML and /api/diagnosis + /api/prompt JSON endpoints", async () => {
    const tempKb = mkdtempSync(join(tmpdir(), "avilog-ui-kb-"));
    const out = await runDiagnosisPipeline({
      text: "TypeError: Cannot read properties of undefined (reading 'id')\n    at getUser (src/user.ts:10:5)",
      target: "cursor",
      copyClipboard: false,
      avilogDir: tempKb
    });

    const handle = await startUiServer(out, 0);
    try {
      const htmlRes = await fetch(`${handle.url}/`);
      expect(htmlRes.status).toBe(200);
      const html = await htmlRes.text();
      expect(html).toContain("avilog");

      const diagRes = await fetch(`${handle.url}/api/diagnosis`);
      expect(diagRes.status).toBe(200);
      const diagJson = (await diagRes.json()) as { diagnosis: { rootCauseTitle: string } };
      expect(diagJson.diagnosis.rootCauseTitle).toContain("Null or undefined");

      const promptRes = await fetch(`${handle.url}/api/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "issue" })
      });
      expect(promptRes.status).toBe(200);
      const promptJson = (await promptRes.json()) as { target: string; prompt: string };
      expect(promptJson.target).toBe("issue");
      expect(promptJson.prompt).toContain("### Bug Report:");
    } finally {
      await handle.close();
      rmSync(tempKb, { recursive: true, force: true });
    }
  });
});
