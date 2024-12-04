# artifact.ci [![X Follow](https://img.shields.io/twitter/follow/mmkalmmkal)](https://x.com/mmkalmmkal)

<!-- codegen:start {preset: custom, source: ./scripts/codegen.js, export: generateReadme} -->
View your GitHub artifacts in the browser.

## How

artifact.ci is a GitHub App that provides browsable links for artifacts uploaded during GitHub Actions workflow runs.

View test reports, code coverage, PDFs, images, and more, directly in your browser. No more downloading and unzipping.

It's a small tool which solves a specific, hopefully temporary, [shortcoming of GitHub Actions](https://github.com/actions/upload-artifact/issues/14). To use it, all you need to do is install the app. Then use `actions/upload-artifact` as normal in your workflow. It will add a link to view any artifacts uploaded via GitHub checks.

Docs and install instructions on [artifact.ci](https://artifact.ci).

## Why

CI jobs often generate useful HTML reports (test results, coverage, etc.). GitHub Actions doesn't provide a way to view these directly. The existing option is to use `actions/upload-artifact`, then download it as a zip file, unzip it on your local machine, and then poke around at the files or run a local server. This app fills that gap, letting you view artifacts in your browser without downloading and unzipping.

This _should_ really be a feature built into GitHub, and likely one day will be, but [for now it isn't](https://github.com/actions/upload-artifact/issues/14). (Note: it is built into some other CI providers like CircleCI).

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

The app requires minimal permissions, operates read-only, and uses GitHub's APIs and authentication. It maintains your repository's existing access controls. See [the privacy policy](https://www.artifact.ci/privacy) for more details.

## Who

This is [my](https://x.com/mmkalmmkal) side project, something I built over a week or so, initially for my own use in support of another project I'm working on, so assume it exists as-is with no guarantees of new features etc. But feel free to file issues.

## Pricing

The actual service doesn't have a paywall for now, and usage is free to start out with. Access may be limited to my [GitHub sponsors](https://github.com/sponsors/mmkal) due to storage costs. I'm giving some users and organizations free access - this is based on how much I use them myself, but if you would like to use this without sponsorship, [contact me](https://x.com/mmkalmmkal).

## Usage and Availability

There's no API surface right now. Just install the app and it should "just work" - it'll find your artifacts automatically. There are a small number of options that can be customised, see [advanced usage docs](https://www.artifact.ci/advanced). Usage limits may be introduced in future, or a proper payments setup.

Note that the GitHub team have mentioned a built-in solution is on their radar, so hopefully this will only be necessary for a short while.
<!-- codegen:end -->