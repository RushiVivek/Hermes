# hermes

Family-facing certificate / document vault. Mobile-first PWA. Plain language for non-technical users.

## Stack
- Next.js 16 (App Router) + TypeScript + Tailwind 4
- Firestore (Firebase, Spark/free) for metadata
- Buzzheavier for blob storage (deferred to v1)
- Gemini for auto-organize and chat (deferred to v1/v2)
- Hosted on Vercel

## Local setup

```sh
mise install            # picks up Node 24 from .mise.toml
npm install
cp .env.local.example .env.local
# fill in HERMES_PASSWORD, SESSION_SECRET, FIREBASE_SERVICE_ACCOUNT
npm run seed            # populates Firestore with ~10 fixture docs
npm run dev             # http://localhost:3000
```

## Env vars
| Var | Required | Purpose |
|---|---|---|
| `HERMES_PASSWORD` | yes | Shared family vault password. |
| `SESSION_SECRET` | yes | 32+ char random string; signs session cookies. |
| `FIREBASE_SERVICE_ACCOUNT` | yes | Service-account JSON (entire object as a single string). |
| `BUZZHEAVIER_ACCOUNTS` | v1+ | JSON `[{id, rootDir}]` of Buzzheavier accounts. |
| `BUZZHEAVIER_ACTIVE_INDEX` | v1+ | Which account new uploads go to. |
| `GEMINI_API_KEY` | v1+ | Gemini API key. |

## v0 surface (current)
- Login (shared password)
- Browse (gdrive-style, mobile-first) backed by seeded Firestore data
- Doc detail page

Upload, auto-organize, and chat come in v1/v2.

## Mobile testing
Test every screen at 360×640 in Chrome devtools first. Touch targets ≥ 44px. No hover-only affordances.
