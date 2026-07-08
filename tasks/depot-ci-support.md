---
status: in-progress
size: large
branch: depot-ci-support
---

# Depot CI support

## Status summary

Spec written after investigating the Depot CI platform and the iterate/iterate
testbed. Implementation not yet started. Main pieces: Depot API client, schema
additions, cron-driven run sync + check runs, and a zip download proxy.

## Problem

artifact.ci only understands GitHub Actions. Repos that migrate to
[Depot CI](https://depot.dev/docs/ci/overview) (Depot's own CI product — GitHub
Actions YAML syntax, but Depot owns the run lifecycle) silently stop working:

- Depot CI does not create GitHub Actions workflow runs, so **no
  `workflow_job` webhooks** fire → artifact.ci never records artifacts or posts
  its check run.
- `actions/upload-artifact@v4` still works inside Depot CI jobs, but Depot
  implements the artifact results service itself: artifacts land in **Depot's
  storage**, not GitHub's. The GitHub artifacts REST API doesn't know they
  exist (verified: iterate/iterate has zero GitHub artifacts after
  2026-07-03, when the migration finished — commit `30ab67927` in
  iterate/iterate).
- Depot CI sets a *synthetic* `GITHUB_RUN_ID` (14-digit, e.g. run URLs like
  `.../actions/runs/29744865282142` which 404 on GitHub), so the
  `artifactci/upload` action's `/github/upload` flow would also fail its
  `getWorkflowRun`/`getArtifact` validation.

Testbed: **iterate/iterate**, Depot org `0p91s0lz49`, workflows in
`.depot/workflows/`, uploads `preview-os-test-artifacts` via plain
`actions/upload-artifact@v4` from `cloudflare-previews.yml`.

## Verified Depot API facts (2026-07-08, tested with real org + CLI token)

Connect-RPC JSON over HTTPS at `https://api.depot.dev` (override:
`DEPOT_API_URL`). Headers: `Authorization: Bearer <token>`,
`x-depot-org: <org-id>`, `content-type: application/json`. Endpoints (from
[depot/cli](https://github.com/depot/cli) `pkg/proto/depot/ci/v1`):

- `POST /depot.ci.v1.CIService/ListRuns`
  `{repo: "owner/repo", status: ["finished","failed","cancelled"], sha?, pr?, pageSize, pageToken}`
  → `{runs: [{runId: "07qwbk1s76", repo, trigger, sha, headSha, ref?, status, createdAt}], nextPageToken}`.
  Sorted newest-first by createdAt; default status filter is running+queued so
  always pass status explicitly. `ref` is e.g. `refs/pull/1758/merge`.
- `POST /depot.ci.v1.CIService/ListArtifacts` `{runId, pageSize, pageToken}`
  → `{artifacts: [{artifactId: "019f4231-…" (uuidv7), runId, workflowId,
  workflowPath, jobId, jobKey, attemptId, attempt, name, sizeBytes, createdAt}]}`
- `POST /depot.ci.v1.CIService/GetArtifactDownloadURL` `{artifactId}`
  → `{artifact, url, expiresAt}` — `url` is a ~5-min presigned S3 GET.
  **No CORS on the S3 bucket** (verified: OPTIONS preflight → 403), so
  browsers cannot fetch it directly; the worker must proxy the zip.
  The zip is a plain zip of the uploaded files (same shape as GitHub's).

`depot ci artifacts list/download` in the CLI wraps exactly these RPCs.
Depot CI has no webhooks (nothing in docs/changelog), and GitHub only delivers
`check_run` events to the app that created the check, so Depot's check runs
can't trigger us → **polling is the only discovery mechanism**.

## Design

### Config: who is connected to Depot?

New table `depot_connections`: `(id, owner, repo, depot_org_id, api_token,
created_at, updated_at, unique(owner, repo))`. Rows inserted manually for now
(SQL via sqlfu against prod, documented below). The token should be a Depot
**org token** (Depot dashboard → org settings → API tokens). No UI yet —
that's follow-up work.

### Ingestion: cron poll

- Cron (every 2 min in prod) → for each `depot_connections` row:
  `ListRuns(repo, status=[finished,failed,cancelled])`, page until runs older
  than a 48h lookback or already seen.
- Dedupe via new table `depot_runs`: `(id, connection_id, depot_run_id unique,
  head_sha, ref, status, artifact_count, created_at, processed_at)`.
- For each new run: `ListArtifacts(runId)`; insert artifacts +
  identifiers; post one artifact.ci **check run** on `headSha` (reuse the
  summary-building logic from `apps/app/src/github/events.ts`) when the run
  produced artifacts.
- Aliases for a depot run:
  - `run` → depot runId (string, fits the free-form identifier column/paths)
  - `sha` → `headSha.slice(0, 7)`
  - `branch` → from `ref` when it's `refs/heads/<branch>` (replaceAll `/`→`__`)
  - (PR runs have `ref: refs/pull/N/merge`; the existing `pr` alias view
    derives from sha/branch identifiers, so no special-casing needed — verify
    while implementing.)

### Artifact rows

`artifacts.github_id` becomes nullable; new column `depot_artifact_id text`
with partial unique index `(repo_id, name, depot_artifact_id) where
depot_artifact_id is not null`. A row is a depot artifact iff
`depot_artifact_id is not null`. (SQLite treats NULLs as distinct in the
existing `unique(repo_id, name, github_id)`, so github rows keep their
semantics.)

### Download: same-origin zip proxy

- trpc `getDownloadUrl` branches: depot artifact → return
  `/api/artifact-zip/<artifactId>` (same-origin); github artifact → unchanged.
- New route `GET /api/artifact-zip/:artifactId` in `server.ts`: session/upload
  token auth + `checkCanAccess` (same as the trpc middleware), look up the
  repo's depot connection, `GetArtifactDownloadURL`, fetch the S3 URL
  server-side, stream the body through with `content-type: application/zip`.
- `clientUpload` then works unchanged (same-origin fetch sends session
  cookies by default).

### Cron plumbing

Alchemy `TanStackStart` props extend `WorkerProps`, so `crons: [...]` passes
through. The server entry (`createServerEntry({fetch})`) needs a `scheduled`
export — spread it into the default export. If the TanStack build/runtime
fights this, fall back to a tiny dedicated `depot-sync` Worker with the cron
that POSTs `/api/depot/sync` with a shared-secret binding. A manual
`POST /api/depot/sync` (secret-gated) is useful for testing either way.

## Checklist

- [ ] schema: `depot_connections`, `depot_runs`, nullable `github_id`,
      `depot_artifact_id` + partial unique index (sqlfu migration)
- [ ] domain: `packages/domain/src/depot/client.ts` (ListRuns, ListArtifacts,
      GetArtifactDownloadURL; injectable base URL) + vitest against local fake
      server
- [ ] sync: `apps/app/src/depot/sync.ts` + insert path for depot artifacts +
      check run posting shared with `events.ts`
- [ ] cron: alchemy `crons` + `scheduled` handler (or fallback sync worker) +
      secret-gated manual sync route
- [ ] download: `/api/artifact-zip/:artifactId` proxy + `getDownloadUrl`
      branch for depot artifacts
- [ ] tests: fake depot API end-to-end-ish test of sync + proxy
- [ ] verify with iterate/iterate locally (real token, real artifact renders
      in browser)
- [ ] document prod setup: create Depot org token, insert `depot_connections`
      row via sqlfu

## Prod setup (once merged)

1. In Depot dashboard for org `0p91s0lz49`: create an org API token scoped to
   CI read access.
2. Insert the connection row (sqlfu prod target):
   `insert into depot_connections (id, owner, repo, depot_org_id, api_token)
   values ('depot_connection_<ulid>', 'iterate', 'iterate', '0p91s0lz49', '<token>')`
3. Wait for the cron (or hit the manual sync route) and check a recent
   iterate/iterate PR commit for the artifact.ci check run.

## Implementation log

(append notes here as work proceeds)
