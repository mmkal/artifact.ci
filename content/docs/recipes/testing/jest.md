---
title: "Jest"
---
## Jest

First install `jest-reporters-html`

```bash
npm install --save-dev jest-reporters-html
```

Then you can run jest with `npx jest --reporters jest-reporters-html` or add it to your jest.config.js:

```js
module.exports = {
  reporters: ['default', 'jest-reporters-html'],
}
```

```yaml
- run: npx jest
- uses: actions/upload-artifact@v4
  if: always()
  with:
      name: jest
      path: jest_html_reporters.html
```

![Jest example](/reports/jest.png)

### Coverage

Jest has a built-in coverage reporter which outputs HTML - if you're paying for codecov... maybe you don't need to anymore. Just run `jest --coverage` via the CLI, or see [jest docs](https://jestjs.io/docs/getting-started#coverage). Then upload the artifact:

```yaml
- run: npx jest --coverage
- uses: actions/upload-artifact@v4
  if: always()
  with:
      name: jest
      path: coverage
```

Or you can combine the HTML output with the coverage report:

```js
// jest.config.js
module.exports = {
  reporters: ["default", ["jest-html-reporters", {publicPath: "./report"}]],
}
```

```yaml
- run: npx vitest --coverage --reporter html
- uses: actions/upload-artifact@v4
  if: always()
  with:
      name: jest
      path: |
        coverage
        report
```
