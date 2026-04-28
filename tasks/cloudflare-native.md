---
status: ready-for-review
size: large
---

# Cloudflare-native: Supabase → D1 + R2

## Status

Branch implementation is complete up to the cutover gate. SQLite/D1
schema, sqlfu config and initial D1 migration, D1/R2 bindings, Better
Auth-on-D1, upload-token replacement, R2 presigned uploads, frontdoor
R2 reads, dependency cleanup, action bundle regeneration, and the
cutover runbook are in place. Missing by design: the prod deploy/cutover
command and Supabase cancellation.

Decision recap (recorded so future-me doesn't re-litigate):
- **D1** for metadata. Edge-local; removes pg-in-workerd hangs and the
  fresh-client-per-request shim; saves the Supabase Pro $10/mo.
- **R2** for artifact blobs. Same write-presigned / read-via-binding
  shape as Supabase Storage; no egress fees; cleaner auth (S3 SigV4
  presigned URLs are stateless, no `vault.secrets` token table needed
  on the storage side).
- **NOT durable-object-per-artifact**. Considered, rejected: artifacts
  are write-once read-many static data, DOs are for coordination.

### Tooling decisions

- **sqlfu** for the SQLite client + migrations + query type generation,
  installed from pkg.pr.new (`https://pkg.pr.new/mmkal/sqlfu/sqlfu@b25d208`).
  If we hit an sqlfu rough edge that needs upstream changes, we can pin
  to a branch URL instead while we iterate on sqlfu.
  - Adapter: `createD1Client(env.ARTIFACT_DB)` →
    `client.sql\`select … where x = \${x}\``.
  - Note from sqlfu's d1.ts source: D1 doesn't support `begin/savepoint`
    in raw SQL, so `client.transaction(fn)` does NOT roll back on error.
    Anywhere we need atomicity (the upload write path), we have to
    either accept partial writes or batch via `db.batch([…])` outside
    sqlfu.
- **R2 presigned PUTs** via `aws4fetch` (small, browser-safe, runs in
  workerd). Worker generates presigned URL → client PUTs file directly
  to R2.
- **Better Auth** uses its built-in Kysely D1 dialect; we drop the
  fresh-pg-client shim entirely.

## Checklist

### Schema port (Postgres → SQLite for D1)

- [x] Rewrite `definitions.sql` for SQLite syntax. _Implemented in `definitions.sql`; schema now uses SQLite types and no Supabase/Postgres-only statements._
  - [x] KSUID generation: drop the `gen_random_ksuid_microsecond`
    plpgsql function, generate IDs in JS at insert time (mirrors what
    sqlfu already does post-pgkit-rewrite). _IDs now come from `createPrefixedId` in `packages/domain/src/db/client.ts`._
  - [x] `prefixed_ksuid` domain type → plain `text` (with a JS-side
    branded type for compile-time safety, if we want to keep that). _All app table IDs are plain `text`; the Zod branded `Id` helper remains._
  - [x] `array_agg(...)` aggregations → `group_concat(...)` + parse
    on the server, or `json_group_array(...)` for richer types.
    _Read paths use `json_group_array(...)` and `parseJsonStringArray`._
  - [x] `jsonb_to_recordset` / `jsonb_populate_recordset` (used in
    bulk insert paths) → either multiple `INSERT … VALUES` or a
    `json_each` join. _Bulk insert paths now use D1 batches with explicit statements._
  - [x] `array[…]` columns → JSON columns + JS-side serialise/parse.
    `aliases text[]` on `artifact_entries` is the main one.
    _`artifact_entries.aliases` is JSON text._
  - [x] Drop the `vault` schema dependency (see Upload-token below). _Replaced by `upload_tokens`._
  - [x] Drop RLS / GRANT statements (D1 doesn't have them). _Removed from `definitions.sql`._
- [x] Decide migration strategy for D1 — pgkit equivalent? Probably
  just one-shot `definitions.sql` apply on bootstrap, since we're
  starting empty. _Normal D1 migrations are now used instead: `migrations/0000_initial_schema.sql` is applied through Alchemy's `migrationsDir`._

### DB driver swap (pg → D1 binding)

- [x] Add a D1 binding to the app worker in `alchemy.run.ts`
  (`bindings: { ARTIFACT_DB: alchemy.cloudflare.D1Database(...) }`). _`ARTIFACT_DB` is bound to `artifact-ci-${stage}-db`._
- [x] Replace `withPg` helper everywhere with a thin wrapper around
  `env.ARTIFACT_DB.prepare(sql).bind(...).all()` etc. Callsites:
  - `apps/app/src/artifacts/load.ts`, `resolve.ts`, `search.ts`
  - `apps/app/src/github/upload.ts`, `events.ts`
  - `apps/app/src/trpc/router.ts`
  _All listed callsites now use `getDb()` / D1 batches._
- [x] Decide how to plumb the binding into `createServerFn` handlers
  (TanStack Start exposes `getRequestEvent()` or similar — needs
  spike). _The Worker env is stored per request via `AsyncLocalStorage` in `apps/app/src/cloudflare-env.ts`._

### Better Auth on D1

- [x] Swap `getPool()` shim in `apps/app/src/auth/server-auth.ts` for
  Better Auth's D1 / Kysely-D1 dialect. _Better Auth receives `env.ARTIFACT_DB` directly._
- [x] Verify `account` / `session` / `user` / `verification` table
  shapes on SQLite match Better Auth's expectations. (Likely needs
  `text` instead of `timestamp`, `integer` for `expiresAt` etc.) _Auth schema uses text dates and integer booleans; `/api/auth/get-session` smoke-tested locally._
- [ ] Confirm GitHub OAuth flow still works end-to-end after the
  driver swap. _Needs real GitHub browser login after reviewer supplies/keeps OAuth env; not exercised by automated smoke._

### Upload-token replacement

- [x] New `upload_tokens` table on D1: `(token_hash text primary key,
  github_login text not null, created_at integer not null,
  expires_at integer not null)`. _Added in `definitions.sql`._
- [x] In `apps/app/src/github/upload.ts`: generate a random token in
  JS, hash it (SHA-256), store the hash + login + 10-min TTL, return
  the raw token to the action. Replaces the
  `vault.create_secret(owner)` call. _Implemented in `apps/app/src/upload-tokens.ts`._
- [x] In `apps/app/src/trpc/router.ts` middleware: hash the incoming
  `artifactci-upload-token` header, look it up in `upload_tokens`,
  recover the `github_login`. Replaces the
  `vault.decrypted_secrets where secret = $1` query. _tRPC middleware calls `lookupUploadToken`._
- [x] Periodic cleanup: easiest is a `delete from upload_tokens
  where expires_at < now()` at write time. _Cleanup runs on token creation and lookup._

### Storage swap (Supabase Storage → R2)

- [x] Add an R2 bucket binding to the app + frontdoor workers
  (`alchemy.cloudflare.R2Bucket('artifact_blobs')`). _`ARTIFACT_BLOBS` is bound to `artifact-ci-${stage}-blobs`._
- [x] Replace `createUploadTokens` mutation in
  `apps/app/src/trpc/router.ts`: generate S3 SigV4 presigned PUT URLs
  for R2 instead of calling Supabase's signed-upload API. Worker-side
  signing means we still chunk (subrequest cap doesn't apply — it's
  a local crypto operation). _Implemented with `aws4fetch`._
- [x] Replace `storeUploadRecords` to write the R2 key directly into
  `artifact_entries.storage_pathname` (drop the `storage.objects` join
  — that was Supabase-internal). _Records store the object key directly._
- [x] Replace `fetchSupabaseObject` in the frontdoor's
  `artifact-handler.ts` with `env.ARTIFACT_BLOBS.get(key)` — much
  simpler, no auth header juggling. _Frontdoor now streams R2 objects._
- [x] Drop the openapi-typescript-generated `supabase-storage.ts`
  and the proxy client, both used only for the Supabase signing call. _Removed generated OpenAPI client and its type test._

### Cutover

- [x] Same plan as the Cloudflare cutover that just landed:
  - DNS already lives on CF, no DNS change.
  - Deploy the new alchemy stack with D1 + R2 bindings; Alchemy applies
    the D1 migrations from `migrations/`.
  - Existing Supabase data is abandoned. Recent artifacts (within
    GitHub's 90-day retention) lazy-rebuild from GitHub on first
    visit. Old artifacts and old user sessions disappear — confirmed
    acceptable.
  _Runbook below; actual prod cutover intentionally not run._
- [ ] Cancel the Supabase Pro subscription once the new stack is
  serving real traffic for ~a week with no surprises. _Post-cutover operational task._

## Out of scope

- DO-per-artifact. Rejected during scoping.
- Image transforms (we don't use Supabase's, and CF's Image
  Transformations are a separate optional product).
- Migrating existing blobs across. Lazy rebuild covers it.

## Cutover runbook

1. Confirm the prod resource names. Defaults in this branch are
   `artifact-ci-prod-db` and `artifact-ci-prod-blobs`.
2. Ensure `.env.prod` has the usual GitHub/Better Auth/PostHog values plus
   `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` for the target R2 bucket.
3. Deploy after merge with `pnpm deploy:prod`.
4. Verify Alchemy applied `migrations/0000_initial_schema.sql` to the
   empty prod D1 database during deploy.
5. Smoke test sign-in, artifact lazy rebuild from GitHub, direct artifact
   blob serving, and upload-action output URLs.
6. Keep Supabase running for roughly a week; cancel it only after the new
   stack is serving real traffic cleanly.

## Implementation notes

- `pnpm exec sqlfu generate` passed with the SQLite schema.
- `pnpm exec sqlfu draft --name initial_schema` with the fixed sqlfu package generated `migrations/0000_initial_schema.sql`; the migration preserves quoted Better Auth identifier casing and SQLite timestamp format strings.
- `pnpm exec tsc --noEmit` passed.
- `pnpm build` passed.
- `pnpm dev` started the local frontdoor at `http://localhost:1337/`;
  `/api/test` and `/api/auth/get-session` returned successfully. The dev
  process was then stopped manually.
- `pnpm typecheck` still fails before project code because the repo's
  native-preview `tsgo` rejects the existing `baseUrl` compiler option.
