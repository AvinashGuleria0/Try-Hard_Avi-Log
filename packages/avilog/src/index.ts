import { runDiagnosisPipeline, type PipelineOutput } from "./core/pipeline.js";
import type { PromptTarget } from "./types/core.js";

export * from "./types/core.js";
export { compactStream, compactText, stripAnsi, normalizeForDedup } from "./core/compactor.js";
export { scrubText, restoreText, scrubCompactedLog } from "./core/scrubber.js";
export { hydrateFrames } from "./core/hydrator.js";
export { openKnowledgeStore } from "./core/knowledge.js";
export { generateTargetPrompt, copyToClipboard } from "./core/promptGen.js";
export { applyPatch, undoLastPatch, validateUnifiedDiff } from "./core/patcher.js";
export { runDiagnosisPipeline, type PipelineOutput } from "./core/pipeline.js";

export const AVILOG_VERSION = "0.1.0";

export interface AttachAvilogOptions {
  target?: PromptTarget;
  localOnly?: boolean;
  copyClipboard?: boolean;
  onDiagnosis?: (result: PipelineOutput) => void;
}

let attached = false;

export async function captureError(
  error: unknown,
  options: AttachAvilogOptions = {}
): Promise<PipelineOutput> {
  const errText =
    error instanceof Error
      ? error.stack || `${error.name}: ${error.message}`
      : String(error);

  const output = await runDiagnosisPipeline({
    text: errText,
    target: options.target ?? "cursor",
    localOnly: options.localOnly ?? false,
    copyClipboard: options.copyClipboard ?? true
  });

  if (options.onDiagnosis) {
    options.onDiagnosis(output);
  } else {
    console.error(
      `\n[avilog SDK] ${output.diagnosis.rootCauseTitle} (${output.diagnosis.source}${output.copiedToClipboard ? ", prompt copied" : ""})`
    );
  }

  return output;
}

/**
 * Attaches avilog's runtime hooks for uncaughtException and unhandledRejection.
 */
export function attachAvilog(options: AttachAvilogOptions = {}): void {
  if (attached) return;
  attached = true;

  process.on("uncaughtException", (err) => {
    void captureError(err, options);
  });

  process.on("unhandledRejection", (reason) => {
    void captureError(reason, options);
  });
}
