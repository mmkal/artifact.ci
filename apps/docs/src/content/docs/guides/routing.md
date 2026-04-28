---
title: Routing
description: How single-origin routing works on Cloudflare.
---

# Routing

Requests hit a small frontdoor Worker first.

It decides between:

1. handling `/artifact/*` directly
2. forwarding app routes to the TanStack app Worker
3. forwarding everything else to the docs Worker

This keeps cookies first-party while still letting the docs and app evolve independently.
