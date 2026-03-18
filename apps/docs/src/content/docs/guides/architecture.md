---
title: Architecture
description: The new Cloudflare-first architecture for artifact.ci.
---

# Architecture

The platform now targets a single repo with three deploy targets:

## Frontdoor Worker

Owns:

- `/artifact/*`
- single-origin dispatch on `artifact.ci`
- redirects, headers, and asset delivery policy

## App UI

Owns:

- `/app/*`
- `/api/*`
- `/login`
- `/account`
- `/billing`
- `/settings`
- `/dashboard`

## Docs

Owns everything else at the origin for now, with a clean path to `docs.artifact.ci` later.
