<!-- codegen:start {preset: custom, source: ./scripts/codegen.js, export: generateReadme} -->
# artifact.ci

## What is this?

A GitHub App that provides browsable links for artifacts uploaded during GitHub Actions workflow runs.

[Click here to install on GitHub](https://github.com/apps/artifact-ci/installations/new/permissions?target_id=71831023)

Once installed, the app adds a link to view your artifacts in a browser:

![playwright report](https://www.artifact.ci/reports/playwright.png)

## Why

CI jobs often generate useful HTML reports (test results, coverage, etc.). GitHub Actions doesn't provide a way to view these directly. The existing option is to use `actions/upload-artifact`, then download it as a zip file, unzip it on your local machine, and then poke around at the files or run a local server. This app fills that gap, letting you view artifacts in your browser without downloading and unzipping.

## Usage

Guides for common tools:

### Testing frameworks

- [Vitest](https://www.artifact.ci/recipes/testing/vitest)
- [Playwright](https://www.artifact.ci/recipes/testing/playwright)
- [Jest](https://www.artifact.ci/recipes/testing/jest)
- [Mocha](https://www.artifact.ci/recipes/testing/mocha)
- [AVA](https://www.artifact.ci/recipes/testing/ava)

### Other languages

- [Python](https://www.artifact.ci/recipes/other-languages/python)
- [Go](https://www.artifact.ci/recipes/other-languages/go)

### More

- [Static websites](https://www.artifact.ci/recipes/more/website)
- [PDFs](https://www.artifact.ci/recipes/more/pdf)

...you get the idea. If you can render it statically in a web browser, you can upload it to artifact.ci.

## Security

The app requires minimal permissions, operates read-only, and uses GitHub's APIs and authentication. It maintains your repository's existing access controls.

## Pricing

The actual service doesn't have a paywall for now, but access is limited to my GitHub sponsors due to storage costs. I'm giving some users and organizations free access - this is based on how much I use them myself, but if you would like to use this without sponsorship, [contact me](https://x.com/mmkalmmkal).

## Availability

There's no API surface right now. Just install the app and it should "just work" - it'll find your artifacts automatically. Options may be added in future to customise how the artifact is stored (for example, defining content-disposition headers, or making access to certain files public rather tha private). Usage limits may be introduced in future, or a proper payments setup.

Note that the GitHub team have mentioned a built-in solution is on their radar, so hopefully this will only be necessary for a short while.
<!-- codegen:end -->