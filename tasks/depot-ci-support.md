---
status: implemented-needs-prod-setup
size: large
branch: depot-ci-support
---

# Depot CI support

## Status summary

Implemented and verified. Sync, check-run creation, and the zip download
proxy all pass integration tests (real SQL via node:sqlite, fake Depot +
GitHub servers) plus a **live smoke test against the real depot.dev API**
that synced actual iterate/iterate runs and streamed a real 5.7MB artifact
zip through the proxy. Remaining: prod setup (Depot org token + connection
row) after merge, then watch the first cron pass.

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
`DEPOT_API_URL` in AppEnv). Headers: `Authorization: Bearer <token>`,
`x-depot-org: <org-id>`, `content-type: application/json`. Endpoints (from
[depot/cli](https://github.com/depot/cli) `pkg/proto/depot/ci/v1`):

- `POST /depot.ci.v1.CIService/ListRuns`
  `{repo: "owner/repo", status: ["finished","failed","cancelled"], sha?, pr?, pageSize, pageToken}`
  → `{runs: [{runId: "07qwbk1s76", repo, trigger, sha, headSha, ref?, status, createdAt}], nextPageToken}`.
  Sorted newest-first by createdAt; default status filter is running+queued so
  always pass status explicitly. `ref` is e.g. `refs/pull/1758/merge`.
- `POST /depot.ci.v1.CIService/ListArtifacts` `{runId, pageSize, pageToken}`
  → `{artifacts: [{artifactId: "019f4231-…" (uuidv7), runId, workflowId,
  workflowPath, jobId, jobKey, attemptId, attempt, name, sizeBytes (int64 →
  string in JSON), createdAt}]}`
- `POST /depot.ci.v1.CIService/GetArtifactDownloadURL` `{artifactId}`
  → `{artifact, url, expiresAt}` — `url` is a ~5-min presigned S3 GET.
  **No CORS on the S3 bucket** (verified: OPTIONS preflight → 403), so
  browsers cannot fetch it directly; the worker proxies the zip.

`depot ci artifacts list/download` in the CLI wraps exactly these RPCs.
Depot CI has no webhooks, and GitHub only delivers `check_run` events to the
app that created the check, so Depot's check runs can't trigger us →
**polling is the only discovery mechanism**.

## What was built

- `packages/domain/src/depot/client.ts` — Connect-JSON client
  (ListRuns/ListArtifacts/GetArtifactDownloadURL) + `depotRunAliases`
  (run = depot runId, sha = headSha[0:7], branch only for `refs/heads/*`;
  PR merge-refs get no branch alias — the PR view derives from sha/branch
  via the GitHub pulls API anyway).
- Schema: `depot_connections` (owner/repo → org + api token),
  `depot_runs` (dedupe/audit of processed runs), `artifacts.github_id` now
  nullable, `artifacts.depot_artifact_id` with a partial unique index
  `(repo_id, name, depot_artifact_id) where depot_artifact_id is not null`.
  Migration `0001_depot_ci_support.sql` (sqlfu draft; replay-tested against
  a DB with existing artifact rows).
- `apps/app/src/depot/sync.ts` — per-connection poll (48h lookback, capped
  at 25 new runs per pass so first-sync backlogs drain over several cron
  ticks without hitting worker subrequest limits), artifact + identifier
  upserts, check-run posting in the same format as the webhook flow.
- Cron `*/2 * * * *` on the app worker (`scheduled` handler spread into the
  TanStack server entry) + `POST /api/depot/sync` for signed-in users.
- `GET /api/depot/artifact-zip/:artifactId` — access-checked (session or
  upload token, `checkCanAccess`) same-origin streaming proxy;
  `getDownloadUrl` returns this path for depot artifacts so the existing
  browser unzip→R2 lazy-load pipeline works unchanged.
- Test seam: `GITHUB_API_URL` env override in
  `packages/domain/src/github/installations.ts` (DI instead of mocks).

## Checklist

- [x] schema + migration _(0001_depot_ci_support.sql, replay-tested with data)_
- [x] domain depot client + unit tests _(client.test.ts, fake connect server)_
- [x] sync + check runs _(sync.ts; sync.test.ts covers record/idempotency/no-artifact runs)_
- [x] cron + manual sync route _(alchemy crons + scheduled handler; POST /api/depot/sync)_
- [x] zip proxy + getDownloadUrl branch _(zip.ts; zip.test.ts covers stream/401/non-depot)_
- [x] live verification against depot.dev _(live.test.ts, gated on DEPOT_LIVE_TOKEN:
      synced real iterate runs, built correct check payloads against a fake GitHub,
      streamed a real 5.7MB preview-os-test-artifacts zip — PK magic bytes verified)_
- [ ] prod setup after merge (below) + watch first cron pass and a real
      check run appear on an iterate/iterate commit
- ~~[ ] browser-level dev-stack walkthrough~~ _(local dev stack is currently
      broken on this machine independent of this branch — wrangler remote-proxy
      session failure in the main checkout too; the browser-side code path is
      unchanged except the URL the zip is fetched from, and the proxy is
      covered by tests + live smoke)_

## Prod setup (once merged)

1. In the Depot dashboard for org `0p91s0lz49`: create an org API token
   (CI read access is enough).
2. Insert the connection row (e.g. `SQLFU_TARGET=prod` sqlfu, or wrangler d1):
   ```sql
   insert into depot_connections (id, owner, repo, depot_org_id, api_token)
   values ('depot_connection_' || lower(hex(randomblob(8))), 'iterate', 'iterate', '0p91s0lz49', '<token>');
   ```
3. The cron picks it up within 2 minutes. First pass processes the 25 most
   recent runs with artifacts from the last 48h; older backlog drains on
   subsequent ticks. Check a recent iterate/iterate commit for the
   artifact.ci check run and click through to the artifact view.

Note: the prod artifact.ci GitHub App is installed on iterate/iterate; the
dev app is not (dev app is mmkal-account only), which is why live
verification faked the GitHub side.

## Follow-up ideas (deliberately out of scope)

- UI for managing depot connections (currently manual SQL).
- `artifactci/upload` action support inside Depot CI jobs (would need a
  non-GitHub validation path in `/github/upload` — e.g. upload tokens as
  Depot secrets — since Depot's GITHUB_RUN_ID is synthetic).
- 'Check again' diagnostics awareness of depot connections (currently
  GitHub-only).
- Backfill beyond 48h on first connection (bump lookback or a one-off
  backfill script) if desired.

## Implementation log

- 2026-07-08: investigated Depot CI via iterate/iterate + depot/cli source;
  verified all three RPCs and the no-CORS presigned URL by hand with a real
  token. Spec committed first, then schema (sqlfu draft), client, sync,
  proxy, tests. Live smoke test initially timed out processing the full
  48h iterate backlog (~hundreds of runs) — added the 25-runs-per-pass cap,
  after which it passed in ~13s. Local `alchemy dev` was broken on this
  machine (wrangler remote proxy session failure, also on main), so
  browser-level verification was replaced by the live smoke test at the
  handler level.
