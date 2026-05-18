export async function ensureSystemSchema(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS rate_limits (
        bucket_key TEXT PRIMARY KEY,
        count INTEGER NOT NULL DEFAULT 0,
        window_start INTEGER NOT NULL
      )`
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS auth_tokens (
        token_hash TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        purpose TEXT NOT NULL,
        issued_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER,
        redirect_url TEXT
      )`
    ),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_auth_purpose ON auth_tokens(purpose, expires_at)")
  ]);
}
