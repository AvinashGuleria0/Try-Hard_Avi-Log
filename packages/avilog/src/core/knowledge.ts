import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { CompactedLog, DiagnosisResult, RuntimeType } from "../types/core.js";

export interface KnowledgeStore {
  lookup(fingerprint: string): Promise<DiagnosisResult | null>;
  save(compacted: CompactedLog, diagnosis: DiagnosisResult): Promise<void>;
  close(): Promise<void>;
}

interface CrashHistoryRow {
  fingerprint: string;
  runtime: RuntimeType;
  error_header: string;
  root_cause_title: string;
  explanation: string;
  fix_steps_json: string;
  unified_diff: string | null;
  target_prompt: string;
  hit_count: number;
  last_seen_at: number;
}

const SCHEMA_SQL = `
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
`;

export function getDefaultAvilogDir(): string {
  return join(homedir(), ".avilog");
}

function rowToDiagnosis(row: CrashHistoryRow, inferenceTimeMs: number): DiagnosisResult {
  let fixSteps: string[] = [];
  try {
    fixSteps = JSON.parse(row.fix_steps_json) as string[];
  } catch {
    fixSteps = [];
  }

  return {
    source: "cache",
    confidence: 95,
    rootCauseTitle: row.root_cause_title,
    explanation: row.explanation,
    causalChain: [row.error_header],
    fixSteps,
    unifiedDiff: row.unified_diff ?? undefined,
    targetPrompt: row.target_prompt,
    inferenceTimeMs
  };
}

class JsonKnowledgeStore implements KnowledgeStore {
  private readonly filePath: string;
  private records: Record<string, CrashHistoryRow> = {};

  constructor(filePath: string) {
    this.filePath = filePath;
    mkdirSync(dirname(filePath), { recursive: true });
    if (existsSync(filePath)) {
      try {
        this.records = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, CrashHistoryRow>;
      } catch {
        this.records = {};
      }
    }
  }

  async lookup(fingerprint: string): Promise<DiagnosisResult | null> {
    const start = performance.now();
    const row = this.records[fingerprint];
    if (!row) return null;
    row.hit_count += 1;
    row.last_seen_at = Date.now();
    writeFileSync(this.filePath, JSON.stringify(this.records, null, 2), "utf8");
    return rowToDiagnosis(row, Number((performance.now() - start).toFixed(2)));
  }

  async save(compacted: CompactedLog, diagnosis: DiagnosisResult): Promise<void> {
    const existing = this.records[compacted.fingerprintHash];
    this.records[compacted.fingerprintHash] = {
      fingerprint: compacted.fingerprintHash,
      runtime: compacted.runtime,
      error_header: compacted.primaryCluster.header,
      root_cause_title: diagnosis.rootCauseTitle,
      explanation: diagnosis.explanation,
      fix_steps_json: JSON.stringify(diagnosis.fixSteps),
      unified_diff: diagnosis.unifiedDiff ?? null,
      target_prompt: diagnosis.targetPrompt,
      hit_count: existing ? existing.hit_count + 1 : 1,
      last_seen_at: Date.now()
    };
    writeFileSync(this.filePath, JSON.stringify(this.records, null, 2), "utf8");
  }

  async close(): Promise<void> {
    // No persistent handle to close
  }
}

export async function openKnowledgeStore(baseDir: string = getDefaultAvilogDir()): Promise<KnowledgeStore> {
  mkdirSync(baseDir, { recursive: true });
  const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

  if (isBun) {
    try {
      const sqliteMod = await import("bun:sqlite");
      const dbPath = join(baseDir, "history.db");
      const db = new sqliteMod.Database(dbPath, { create: true });
      db.exec(SCHEMA_SQL);

      const selectStmt = db.query<CrashHistoryRow, [string]>(
        "SELECT * FROM crash_history WHERE fingerprint = ?"
      );
      const incrementStmt = db.query<unknown, [number, string]>(
        "UPDATE crash_history SET hit_count = hit_count + 1, last_seen_at = ? WHERE fingerprint = ?"
      );
      const upsertStmt = db.query<
        unknown,
        [string, string, string, string, string, string, string | null, string, number]
      >(
        `INSERT INTO crash_history (
          fingerprint, runtime, error_header, root_cause_title, explanation,
          fix_steps_json, unified_diff, target_prompt, hit_count, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT(fingerprint) DO UPDATE SET
          root_cause_title = excluded.root_cause_title,
          explanation = excluded.explanation,
          fix_steps_json = excluded.fix_steps_json,
          unified_diff = excluded.unified_diff,
          target_prompt = excluded.target_prompt,
          hit_count = crash_history.hit_count + 1,
          last_seen_at = excluded.last_seen_at`
      );

      return {
        async lookup(fingerprint: string): Promise<DiagnosisResult | null> {
          const start = performance.now();
          const row = selectStmt.get(fingerprint);
          if (!row) return null;
          incrementStmt.run(Date.now(), fingerprint);
          return rowToDiagnosis(row, Number((performance.now() - start).toFixed(2)));
        },
        async save(compacted: CompactedLog, diagnosis: DiagnosisResult): Promise<void> {
          upsertStmt.run(
            compacted.fingerprintHash,
            compacted.runtime,
            compacted.primaryCluster.header,
            diagnosis.rootCauseTitle,
            diagnosis.explanation,
            JSON.stringify(diagnosis.fixSteps),
            diagnosis.unifiedDiff ?? null,
            diagnosis.targetPrompt,
            Date.now()
          );
        },
        async close(): Promise<void> {
          db.close();
        }
      };
    } catch {
      // Fall back to JSON store if bun:sqlite fails to load
    }
  }

  return new JsonKnowledgeStore(join(baseDir, "history.json"));
}
