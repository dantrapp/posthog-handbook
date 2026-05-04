import assert from "node:assert/strict";
import test from "node:test";
import {
  buildZip,
  canonicalPath,
  compareManifests,
  markdownToHtml,
  sectionFor,
  serializeDiff,
} from "../src/cli/index.mjs";

test("maps handbook source paths to canonical PostHog URLs", () => {
  assert.equal(canonicalPath("contents/handbook/engineering/code-review.md"), "/handbook/engineering/code-review");
  assert.equal(canonicalPath("contents/handbook/people/index.md"), "/handbook/people");
  assert.equal(sectionFor("contents/handbook/engineering/code-review.md"), "engineering");
  assert.equal(sectionFor("contents/handbook/values.md"), null);
});

test("renders basic reader-safe markdown", () => {
  const html = markdownToHtml("# Hello\n\nThis is **bold** and [linked](/handbook/values).\n\n- One\n- Two");
  assert.match(html, /<h2 id="hello">Hello<\/h2>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /href="https:\/\/posthog.com\/handbook\/values"/);
  assert.match(html, /<ul>/);
});

test("adapts inline MDX components into readable text", () => {
  const html = markdownToHtml('Handled by <TeamMember name="Lottie Coxon" />, <TeamMember name="Heidi Berton" />, and <TeamMember name="Daniel Hawkins" />.');
  assert.match(html, /Handled by Lottie Coxon, Heidi Berton, and Daniel Hawkins\./);
  assert.doesNotMatch(html, /TeamMember/);
});

test("preserves markdown children inside MDX wrapper components", () => {
  const html = markdownToHtml("<Callout>\n\nImportant **reader** note.\n\n</Callout>");
  assert.match(html, /Important <strong>reader<\/strong> note\./);
  assert.doesNotMatch(html, /Callout/);
});

test("detects changed, added, removed, and moved pages from manifests", () => {
  const previous = {
    pages: [
      { title: "A", sourcePath: "contents/handbook/a.md", canonicalUrl: "/a", contentHash: "same" },
      { title: "B", sourcePath: "contents/handbook/b.md", canonicalUrl: "/b", contentHash: "old" },
      { title: "C", sourcePath: "contents/handbook/c.md", canonicalUrl: "/c", contentHash: "move-me" },
      { title: "D", sourcePath: "contents/handbook/d.md", canonicalUrl: "/d", contentHash: "gone" },
    ],
  };
  const current = {
    pages: [
      { title: "A", sourcePath: "contents/handbook/a.md", canonicalUrl: "/a", contentHash: "same" },
      { title: "B", sourcePath: "contents/handbook/b.md", canonicalUrl: "/b", contentHash: "new" },
      { title: "C", sourcePath: "contents/handbook/new-c.md", canonicalUrl: "/new-c", contentHash: "move-me" },
      { title: "E", sourcePath: "contents/handbook/e.md", canonicalUrl: "/e", contentHash: "fresh" },
    ],
  };
  const diff = compareManifests(previous, current);
  assert.equal(diff.changed.length, 1);
  assert.equal(diff.added.length, 1);
  assert.equal(diff.removed.length, 1);
  assert.equal(diff.moved.length, 1);
  assert.deepEqual(serializeDiff(diff).moved[0].after.sourcePath, "contents/handbook/new-c.md");
});

test("writes zip files with an uncompressed first entry", () => {
  const zip = buildZip([
    { name: "mimetype", data: Buffer.from("application/epub+zip") },
    { name: "OEBPS/nav.xhtml", data: Buffer.from("<html></html>") },
  ]);
  assert.equal(zip.slice(0, 4).toString("binary"), "PK\u0003\u0004");
  assert.equal(zip.slice(30, 38).toString("utf8"), "mimetype");
  assert.equal(zip.slice(38, 58).toString("utf8"), "application/epub+zip");
});
