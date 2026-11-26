import { diagnoseWithRouter } from "../ai/router.js";
import type { CompactedLog, DiagnosisResult, HydratedContext, PromptTarget } from "../types/core.js";
import { compactStream, compactText } from "./compactor.js";
import { hydrateFrames } from "./hydrator.js";
import { openKnowledgeStore } from "./knowledge.js";
import { copyToClipboard } from "./promptGen.js";
import { createRedactionMap, scrubCompactedLog, scrubHydratedContexts } from "./scrubber.js";

export interface PipelineInput {
  text?: string;
  stream?: ReadableStream<Uint8Array>;
  target?: PromptTarget;
  localOnly?: boolean;
  fresh?: boolean;
  copyClipboard?: boolean;
  cwd?: string;
  avilogDir?: string;
}

export interface PipelineOutput {
  compacted: CompactedLog;
  contexts: HydratedContext[];
  diagnosis: DiagnosisResult;
  redactedCount: number;
  copiedToClipboard: boolean;
}

export async function runDiagnosisPipeline(input: PipelineInput): Promise<PipelineOutput> {
  const target: PromptTarget = input.target ?? "cursor";
  const cwd = input.cwd ?? process.cwd();

  const compacted = input.stream
    ? await compactStream(input.stream)
    : compactText(input.text ?? "");

  const contexts = hydrateFrames(compacted.primaryCluster.frames, cwd);

  const store = await openKnowledgeStore(input.avilogDir);
  try {
    if (!input.fresh) {
      const cached = await store.lookup(compacted.fingerprintHash);
      if (cached) {
        const copied = input.copyClipboard !== false ? copyToClipboard(cached.targetPrompt) : false;
        return {
          compacted,
          contexts,
          diagnosis: cached,
          redactedCount: 0,
          copiedToClipboard: copied
        };
      }
    }

    const redactionMap = createRedactionMap();
    const { log: scrubbedLog } = scrubCompactedLog(compacted, redactionMap);
    const scrubbedContexts = scrubHydratedContexts(contexts, redactionMap);

    const diagnosis = await diagnoseWithRouter({
      compacted: scrubbedLog,
      contexts: scrubbedContexts,
      redactionMap,
      target,
      localOnly: input.localOnly
    });

    await store.save(compacted, diagnosis);

    const copied = input.copyClipboard !== false ? copyToClipboard(diagnosis.targetPrompt) : false;

    return {
      compacted,
      contexts,
      diagnosis,
      redactedCount: redactionMap.redactedCount,
      copiedToClipboard: copied
    };
  } finally {
    await store.close();
  }
}
