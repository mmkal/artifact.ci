## python

[pytest-html](https://pypi.org/project/pytest-html) outputs a useful document.

```bash
pip install pytest-html
```

```yaml
- run: pytest tests --html report/index.html
- uses: mmkal/artifact.ci/upload@main
  if: always()
  with:
      name: pytest
      path: output.html
```

![pytest example](/reports/pytest.png)
