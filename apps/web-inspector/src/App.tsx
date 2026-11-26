import { useEffect, useState } from "react";

interface StackFrame {
  file: string;
  line: number;
  column?: number;
  functionName?: string;
  isUserLand: boolean;
  rawLine: string;
}

interface LogCluster {
  id: string;
  firstSeenLine: number;
  level: string;
  header: string;
  repeatCount: number;
  frames: StackFrame[];
  rawSnippet: string[];
  isPrimaryCause: boolean;
}

interface HydratedContext {
  file: string;
  line: number;
  codeWindow: string;
  gitDiff?: string;
  lastCommitMeta?: string;
}

interface DiagnosisPayload {
  compacted: {
    runtime: string;
    totalRawLines: number;
    compactedLines: number;
    reductionPercent: number;
    parseTimeMs: number;
    fingerprintHash: string;
    primaryCluster: LogCluster;
    cascadeClusters: LogCluster[];
  };
  contexts: HydratedContext[];
  diagnosis: {
    source: string;
    confidence: number;
    rootCauseTitle: string;
    explanation: string;
    causalChain: string[];
    fixSteps: string[];
    targetPrompt: string;
    inferenceTimeMs: number;
  };
  redactedCount: number;
}

const TARGETS = ["cursor", "claude", "gemini", "issue", "raw"] as const;

export function App() {
  const [data, setData] = useState<DiagnosisPayload | null>(null);
  const [showVendorFrames, setShowVendorFrames] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<string>("cursor");
  const [promptText, setPromptText] = useState<string>("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/diagnosis")
      .then((r) => r.json())
      .then((payload: DiagnosisPayload) => {
        setData(payload);
        setPromptText(payload.diagnosis.targetPrompt);
      })
      .catch(() => {});
  }, []);

  const handleTargetChange = async (target: string) => {
    setSelectedTarget(target);
    try {
      const res = await fetch("/api/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target })
      });
      const json = (await res.json()) as { prompt: string };
      setPromptText(json.prompt);
    } catch {
      // Keep existing prompt on error
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(promptText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center text-zinc-400">
        Loading avilog inspection data...
      </div>
    );
  }

  const frames = data.compacted.primaryCluster.frames.filter(
    (f) => showVendorFrames || f.isUserLand
  );

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6 max-w-6xl mx-auto space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold tracking-tight text-emerald-400">avilog</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300">
              {data.compacted.runtime}
            </span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300">
              {data.diagnosis.source} ({data.diagnosis.inferenceTimeMs}ms)
            </span>
          </div>
          <h1 className="text-2xl font-semibold mt-1">{data.diagnosis.rootCauseTitle}</h1>
        </div>

        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2">
            <div className="text-xs text-zinc-400">Raw Lines</div>
            <div className="text-lg font-mono font-semibold">{data.compacted.totalRawLines}</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2">
            <div className="text-xs text-zinc-400">Compacted</div>
            <div className="text-lg font-mono font-semibold text-emerald-400">
              {data.compacted.compactedLines} ({data.compacted.reductionPercent}%)
            </div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2">
            <div className="text-xs text-zinc-400">Secrets Scrubbed</div>
            <div className="text-lg font-mono font-semibold text-amber-400">{data.redactedCount}</div>
          </div>
        </div>
      </header>

      <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Root Cause & Causal Chain
        </h2>
        <p className="text-zinc-200">{data.diagnosis.explanation}</p>
        {data.diagnosis.causalChain.length > 0 && (
          <ul className="space-y-1 text-sm text-zinc-300 list-disc list-inside">
            {data.diagnosis.causalChain.map((step, idx) => (
              <li key={idx}>{step}</li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
              Stack Frames
            </h2>
            <button
              onClick={() => setShowVendorFrames((v) => !v)}
              className="text-xs px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 cursor-pointer"
            >
              {showVendorFrames ? "Hide Vendor Frames" : "Show Vendor Frames"}
            </button>
          </div>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {frames.length === 0 ? (
              <div className="text-sm text-zinc-500">No stack frames extracted.</div>
            ) : (
              frames.map((frame, i) => (
                <div
                  key={i}
                  className={`p-2.5 rounded-lg border text-xs font-mono ${
                    frame.isUserLand
                      ? "bg-emerald-950/30 border-emerald-800/50 text-emerald-200"
                      : "bg-zinc-950 border-zinc-800 text-zinc-400"
                  }`}
                >
                  <div className="font-semibold">
                    {frame.file}:{frame.line}
                    {frame.functionName ? ` (${frame.functionName})` : ""}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
            Local Code Context
          </h2>
          {data.contexts.length === 0 ? (
            <div className="text-sm text-zinc-500">No local workspace files matched stack frames.</div>
          ) : (
            data.contexts.map((ctx, i) => (
              <div key={i} className="space-y-2">
                <div className="text-xs font-mono text-zinc-300">
                  {ctx.file}:{ctx.line}
                  {ctx.lastCommitMeta ? ` — ${ctx.lastCommitMeta}` : ""}
                </div>
                <pre className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-xs font-mono overflow-x-auto max-h-64 text-zinc-200">
                  {ctx.codeWindow}
                </pre>
              </div>
            ))
          )}
        </section>
      </div>

      <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
              Surgical AI Fix Prompt
            </h2>
            <div className="flex gap-1">
              {TARGETS.map((t) => (
                <button
                  key={t}
                  onClick={() => void handleTargetChange(t)}
                  className={`text-xs px-2.5 py-1 rounded cursor-pointer ${
                    selectedTarget === t
                      ? "bg-emerald-500 text-zinc-950 font-semibold"
                      : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={() => void handleCopy()}
            className="text-xs px-3 py-1.5 rounded bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold cursor-pointer"
          >
            {copied ? "Copied!" : "Copy Prompt"}
          </button>
        </div>
        <pre className="bg-zinc-950 border border-zinc-800 rounded-lg p-4 text-xs font-mono overflow-x-auto whitespace-pre-wrap text-zinc-200">
          {promptText}
        </pre>
      </section>
    </div>
  );
}
