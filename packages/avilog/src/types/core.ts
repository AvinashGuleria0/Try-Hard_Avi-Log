export type RuntimeType = "js-ts" | "python" | "docker-build" | "unknown";
export type PromptTarget = "cursor" | "claude" | "gemini" | "issue" | "raw";
export type LogLevel = "FATAL" | "ERROR" | "WARN" | "INFO";

export interface StackFrame {
  /** Normalized relative path (e.g., "src/db/schema.ts") */
  file: string;
  /** Resolved local path if exists on disk */
  absolutePath?: string;
  line: number;
  column?: number;
  functionName?: string;
  /** True if not inside node_modules, site-packages, or internal runtime */
  isUserLand: boolean;
  rawLine: string;
}

export interface LogCluster {
  id: string;
  firstSeenLine: number;
  timestamp?: string;
  level: LogLevel;
  /** Primary error message line */
  header: string;
  /** Number of identical/structurally similar cascades collapsed */
  repeatCount: number;
  frames: StackFrame[];
  /** Max 15 high-signal lines */
  rawSnippet: string[];
  /** Marked true for earliest causal error cluster */
  isPrimaryCause: boolean;
}

export interface CompactedLog {
  runtime: RuntimeType;
  totalRawLines: number;
  compactedLines: number;
  reductionPercent: number;
  parseTimeMs: number;
  /** SHA-256 of normalized error header + top 3 user-land frames */
  fingerprintHash: string;
  primaryCluster: LogCluster;
  cascadeClusters: LogCluster[];
}

export interface RedactionMap {
  /** e.g., "[SECRET_KEY_1]" -> "sk-live-98a..." */
  tokenToOriginal: Map<string, string>;
  redactedCount: number;
}

export interface HydratedContext {
  file: string;
  line: number;
  /** ±20 lines with line numbers and ">>> " pointer on offending line */
  codeWindow: string;
  /** Output of `git diff HEAD~1 -- <file>` */
  gitDiff?: string;
  /** e.g., "8f3a1c (2 mins ago): add tenantId filter" */
  lastCommitMeta?: string;
}

export interface DiagnosisResult {
  source: "cache" | "ollama" | "cloud" | "deterministic-fallback";
  /** 0 to 100 */
  confidence: number;
  rootCauseTitle: string;
  explanation: string;
  /** Ordered steps from initial trigger to terminal crash */
  causalChain: string[];
  fixSteps: string[];
  /** Valid git apply unified diff string */
  unifiedDiff?: string;
  /** Ready-to-paste surgical prompt for coding agents */
  targetPrompt: string;
  inferenceTimeMs: number;
}

export interface CliOptions {
  mode: "wrap" | "pipe" | "analyze" | "watch" | "ci" | "undo" | "bench" | "help" | "version";
  target: PromptTarget;
  local: boolean;
  fresh: boolean;
  ui: boolean;
  filePath?: string;
  command?: string[];
}

export interface BackupEntry {
  originalPath: string;
  backupPath: string;
  existed: boolean;
}

export interface BackupManifest {
  id: string;
  createdAt: string;
  entries: BackupEntry[];
}
