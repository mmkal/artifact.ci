---
title: Architecture
description: The new Cloudflare-first architecture for artifact.ci.
---

# Architecture

The platform is a single repo with three Workers behind one origin (`artifact.ci`):

## Frontdoor Worker

Owns:

- `/artifact/blob/*` — streams artifact files directly from R2 so reads don't bounce through the app
- single-origin dispatch on `artifact.ci`: routes everything else to the app or docs Worker
- redirects, headers, and asset delivery policy

## App Worker (TanStack Start)

Owns:

- `/artifact/view/*` — the artifact browser UI
- `/login`, `/account` — user-facing auth pages
- `/api/*`, `/_serverFn/*` — Better Auth, tRPC, and TanStack Start server functions
- `/github/*` — webhook receiver and upload-token endpoints
- `/app/*`, `/assets/*` — reserved for app routes and built client assets

The full route table lives in `packages/config/src/routes.ts`.

## Docs Worker (Astro / Starlight)

Owns everything else at the origin for now, with a clean path to `docs.artifact.ci` later.

## Storage

- **Cloudflare D1** holds metadata (artifacts, identifiers, upload tokens, Better Auth tables, usage credits). The schema lives under `migrations/` and is applied automatically by Alchemy.
- **Cloudflare R2** holds artifact blobs. The app mints S3-style presigned PUTs so browsers and CI runners upload directly to R2; the frontdoor reads via the `ARTIFACT_BLOBS` binding.
