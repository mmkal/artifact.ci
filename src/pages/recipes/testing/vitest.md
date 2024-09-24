## Vitest

Vitest has a sort-of builtin report. Just run `vitest --reporter html` via the CLI, or see [vitest docs](https://vitest.dev/guide/reporter.html#html-reporter). You may be prompted to install the `@vitest/ui` package. Then just upload the artifact:

```yaml
- run: npx vitest --reporter html
- uses: mmkal/artifact.ci/upload@main
  if: always()
  with:
      name: vitest
      path: vitest-report
```

![Vitest example](/reports/vitest.png)
