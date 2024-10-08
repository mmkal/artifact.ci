## ava

There's no great HTML reporter for AVA, but there's an ok-ish one for tap:

```bash
npm install tap-html --save-dev
```

```yaml
- run: npx ava --tap | npx tap-html --out output.html
- uses: actions/upload-artifact@v4
  if: always()
  with:
      name: ava
      path: output.html
```

![AVA example](/reports/ava.png)
