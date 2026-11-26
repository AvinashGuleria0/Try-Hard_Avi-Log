import { generateTargetPrompt } from "../core/promptGen.js";
import { restoreText } from "../core/scrubber.js";
import type {
  CompactedLog,
  DiagnosisResult,
  HydratedContext,
  PromptTarget,
  RedactionMap
} from "../types/core.js";
import { buildDeterministicDiagnosis } from "./fallback.js";
import { buildAiDiagnosisMessages, parseDiagnosisJson } from "./prompts.js";

export interface RouterOptions {
  compacted: CompactedLog;
  contexts: HydratedContext[];
  redactionMap: RedactionMap;
  target: PromptTarget;
  localOnly?: boolean;
}

async function callOllama(system: string, user: string): Promise<Omit<DiagnosisResult, "targetPrompt"> | null> {
  const model = process.env.AVILOG_OLLAMA_MODEL || "qwen2.5-coder:3b";
  const endpoint = process.env.AVILOG_OLLAMA_URL || "http://localhost:11434/api/chat";
  const start = performance.now();

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      }),
      signal: AbortSignal.timeout(15_000)
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { message?: { content?: string } };
    const content = data.message?.content;
    if (!content) return null;
    return parseDiagnosisJson(content, "ollama", Number((performance.now() - start).toFixed(2)));
  } catch {
    return null;
  }
}

async function callOpenAiCompatible(
  url: string,
  apiKey: string,
  model: string,
  system: string,
  user: string
): Promise<Omit<DiagnosisResult, "targetPrompt"> | null> {
  const start = performance.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      }),
      signal: AbortSignal.timeout(20_000)
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;
    return parseDiagnosisJson(content, "cloud", Number((performance.now() - start).toFixed(2)));
  } catch {
    return null;
  }
}

async function callGemini(
  apiKey: string,
  system: string,
  user: string
): Promise<Omit<DiagnosisResult, "targetPrompt"> | null> {
  const model = process.env.AVILOG_GEMINI_MODEL || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const start = performance.now();

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json"
        }
      }),
      signal: AbortSignal.timeout(20_000)
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) return null;
    return parseDiagnosisJson(content, "cloud", Number((performance.now() - start).toFixed(2)));
  } catch {
    return null;
  }
}

function restoreDiagnosisTokens(
  diagnosis: DiagnosisResult,
  redactionMap: RedactionMap
): DiagnosisResult {
  if (redactionMap.redactedCount === 0) return diagnosis;
  return {
    ...diagnosis,
    rootCauseTitle: restoreText(diagnosis.rootCauseTitle, redactionMap),
    explanation: restoreText(diagnosis.explanation, redactionMap),
    causalChain: diagnosis.causalChain.map((c) => restoreText(c, redactionMap)),
    fixSteps: diagnosis.fixSteps.map((s) => restoreText(s, redactionMap)),
    unifiedDiff: diagnosis.unifiedDiff ? restoreText(diagnosis.unifiedDiff, redactionMap) : undefined,
    targetPrompt: restoreText(diagnosis.targetPrompt, redactionMap)
  };
}

export async function diagnoseWithRouter(options: RouterOptions): Promise<DiagnosisResult> {
  const { compacted, contexts, redactionMap, target, localOnly = false } = options;
  const { system, user } = buildAiDiagnosisMessages(compacted, contexts);

  let aiResult: Omit<DiagnosisResult, "targetPrompt"> | null = null;

  if (localOnly || process.env.AVILOG_MODE === "local") {
    aiResult = await callOllama(system, user);
  } else {
    if (process.env.GEMINI_API_KEY) {
      aiResult = await callGemini(process.env.GEMINI_API_KEY, system, user);
    } else if (process.env.GROQ_API_KEY) {
      aiResult = await callOpenAiCompatible(
        "https://api.groq.com/openai/v1/chat/completions",
        process.env.GROQ_API_KEY,
        process.env.AVILOG_GROQ_MODEL || "llama-3.3-70b-versatile",
        system,
        user
      );
    } else if (process.env.OPENAI_API_KEY) {
      aiResult = await callOpenAiCompatible(
        "https://api.openai.com/v1/chat/completions",
        process.env.OPENAI_API_KEY,
        process.env.AVILOG_OPENAI_MODEL || "gpt-4o-mini",
        system,
        user
      );
    }
  }

  if (aiResult) {
    const targetPrompt = generateTargetPrompt(target, compacted, contexts, aiResult);
    return restoreDiagnosisTokens({ ...aiResult, targetPrompt }, redactionMap);
  }

  const fallback = buildDeterministicDiagnosis(compacted, contexts, target);
  return restoreDiagnosisTokens(fallback, redactionMap);
}
