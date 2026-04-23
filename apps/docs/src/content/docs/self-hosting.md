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
  - This project uses [Supabase Storage](https://supabase.com/docs/reference/api/supabase-storage-from-create), but in theory you may be able to use a service that wraps another blob storage provider like AWS, Azure or Cloudflare's offerings, to make them usable with the Supabase API format.
  - Set the `SUPABASE_PROJECT_URL` environment variable to the URL of the storage service you're using.
  - Set the `SUPABASE_SERVICE_ROLE_KEY` environment variable to a token that has read/write access to the storage service.
- Database setup:
  - This project also uses Supabase for the database, but you should be able to use any other PostgreSQL database.
  - Create a database and user, and set `DATABASE_URL` in your server deployment to the connection string.
  - The client uses [pgkit.dev](https://pgkit.dev):
    - Migrations: run `pnpm pgkit migrate.definitions.updateDb` to create/update/delete tables, views, functions, indexes etc. based on the `definitions.sql` file.
    - Types: if you change the source code, you can run `pnpm pgkit generate` to add TypeScript types to all DB queries.
- You'll need to manage the `usage_credits` table to whitelist your organization/users to make sure they aren't denied access to artifacts.
- Local development:
  - Run `pnpm dev` to start the development server.
  - The dev script spins up a Cloudflare quick tunnel so GitHub webhooks can reach your laptop. The tunnel URL is printed at startup.
  - Note that simulating a GitHub Actions workflow is tricky. The API checks that the workflow is in "running" status before minting artifact upload tokens.
