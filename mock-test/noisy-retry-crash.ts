// Intentional noisy crash with ANSI colors, repeated retry loop, and embedded fake secrets
const FAKE_OPENAI_KEY = "OPENAI_API_KEY=sk-proj1234567890abcdefghijklmnop";
const FAKE_DB_URL = "DATABASE_URL=postgresql://admin:SuperSecretPass99@db.local:5432/prod";

function connectDatabase(): never {
  console.log(`\x1b[36m[boot]\x1b[0m Loading config with ${FAKE_OPENAI_KEY}`);
  console.log(`\x1b[36m[boot]\x1b[0m Connecting to ${FAKE_DB_URL}`);

  for (let i = 1; i <= 300; i++) {
    console.error(
      `\x1b[33m2026-11-26T08:00:0${i % 10}.123Z ERROR Connection retry #${i} failed for req_id=req-${i}\x1b[0m`
    );
  }

  throw new Error("ECONNREFUSED 127.0.0.1:5432 — Postgres container is not reachable");
}

connectDatabase();
