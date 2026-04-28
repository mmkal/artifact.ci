---
status: complete
size: medium
---

# Readable bundled action output

Status summary: done. The action outputs now use readable ESM entry files for repository-owned code and a single minified shared `bundled-action/vendor.js` for dependencies. A PR validation follow-up fixed direct file outputs so badge and eager entrypoint links use the blob-serving route instead of appending file paths to the artifact browser route. Verification passed for generation, lint, syntax checks, targeted URL tests, and local action-entry smoke checks; remaining lint output is existing repo warnings.

## Assumptions

- The action entrypoints still need to ship as JavaScript files with dependencies bundled, because GitHub Actions should not need an install step.
- First-party TypeScript action code should remain visibly close to the generated JavaScript where Node/tooling allows it.
- Third-party dependencies can stay minified or otherwise compact, since they are not the code reviewers are trying to read.
- The experiment should avoid changing action runtime behavior.

## Checklist

- [x] Inspect the current action source and bundle pipeline. _Found `package.json` action scripts using esbuild `--bundle --minify` to generate `bundled-action/*.min.cjs`._
- [x] Identify whether the bundler can preserve first-party module shape while compacting dependencies. _Confirmed GitHub Actions Node 20 can run ESM action entries, so the readable entry can import bundled vendor chunks._
- [x] Update the action build configuration or build script to produce more readable checked-in action JS. _Added `scripts/build-action.js`, which emits readable `bundled-action/{badge,upload}.js` and a minified shared `bundled-action/vendor.js`._
- [x] Regenerate the checked-in action output. _Ran `pnpm generate`; action metadata now points at the ESM entry files._
- [x] Validate generated badge URLs from the PR action run. _Confirmed the action uploaded successfully, but its printed `/artifact/view/.../badge.svg` URL 404ed while the equivalent `/artifact/blob/.../badge.svg` URL served the SVG._
- [x] Fix direct action file URLs. _Added `src/action/artifact-url.ts` and used it from badge and eager upload entrypoint outputs so direct files point at `/artifact/blob/...`._
- [x] Run the relevant build/tests or a targeted smoke check for the action output. _Ran syntax checks, lint, missing-event smoke checks, and fake-event input-parse smoke checks for both actions._
- [x] Move this task to `tasks/complete/` once the branch is ready for review. _Moved to `tasks/complete/2026-04-28-readable-actions-output.md`._

## Implementation Notes

- 2026-04-28: Created from the user request to try making action bundles easier to read by minifying dependencies without turning first-party TypeScript into opaque generated code.
- 2026-04-28: First tried a CommonJS wrapper with an inline vendor map, but it changed dependency initialization enough to fail during vendor load. Pivoted to ESM entries after checking the current GitHub Actions JavaScript action docs.
- 2026-04-28: Final shape keeps the reviewable action/domain code in `bundled-action/upload.js` and `bundled-action/badge.js`; third-party code is in one minified `bundled-action/vendor.js` file shared by both actions.
- 2026-04-28: Follow-up from PR run `25053451022`: `https://www.artifact.ci/artifact/view/mmkal/artifact.ci/sha/5da99a9/result/badge.svg` returned 404, while `https://www.artifact.ci/artifact/blob/mmkal/artifact.ci/sha/5da99a9/result/badge.svg` returned 200. Fixed action direct file outputs accordingly.
- 2026-04-28: `pnpm lint` exits 0 but still reports existing warnings, including the repo's missing `src/pages/index.mdx` codegen warning and workspace dependency warnings.
