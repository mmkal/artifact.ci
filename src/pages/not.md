# What this is not

## A CDN

Files within your artifacts are uploaded to a storage backend. For URLs served with an identifier using a GitHub run ID, or a commit SHA, a long-lasting cache-control header is set. For URLs served with an identifier using a branch name, a short-lasting cache-control header is set (at time or writing, five minutes).

Beyond that, however, there are none of the features you might expect from a CDN.

## A static file hosting service

While you can use this to upload a static website, it is not intended to be the primary way you host your website.

## A replacement for GitHub Actions artifacts

artifact.ci uses GitHub's API as its "backend" - the source of truth is your regular old GitHub Actions artifacts. This app just helps you look at them in the browser.
