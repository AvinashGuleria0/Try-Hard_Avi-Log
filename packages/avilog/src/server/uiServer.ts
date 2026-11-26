import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PipelineOutput } from "../core/pipeline.js";
import { generateTargetPrompt } from "../core/promptGen.js";
import type { PromptTarget } from "../types/core.js";

export interface UiServerHandle {
  url: string;
  port: number;
  close: () => Promise<void>;
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};

function getUiDistDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "../ui"),
    resolve(here, "../../dist/ui")
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, "index.html"))) return dir;
  }
  return candidates[0]!;
}

function renderFallbackHtml(output: PipelineOutput): string {
  const title = output.diagnosis.rootCauseTitle.replace(/</g, "&lt;");
  const explanation = output.diagnosis.explanation.replace(/</g, "&lt;");
  const prompt = output.diagnosis.targetPrompt.replace(/</g, "&lt;");
  return `<!doctype html>
<html lang="en" class="dark">
<head>
  <meta charset="utf-8" />
  <title>avilog Inspector — ${title}</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; background: #09090b; color: #f4f4f5; margin: 0; padding: 2rem; }
    .card { background: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 1.25rem; margin-bottom: 1rem; }
    pre { background: #09090b; padding: 1rem; border-radius: 8px; overflow-x: auto; font-size: 13px; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #10b98122; color: #34d399; font-size: 12px; }
  </style>
</head>
<body>
  <h1>avilog Web Inspector</h1>
  <div class="card">
    <span class="badge">${output.compacted.runtime} • ${output.compacted.reductionPercent}% reduced</span>
    <h2>${title}</h2>
    <p>${explanation}</p>
  </div>
  <div class="card">
    <h3>AI Fix Prompt</h3>
    <pre>${prompt}</pre>
  </div>
</body>
</html>`;
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function startUiServer(
  output: PipelineOutput,
  port = 4321
): Promise<UiServerHandle> {
  const uiDir = getUiDistDir();

  const handleRequest = async (req: IncomingMessage, res: ServerResponse) => {
    const reqUrl = new URL(req.url || "/", `http://localhost:${port}`);
    res.setHeader("Access-Control-Allow-Origin", "*");

    if (reqUrl.pathname === "/api/diagnosis" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(output));
      return;
    }

    if (reqUrl.pathname === "/api/prompt" && req.method === "POST") {
      const body = await readJsonBody(req);
      const target = (typeof body.target === "string" ? body.target : "cursor") as PromptTarget;
      const prompt = generateTargetPrompt(target, output.compacted, output.contexts, output.diagnosis);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ target, prompt }));
      return;
    }

    const relPath = reqUrl.pathname === "/" ? "index.html" : reqUrl.pathname.replace(/^\/+/, "");
    const candidate = resolve(uiDir, relPath);
    if (candidate.startsWith(uiDir) && existsSync(candidate) && statSync(candidate).isFile()) {
      const ext = extname(candidate);
      res.writeHead(200, { "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream" });
      res.end(readFileSync(candidate));
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderFallbackHtml(output));
  };

  const server = createServer((req, res) => {
    void handleRequest(req, res);
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, "127.0.0.1", () => resolveListen());
  });

  const addr = server.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : port;

  return {
    url: `http://localhost:${actualPort}`,
    port: actualPort,
    close: () =>
      new Promise<void>((resolveClose, rejectClose) => {
        server.close((err) => (err ? rejectClose(err) : resolveClose()));
      })
  };
}
