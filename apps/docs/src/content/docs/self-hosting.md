---
title: Self-hosting
description: Stand up your own instance of artifact.ci.
---

The code is open-source, so you can self-host it if you want to (e.g. to run on a private network, or to use it without [sponsoring me](https://github.com/sponsors/mmkal), or to use a different blob storage provider, or to add extra features etc.). Here's how:

- Clone the repository.
- Deploy to Cloudflare via [Alchemy](https://alchemy.run). `pnpm deploy:dev` (or `pnpm deploy:prod`) stands up the three Workers (`app`, `docs`, `frontdoor`) in your account, and creates the D1 database and R2 bucket the app uses.
- GitHub App. Set up an App at https://github.com/settings/apps.
  - Set the callback URL to `https://<your-domain>/api/auth/callback/github`.
  - Add the following environment variables to your `.env.<stage>` file:
    - `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` — needed for the App to make GitHub API requests.
    - `GITHUB_APP_WEBHOOK_SECRET` — needed to verify webhook requests really came from GitHub.
    - `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_SECRET` — needed for the OAuth login flow.
    - `GITHUB_APP_URL`.
- Auth setup:
  - Add a `BETTER_AUTH_SECRET` to your `.env.<stage>` file.
- Blob storage setup:
  - This project uses Cloudflare R2 for artifact blobs. Alchemy creates a stage-scoped bucket (`artifact-ci-<stage>-blobs`) on first deploy.
  - The app Worker mints S3-style presigned PUT URLs so the browser can upload directly to R2. That requires an R2 API token: open the Cloudflare dashboard → R2 → **Manage R2 API Tokens** → create a token with **Object Read & Write** scoped to the bucket, and add `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` to `.env.<stage>`. (You'll need to deploy once first so the bucket exists, then mint the token, then deploy again so the worker picks up the keys.)
  - `alchemy.run.ts` configures CORS allow-origins on the bucket so browsers can PUT to presigned URLs from your site. If you serve the app from a different origin, update the `cors` rule in `alchemy.run.ts` to match.
- Database setup:
  - This project uses Cloudflare D1 for metadata. Alchemy creates a stage-scoped database (`artifact-ci-<stage>-db`) on first deploy.
  - Schema is applied via the SQL files in `migrations/`. Alchemy runs them automatically against the D1 database during deploy — no manual step required for a fresh setup.
  - The client uses `sqlfu`: if you change database queries, run `pnpm exec sqlfu generate` to regenerate query types, and `pnpm exec sqlfu draft --name <description>` to scaffold a new migration.
- You'll need to manage the `usage_credits` table to whitelist your organization/users to make sure they aren't denied access to artifacts.
- Local development:
  - Run `pnpm dev` to start the development server.
  - The dev script spins up a Cloudflare quick tunnel so GitHub webhooks can reach your laptop. The tunnel URL is printed at startup.
  - The local R2 binding talks to real R2 (miniflare's local R2 isn't S3-compatible, so signed PUT URLs can't reach it). That requires `wrangler login` once so the Cloudflare vite plugin can establish a remote-proxy session. Dev and prod use different stage-scoped buckets, so dev never touches prod data.
  - Note that simulating a GitHub Actions workflow is tricky. The API checks that the workflow is in "running" status before minting artifact upload tokens.
