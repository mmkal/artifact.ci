## python

[pytest-html](https://pypi.org/project/pytest-html) outputs a useful document.

```bash
pip install pytest-html
```

```yaml
- run: pytest tests --html report/index.html
- uses: actions/upload-artifact@v4
  if: always()
  with:
      name: pytest
      path: output.html
```

![pytest example](/reports/pytest.png)
