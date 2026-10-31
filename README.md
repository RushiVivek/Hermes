# hermes

Family-facing certificate / document vault. Mobile-first. Plain language for non-technical users.

## Stack
- Next.js 16 (App Router) + TypeScript + Tailwind 4
- Firestore (Firebase, Spark/free) for metadata + folder registry + login rate limits
- Cloudflare R2 for file storage (private bucket; free tier: 10 GB-month, 1M writes + 10M reads/month, free egress). Uploads stop at 9 GB so it never bills.
- Hosted on Render (persistent Node server); `hermes.rushivivek.com`
- Gemini (optional) for auto-organize on upload and natural-language search

## Local setup

```sh
mise install            # picks up Node 24 from .mise.toml
npm install
cp .env.local.example .env.local
npm run hash-password   # paste the printed HERMES_PASSWORD_HASH line into .env.local
# fill in SESSION_SECRET, FIREBASE_SERVICE_ACCOUNT and the four R2_* vars
npm run r2:smoke        # confirms the bucket + credentials round-trip
npm run dev             # http://localhost:28085
```

### Cloudflare R2 setup
1. Cloudflare dashboard → **R2** → create a bucket (e.g. `hermes`). Leave public access **off**: downloads use short-lived signed links that only a signed-in user can get.
2. **R2 → Manage API tokens → Create API token** → permission **Object Read & Write**, scoped to that one bucket. Copy the Access Key ID and Secret Access Key.
3. Your account id is shown on the R2 overview page.

## Env vars
| Var | Required | Purpose |
|---|---|---|
| `HERMES_PASSWORD_HASH` | yes | scrypt hash of the shared vault password (`npm run hash-password`). |
| `SESSION_SECRET` | yes | 32+ char random string; signs session cookies. |
| `FIREBASE_SERVICE_ACCOUNT` | yes | Service-account JSON, base64 or inline (see `.env.local.example`). |
| `R2_ACCOUNT_ID` | yes | Cloudflare account id. |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | yes | R2 API token scoped to the bucket. |
| `R2_BUCKET` | yes | Bucket name. |
| `GEMINI_API_KEY` | no | Enables AI auto-organize + smarter chat search. |

## Scripts
- `npm run dev`: dev server on :28085
- `npm run hash-password`: hash a new vault password (changing it signs every device out)
- `npm run r2:smoke`: put/get/delete one object against the real bucket
- `npm run wipe`: delete every doc + blob + folder entry (type `WIPE` to confirm)
- `npm run test`: vitest unit tests
- `npm run typecheck`: `tsc --noEmit`

## Current surface
- Shared-password login + sign-out, with brute-force lockout
- Browse (gdrive-style, mobile-first, list/grid/gallery, light/dark/system)
- Upload (multi-file, drag-drop, paste, camera) with manual filing or AI auto-organize
- Natural-language "find a document" chat
- Folder + document delete; folders persist after being emptied
- Download straight from R2 via 5-minute signed links; ZIP export streamed through hermes (the bucket is never public)

## Security model
- One shared password, stored only as an scrypt hash. Sessions are 30-day signed cookies (`HttpOnly`, `SameSite=Lax`, `Secure` in prod).
- The session signing key is derived from `SESSION_SECRET` + the password hash, so **changing the password signs everyone out**. Rotating `SESSION_SECRET` does the same.
- Login lockout: 5 wrong tries from one IP locks it for 15 min, and the lock doubles on each repeat (max 24 h). 100 wrong tries per hour across all IPs pauses new logins for 15 min.
- State-changing API calls must come from this site's Origin. Security headers (`nosniff`, `X-Frame-Options: DENY`, HSTS) are set on every response.
- Only images and PDFs are accepted (checked server-side), and only those are ever served inline.

## Deploying to Render + custom domain

We deploy to **Render**, not Vercel. hermes streams uploads *through* the
server, and Vercel's serverless functions cap request bodies at **4.5 MB**
with no way to raise it. Render runs hermes as a persistent Node server, so the
upload limit is ours to set (100 MB per batch, see "Upload size").

0. **Smoke-test creds locally first**:
   ```sh
   npm run r2:smoke   # confirms the R2 bucket round-trips
   npm run dev        # log in at :28085, upload one real file
   ```
   If it works locally it'll work on Render. Fix problems here rather than on Render.

1. **First deploy (Blueprint)**
   - The repo has a `render.yaml`. In Render: **New + → Blueprint**, pick this
     repo. It provisions a free web service: `npm ci && npm run build` →
     `npm run start` (binds Render's `$PORT`), health check `/api/health`.
   - When you **Apply**, Render prompts for the secret env vars (marked
     `sync:false` in `render.yaml` so they're never committed). Set all of:
     `HERMES_PASSWORD_HASH`, `SESSION_SECRET` (`openssl rand -base64 48`),
     `FIREBASE_SERVICE_ACCOUNT` (**base64 form**), `R2_ACCOUNT_ID`,
     `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, and optionally
     `GEMINI_API_KEY`.

2. **Custom domain `hermes.rushivivek.com`**
   - Render service → **Settings → Custom Domains → Add** → `hermes.rushivivek.com`.
   - Render shows the record to create. For a subdomain it's a **CNAME**:
     - Host/Name: `hermes`
     - Value: the `…onrender.com` hostname Render gives you
   - Add that CNAME at `rushivivek.com`'s DNS provider. Render issues the
     Let's Encrypt cert automatically once it resolves.
   - No port mapping is needed: Render serves 443. `:28085` is only for `npm run dev`.

### Free-tier cold start
Render's free tier spins the service down after ~15 min of no traffic, and the next
visit waits ~30 s for it to wake. Fine for a vault opened occasionally. To
eliminate it: upgrade to the $7/mo paid instance, or hit `/api/health` from an
external cron every ~10 min.

### Upload and download size
- **Uploads:** at most 25 files / 100 MB per batch (`MAX_UPLOAD_*` in
  `lib/types.ts`; the form checks before sending). The upload route holds the
  batch in memory and Render's free instance has 512 MB of RAM, so don't raise
  this without a bigger instance. Larger needs → presigned direct-to-R2 uploads.
- **Gemini auto-organize** reads files up to 12 MB; bigger ones get a blank
  review form.
- **Downloads:** no limit. Single files come straight from R2 (free egress);
  ZIP export streams through hermes one file at a time.

## Mobile testing
Test every screen at 360×640 in Chrome devtools first. Touch targets ≥ 44px. No hover-only affordances.
