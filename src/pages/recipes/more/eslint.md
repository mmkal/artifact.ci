## Eslint config inspector

You couuld serve a rendered version of your eslint config using `@eslint/config-inspector`:

```yaml
- name: build eslint config inspection
  run: npx @eslint/config-inspector build --base /artifact/blob/${{ github.repository }}/${{ github.run_id }}/eslint/.eslint-config-inspector
- uses: mmkal/artifact.ci/upload@main
  if: always()
  with:
    name: eslint
    path: .eslint-config-inspector
```

![eslint config inspector](/reports/eslint.png)

>Note: in the above two examples, we are passing a "base" path to the build commands. Without this, some tools including eslint and astro will assume that all paths are relative to the root of the domain. You can use the template `/artifact/blob/${{ github.repository }}/${{ github.run_id }}/<name-of-your-artifact>` as above to get the correct base path.
