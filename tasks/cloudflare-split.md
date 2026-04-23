---
status: ready
size: large
---

# Cloudflare split: move off Next.js/Vercel to three Cloudflare Workers

## Status (as of 2026-04-23)

Most of the code is ported. The remaining work is validating the round
trip end-to-end on the laptop, then tackling prod deploy + cleanup.

Main completed pieces:

- Three Workers wired via Alchemy (app / docs / frontdoor) with service
  bindings + Supabase env.
- Frontdoor Worker owns `/artifact/*` and proxies the rest.
- App Worker (TanStack Start) now has Better Auth GitHub OAuth + session
  helpers + `/api/internal/artifacts/resolve` (edge) +
  **`/github/upload`** + **`/github/events`** + **`/api/trpc/*`** (tRPC
  artifact-access router with `getDownloadUrl`, `createUploadTokens`,
  `storeUploadRecords`, `deleteEntries`).
- Artifact browser UI (`/app/artifacts/…`) ported with TrpcProvider,
  ArtifactLoader, FileList, DeleteButton, and the "no credit / not
  authorized / upload missing" branches.
- Docs content ported (recipes, advanced usage, self-hosting, legal,
  landing splash).
- `pnpm dev` auto-spins a **cloudflared quick tunnel**, saves the URL to
  `.alchemy/tunnel-url.txt`, and re-points the GitHub App webhook there
  via `PATCH /app/hook/config` (disable with `GITHUB_APP_WEBHOOK_SYNC=0`).
- `usage.test.ts` reads the tunnel URL, generates workflows using
  `mmkal/artifact.ci/upload@main` with `artifactci-origin` set to the
  tunnel, and follows the status-check link through to the rendered
  artifact page.

Main missing pieces:

- No real Cloudflare deploy yet — prod secrets aren't wired through
  `alchemy.run.ts` and DNS isn't pointed.
- Dev harness still has Vite HMR disabled (app + docs) and serves docs
  from a pre-built `dist/` via `python3 -m http.server`.
- Quick tunnels rotate URLs each session; named-tunnel flow (with a
  stable `dev.artifact.ci` CNAME) is documented but not wired.
- Legacy `src/action/*` still bundles the GitHub Action against `~/tag-logger`
  and `@artifact/domain` — works, but could live under `apps/action/` for
  symmetry.
- Sponsors cron not ported (was `src/app/api/cron/update-sponsors`).

## The goal

Keep the same user-facing URLs and product behavior as the legacy Next.js app
on Vercel, but deploy as three Cloudflare Workers (via Alchemy) with a shared
origin:

- **Frontdoor Worker** owns `/artifact/*` and dispatches the rest. Handles
  artifact blob fetching directly from Supabase storage at the edge.
- **App Worker** (TanStack Start) owns `/app/*`, `/api/*`, `/login`,
  `/account`, `/billing`, `/settings`, `/dashboard`. Auth, session, artifact
  metadata, upload ingest, webhook ingest.
- **Docs** (Astro + Starlight, static) owns everything else, with a clean
  path to `docs.artifact.ci` later.

See `apps/docs/src/content/docs/guides/architecture.md` for the canonical
statement.

## What's done

- [x] Monorepo + pnpm workspaces under `apps/*` and `packages/*`
  _packages/config (routing constants), packages/domain (db, auth, artifact, github, logging, analytics)_
- [x] Legacy Next.js app removed
  _commit `4bcf1a2 remove legacy next app`; the whole `src/app/**` tree is gone_
- [x] Alchemy config for three Workers with service bindings
  _`alchemy.run.ts`; frontdoor has `APP` + `DOCS` bindings and Supabase env_
- [x] Frontdoor Worker
  _`apps/frontdoor/src/index.ts` + `artifact-handler.ts` + `routing.ts`; handles `/artifact/blob/*` by calling `/api/internal/artifacts/resolve` on the app worker then fetching Supabase storage directly; redirects legacy `/artifact/view/*` → `/app/artifacts/*`_
- [x] App Worker (TanStack Start + React Router)
  _`apps/app/src/server.ts`; routes `/api/auth/*`, `/api/internal/artifacts/resolve`, plus file-based UI routes_
- [x] Better Auth with GitHub OAuth
  _`apps/app/src/auth/{server-auth,session,request-session,auth-client}.ts`; pg pool hydrated from `DATABASE_URL`_
- [x] Edge artifact-resolve endpoint
  _`apps/app/src/artifacts/resolve.ts` → calls into `packages/domain` resolve logic_
- [x] Docs site content
  _`apps/docs/src/content/docs/**`; recipes ported from old Nextra pages_
- [x] Consolidated DB schema with better-auth tables
  _`definitions.sql`; `pnpm auth:generate` pipeline documented_
- [x] Dev harness via single portless origin
  _`scripts/dev.sh`, `http://artifactci.localhost:1355`_
- [x] Minimal e2e smoke against the new stack
  _`e2e/site.test.ts`: homepage, `/login`, `/app → /login` redirect, websocket-error regression_

## What's left

### Upload pipeline

- [x] `/github/upload` POST handler ported into the app worker
  _`apps/app/src/github/upload.ts` — does the GitHub app install lookup, confirms the run is in-progress, inserts artifact + identifiers, mints a vault-backed upload token, and returns the list of viewable URLs (pointing at `/app/artifacts/…`)._
- [x] `/github/events` webhook handler ported
  _`apps/app/src/github/events.ts` — handles `installation_added/removed` and `workflow_job_completed`. For completed runs it lists artifacts, inserts DB records, and posts a GitHub check run whose `details_url` points at the incoming origin (dev tunnel or prod)._
- [x] `/api/trpc/*` router ported
  _`apps/app/src/trpc/{server,router}.ts` — `getDownloadUrl`, `createUploadTokens`, `storeUploadRecords`, `deleteEntries`. Auth middleware checks either a Better Auth session or a recently-minted vault upload token (same shape as legacy)._
- [x] Webhook signature validator ported
  _`packages/domain/src/github/webhook-validator.ts` — Cloudflare-friendly wrapper around `@octokit/webhooks`, no NextRequest dependency._
- [ ] **End-to-end `usage.test.ts` round trip on the laptop**
  _code is in place; never actually run. Needs `pnpm dev` up, cloudflared tunnel live, GitHub App webhook synced, `GH_TOKEN` exported, then `pnpm e2e`. First pass will almost certainly turn up bugs._

### Artifact browser UI

- [x] Real `/app/artifacts/$owner/$repo/…` route
  _`apps/app/src/routes/app.artifacts.*.tsx` now runs `loadArtifactForBrowser` (server function wrapping `resolveArtifactRequest`), branches on `artifact_not_found / not_authorized / upload_not_found / not_uploaded_yet / 2xx`, and renders one of `ArtifactLoader` / `FileList`. Shares the `getEntrypoints` heuristic with the server._
- [x] Client-side loader + file browser
  _`apps/app/src/ui/{artifact-loader,file-list,delete-button,trpc-provider}.tsx` — TrpcProvider wraps React Query + the tRPC client; `ArtifactLoader` drives `clientUpload` (from `@artifact/domain/artifact/client-upload`) via tRPC and streams stage updates. FileList links to `/artifact/blob/…` for file bytes (served by the frontdoor)._
- [ ] Nav + signed-in shell polish
  _`apps/app/src/routes/__root.tsx` has a basic link list. Could lift the old "breadcrumb" nav, but the site-wide UI is no longer blocking._

### Product surface gaps

- [ ] Sponsors cron
  _legacy `src/app/api/cron/update-sponsors/route.ts` is gone. Port to a Cloudflare Worker Cron Trigger or drop it. Not blocking for feature parity._
- [ ] OpenAPI proxy route — decide whether to keep
  _legacy `src/app/api/openapi/[...url]/route.ts` is gone. The client-upload path hits Supabase directly with signed URLs, so the proxy may no longer be needed._
- [ ] Analytics wiring in the app worker
  _`captureServerEvent` is called from the webhook handler; the client still needs PostHog init if we want pageview coverage._
- [ ] Replace placeholder pages
  _`/account`, `/billing`, `/settings`, `/dashboard`, `/` are still stubs (`apps/app/src/routes/`). Not blocking for feature parity but feels empty on first visit._

### Legacy `src/` folder cleanup

- [x] Move `src/openapi/` → `packages/domain/src/openapi/`
- [x] Move `src/storage/supabase.ts` → `packages/domain/src/storage/supabase.ts`
- [ ] Move `src/action/{badge,upload,types}.ts` into a dedicated `apps/action/` (non-blocking — esbuild bundles still work as-is)
- [ ] Delete `src/tag-logger.ts` and `src/db.ts` once nothing outside `packages/domain` imports them
  _both currently duplicated. `src/action/*` imports `~/tag-logger`, which resolves to the root `src/tag-logger.ts`. Swap its import to `@artifact/domain/logging/tag-logger` and delete._
- [ ] `src/gh/sponsors.ts` — delete along with the sponsors cron decision

### Deploy

- [ ] Wire prod secrets through `alchemy.run.ts`
  _today only `SUPABASE_PROJECT_URL` and `SUPABASE_SERVICE_ROLE_KEY` reach the frontdoor. The **app worker** needs `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_WEBHOOK_SECRET`, `DATABASE_URL`, and the Supabase keys (for the storage proxy)._
- [ ] First real Cloudflare deploy to a staging stage
  _`pnpm deploy` has never run for real on this branch — needs Cloudflare account + DNS for `artifact.ci` pointed at the frontdoor Worker._
- [ ] Decide cutover plan vs. the Vercel deploy
  _probably: stand up `staging.artifact.ci` on Cloudflare, verify upload/browse/webhooks end-to-end, then switch DNS._

### Dev harness stabilisation (ongoing)

- [x] Expose the dev box to GitHub via cloudflared quick tunnel, auto-sync webhook URL
  _`scripts/dev.sh` + `scripts/sync-github-app-webhook.ts`. Disable with `GITHUB_APP_WEBHOOK_SYNC=0`. `CLOUDFLARE_TUNNEL=<name>` switches to a named tunnel if you want a stable URL._
- [ ] Support stable `dev.artifact.ci` named tunnel as a first-class flow
  _today `CLOUDFLARE_TUNNEL=<name>` is half-wired: it runs `cloudflared tunnel run <name>` but expects the user to also set `PUBLIC_DEV_URL`. Would be nicer to derive the URL from the tunnel's ingress config._
- [ ] Re-enable Vite HMR cleanly through the frontdoor
  _today `apps/app/vite.config.mjs` has `server: {hmr: false}` and `apps/docs/astro.config.mjs` also sets `hmr: false`; docs dev is served via `python3 -m http.server` off a pre-built `dist/`. The `/__app_proxy__` rewrite in the frontdoor is a workaround that feels fragile._
- [ ] Flatten the `/__app_proxy__` asset-rewriting in prod
  _that whole branch in `apps/frontdoor/src/index.ts` is dev-only; make sure it can't leak into prod responses._
- [ ] Fix `astro build` in `apps/docs`
  _fails at the end with `Received protocol 'astro:'` — ESM loader doesn't recognise astro's virtual modules. Pre-existing on branch; partial `dist/` is still produced (which is what dev serves), but `pnpm deploy` will want a clean build._

## Ground rules / design decisions already locked in

- Single origin (`artifact.ci`) for now. Docs can move to `docs.artifact.ci`
  later; not a blocker.
- Auth cookies first-party on the app origin, issued by Better Auth.
- Artifact bytes come from Supabase storage, fetched by the frontdoor Worker
  at the edge using the service-role key. Supabase is not going away for blob
  storage in this migration.
- Postgres stays (Supabase-hosted); pgkit + pg pool used from the app worker.
- Alchemy is the deploy tool. No manual `wrangler deploy` scripting.
- The GitHub Action is a separate build target (`bundled-action/*.min.js`);
  moving it off the legacy `src/action/` tree is cleanup, not migration.

## Open questions

- Keep tRPC or drop it? We kept it for feature parity. Reevaluate once
  the pipeline is green — a JSON API might simplify things.
- Where to host `docs.artifact.ci` long-term — same Cloudflare account, or
  just a CNAME to the current static deploy.

## Dev loop (what to run on the laptop)

1. Bring up supabase/postgres (docker-compose or a real DATABASE_URL).
2. Make sure `.env` has all the `GITHUB_APP_*`, `SUPABASE_*`,
   `BETTER_AUTH_SECRET`, and `DATABASE_URL` vars set.
3. `pnpm dev` — this starts alchemy dev, opens a cloudflared quick
   tunnel, writes the URL to `.alchemy/tunnel-url.txt`, and repoints the
   GitHub App webhook at `<tunnel>/github/events` automatically.
4. Drive a workflow in a test repo. The full round trip to verify:
   upload action hits `<tunnel>/github/upload`, `workflow_job_completed`
   webhook hits `<tunnel>/github/events`, the app posts a check run
   with `details_url` pointing at the tunnel, clicking it opens the
   artifact browser on the tunnel, and the file list renders with a
   link to `/artifact/blob/…`.
5. For the automated version, export `GH_TOKEN` and run `pnpm e2e`.
   `usage.test.ts` orchestrates 1–4 above against a freshly-created
   `mmkal/artifact-ci-e2e-<timestamp>` repo.
