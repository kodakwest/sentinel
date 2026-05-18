# Sentinel Gating Strategy

## Goal
Add CORS lockdown + rate limiting to Sentinel, mirroring LogOS-Core's gating patterns but adapted for a clinical API (API keys instead of magic links).

## Files to Modify

### 1. `src/index.ts` — CORS Lockdown
**Current:**
```ts
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Admin-Secret, X-Admin-Key, Authorization"
};
```

**Change to:**
```ts
function corsOrigin(request: Request, env: Env): string {
  const origin = request.headers.get("Origin");
  const allowed = (env.ALLOWED_ORIGINS || "https://sentinel-api.kodakwest.workers.dev").split(",");
  if (origin && allowed.includes(origin)) return origin;
  return "null"; // not "null" string — blocks the request properly
}
```
- Allow `Origin` header matching against `env.ALLOWED_ORIGINS` (comma-separated)
- Default: the worker's own dev URL
- Every response builder uses `corsHeaders(origin)` not the static object
- `OPTIONS` preflight also uses dynamic origin

### 2. `src/index.ts` — Rate Limiting Middleware
Add before any handler runs:
```ts
async function checkRateLimit(request: Request, env: Env): Promise<Response | null> {
  const key = request.headers.get("X-Api-Key") || clientIp(request);
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / 3600) * 3600;
  const bucketKey = `rl:${await sha256(key)}:${windowStart}`;

  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (bucket_key, count, window_start)
     VALUES (?, 1, ?)
     ON CONFLICT(bucket_key) DO UPDATE SET
       count = CASE
         WHEN rate_limits.window_start < excluded.window_start THEN 1
         ELSE rate_limits.count + 1
       END,
       window_start = CASE
         WHEN rate_limits.window_start < excluded.window_start THEN excluded.window_start
         ELSE rate_limits.window_start
       END
     RETURNING count`
  ).bind(bucketKey, windowStart).first<{ count: number }>();

  const limit = Number(env.RATE_LIMIT_PER_HOUR) || 100;
  if (row && row.count > limit) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again later." }), {
      status: 429,
      headers: { ...corsHeaders(request, env), "Retry-After": "3600" }
    });
  }
  return null;
}
```
- Per-hour buckets keyed by API key (or IP if no key)
- D1 `INSERT ... ON CONFLICT` pattern (same as LogOS-Core's rate limiting)
- Configurable via `env.RATE_LIMIT_PER_HOUR` (default 100)
- Returns 429 with `Retry-After` header

### 3. `src/index.ts` — Wire It Up
Add to the top of the fetch handler, after OPTIONS check:
```ts
const rateLimitCheck = await checkRateLimit(request, env);
if (rateLimitCheck) return rateLimitCheck;
```

### 4. `wrangler.toml` — Add Vars
```toml
[vars]
ALLOWED_ORIGINS = "https://sentinel-api.kodakwest.workers.dev"
RATE_LIMIT_PER_HOUR = "100"
```

### 5. D1 — Rate Limits Table
Add to the migration or ensure schema:
```sql
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket_key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL
);
```

### 6. `src/index.ts` — Update `json()` Helper
The `json()` helper currently uses the static `corsHeaders`. Change to accept the request or origin:
```ts
function json(body: unknown, status = 200, origin: string) { ... }
```
Or better: compute per-request in each handler.

## Testing
1. `curl -v -H "Origin: https://evil.com" https://sentinel-api.kodakwest.workers.dev/api/drugs/search?q=aspirin` → should NOT include `Access-Control-Allow-Origin: *`
2. `curl -v -H "Origin: https://sentinel-api.kodakwest.workers.dev" ...` → should work
3. Rapid-fire `/api/ask` → 429 after 100 requests
