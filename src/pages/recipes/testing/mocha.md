## mocha

Mocha's [doc](https://mochajs.org/#doc) reporter outputs simple HTML. Their documentation has some pointers on how to add styling to the output.

```yaml
- run: npx mocha --reporter doc > output.html
- uses: mmkal/artifact.ci/upload@main
  if: always()
  with:
      name: mocha
      path: output.html
```

![Mocha example](/reports/mocha.png)
