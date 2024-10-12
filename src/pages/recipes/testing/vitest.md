## Vitest

Vitest has a sort-of builtin report. Just run `vitest --reporter html` via the CLI, or see [vitest docs](https://vitest.dev/guide/reporter.html#html-reporter). You may be prompted to install the `@vitest/ui` package. Then just upload the artifact:

```yaml
- run: npx vitest --reporter html
- uses: actions/upload-artifact@v4
  if: always()
  with:
      name: vitest
      path: vitest-report
```

![Vitest example](/reports/vitest.png)

### Coverage

Vitest has a built-in coverage reporter which outputs HTML - if you're paying for codecov... maybe you don't need to anymore. Just run `vitest --coverage` via the CLI, or see [vitest docs](https://vitest.dev/guide/coverage.html). Then upload the artifact:

```yaml
- run: npx vitest --coverage
- uses: actions/upload-artifact@v4
  if: always()
  with:
      name: vitest
      path: coverage
```

Or you can combine the HTML output with the coverage report:

```yaml
- run: npx vitest --coverage --reporter html
- uses: actions/upload-artifact@v4
  if: always()
  with:
      name: vitest
      path: |
        coverage
        html
```

Note that by default, the coverage report will be skipped if any tests fail. You can override this by passing `--coverage.reportOnFailure`.
