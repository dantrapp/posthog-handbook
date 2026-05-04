# PostHog Handbook Library

An unofficial, rebuildable publishing layer for PostHog's public handbook.

This project started from a community-shaped product problem: an ebook version of the handbook would be useful, but PostHog's handbook changes constantly, so a static book would go stale.

This repo treats that objection as the core feature. It builds dated reader editions, manifests, source provenance, and change digests directly from PostHog's public handbook source. The live PostHog handbook remains the source of truth.

## Current Iteration

This first public iteration ships a dependency-free Node.js CLI that can:

- discover every Markdown/MDX file under `contents/handbook/**` from `PostHog/posthog.com`
- fetch raw source content from GitHub
- generate a full static HTML handbook library
- generate a company narrative HTML edition
- generate per-page source metadata and content hashes
- generate a machine-readable manifest
- generate a baseline or comparative change digest
- validate that generated HTML and manifest artifacts exist

EPUB generation and richer MDX component adapters are planned next. An earlier EPUB proof of concept is kept locally in ignored `v1/` and is not part of the public repo history.

## Usage

Requires Node.js 22+.

```bash
npm run discover
npm run build
npm run validate
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

That is the answer to the stale-book problem: do not pretend the handbook is stable; make freshness and provenance visible.

