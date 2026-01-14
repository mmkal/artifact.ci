---
title: "PDFs"
---
## PDFs

You can upload individual files:

```yaml
- name: create pdf
  run: node generate-pdf.js --destination output.pdf
- uses: actions/upload-artifact@v4
  with:
    name: pdf
    path: output.pdf
```

![PDF example](/reports/pdf.png)
