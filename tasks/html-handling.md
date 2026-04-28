---
status: implemented-needs-verification
size: medium
---

# `.html` extension resolution when serving artifacts

## Status

Implemented locally on `main`. Pure resolver function + 17-row spec table
test pass against `node:test`. Needs the acceptance steps (staging deploy
+ live sqlfu URL check) before moving to complete.

- Done: pure `resolveFilepath()` matching the spec table (incl. the
  `foo/index.html` wins over `foo.html` rule, and the underlying root-cause
  bug in `entrypoints.ts` where the path shim produced `/ui` instead of
  `ui` for root-level files).
- Done: route handler returns 307 with preserved query string.
- Done: `skipTrailingSlashRedirect: true` in `next.config.mjs` so Next.js
  doesn't 308-strip `/foo/` before our handler can choose between
  `foo.html` and `foo/index.html`.
- Missing: live verification against staging + sqlfu repro URL.

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

## Implementation log

### Files changed

- `src/app/artifact/view/.../resolve-filepath.ts` — new pure resolver.
  Returns `{type: 'serve', entryName}` / `{type: 'redirect', filepath,
  trailingSlash}` / `{type: 'not_found'}`. The 5-step lookup order from
  the spec is encoded directly here. `foo/index.html` is checked before
  `foo.html` for the no-trailing-slash case, so when both coexist the
  index file wins (matches Cloudflare; spec ack #3).
- `src/app/artifact/view/.../resolve-filepath.test.ts` — `node:test`
  mirror of the spec's test-case table, plus the conflict tiebreak case.
  Run with: `npx tsx 'src/app/artifact/view/[owner]/[repo]/[aliasType]/[identifier]/[artifactName]/resolve-filepath.test.ts'`
- `src/app/artifact/view/.../load-artifact.server.ts` — `loadArtifact`
  now takes `trailingSlash` and uses the resolver against the
  already-loaded `entries` array. The DB query for the storage object
  switched from `${path} = any(ae.aliases)` to `ae.entry_name =
  ${resolved}`. Added a new `redirect` return code.
- `src/app/artifact/view/.../[...filepath]/route.ts` — derives
  `trailingSlash` from `request.nextUrl.pathname.endsWith('/')` (only for
  non-empty filepaths), and handles the new `redirect` code by returning
  a 307 with `request.nextUrl.search` preserved.
- `src/app/artifact/view/.../page.tsx` — passes `trailingSlash: false`
  (this page is the artifact root; resolver isn't invoked for empty
  filepath but the type system needs the param). Defensively handles
  the `redirect` case by redirecting to the artifact root.
- `next.config.mjs` — `skipTrailingSlashRedirect: true`. Without this,
  Next.js's default 308 would strip `/foo/` to `/foo` before our handler
  ran, making the `/about/` (serve `about/index.html`) vs `/about`
  (redirect to `/about/`) distinction impossible — and risking a
  redirect loop (spec ack #4).
- `src/app/artifact/view/.../entrypoints.ts` — fixed two bugs in the
  browser-friendly `path` shim:
  1. `path.join('', 'ui')` was producing `/ui` (leading slash) because
     `Array.prototype.join` puts the separator between empty strings.
     Fixed by filtering empty parts.
  2. `path.parse('README')` was producing `ext: '.README'` because the
     shim assumed any `.split('.')` had an extension. Fixed by checking
     for an actual `.` past position 0 (so `.gitignore` correctly has no
     ext either).

  These bugs meant the `aliases` column on `artifact_entries` was being
  populated with garbage for root-level HTML files (e.g. `ui.html`
  produced `[ui.html, /ui]` instead of `[ui.html, ui]`), so the old
  alias-based lookup couldn't have served `/ui` even if it had wanted
  to. The new resolver doesn't read `aliases`, but new uploads will at
  least have correct values going forward, and `FileList`'s entrypoint
  highlighting also benefits.

### Notes

- `loadFile` keeps using the request's `params.filepath` for the
  `artifactci-path` response header (so the URL is reflected, not the
  underlying entry name). Intentional — the header identifies the URL,
  not the served file.
- Existing entries written before this fix have stale `aliases` values.
  Not backfilled — the new resolver doesn't depend on `aliases`, and
  `aliases` is otherwise only consumed in places that are not on the
  serving hot path. Future work could drop the column or backfill it.
- `skipTrailingSlashRedirect: true` is global, not scoped to artifact
  routes. Side effect: other routes won't auto-strip trailing slashes.
  Most app routes are static `/page` style URLs that won't be hit with
  trailing slashes in practice; if they are, Next.js's app-router
  matching still works (it normalizes internally for `params`). Worth
  watching after deploy but not expected to break anything.
