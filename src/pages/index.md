# artifact.ci

## What

A wrapper around the `actions/upload-artifact` action which makes it possible to view the uploaded artifact in a browser.

>⚠️Note⚠️ This isn't ready yet! Message [me on X](https://x.com/mmkalmmkal) if you want to try it now.

It's a drop in replacement for the `actions/upload-artifact` action, so you can use it in the same way:

```diff
name: CI
on: [push]
jobs:
  run:
    steps:
      - uses: actions/checkout@v4
      - run: npm install
      - run: npx playwright test --reporter html
-     - uses: actions/upload-artifact@v4
+     - uses: mmkal/artifact.ci/upload@main
        if: always()
        with:
          name: e2e-test-report
          path: playwright-report
```

This will print a link to the artifact in your workflow run output, which you can click to view in your browser:

![playwright report](/reports/playwright.png)

## Why

Lots of CI jobs can build really useful, interactive HTML reports - test runners, code coverage, website outputs, PDFs, images, etc. And vendors out there sometimes get your money by offering a dashboard - a link you can click and see what's going on in your browser. But GitHub Actions doesn't - so when a test run fails, for example, you don't have the option of viewing the report in your browser. The existing option is to use `actions/upload-artifact`, then download it as a zip file, unzip it on your local machine, and then poke around at the files or run a local server. By using this action instead, you can just click the link logged by the action, and look at your artifact in your browser. This _should_ really be a feature built into GitHub, and hopefully one day will be, but [for now it isn't](https://github.com/actions/upload-artifact/issues/14). (Note: it is built into some other CI providers like CircleCI).

## How

Here are some high-level guides for how to get useful HTML outputs from various tools:

### Testing frameworks

#### Playwright

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

#### Vitest

Vitest has a sort-of builtin report. Just run `vitest --reporter html` via the CLI, or see [vitest docs](https://vitest.dev/guide/reporter.html#html-reporter). You may be prompted to install the `@vitest/ui` package. Then just upload the artifact:

```yaml
- run: npx vitest
- uses: mmkal/artifact.ci/upload@main
  if: always()
  with:
      name: vitest
      path: vitest-report
```

![Vitest example](/reports/vitest.png)

#### Jest

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


#### ava

There's no great HTML reporter for AVA, but there's an ok-ish one for tap:

```bash
npm install tap-html --save-dev
```

```yaml
- run: npx ava --tap | npx tap-html --out output.html
- uses: mmkal/artifact.ci/upload@main
  if: always()
  with:
      name: ava
      path: output.html
```

![AVA example](/reports/ava.png)

#### mocha

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

### Other languages

#### python

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

#### go

Go's default test output can be piped to [go-test-report](https://github.com/vakenbolt/go-test-report).

```bash
go get github.com/vakenbolt/go-test-report
go install github.com/vakenbolt/go-test-report
```

```yaml
- run: go test -json | go-test-report
- uses: mmkal/artifact.ci/upload@main
  if: always()
  with:
    name: go
    path: test_report.html
```

![go example](/reports/go.png)

### More

It's not limited to HTML test reports. You can upload any kind of artifact that you might want to view in a browser.

#### A website!

For a simple static HTML website, you can serve it using artifact.ci. For example, you could build an Astro website:

```yaml
- name: build website
  run: |
    npm create astro@latest -- demosite --template starlight --yes
    export BASE_PATH="/artifact/blob/${{ github.repository }}/${{ github.run_id }}/website/demosite/dist"
    sed -i "s|integrations|base: '$BASE_PATH', integrations|g" demosite/astro.config.mjs
    npm run build
- uses: mmkal/artifact.ci/upload@main
  if: always()
  with:
    name: website
    path: demosite/dist
```

![website](/reports/website.png)

#### Eslint config inspector

You couuld serve a rendered version of your eslint config using `@eslint/config-inspector`:

```yaml
- name: build eslint config inspection
  run: npx @eslint/config-inspector build --base /artifact/blob/${{ github.repository }}/${{ github.run_id }}/eslint/.eslint-config-inspector
- uses: mmkal/artifact.ci/upload@main
  if: always()
  with:
    name: eslint
    path: .eslint-config-inspector
```

![eslint config inspector](/reports/eslint.png)

>Note: in the above two examples, we are passing a "base" path to the build commands. Without this, some tools including eslint and astro will assume that all paths are relative to the root of the domain. You can use the template `/artifact/blob/${{ github.repository }}/${{ github.run_id }}/<name-of-your-artifact>` as above to get the correct base path.

#### PDFs

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

## When

For now, it's limited to whitelisted GitHub organizations. In future, I'll open it up to all users, likely based on GitHub sponsorship. It will also be free for open-source projects that don't have commercial sponsors.

Get in touch on [X](https://x.com/mmkalmmkal) if you would like to use this now. There may be changes to the API, and additional usage limits that are added.

## Whether

If you use this, you are sending your CI artifacts to a third-party service. You should only do this if there is no protected or proprietary information in these artifacts. The reason the service is open source is so you can see nothing is being done with the data. If you want to be extra sure of that, see the self-hosting instructions below.

For convenience of use, a *GitHub token is not required* to upload artifacts for open source projects. However this does meant that in theory it is possible to spoof uploads. There are some protections against this - the upload API will check to make sure that the job id provided is running at the time it receives the request. And, only one request can be made for each repo/run/job/attempt. So, a spoofer would need to time their request to run right when your CI job is running, and have a way to gather all the information they need to make a valid request. So while this makes it very unlikely to happen - and if it did happen, you would notice the failed requests from your real CI job - it is still theoretically possible, so you should not consider the URLs generated by this service as 100% secure, unless you configure your repo to require a GitHub token.

For closed-source projects, a token is required.

## How much

Right now this service itself is "free" but since the storage costs money, I'm limiting access to the service to individuals or organizations that are sponsoring me on https://github.com/sponsors/mmkal.

I'm giving some organizations free access - this is based on how much I use them myself.

## Self-host

The code is open-source, so you can self-host it if you want to (e.g. to run on a private network, or to use it without sponsoring me, or to use a different blob storage provider, or to add extra features etc.). Here's how:

- Clone the repository
- Deploy to Vercel - which will automatically detect how to build and deploy the server. You should also be able to use any other platform that supports Next.js.
- You'll need to set the `ALLOWED_GITHUB_OWNERS` environment variable to a comma-separated list of GitHub organizations that are allowed to upload artifacts.
- Blob storage setup:
   - This project uses `@vercel/blob`, but in theory you may be able to use a service that wraps another blob storage provider like AWS, Azure or Cloudflare's offerings, to make them usable with the `@vercel/blob` SDK.
   - Set the `STORAGE_ORIGIN` environment variable to the URL of the storage service you're using.
   - Set the `BLOB_READ_WRITE_TOKEN` environment variable to a token that has read/write access to the storage service.
- Auth setup:
   - Add an environment variable `AUTH_SECRET` to your server deployment.
   - Create a GitHub OAuth app
   - Set the callback URL to `https://<your-domain>/api/auth/callback/github`
   - Set the `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET` environment variables to the values from the GitHub OAuth app.
