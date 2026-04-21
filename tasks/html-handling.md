---
status: ready
size: medium
---

# `.html` extension resolution when serving artifacts

## The bug

When artifact.ci serves a previewed artifact, it doesn't try `foo.html`
as a fallback for a request to `/foo`. This means any static-site
framework that emits file-style output — Astro with
`build.format: 'file'`, SvelteKit with `trailingSlash: 'never'`,
Eleventy with permalinks that omit `index.html`, etc. — has broken
asset paths in its own artifact preview.

### Live repro (as of 2026-04-21)

Take an artifact preview URL of this shape:

`https://www.artifact.ci/artifact/view/mmkal/sqlfu/run/24728275564.1/website/ui?demo=1`

The artifact contains both `ui.html` (at the website root) and a
`ui/` directory (containing static assets but no `index.html`). Hit
the URL above:

- **Today:** 200 response, but the served HTML's relative asset
  references (`./ui/assets/foo.js`, etc.) 404. Most visible symptom:
  the page loads blank or unstyled.
- **Expected:** artifact.ci serves `ui.html` and the relative paths
  resolve correctly.

Appending `.html` explicitly works as a workaround:

`https://www.artifact.ci/artifact/view/mmkal/sqlfu/run/24728275564.1/website/ui.html?demo=1`

…which confirms the file exists and renders correctly; artifact.ci
just isn't finding it via extensionless URL.

## Why this matters

Pretty much every modern framework emits files-without-trailing-slash
URLs by default, because that's how the real production CDNs behave:

- Cloudflare Workers/Pages (default: `html_handling:
  auto-trailing-slash`)
- Vercel (default behavior, not configurable)
- Netlify (default behavior, `Pretty URLs` setting)
- GitHub Pages via Jekyll's `permalink: pretty`

Meaning: people's artifact previews look broken on artifact.ci in a
way they never look broken in production. It makes artifact.ci
untrustworthy as a PR-preview tool for any framework that uses this
output style.

The fix is not framework-specific. It's one behavioral layer in
artifact.ci's request-handling pipeline.

## What to implement (product spec)

When a request comes in for a path under an artifact, the lookup
order should be:

### Request `/foo` (no trailing slash)

1. If an exact file exists at `foo` → serve it.
2. Else if `foo.html` exists → serve it. URL in the browser stays
   `/foo`. Query string and fragment are preserved.
3. Else if `foo/index.html` exists → 307 redirect to `/foo/`. Query
   string and fragment preserved on the redirect.
4. Else if `foo/` exists as a directory but has no `index.html` →
   404 (today's behavior; don't invent a directory listing).
5. Else → 404.

### Request `/foo/` (with trailing slash)

1. If an exact file exists at `foo/` — not usually a thing, but for
   completeness, skip.
2. Else if `foo/index.html` exists → serve it. URL in the browser
   stays `/foo/`. Query/fragment preserved.
3. Else if `foo.html` exists → 307 redirect to `/foo`. Query/fragment
   preserved.
4. Else → 404.

### Redirects preserve query + fragment

The redirects in steps 2/3 of both sections must keep the original
query string and fragment. I.e.:

`/foo?bar=1#baz` → 307 → `/foo/?bar=1#baz`

This is the subtle part. A lot of "pretty URL" implementations strip
query strings on redirect; that breaks anything using `?demo=1`,
`?preview=true`, `?search=…` style state.

### Status codes

- `307 Temporary Redirect` for the "which form of the URL is
  canonical" redirects (not 301/308). 307 preserves HTTP method and
  isn't indefinitely cached by browsers, which is what you want for
  artifact previews that are ephemeral by nature.
- Artifact.ci probably also has its trailing-slash-stripping 308
  redirect at a different layer — that's fine and orthogonal, but
  make sure the two don't fight each other into a redirect loop. If
  the outer 308 strips `/foo/` → `/foo` and then the inner logic
  redirects `/foo` → `/foo/` because an `index.html` exists in a
  `foo/` dir, you're in trouble. See "test cases" below.

## What NOT to change

- Don't add directory listings for directories that lack an
  `index.html`. Keep those as 404s.
- Don't change behavior for paths that already resolve exactly
  (existing files, existing asset paths). This is purely a
  fallback-resolution layer, not a rewrite layer.
- Don't rewrite or modify the served HTML content in any way. File
  contents are not the problem — the problem is which file gets
  picked.
- Don't redirect `/foo` → `/foo.html` (exposing the `.html`
  extension). The browser URL should stay pretty. Serve `foo.html`
  under the URL `/foo`.

## Test cases

Given an artifact with these files:

```
/landing.html
/docs.html
/docs/
  overview.html
  api.html
/ui.html
/ui/
  assets/
    main.js
    main.css
/about/
  index.html
/team/
  index.html
  about.html
```

Then:

| Request | Expected response | Browser URL after |
|---|---|---|
| `/landing` | 200, serves `landing.html` | `/landing` |
| `/landing/` | 307 → `/landing`, serves `landing.html` | `/landing` |
| `/landing.html` | 200, serves `landing.html` | `/landing.html` (no redirect; explicit file hits still work) |
| `/docs` | 200, serves `docs.html` | `/docs` |
| `/docs/` | 307 → `/docs`, serves `docs.html` (no `index.html` in dir, so fall back) | `/docs` |
| `/docs/overview` | 200, serves `docs/overview.html` | `/docs/overview` |
| `/docs/overview/` | 307 → `/docs/overview`, serves `docs/overview.html` | `/docs/overview` |
| `/ui` | 200, serves `ui.html` | `/ui` |
| `/ui?demo=1` | 200, serves `ui.html` | `/ui?demo=1` |
| `/ui/` | 307 → `/ui`, serves `ui.html` | `/ui` |
| `/ui/?demo=1` | 307 → `/ui?demo=1`, serves `ui.html` | `/ui?demo=1` |
| `/ui/assets/main.js` | 200, serves `ui/assets/main.js` | `/ui/assets/main.js` |
| `/about` | 307 → `/about/`, serves `about/index.html` | `/about/` |
| `/about/` | 200, serves `about/index.html` | `/about/` |
| `/team` | 307 → `/team/`, serves `team/index.html` | `/team/` |
| `/team/about` | 200, serves `team/about.html` | `/team/about` |
| `/nope` | 404 | - |
| `/nope/` | 404 | - |

Every one of these should keep its query string and fragment if
present.

## Non-goals

- No user-configurable per-artifact routing. This should just be the
  default, baked-in behavior.
- No custom 404 pages. Today's 404 is fine.
- No `_redirects`/`_headers` file support. That's a much bigger
  feature and out of scope for this task.

## Acceptance

1. Deploy to staging.
2. Run the test-case table above against a fixture artifact. All
   rows match the expected response and browser URL.
3. Verify no redirect loops on edge cases where both `foo.html` and
   `foo/index.html` coexist — pick one deterministically (my vote:
   `foo/index.html` wins, because that's the more "framework-native"
   form, and it matches what Cloudflare does).
4. Regression-check the existing trailing-slash-stripping behavior
   (if any). If artifact.ci currently 308s `/foo/` → `/foo`
   unconditionally at a layer above this, that needs to interact
   cleanly with the new lookup — probably by moving the strip
   behavior *into* the new handler instead of keeping it as a
   pre-step.
5. Hit the live sqlfu repro URL post-deploy: `/website/ui?demo=1`
   should render a working demo (no 404 assets in devtools console).

## Context from the reporting repo

This task was written up while debugging sqlfu's single-origin
deployment — see sqlfu commit `dd1f6ac` and PR
`mmkal/sqlfu#40`. The sqlfu side has worked around the artifact.ci
shortcoming by using a flat `ui.html` + a `ui/` directory of assets,
with the HTML's paths prefixed (`./ui/assets/…`) so they resolve
correctly when the URL is the extensionless form. Production
Cloudflare works today because its `html_handling: auto-trailing-slash`
already does the right thing. The artifact.ci preview will start
working the moment this task ships.
