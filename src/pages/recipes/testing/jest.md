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
- uses: mmkal/artifact.ci/upload@main
  if: always()
  with:
      name: jest
      path: jest_html_reporters.html
```

![Jest example](/reports/jest.png)

