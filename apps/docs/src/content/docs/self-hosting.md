---
title: Self-hosting
description: Stand up your own instance of artifact.ci.
---

The code is open-source, so you can self-host it if you want to (e.g. to run on a private network, or to use it without [sponsoring me](https://github.com/sponsors/mmkal), or to use a different blob storage provider, or to add extra features etc.). Here's how:

- Clone the repository.
- Deploy to Cloudflare via [Alchemy](https://alchemy.run). `pnpm deploy` will stand up the three Workers (`app`, `docs`, `frontdoor`) in your account.
- GitHub App. Set up an App at https://github.com/settings/apps.
  - Set the callback URL to `https://<your-domain>/api/auth/callback/github`.
  - Add the following environment variables to your Worker secrets:
    - `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` — needed for the App to make GitHub API requests.
    - `GITHUB_APP_WEBHOOK_SECRET` — needed to verify webhook requests really came from GitHub.
    - `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_SECRET` — needed for the OAuth login flow.
    - `GITHUB_APP_URL`.
- Auth setup:
  - Add a `BETTER_AUTH_SECRET` to your server deployment.
- Blob storage setup:
  - This project uses Cloudflare R2 for artifact blobs.
  - The app Worker needs `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` so it can mint presigned PUT URLs.
- Database setup:
  - This project uses Cloudflare D1 for metadata.
  - The schema lives in `definitions.sql`; apply it to a new D1 database before serving real traffic.
  - The client uses `sqlfu`: if you change database queries, run `pnpm typegen`.
- You'll need to manage the `usage_credits` table to whitelist your organization/users to make sure they aren't denied access to artifacts.
- Local development:
  - Run `pnpm dev` to start the development server.
  - The dev script spins up a Cloudflare quick tunnel so GitHub webhooks can reach your laptop. The tunnel URL is printed at startup.
  - Note that simulating a GitHub Actions workflow is tricky. The API checks that the workflow is in "running" status before minting artifact upload tokens.
