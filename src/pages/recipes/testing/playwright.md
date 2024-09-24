## Playwright

HTML reporting is built in to Playwright. It's interactable, and renders detailed failure information, step-by-step traces including console logs, network calls, as well as screenshots and videos. Just add `reporter: 'html'` to your `playwright.config.ts`, run `playwright test --reporter html` via the CLI, or see [playwright docs](https://playwright.dev/docs/test-reporters#html-reporter) to customize the output folder. Then upload an artifact and print the URL:

```yaml
- run: npx playwright test
- uses: mmkal/artifact.ci/upload@main
  if: always()
  with:
      name: playwright
      path: playwright-report
```

![Playwright example](/reports/playwright.png)
