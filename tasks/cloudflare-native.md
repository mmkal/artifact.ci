---
status: needs-grilling
size: large
---

# Cloudflare-native: Supabase → D1 + R2

## Status

Not started. Scoped after a successful Vercel→Cloudflare-Workers cutover
(see `tasks/complete/*cloudflare-split*` once landed). Goal: drop the
Supabase dependency entirely so the whole stack lives on the same CF
account, and so per-request `new pg.Client()` round-trips stop being
the latency floor of every page render.

Decision recap (recorded so future-me doesn't re-litigate):
- **D1** for metadata. Edge-local; removes pg-in-workerd hangs and the
  fresh-client-per-request shim; saves the Supabase Pro $10/mo.
- **R2** for artifact blobs. Same write-presigned / read-via-binding
  shape as Supabase Storage; no egress fees; cleaner auth (S3 SigV4
  presigned URLs are stateless, no `vault.secrets` token table needed
  on the storage side).
- **NOT durable-object-per-artifact**. Considered, rejected: artifacts
  are write-once read-many static data, DOs are for coordination.

## Checklist

### Schema port (Postgres → SQLite for D1)

- [ ] Rewrite `definitions.sql` for SQLite syntax. Concrete pieces:
  - [ ] KSUID generation: drop the `gen_random_ksuid_microsecond`
    plpgsql function, generate IDs in JS at insert time (mirrors what
    sqlfu already does post-pgkit-rewrite).
  - [ ] `prefixed_ksuid` domain type → plain `text` (with a JS-side
    branded type for compile-time safety, if we want to keep that).
  - [ ] `array_agg(...)` aggregations → `group_concat(...)` + parse
    on the server, or `json_group_array(...)` for richer types.
  - [ ] `jsonb_to_recordset` / `jsonb_populate_recordset` (used in
    bulk insert paths) → either multiple `INSERT … VALUES` or a
    `json_each` join.
  - [ ] `array[…]` columns → JSON columns + JS-side serialise/parse.
    `aliases text[]` on `artifact_entries` is the main one.
  - [ ] Drop the `vault` schema dependency (see Upload-token below).
  - [ ] Drop RLS / GRANT statements (D1 doesn't have them).
- [ ] Decide migration strategy for D1 — pgkit equivalent? Probably
  just one-shot `definitions.sql` apply on bootstrap, since we're
  starting empty.

### DB driver swap (pg → D1 binding)

- [ ] Add a D1 binding to the app worker in `alchemy.run.ts`
  (`bindings: { ARTIFACT_DB: alchemy.cloudflare.D1Database(...) }`).
- [ ] Replace `withPg` helper everywhere with a thin wrapper around
  `env.ARTIFACT_DB.prepare(sql).bind(...).all()` etc. Callsites:
  - `apps/app/src/artifacts/load.ts`, `resolve.ts`, `search.ts`
  - `apps/app/src/github/upload.ts`, `events.ts`
  - `apps/app/src/trpc/router.ts`
- [ ] Decide how to plumb the binding into `createServerFn` handlers
  (TanStack Start exposes `getRequestEvent()` or similar — needs
  spike).

### Better Auth on D1

- [ ] Swap `getPool()` shim in `apps/app/src/auth/server-auth.ts` for
  Better Auth's D1 / Kysely-D1 dialect.
- [ ] Verify `account` / `session` / `user` / `verification` table
  shapes on SQLite match Better Auth's expectations. (Likely needs
  `text` instead of `timestamp`, `integer` for `expiresAt` etc.)
- [ ] Confirm GitHub OAuth flow still works end-to-end after the
  driver swap.

### Upload-token replacement

- [ ] New `upload_tokens` table on D1: `(token_hash text primary key,
  github_login text not null, created_at integer not null,
  expires_at integer not null)`.
- [ ] In `apps/app/src/github/upload.ts`: generate a random token in
  JS, hash it (SHA-256), store the hash + login + 10-min TTL, return
  the raw token to the action. Replaces the
  `vault.create_secret(owner)` call.
- [ ] In `apps/app/src/trpc/router.ts` middleware: hash the incoming
  `artifactci-upload-token` header, look it up in `upload_tokens`,
  recover the `github_login`. Replaces the
  `vault.decrypted_secrets where secret = $1` query.
- [ ] Periodic cleanup: easiest is a `delete from upload_tokens
  where expires_at < now()` at write time.

### Storage swap (Supabase Storage → R2)

- [ ] Add an R2 bucket binding to the app + frontdoor workers
  (`alchemy.cloudflare.R2Bucket('artifact_blobs')`).
- [ ] Replace `createUploadTokens` mutation in
  `apps/app/src/trpc/router.ts`: generate S3 SigV4 presigned PUT URLs
  for R2 instead of calling Supabase's signed-upload API. Worker-side
  signing means we still chunk (subrequest cap doesn't apply — it's
  a local crypto operation).
- [ ] Replace `storeUploadRecords` to write the R2 key directly into
  `artifact_entries.storage_pathname` (drop the `storage.objects` join
  — that was Supabase-internal).
- [ ] Replace `fetchSupabaseObject` in the frontdoor's
  `artifact-handler.ts` with `env.ARTIFACT_BLOBS.get(key)` — much
  simpler, no auth header juggling.
- [ ] Drop the openapi-typescript-generated `supabase-storage.ts`
  and the proxy client, both used only for the Supabase signing call.

### Cutover

- [ ] Same plan as the Cloudflare cutover that just landed:
  - DNS already lives on CF, no DNS change.
  - Deploy the new alchemy stack with D1 + R2 bindings.
  - Run a one-shot script to apply the SQLite `definitions.sql` to
    the freshly-provisioned D1 db.
  - Existing Supabase data is abandoned. Recent artifacts (within
    GitHub's 90-day retention) lazy-rebuild from GitHub on first
    visit. Old artifacts and old user sessions disappear — confirmed
    acceptable.
- [ ] Cancel the Supabase Pro subscription once the new stack is
  serving real traffic for ~a week with no surprises.

## Out of scope

- DO-per-artifact. Rejected during scoping.
- Image transforms (we don't use Supabase's, and CF's Image
  Transformations are a separate optional product).
- Migrating existing blobs across. Lazy rebuild covers it.

## Implementation notes

(to be filled in once we start)
