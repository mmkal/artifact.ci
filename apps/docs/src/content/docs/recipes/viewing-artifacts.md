---
title: Viewing artifacts
description: Where the UI shell ends and edge delivery begins.
---

# Viewing artifacts

The browser UI lives under `/artifact/view/...`.

The bytes themselves live under `/artifact/blob/...`.

That split means the app can focus on navigation and metadata while the edge worker focuses on:

- authorization
- redirects
- `Content-Type`
- `Content-Disposition`
- cache policy
