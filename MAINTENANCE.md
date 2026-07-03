# hermes — maintenance & architecture notes

The map for fixing/extending hermes without re-deriving the hard-won details.
Pairs with `README.md` (setup/deploy). Read this before debugging anything weird.

---

## Mental model in one paragraph

Next.js 16 (App Router) app on a **persistent Node server** (Render, not Vercel
— see "Why not Vercel"). Firestore holds all metadata; Buzzheavier holds the
file blobs. Every request is gated by a shared password (`proxy.ts`). The UI is
mobile-first. Two optional Gemini-powered features (auto-organize on upload,
natural-language chat search) degrade gracefully to manual when no
`GEMINI_API_KEY` is set.

Data flow for an upload: browser → `POST /api/upload` → blob PUT to Buzzheavier
→ metadata row written to Firestore `docs`. Browse/search/download all read
Firestore; the blob is only touched on upload, download-proxy, and delete.

---

## Runtime layout

- **Dev/prod port:** `28085` (`package.json` scripts). `start` uses
  `${PORT:-28085}` so Render's injected `$PORT` wins in prod.
- **Node:** pinned to 24 (`.mise.toml` locally, `.node-version` + `NODE_VERSION`
  env for Render). Next 16 needs ≥20.9.
- **Commands:** `npm run dev|build|start|test|typecheck|seed|wipe|buzzheavier:smoke`.

## Environment variables (all required unless noted)

| Var | Purpose | Gotcha |
|---|---|---|
| `HERMES_PASSWORD` | shared vault password | plain string; SHA-256 timing-safe compared |
| `SESSION_SECRET` | signs the JWT session cookie | must be ≥32 chars or the app throws |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase admin creds | **use base64 form** — inline JSON breaks under dotenv quoting. Loader (`lib/firestore.ts`) sniffs `{` vs base64. |
| `BUZZHEAVIER_ACCOUNTS` | `["accId1","accId2"]` | account id **is** the bearer token. Array of strings (object `{id}` also accepted). |
| `BUZZHEAVIER_ACTIVE_INDEX` | which account new uploads start at | default 0; auto-rotates forward at 90% quota |
| `GEMINI_API_KEY` | optional; AI auto-organize + chat | if absent, upload hides the AI toggle and chat falls back to substring search |

---

## Firestore collections

1. **`docs`** — one per uploaded file. Shape = `Doc` in `lib/types.ts`.
   - `status`: `"pending_confirm"` (AI draft awaiting review) | `"active"` (live,
     browsable) | `"deleted"` (soft-deleted, hidden). **Browse/search/download
     only ever show `active`.**
   - `path` is the folder string, e.g. `"Education/Aarav/Marksheets"`. Backend is
     flat; the folder tree is *derived* from these strings.
   - `buzzheavier_account_id` records which account uploaded it, so delete uses
     the right bearer token even after rotation.
2. **`folders`** — persistent folder registry (doc id = `encodeURIComponent(path)`).
   Exists so a folder survives after its last doc is deleted (folders are
   otherwise derived from doc paths and would vanish). Written on upload/confirm,
   removed on folder-delete, cleared by `wipe`.
3. **`accounts`** — per-Buzzheavier-account `{ used_bytes }`. See "Size accounting".

**Required composite index:** `docs` on `(status, ...)` — Firestore will print a
one-click index-creation URL in the server logs the first time a query needs it.
If browse/search returns empty with a `FAILED_PRECONDITION` error in logs,
that's a missing index — click the URL in the error.

---

## The non-obvious decisions (why things are the way they are)

### Why not Vercel
Vercel serverless functions hard-cap the request body at **4.5 MB**, unraisable.
Uploads stream *through* our server, so that cap kills real phone photos. Render
runs a persistent Node process — no such cap; the only limit is
`next.config.ts` → `proxyClientMaxBodySize` (300 MB).

### proxy.ts, not middleware.ts
Next 16 renamed middleware to **proxy**. `proxy.ts` exporting `proxy` IS correct
and IS loaded (verified against `node_modules/next/dist/docs` and live). The
`middleware-manifest.json` being empty is a red herring — that's the legacy
Pages-Router index. Don't "fix" this by renaming to middleware.ts.

### Auth model
`proxy.ts` gates everything via a matcher allowlist. Excluded (public): `/login`,
`/api/auth/login`, `/api/auth/logout` (so a stale cookie can self-clear),
`/api/health` (Render's probe), and static assets. **`/api/*` returns 401 JSON**
when unauthenticated (not a 302 redirect) — a redirect would make `fetch()` read
the login HTML as a fake success. If you add a new public route, add it to the
matcher; if you add a new API route it's auth-gated automatically.

### Buzzheavier is behind Cloudflare
CF intermittently serves a challenge HTML page (with `<meta viewport>`) instead
of the API JSON — even on a 200. Mitigations already in place, keep them:
- Browser-like `User-Agent` + `Accept` + `Cache-Control: no-cache` headers on
  every Buzzheavier call (`CLIENT_HEADERS` in `lib/buzzheavier.ts`).
- **Cache-busting query param on retry** — CF caches the challenge per-URL, so a
  retry of the *exact* URL gets the same failure; a fresh `?_=nonce` dodges it.
- Probe retries 3× with backoff; download-proxy and export cache-bust too.
- If uploads/downloads start failing with "unexpected payload", it's almost
  certainly CF. The raw body head is logged (`[buzzheavier]` / `[gemini]`).

### Size accounting (`lib/account-usage.ts`)
Buzzheavier's `/api/fs` returns `size: 0` for the account root **even with files
in it** (the children carry sizes, the aggregate doesn't). So we do NOT trust it.
Instead we keep our own `used_bytes` counter in Firestore `accounts/{id}`:
increment on upload, decrement on confirmed delete. First access to an account
backfills by walking the real tree. Rotation compares this counter to 90% of
500 MB. **Known leak:** an abandoned `pending_confirm` draft (uploaded but never
confirmed/discarded) keeps its bytes counted; self-heals on the next backfill.

### Upload has two modes
- **Manual** (AI off / no key): reads shared category+subfolder from the form,
  writes docs `status:"active"` immediately, navigates to browse.
- **Auto-organize** (AI on): runs Gemini per file, writes `status:"pending_confirm"`,
  returns suggestions → user reviews on the confirm screen → `POST /api/docs/confirm`
  flips to `active`, or `POST /api/docs/discard` deletes the drafts + blobs.

### Chat search (`lib/chat-search.ts` — pure, unit-tested)
Gemini turns the query into structured filters + free-text; we filter active docs
in memory and rank. Fallbacks that must stay:
- No Gemini → substring search over the raw query.
- Structured filter returns zero → retry as plain keyword search (rescues a
  slightly-wrong Gemini owner/category guess).
- `matchesText` returns **false** on a content-less query (e.g. "a a a") so it
  can't dump the whole vault.
- Tokenizer splits on non-alphanumerics so "Aarav's" → "aarav".

### ZIP export (`app/api/export/route.ts`)
Streams via `archiver`, one blob buffered at a time (bounded memory). The
per-entry drain + error handling is deliberate: on an archiver error the handler
`destroy()`s the stream (client sees a failed, not hung, download); the catch
does **not** re-`finalize()` (finalize on a destroyed archive never settles —
that was a real bug). Empty titles fall back to `document-<id>` so archiver never
gets an empty entry name.

---

## Gotchas that will bite you

- **Literal U+2028/U+2029 in regexes:** `sanitizeSubfolder`'s char-class includes
  Unicode line separators. If you retype that regex, use the `\u2028\u2029`
  escapes, not the literal chars — the literals silently break the TS parser or
  get mangled by tooling. (This bit us twice.)
- **`docsCol` / `getDb` are lazy functions, not values.** Call `docsCol()` and
  `getDb()`. They're lazy so `next build` doesn't need real Firebase creds.
- **`FieldValue.delete()` vs `undefined`:** confirm route uses `FieldValue.delete()`
  to clear owner/date; upload writes `undefined` (dropped by
  `ignoreUndefinedProperties`). Both normalize to "field absent" via `fromFirestore`.
- **Tags are lowercased on every write path** (manual, confirm, auto). Keep it
  that way or tag matching/grouping desyncs.
- **Cache-buster chars in `subfolder`/filenames:** already sanitized; don't remove
  the guards — they stop path traversal and Firestore-index-busting long strings.

---

## How to debug the common failures

| Symptom | Likely cause | Where to look |
|---|---|---|
| Upload "Expected multipart form" on big files | body exceeded `proxyClientMaxBodySize` | `next.config.ts`; raise it (Render only — Vercel can't) |
| Upload/download "unexpected payload" or 403, intermittent | Cloudflare challenge | `lib/buzzheavier.ts` headers/retry; check `[buzzheavier]` logs |
| Browse/search empty + `FAILED_PRECONDITION` in logs | missing Firestore index | click the index URL Firestore prints in the log |
| Auto-organize toggle missing | no `GEMINI_API_KEY` | env var |
| Rotation never triggers / account "full" wrong | `used_bytes` drift | delete the `accounts/{id}` Firestore doc → next upload backfills |
| Folder vanished after deleting its docs | `folders` registry write failed | `lib/folder-store.ts`; folder still works off doc paths |
| Login redirect loop | bad/short `SESSION_SECRET` | env var (throws by design; check server logs) |
| Everything 500s at once | Firebase creds bad | `FIREBASE_SERVICE_ACCOUNT` — use base64 form |

## Safety tools

- `npm run buzzheavier:smoke` — end-to-end probe/upload/download/delete against
  the real Buzzheavier account. **Run this first when anything storage-related
  breaks** — it isolates "is it us or is it Buzzheavier".
- `npm run wipe` — deletes every doc + blob + folder entry (type `WIPE`). For
  resetting during testing.
- `npm test` — 48 unit tests over the pure logic (buzzheavier account/rotation,
  chat-search filters). Run before any commit touching `lib/`.
- `npm run typecheck` — always green before commit.

## If you add a feature

1. New API route → auth is automatic (proxy matcher catch-all). Public route →
   add to the matcher.
2. Touching storage → keep the `used_bytes` counter in sync (increment/decrement).
3. New write path for tags → lowercase them.
4. Pure logic → put it in `lib/` and add a `.test.ts` (route handlers can't be
   unit-tested cleanly; that's why `chat-search.ts` was extracted out of its route).
5. Before commit: `npm run typecheck && npm test && npm run build`.
