export * from "./types/core.js";

export const AVILOG_VERSION = "0.1.0";

export interface AttachAvilogOptions {
  target?: "cursor" | "claude" | "gemini" | "issue" | "raw";
  localOnly?: boolean;
}

/**
 * Attaches avilog's development runtime error hooks (stub for Milestone 5).
 */
export function attachAvilog(_options: AttachAvilogOptions = {}): void {
  // Full implementation in Milestone 5
}
