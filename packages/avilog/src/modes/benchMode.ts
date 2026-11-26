import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { compactText } from "../core/compactor.js";
import { scrubCompactedLog } from "../core/scrubber.js";

export interface BenchFixtureResult {
  name: string;
  rawLines: number;
  compactedLines: number;
  reductionPercent: number;
  parseTimeMs: number;
  redactedCount: number;
}

export interface BenchSummary {
  fixturesRun: number;
  avgReductionPercent: number;
  avgParseTimeMs: number;
  results: BenchFixtureResult[];
}

function generateSyntheticLog(name: string, lineCount: number): string {
  const lines: string[] = [
    `2026-11-26T08:00:00.000Z INFO Booting benchmark fixture ${name}`,
    `DATABASE_URL=postgresql://bench:SecretBenchPass123@localhost:5432/app`,
    "TypeError: Cannot read properties of undefined (reading 'tenantId')",
    "    at resolveTenant (src/middleware/tenant.ts:24:17)",
    "    at /app/node_modules/hono/dist/compose.js:44:12"
  ];
  for (let i = 0; i < lineCount - 5; i++) {
    lines.push(
      `2026-11-26T08:00:0${i % 10}.123Z ERROR Retry #${i} failed for req_id=req-${i} uuid=550e8400-e29b-41d4-a716-446655440000`
    );
  }
  return lines.join("\n");
}

export function runBenchSuite(fixturesDir?: string): BenchSummary {
  const items: Array<{ name: string; content: string }> = [];

  if (fixturesDir && existsSync(fixturesDir)) {
    for (const file of readdirSync(fixturesDir).sort()) {
      if (file.endsWith(".log") || file.endsWith(".txt")) {
        items.push({
          name: file,
          content: readFileSync(join(fixturesDir, file), "utf8")
        });
      }
    }
  }

  // Pad up to 15 multi-scale fixtures (5k-20k lines) to match HLD benchmark suite
  let syntheticIdx = 1;
  while (items.length < 15) {
    const size = 5000 + (syntheticIdx % 4) * 5000;
    const name = `synthetic-${syntheticIdx}-${size}lines.log`;
    items.push({ name, content: generateSyntheticLog(name, size) });
    syntheticIdx++;
  }

  const results: BenchFixtureResult[] = items.map((item) => {
    const compacted = compactText(item.content);
    const { map } = scrubCompactedLog(compacted);
    return {
      name: item.name,
      rawLines: compacted.totalRawLines,
      compactedLines: compacted.compactedLines,
      reductionPercent: compacted.reductionPercent,
      parseTimeMs: compacted.parseTimeMs,
      redactedCount: map.redactedCount
    };
  });

  const avgReductionPercent = Number(
    (results.reduce((s, r) => s + r.reductionPercent, 0) / results.length).toFixed(2)
  );
  const avgParseTimeMs = Number(
    (results.reduce((s, r) => s + r.parseTimeMs, 0) / results.length).toFixed(2)
  );

  return {
    fixturesRun: results.length,
    avgReductionPercent,
    avgParseTimeMs,
    results
  };
}
