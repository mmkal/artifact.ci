---
title: Static website
description: Publish any static site as an artifact preview.
---

For a simple static HTML website, you can serve it using artifact.ci. For example, you could build an Astro website:

```yaml
- name: build website
  run: |
    npm create astro@latest -- demosite --template starlight --yes
    export BASE_PATH="/artifact/blob/${{ github.repository }}/${{ github.run_id }}/$GITHUB_RUN_ATTEMPT/website/demosite/dist"
    sed -i "s|integrations|base: '$BASE_PATH', integrations|g" demosite/astro.config.mjs
    npm run build
- uses: actions/upload-artifact@v4
  if: always()
  with:
    name: website
    path: demosite/dist
```

![website](/reports/website.png)

:::note
Some tools (including eslint-config-inspector and Astro) assume all paths are relative to the root of the domain, but artifact previews live under a subpath. Pass a base path like `/artifact/blob/${{ github.repository }}/${{ github.run_id }}/$GITHUB_RUN_ATTEMPT/<artifact-name>` at build time so asset URLs resolve correctly.
:::
