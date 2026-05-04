# PostHog Handbook Library

An unofficial, living reader edition of [PostHog's public handbook](https://posthog.com/handbook).

PostHog's [live handbook](https://posthog.com/handbook) changes constantly, so a normal ebook would go stale. This project rebuilds the handbook from the public source, publishes fresh reader editions, and explains what changed between editions.

The [live PostHog handbook](https://posthog.com/handbook) remains the source of truth.

## Use It

No terminal required.

- Read online: https://dantrapp.github.io/posthog-handbook/
- Download the latest EPUBs and ZIP: https://github.com/dantrapp/posthog-handbook/releases/latest
- Start with the company narrative edition if you want the readable front-door version.
- Use the section EPUBs if you only care about Engineering, People, Growth, Product, and so on.

## What It Builds

Every generated edition includes source links and a generated date.

- Complete HTML handbook library
- Searchable hosted reader site
- Company narrative HTML edition
- Complete-library EPUB
- Company narrative EPUB
- Section-level EPUB volumes
- Print/PDF-ready HTML
- Downloadable HTML library ZIP
- Full source and artifact manifest
- Human-readable and JSON change digests

## Living Rebuilds

GitHub Actions does the living-book work:

1. Runs on pushes, manual dispatch, and a weekly schedule.
2. Downloads the latest released manifest when one exists.
3. Rebuilds the live PostHog handbook from `PostHog/posthog.com`.
4. Compares the new manifest against the previous released manifest.
5. Generates Markdown and JSON change digests.
6. Publishes the reader site to GitHub Pages.
7. Publishes a dated GitHub Release with EPUBs, the HTML archive, manifest, and changes.

That is the product idea: do not pretend the handbook is stable. Rebuild it, timestamp it, attribute it, and show the diff.

## For Developers

Requires Node.js 22+.

```bash
npm run discover
npm run build
npm run validate
npm test
```

For a faster live smoke build:

```bash
npm run build:smoke
```

Build outputs are written to `dist/`. The latest complete library is also copied to `dist/latest/`.

## CLI

```bash
npm run cli -- discover
npm run cli -- build --edition all
npm run cli -- build --edition company
npm run cli -- diff --previous old-manifest.json --current new-manifest.json
npm run cli -- validate --dist dist/latest
npm run cli -- serve --dist dist/latest
```

## Philosophy

There is no manually maintained book here. There is only:

- PostHog's public handbook source
- a deterministic build pipeline
- dated generated editions
- clear source attribution
- manifest-based change intelligence
