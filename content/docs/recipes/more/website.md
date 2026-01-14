---
title: "A website!"
---
## A website!

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

>Note: in the above example, we are passing a "base" path to the build command. Without this, some tools including eslint and astro will assume that all paths are relative to the root of the domain, but the artifact will be uploaded to a subdirectory of the artifact.ci domain. You can use the template `/artifact/blob/${{ github.repository }}/${{ github.run_id }}/$GITHUB_RUN_ATTEMPT/<name-of-your-artifact>` as above to get the correct base path.
