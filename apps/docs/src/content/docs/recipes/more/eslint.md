---
title: ESLint config inspector
description: Serve a rendered ESLint config from an artifact.
---

You could serve a rendered version of your eslint config using `@eslint/config-inspector`:

```yaml
- name: build eslint config inspection
  run: npx @eslint/config-inspector build --base /artifact/blob/${{ github.repository }}/${{ github.run_id }}/$GITHUB_RUN_ATTEMPT/eslint/.eslint-config-inspector
- uses: actions/upload-artifact@v4
  if: always()
  with:
    name: eslint
    path: .eslint-config-inspector
```

![eslint config inspector](/reports/eslint.png)

:::note
Passing a base path to the build command is important. Without it, tools like ESLint and Astro assume paths are relative to the domain root, but artifact.ci serves under a subpath. The template `/artifact/blob/${{ github.repository }}/${{ github.run_id }}/$GITHUB_RUN_ATTEMPT/<artifact-name>` is a handy default.
:::
