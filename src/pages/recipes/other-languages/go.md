## go

Go's default test output can be piped to [go-test-report](https://github.com/vakenbolt/go-test-report).

```bash
go get github.com/vakenbolt/go-test-report
go install github.com/vakenbolt/go-test-report
```

```yaml
- run: go test -json | go-test-report
- uses: actions/upload-artifact@v4
  if: always()
  with:
    name: go
    path: test_report.html
```

![go example](/reports/go.png)
