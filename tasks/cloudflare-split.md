---
status: ready
size: large
---

# Cloudflare split: move off Next.js/Vercel to three Cloudflare Workers

## Status (as of 2026-04-21)

Infra + auth shell is ~80% done. Product pipeline (upload, webhooks, artifact browser UI) is ~0% done — the old Next.js routes were deleted without replacements.

Main completed pieces:

- Monorepo layout under `apps/{app,docs,frontdoor}` + `packages/{config,domain}`.
- Alchemy config for three Workers with service bindings + Supabase env.
- Frontdoor Worker routes `/artifact/*` and proxies/dispatches everything else.
- App Worker (TanStack Start) with Better Auth GitHub OAuth + session helpers + edge resolver endpoint.
- Docs worker (Astro + Starlight) with the architecture/routing/recipes pages ported.
- DB schema consolidated (`definitions.sql`) including Better Auth tables.
- Dev harness: `pnpm dev` → `alchemy dev` behind a single portless origin
  (`http://artifactci.localhost:1355`).
- E2E smoke tests aligned to the new stack (homepage, login, `/app → /login` redirect).

Main missing pieces:

- No upload endpoint (`/github/upload`) and no tRPC server — the GitHub Action
  uploader can't actually round-trip.
- No GitHub webhook handler (`/github/events`).
- Artifact browser route is a literal placeholder.
- Legacy `src/` folder still partially live; some of it is genuinely still
  imported (action code, openapi client, tag-logger).
- No real deploy yet — prod secrets aren't wired through `alchemy.run.ts`.
- Dev harness is still a bit wobbly around Vite HMR / websocket proxying.

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

### Upload pipeline (the big one)

- [ ] Port the upload ingest endpoint
  _the GitHub Action at `src/action/upload.ts` + `src/action/badge.ts` still POST to `/github/upload` and then drive uploads over `/api/trpc/*` via `packages/domain/src/artifact/client-upload.ts`. Both endpoints no longer exist. Decide whether to keep tRPC (port it onto the app worker) or replace with plain REST/JSON and adjust `client-upload.ts` accordingly. Either way, `getDownloadUrl` / `createUploadTokens` / `storeUploadRecords` need real implementations backed by pg + Supabase storage signed URLs._
- [ ] Port the GitHub webhook handler (`/github/events`)
  _legacy file was `src/app/github/events/route.ts` (337 lines) — installation created/deleted, push events, artifact discovery. Needs reinstating on the app worker, likely as a POST handler in `apps/app/src/server.ts` wired to domain-level handlers in `packages/domain/src/github/`._
- [ ] End-to-end `usage.test.ts` passes again
  _today the showcase flow fails because the action can't upload._

### Artifact browser UI

- [ ] Real `/app/artifacts/$owner/$repo/$aliasType/$identifier/$artifactName` page
  _currently `apps/app/src/routes/app.artifacts.*.tsx` is a placeholder. The old Next.js components (FileList, ArtifactLoader, entrypoints, DeleteButton, client-upload UI) were all deleted. Rebuild in TanStack Start; pull from `/api/internal/artifacts/resolve` (or a sibling metadata endpoint) + `/artifact/blob/*` for file bytes._
- [ ] Real signed-in nav
  _`apps/app/src/routes/__root.tsx` has a nav bar of placeholders. Fill in once the browser page exists._

### Product surface gaps

- [ ] Sponsors cron
  _legacy `src/app/api/cron/update-sponsors/route.ts` (115 lines) is gone. Either port it to a Cloudflare Worker Cron Trigger or drop it._
- [ ] OpenAPI proxy route
  _legacy `src/app/api/openapi/[...url]/route.ts` (331 lines) is gone — used by `src/openapi/client.ts` which is still imported by `packages/domain/src/artifact/client-upload.ts`. Decide whether the proxy is still needed once upload lands on the new stack._
- [ ] Analytics wiring
  _PostHog server/client modules exist in `packages/domain/src/analytics/` but aren't called from the app worker yet._
- [ ] Replace placeholder pages
  _`/account`, `/billing`, `/settings`, `/dashboard`, `/` are all stubs. `/billing` in particular is labelled "Polar or Stripe can slot in here later"._
- [ ] Marketing / docs landing
  _docs homepage (`apps/docs/src/content/docs/index.mdx`) is 17 lines of "docs on Astro + Starlight"; needs real copy to replace the Nextra landing._

### Legacy `src/` folder cleanup

- [ ] Move `src/action/{badge,upload,types}.ts` into `apps/action/` (or similar) — they bundle the GitHub Action via esbuild (see `package.json` `build-badge-action`/`build-upload-action` scripts). Today they still import from `~/tag-logger` and `@artifact/domain`.
- [ ] Move `src/openapi/` + `src/storage/supabase.ts` into `packages/domain` (the Supabase proxy client is used from `packages/domain/src/artifact/client-upload.ts` via a `../../../../src/openapi/client` relative path — nasty).
- [ ] Decide about `src/gh/sponsors.ts` along with the sponsors cron decision above.
- [ ] Delete `src/tag-logger.ts` once nothing outside `packages/domain/src/logging/tag-logger.ts` depends on it.

### Deploy

- [ ] Wire prod secrets through `alchemy.run.ts`
  _today only `SUPABASE_PROJECT_URL` and `SUPABASE_SERVICE_ROLE_KEY` are passed to the frontdoor. The app worker needs `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `DATABASE_URL`, plus (once webhooks land) GitHub App private key and webhook secret._
- [ ] First real Cloudflare deploy to a staging stage
  _`pnpm deploy` has never run for real on this branch — needs Cloudflare account + DNS for `artifact.ci` pointed at the frontdoor Worker._
- [ ] Decide cutover plan vs. the Vercel deploy
  _probably: stand up `staging.artifact.ci` on Cloudflare, verify upload/browse/webhooks end-to-end, then switch DNS._

### Dev harness stabilisation (ongoing)

- [ ] Get Vite HMR working through the frontdoor
  _today `apps/app/vite.config.mjs` has `server: {hmr: false}` and `apps/docs/astro.config.mjs` also sets `hmr: false`; docs dev is served via `python3 -m http.server` off a pre-built `dist/`. That's why the frontdoor has to rewrite `/src/`, `/@vite/`, `/@react-refresh`, etc. behind an `/__app_proxy__` prefix. This works but is fragile. Ideally the frontdoor would proxy the raw vite dev server cleanly and both apps would re-enable HMR._
- [ ] Flatten the `/__app_proxy__` asset-rewriting in prod
  _that whole branch in `apps/frontdoor/src/index.ts` is dev-only; the prod path should never hit it. Double-check it can't leak into prod responses._

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

- Keep tRPC or drop it? The old app used tRPC heavily; the new app worker
  has no tRPC server. Upload client still imports `@trpc/client`. Dropping
  tRPC would simplify the edge a lot but requires refactoring
  `client-upload.ts` and the action bundle.
- How to handle the artifact-browser data layer in TanStack Start — server
  functions vs. loaders vs. a small JSON API on the app worker.
- Where to host `docs.artifact.ci` long-term — same Cloudflare account, or
  just a CNAME to the current static deploy.
