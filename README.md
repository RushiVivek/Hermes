# hermes

Family-facing certificate / document vault. Mobile-first. Plain language for non-technical users.

## Stack
- Next.js 16 (App Router) + TypeScript + Tailwind 4
- Firestore (Firebase, Spark/free) for metadata + folder registry + per-account usage
- Buzzheavier for blob storage (multi-account, auto-rotating at 90% of the 500MB free cap)
- Hosted on Render (persistent Node server); `hermes.rushivivek.com`
- Gemini for auto-organize and chat (deferred to a later phase)

## Local setup

```sh
mise install            # picks up Node 24 from .mise.toml
npm install
cp .env.local.example .env.local
# fill in HERMES_PASSWORD, SESSION_SECRET, FIREBASE_SERVICE_ACCOUNT, BUZZHEAVIER_ACCOUNTS
npm run seed            # optional: ~10 fixture docs for UI testing
npm run dev             # http://localhost:28085
```

## Env vars
| Var | Required | Purpose |
|---|---|---|
| `HERMES_PASSWORD` | yes | Shared family vault password. |
| `SESSION_SECRET` | yes | 32+ char random string; signs session cookies. |
| `FIREBASE_SERVICE_ACCOUNT` | yes | Service-account JSON, base64 or inline (see `.env.local.example`). |
| `BUZZHEAVIER_ACCOUNTS` | yes | JSON array of account-id strings, e.g. `["acc1","acc2"]`. Root dir discovered automatically. |
| `BUZZHEAVIER_ACTIVE_INDEX` | no | Which account new uploads start at (default 0). Auto-rotates forward at 90% quota. |
| `GEMINI_API_KEY` | later | Gemini API key (auto-organize / chat). |

## Scripts
- `npm run dev` — dev server on :28085
- `npm run seed` — insert fixture docs
- `npm run wipe` — delete every doc + blob + folder entry (type `WIPE` to confirm)
- `npm run test` — vitest unit tests
- `npm run buzzheavier:smoke` — end-to-end probe/upload/download/delete against the real API
- `npm run typecheck` — `tsc --noEmit`

## Current surface
- Shared-password login + sign-out
- Browse (gdrive-style, mobile-first, list/grid/gallery, light/dark/system)
- Upload (multi-file, drag-drop, camera) with manual category + free-form sub-folders
- Folder + document delete; folders persist after being emptied
- Download proxied through hermes (Buzzheavier URL never exposed)

## Deploying to Render + custom domain

We deploy to **Render**, not Vercel. hermes streams uploads *through* the
server, and Vercel's serverless functions cap request bodies at **4.5 MB** with
no way to raise it (confirmed in Vercel's docs). Render runs hermes as a
persistent Node server, so the only upload limit is our
`next.config.ts` `proxyClientMaxBodySize` (300 MB).

0. **Smoke-test creds locally first** (catch problems before deploying):
   ```sh
   git pull && npm install
   npm run buzzheavier:smoke   # confirms the Buzzheavier API round-trips
   npm run dev                 # log in at :28085, upload one real file
   ```
   If it works locally it'll work on Render. If not, fix it here — don't debug
   on Render. `buzzheavier:smoke` is also your first-line "is it me or is it
   Buzzheavier/Cloudflare?" tool whenever storage misbehaves.

1. **First deploy (Blueprint)**
   - The repo has a `render.yaml`. In Render: **New + → Blueprint**, pick this
     repo. It provisions a free web service: `npm ci && npm run build` →
     `npm run start` (binds Render's `$PORT`), health check `/api/health`.
   - When you **Apply**, Render prompts for the secret env vars (marked
     `sync:false` in `render.yaml` so they're never committed). Set all of:
     - `HERMES_PASSWORD` — the shared vault password
     - `SESSION_SECRET` — `openssl rand -base64 48`
     - `FIREBASE_SERVICE_ACCOUNT` — **base64 form** (same value as `.env.local`)
     - `BUZZHEAVIER_ACCOUNTS` — e.g. `["your-account-id"]`
     - `BUZZHEAVIER_ACTIVE_INDEX` — `0`
     - `GEMINI_API_KEY` — optional; enables AI auto-organize + smarter chat
       (without it the app still works: manual filing + substring search)

2. **Custom domain `hermes.rushivivek.com`**
   - Render service → **Settings → Custom Domains → Add** → `hermes.rushivivek.com`.
   - Render shows the record to create — for a subdomain it's a **CNAME**:
     - Host/Name: `hermes`
     - Value: the `…onrender.com` hostname Render gives you
   - Add that CNAME at `rushivivek.com`'s DNS provider. Render issues the
     Let's Encrypt cert automatically once it resolves.
   - No port mapping — Render serves 443. `:28085` is only for `npm run dev`.

### Free-tier cold start
Render's free tier spins the service down after ~15 min of no traffic; the next
visit waits ~30 s for it to wake. Fine for a vault opened occasionally. To
eliminate it: upgrade to the $7/mo paid instance, or hit `/api/health` from an
external cron (e.g. UptimeRobot) every ~10 min — though if you're running a
keep-alive cron anyway, self-hosting on a box you already own is simpler.

### Upload size
On Render (persistent server) uploads are bounded only by `proxyClientMaxBodySize`
(300 MB) — big phone photos and scanned PDFs work. If you ever move back to a
serverless host (Vercel/Netlify), the ~4.5–6 MB function body cap returns and the
real fix becomes a direct client→Buzzheavier upload (deferred — needs the account
token off the client).

## Mobile testing
Test every screen at 360×640 in Chrome devtools first. Touch targets ≥ 44px. No hover-only affordances.
