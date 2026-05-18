CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  redirect_url TEXT
);
CREATE INDEX IF NOT EXISTS idx_auth_purpose ON auth_tokens(purpose, expires_at);
