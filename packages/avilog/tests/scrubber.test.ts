import { describe, expect, test } from "bun:test";
import { restoreText, scrubText, shannonEntropy } from "../src/core/scrubber.js";

describe("secret & PII scrubber", () => {
  test("redacts API keys, JWTs, database URIs, and .env assignments", () => {
    const raw = [
      "OPENAI_API_KEY=sk-proj1234567890abcdefghijklmnop",
      "GITHUB_TOKEN=ghp_123456789012345678901234567890123456",
      "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
      "DATABASE_URL=postgresql://admin:SuperSecretPass123@db.internal:5432/prod"
    ].join("\n");

    const { scrubbed, map } = scrubText(raw);

    expect(scrubbed).not.toContain("sk-proj1234567890abcdefghijklmnop");
    expect(scrubbed).not.toContain("ghp_123456789012345678901234567890123456");
    expect(scrubbed).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    expect(scrubbed).not.toContain("SuperSecretPass123");
    expect(map.redactedCount).toBe(4);

    // Reversible restoration
    const restored = restoreText(scrubbed, map);
    expect(restored).toBe(raw);
  });

  test("detects high-entropy standalone secrets while ignoring normal file paths", () => {
    const highEntropy = "a9F$k2L8mQ1zX7vB4nR6pW3yT0cJ5hD".replace("$", "Z");
    expect(shannonEntropy(highEntropy)).toBeGreaterThan(4.2);

    const logLine = `Failed reading src/services/invoiceService.ts with token ${highEntropy}`;
    const { scrubbed, map } = scrubText(logLine);

    expect(scrubbed).toContain("src/services/invoiceService.ts");
    expect(scrubbed).not.toContain(highEntropy);
    expect(scrubbed).toContain("[HIGH_ENTROPY_SECRET_1]");
    expect(restoreText(scrubbed, map)).toBe(logLine);
  });
});
