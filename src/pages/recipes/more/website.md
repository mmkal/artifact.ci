## A website!

For a simple static HTML website, you can serve it using artifact.ci. For example, you could build an Astro website:

```yaml
- name: build website
  run: |
    npm create astro@latest -- demosite --template starlight --yes
    export BASE_PATH="/artifact/blob/${{ github.repository }}/${{ github.run_id }}/website/demosite/dist"
    sed -i "s|integrations|base: '$BASE_PATH', integrations|g" demosite/astro.config.mjs
    npm run build
- uses: mmkal/artifact.ci/upload@main
  if: always()
  with:
    name: website
    path: demosite/dist
```

![website](/reports/website.png)
