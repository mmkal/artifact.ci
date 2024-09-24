## PDFs

You can upload individual files:

```yaml
- name: create pdf
  run: node generate-pdf.js --destination output.pdf
- uses: mmkal/artifact.ci/upload@main
  with:
    name: pdf
    path: output.pdf
```

![PDF example](/reports/pdf.png)
