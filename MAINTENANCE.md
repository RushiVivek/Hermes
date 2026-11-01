# hermes — maintenance & architecture notes

The map for fixing/extending hermes without re-deriving the hard-won details.
Pairs with `README.md` (setup/deploy). Read this before debugging anything weird.

---

## Mental model in one paragraph

Next.js 16 (App Router) app on a **persistent Node server** (Render, not Vercel
— see "Why not Vercel"). Firestore holds all metadata; a private Cloudflare R2
bucket holds the file blobs. Every request is gated by a shared password
(`proxy.ts`). The UI is mobile-first. Two optional Gemini-powered features
(auto-organize on upload, natural-language chat search) degrade gracefully to
manual when no `GEMINI_API_KEY` is set.

Data flow for an upload: browser → `POST /api/upload` → `PutObject` to R2 at
`docs/{firestoreDocId}` → metadata row written to Firestore `docs`.
Browse/search read Firestore only. Single-file downloads redirect the browser
to a short-lived signed R2 URL; export and delete touch R2 server-side.

---

## Runtime layout

- **Dev/prod port:** `28085` (`package.json` scripts). `start` uses
  `${PORT:-28085}` so Render's injected `$PORT` wins in prod.
- **Node:** pinned to 24 (`.mise.toml` locally, `.node-version` + `NODE_VERSION`
  env for Render). Next 16 needs ≥20.9.
- **Commands:** `npm run dev|build|start|test|typecheck|wipe|r2:smoke|hash-password`.

## Environment variables (all required unless noted)

| Var | Purpose | Gotcha |
|---|---|---|
| `HERMES_PASSWORD_HASH` | scrypt hash of the shared password | `scrypt:N:r:p:salt:hash`, uses `:` because dotenv-expand mangles `$`. Make with `npm run hash-password`. |
| `SESSION_SECRET` | with the hash, derives the JWT key | must be ≥32 chars or the app throws |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase admin creds | **use base64 form**, since inline JSON breaks under dotenv quoting. The loader (`lib/firestore.ts`) checks for a leading `{` and otherwise treats the value as base64. |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | R2 storage | token should be *Object Read & Write* on this bucket only |
| `GEMINI_API_KEY` | optional; AI auto-organize + chat | if absent, upload hides the AI toggle and chat falls back to substring search |

---

## Firestore collections

1. **`docs`**: one per uploaded file. Shape = `Doc` in `lib/types.ts`.
   - `status`: `"pending_confirm"` (AI draft awaiting review) | `"active"` (live,
     browsable) | `"deleted"` (soft-deleted, hidden). **Browse/search/download
     only ever show `active`.**
   - `path` is the folder string, e.g. `"Education/Marksheets/2024"`. Backend is
     flat; the folder tree is *derived* from these strings.
   - `storage_key` is the R2 object key (`docs/{id}`). The user's filename never
     appears in the key.
2. **`folders`**: persistent folder registry (doc id = `encodeURIComponent(path)`).
   Exists so a folder survives after its last doc is deleted (folders are
   otherwise derived from doc paths and would vanish). Written on upload/confirm,
   removed on folder-delete, cleared by `wipe`.
3. **`login_attempts`**: brute-force counters. Doc id = sha256(client IP), plus
   one `global` doc. See "Auth model".

**Required composite index:** `docs` on `(status, ...)`. Firestore will print a
one-click index-creation URL in the server logs the first time a query needs it.
If browse/search returns empty with a `FAILED_PRECONDITION` error in logs,
that's a missing index. Click the URL in the error.

---

## The non-obvious decisions (why things are the way they are)

### Why not Vercel
Vercel serverless functions hard-cap the request body at **4.5 MB**, and the cap can't be raised.
Uploads stream *through* our server, so that cap kills real phone photos. Render
runs a persistent Node process, which has no such cap. Our own limit is 100 MB per
batch (`MAX_UPLOAD_BYTES` in `lib/types.ts`, with `proxyClientMaxBodySize` at 110 MB
just above it) because the batch sits in RAM and Render free has 512 MB.

### proxy.ts, not middleware.ts
Next 16 renamed middleware to **proxy**. `proxy.ts` exporting `proxy` IS correct
and IS loaded. The `middleware-manifest.json` being empty is a red herring, because that's the legacy
Pages-Router index. Don't "fix" this by renaming to middleware.ts.

### Auth model
- `proxy.ts` gates everything via a matcher allowlist. Excluded (public): `/login`,
  `/api/auth/login`, `/api/auth/logout` (so a stale cookie can self-clear),
  `/api/health` (Render's probe), and static assets. **`/api/*` returns 401 JSON**
  when unauthenticated (not a 302 redirect), because a redirect would make `fetch()` read
  the login HTML as a fake success. A new API route is auth-gated automatically.
  A new public route must be added to the matcher **and** must call
  `isSameOriginRequest` itself if it accepts writes.
- **Password** (`lib/password.ts`): scrypt verify against `HERMES_PASSWORD_HASH`.
- **Session key** (`lib/session.ts`) = HMAC-SHA256(`SESSION_SECRET`, password hash).
  Changing the password or rotating the secret invalidates every cookie. That
  is the "sign out all devices" button.
- **Rate limiting** (`lib/rate-limit.ts`): the policy math is pure and unit-tested;
  state is in Firestore so it survives Render restarts. Per IP: 5 attempts/15 min →
  15 min lock, doubling per repeat lockout, capped at 24 h. Global: 100 attempts/h →
  15 min pause, which **known devices skip** (`hermes_device` cookie, set on any
  successful login; it's not a credential). That stops a distributed attacker from
  locking the family out.
  - The device cookie carries a random id, and a known device answers to its own
    bucket (`login_attempts/device-<id>`, same 5/15 min policy as an IP) instead
    of the global lock. A leaked cookie therefore can't be replayed from many IPs.
    Its key is bound to the password hash, so a password change voids it.
  - Each attempt is counted *before* the password check, in one Firestore
    transaction with the lock check (`beginLoginAttempt`). A correct password then
    clears the IP's and device's counts. Check-then-record would let parallel
    guesses slip past.
  - Client IP = `CF-Connecting-IP` (Cloudflare fronts every Render service and
    overwrites it), then rightmost `X-Forwarded-For` (local dev only: Render
    *appends* to a client-sent XFF, so on Render it's forgeable). `True-Client-IP`
    is deliberately ignored: Cloudflare only sets it on some plans, otherwise a
    client-sent value passes through. If IPs were ever spoofable, the global
    backstop still caps attackers, since they have no device cookie.
  - **After deploying, sanity-check it:** one wrong password from two different
    networks (e.g. phone on mobile data + laptop on Wi-Fi) should create two
    `login_attempts` docs plus `global`. If they share one doc, IP detection is
    wrong and the per-IP lock is acting like a global one.
- **CSRF**: `SameSite=Lax` cookie + `lib/origin.ts` rejects non-GET requests
  whose `Origin` host ≠ `Host`.
- **Stored-XSS guard**: `lib/mime.ts` is the single allowlist (PDF + raster images).
  Upload rejects anything else server-side, and the signed download link forces
  `inline` only for allowlisted types (`attachment` + octet-stream otherwise; the
  overrides are part of the signature). Never add `image/svg+xml` or HTML.

### Storage (`lib/r2.ts`)
- Private bucket, S3 API via `@aws-sdk/client-s3` (`region: "auto"`). Client is
  lazy so `next build` needs no credentials.
- Key = `docs/{firestoreDocId}`: upload allocates the Firestore ref *first*, puts the
  blob, then writes the row. If the row write fails, the blob is best-effort deleted.
- **Downloads** (`app/api/docs/[id]/download`): after the auth + `active` check the
  route 302s to a signed GET URL (5 min, `Cache-Control: no-store`) with
  `ResponseContentType`/`ResponseContentDisposition` baked in. Bytes go
  browser↔R2: free egress, no Render RAM/bandwidth. A leaked link works until it
  expires. ZIP export can't do this (the zip is built here) and still streams
  through the server.
- Deletes soft-delete the row first, then delete the blob. A failed blob delete
  leaves an unreferenced orphan (harmless, costs storage). `DeleteObject` is
  idempotent and free.
- **Free-tier cap:** `STORAGE_CAP_BYTES` (9 GB). The upload route sums `size_bytes`
  of `active` + `pending_confirm` docs (every blob still in R2) and returns 507
  if the new batch would cross it. Firestore sizes are the only counter; there's
  nothing separate to drift. An abandoned `pending_confirm` draft counts until
  `wipe` (or a discard) removes it.

### Upload has two modes
- **Manual** (AI off / no key): reads shared category+subfolder from the form,
  writes docs `status:"active"` immediately, navigates to browse.
- **Auto-organize** (AI on): runs Gemini per file, writes `status:"pending_confirm"`,
  returns suggestions → user reviews on the confirm screen → `POST /api/docs/confirm`
  flips to `active`, or `POST /api/docs/discard` deletes the drafts + blobs.

### Chat search (`lib/chat-search.ts`, pure and unit-tested)
Gemini turns the query into structured filters + free-text, and we filter active docs
in memory and rank. These fallbacks must stay:
- No Gemini → substring search over the raw query.
- Structured filter returns zero → retry as plain keyword search (rescues a
  slightly-wrong Gemini owner/category guess).
- `matchesText` returns **false** on a content-less query (e.g. "a a a") so it
  can't dump the whole vault.
- Tokenizer splits on non-alphanumerics so "Sister's" → "sister".

### ZIP export (`app/api/export/route.ts`)
Streams via `archiver`, one blob buffered at a time (bounded memory). The
per-entry drain + error handling is deliberate: on an archiver error the handler
`destroy()`s the stream (client sees a failed, not hung, download), and the catch
does **not** re-`finalize()` (finalize on a destroyed archive never settles;
that was a real bug). Empty titles fall back to `document-<id>` so archiver never
gets an empty entry name.

---

## Gotchas that will bite you

- **Literal U+2028/U+2029 in regexes:** `sanitizeSubfolder`'s char-class includes
  Unicode line separators. If you retype that regex, use the `  `
  escapes, not the literal chars, because the literals silently break the TS parser or
  get mangled by tooling. (This bit us twice.)
- **`docsCol` / `getDb` are lazy functions, not values.** Call `docsCol()` and
  `getDb()`. They're lazy so `next build` doesn't need real Firebase creds.
- **`FieldValue.delete()` vs `undefined`:** confirm route uses `FieldValue.delete()`
  to clear owner/date; upload writes `undefined` (dropped by
  `ignoreUndefinedProperties`). Both normalize to "field absent" via `fromFirestore`.
- **Tags are lowercased on every write path** (manual, confirm, auto). Keep it
  that way or tag matching/grouping desyncs.
- **Subfolder sanitizing:** don't remove the guards. They stop path traversal and
  Firestore-index-busting long strings.

---

## How to debug the common failures

| Symptom | Likely cause | Where to look |
|---|---|---|
| Upload "Expected multipart form" on big files | body exceeded `proxyClientMaxBodySize` | `next.config.ts`; raise it (Render only) |
| Upload "Couldn't store the file" / download 502 or R2 error page | R2 creds, bucket name, token scope | `npm run r2:smoke`; `[hermes] R2 …` lines in server logs |
| Upload 507 "Storage is almost full" | hit the 9 GB free-tier cap | delete docs, or raise `STORAGE_CAP_BYTES` in `lib/r2.ts` if you accept billing |
| Browse/search empty + `FAILED_PRECONDITION` in logs | missing Firestore index | click the index URL Firestore prints in the log |
| Auto-organize toggle missing | no `GEMINI_API_KEY` | env var |
| New device says "Too many wrong attempts" | global backstop tripped (known devices are exempt) | wait 15 min, or delete `login_attempts/global` in Firestore |
| Everyone locked out after a few wrong tries | client IP detection collapsed to one value | see the sanity check under "Auth model"; fix `clientIp` |
| Everyone suddenly signed out | password hash or `SESSION_SECRET` changed | expected; sign in again |
| Login redirect loop / every page 500 | bad/short `SESSION_SECRET` or malformed `HERMES_PASSWORD_HASH` | env vars (throws by design; check server logs) |
| Folder vanished after deleting its docs | `folders` registry write failed | `lib/folder-store.ts`; folder still works off doc paths |
| Everything 500s at once | Firebase creds bad | `FIREBASE_SERVICE_ACCOUNT`, use base64 form |

## Safety tools

- `npm run r2:smoke`: put/get/compare/delete one object in the real bucket.
  **Run this first when anything storage-related breaks**, because it isolates "is it
  our code or the bucket/credentials".
- `npm run wipe`: deletes every doc + blob + folder entry + login-attempt record
  (type `WIPE`). For resetting during testing.
- `npm run hash-password`: new password hash; deploying it signs everyone out.
- `npm test`: unit tests over the pure logic (chat-search filters, password
  hashing, rate-limit policy, origin check). Run before any commit touching `lib/`.
- `npm run typecheck`: keep it green before every commit.

## If you add a feature

1. New API route → auth + Origin check are automatic (proxy matcher catch-all).
   Public route → add it to the matcher and call `isSameOriginRequest` yourself.
2. New stored file type → add it to `lib/mime.ts` only if a browser can't execute it.
3. New write path for tags → lowercase them.
4. Pure logic → put it in `lib/` and add a `.test.ts` (route handlers can't be
   unit-tested cleanly, which is why `chat-search.ts` was extracted out of its route).
5. Before commit: `npm run typecheck && npm test && npm run build`.
