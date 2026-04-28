---
status: ready
size: medium
---

# Readable bundled action output

Status summary: just specified. The goal is to experiment with making the generated GitHub Action JavaScript readable enough to review, while still bundling/minifying dependencies so checked-in action artifacts stay self-contained. No implementation or verification has been done yet.

## Assumptions

- The action entrypoints still need to ship as JavaScript files with dependencies bundled, because GitHub Actions should not need an install step.
- First-party TypeScript action code should remain visibly close to the generated JavaScript where Node/tooling allows it.
- Third-party dependencies can stay minified or otherwise compact, since they are not the code reviewers are trying to read.
- The experiment should avoid changing action runtime behavior.

## Checklist

- [ ] Inspect the current action source and bundle pipeline.
- [ ] Identify whether the bundler can preserve first-party module shape while compacting dependencies.
- [ ] Update the action build configuration or build script to produce more readable checked-in action JS.
- [ ] Regenerate the checked-in action output.
- [ ] Run the relevant build/tests or a targeted smoke check for the action output.
- [ ] Move this task to `tasks/complete/` once the branch is ready for review.

## Implementation Notes

- 2026-04-28: Created from the user request to try making action bundles easier to read by minifying dependencies without turning first-party TypeScript into opaque generated code.
