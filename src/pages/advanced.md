# Advanced usage

## Passthrough action

The artifact.ci [GitHub repository](https://github.com/mmkal/artifact.ci) contains a passthrough action that can be used as a drop-in replacement for `actions/upload-artifact`. In most cases, you won't need to use this - `actions/upload-artifact` will work fine. The differences are:

- The passthrough action uploads files mid-job to the artifact.ci service, whereas the default action will only be picked up by artifact.ci once the job completes (either succeeding or failing). This can be useful for very long running jobs.
- The passthrough action exposes the viewable links as step outputs, so they can be used in subsequent steps.
- You can pass `artifactci_visibility: public` to make the artifact publicly-viewable.

Here's an example of the change you might make to start using the passthrough action:

```diff
name: CI
on: [push]
jobs:
  run:
    steps:
      - uses: actions/checkout@v4
      - run: npm install
      - run: npx playwright test --reporter html
      - id: report
-       uses: actions/upload-artifact@v4
+       uses: mmkal/artifact.ci/upload@main
        if: always()
        with:
          name: e2e-test-report
          path: playwright-report
+       run: echo 'Report: ${{ steps.report.outputs.artifactci_run_url }}' >> $GITHUB_OUTPUT
```
