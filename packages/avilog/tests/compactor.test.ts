import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compactStream, compactText, normalizeForDedup, stripAnsi } from "../src/core/compactor.js";

const FIXTURES_DIR = join(import.meta.dir, "fixtures");

describe("compactor & multi-runtime parsers", () => {
  test("stripAnsi removes ANSI color sequences", () => {
    const raw = "\x1b[31mERROR:\x1b[0m \x1b[1;33mSomething failed\x1b[39m";
    expect(stripAnsi(raw)).toBe("ERROR: Something failed");
  });

  test("normalizeForDedup normalizes UUIDs, timestamps, hex, ports, and numbers", () => {
    const line =
      "2026-11-26T08:00:01.123Z ERROR req_id=abc123 addr=0x7fff1234 uuid=550e8400-e29b-41d4-a716-446655440000 port :5432 retry 42";
    const norm = normalizeForDedup(line);
    expect(norm).toBe("<TS> ERROR <REQ_ID> addr=<HEX> uuid=<UUID> port :<PORT> retry <N>");
  });

  test("detects JS/TS runtime, separates user-land vs node_modules, and ranks earliest root cause", () => {
    const raw = readFileSync(join(FIXTURES_DIR, "node-prisma-crash.log"), "utf8");
    const result = compactText(raw);

    expect(result.runtime).toBe("js-ts");
    expect(result.primaryCluster.isPrimaryCause).toBe(true);
    expect(result.primaryCluster.header).toContain("PrismaClientKnownRequestError");
    const userLandFiles = result.primaryCluster.frames
      .filter((f) => f.isUserLand)
      .map((f) => f.file);
    expect(userLandFiles).toContain("src/services/invoiceService.ts");
    expect(userLandFiles).toContain("src/app/api/invoices/route.ts");
    expect(result.cascadeClusters.length).toBeGreaterThanOrEqual(1);
    expect(result.fingerprintHash).toHaveLength(64);
  });

  test("detects Python runtime and reverses traceback frames so terminal frame is first", () => {
    const raw = readFileSync(join(FIXTURES_DIR, "python-fastapi-crash.log"), "utf8");
    const result = compactText(raw);

    expect(result.runtime).toBe("python");
    expect(result.primaryCluster.header).toBe("KeyError: 'EU_DE'");
    const userLand = result.primaryCluster.frames.filter((f) => f.isUserLand);
    expect(userLand[0]?.file).toBe("app/services/tax_engine.py");
    expect(userLand[0]?.line).toBe(31);
    expect(userLand[1]?.file).toBe("app/api/routes/billing.py");
  });

  test("detects Docker/npm build errors and extracts Dockerfile frame", () => {
    const raw = readFileSync(join(FIXTURES_DIR, "docker-build-crash.log"), "utf8");
    const result = compactText(raw);

    expect(result.runtime).toBe("docker-build");
    expect(result.primaryCluster.level).toBe("ERROR");
    expect(result.primaryCluster.frames.some((f) => f.file === "Dockerfile" && f.line === 12)).toBe(true);
  });

  test("achieves >95% reduction on noisy repeated logs via ReadableStream", async () => {
    const repeatedLines: string[] = [
      "\x1b[31mError: ECONNREFUSED 127.0.0.1:5432\x1b[0m",
      "    at connectPool (src/db/pool.ts:14:9)"
    ];
    for (let i = 0; i < 1500; i++) {
      repeatedLines.push(`2026-11-26T08:00:0${i % 10}.000Z ERROR Connection retry #${i} failed for req_id=req-${i}`);
    }
    const payload = repeatedLines.join("\n");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        // Chunk into 4KB slices to test streaming boundary handling
        const bytes = encoder.encode(payload);
        for (let offset = 0; offset < bytes.length; offset += 4096) {
          controller.enqueue(bytes.subarray(offset, offset + 4096));
        }
        controller.close();
      }
    });

    const result = await compactStream(stream);
    expect(result.totalRawLines).toBe(1502);
    expect(result.reductionPercent).toBeGreaterThan(95);
    expect(result.cascadeClusters[0]?.repeatCount).toBe(1500);
  });
});
