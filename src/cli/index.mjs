#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, cp, access, readdir, stat, rm } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = "https://posthog.com";
const SOURCE_REPO = "PostHog/posthog.com";
const SOURCE_REF = "master";
const TREE_API = `https://api.github.com/repos/${SOURCE_REPO}/git/trees/${SOURCE_REF}?recursive=1`;
const RAW_BASE = `https://raw.githubusercontent.com/${SOURCE_REPO}/${SOURCE_REF}/`;
const GITHUB_BASE = `https://github.com/${SOURCE_REPO}/blob/${SOURCE_REF}/`;
const USER_AGENT = "posthog-handbook-library/0.1";
const GENERATOR_VERSION = "0.2.0";
const COMPANY_ORDER = [
  "contents/handbook/why-does-posthog-exist.md",
  "contents/handbook/story.md",
  "contents/handbook/how-we-get-users.md",
  "contents/handbook/who-we-build-for.md",
  "contents/handbook/making-users-happy.md",
  "contents/handbook/how-we-make-money.md",
  "contents/handbook/low-prices.md",
  "contents/handbook/which-products.md",
  "contents/handbook/wide-company.md",
  "contents/handbook/strong-team.md",
  "contents/handbook/values.md",
  "contents/handbook/world-class-engineering.md",
  "contents/handbook/finance.md",
  "contents/handbook/future.md",
  "contents/handbook/help.md",
];

const SECTION_TITLES = new Map([
  ["cs-and-onboarding", "CS and Onboarding"],
  ["docs-and-wizard", "Docs and Wizard"],
]);

function parseArgs(argv) {
  const [command = "help", ...rest] = argv;
  const args = { _: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = rest[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return { command, args };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "page";
}

async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

async function exists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const time =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const dosDate =
    ((date.getFullYear() - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();
  return { time, date: dosDate };
}

function zipEntry(name, data) {
  return {
    name: name.replace(/^\/+/, ""),
    data: Buffer.isBuffer(data) ? data : Buffer.from(String(data)),
  };
}

function buildZip(entries) {
  const localParts = [];
  const centralParts = [];
  const { time, date } = dosDateTime();
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = entry.data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

async function writeZip(outputPath, entries) {
  await ensureDir(path.dirname(outputPath));
  await writeFile(outputPath, buildZip(entries));
}

async function collectFiles(root, base = root) {
  const items = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      items.push(...await collectFiles(fullPath, base));
    } else if (entry.isFile()) {
      items.push({
        absolutePath: fullPath,
        relativePath: path.relative(base, fullPath).split(path.sep).join("/"),
      });
    }
  }
  return items;
}

async function fileHash(filePath) {
  return hash(await readFile(filePath));
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/vnd.github+json, text/plain, */*",
    },
  });
  if (!response.ok) {
    throw new Error(`Fetch failed ${response.status} ${response.statusText}: ${url}`);
  }
  return response.text();
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

function rawUrl(sourcePath) {
  return `${RAW_BASE}${sourcePath.split("/").map(encodeURIComponent).join("/")}`;
}

function githubUrl(sourcePath) {
  return `${GITHUB_BASE}${sourcePath.split("/").map(encodeURIComponent).join("/")}`;
}

function canonicalPath(sourcePath) {
  let relative = sourcePath
    .replace(/^contents\/handbook\//, "")
    .replace(/\.(md|mdx)$/i, "");
  relative = relative.replace(/(^|\/)index$/, "");
  return `/handbook${relative ? `/${relative}` : ""}`;
}

function pageDataUrl(sourcePath) {
  return `${BASE_URL}/page-data${canonicalPath(sourcePath)}/page-data.json`;
}

function sectionFor(sourcePath) {
  const relative = sourcePath.replace(/^contents\/handbook\//, "");
  if (!relative.includes("/")) return null;
  return relative.split("/")[0];
}

function titleCaseSegment(segment) {
  return SECTION_TITLES.get(segment) || segment
    .split("-")
    .map((part) => part ? part[0].toUpperCase() + part.slice(1) : part)
    .join(" ");
}

function stripFrontmatter(markdown) {
  if (!markdown.startsWith("---")) {
    return { frontmatter: {}, body: markdown };
  }
  const end = markdown.indexOf("\n---", 3);
  if (end === -1) {
    return { frontmatter: {}, body: markdown };
  }
  const raw = markdown.slice(3, end).trim();
  const frontmatter = {};
  for (const line of raw.split("\n")) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/);
    if (match) {
      frontmatter[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
  return { frontmatter, body: markdown.slice(end + 4).trimStart() };
}

function inferTitle(sourcePath, frontmatter, body) {
  if (frontmatter.title) return frontmatter.title;
  const heading = body.match(/^#\s+(.+)$/m);
  if (heading) return heading[1].trim().replace(/\s+#*$/, "");
  const fileName = path.basename(sourcePath).replace(/\.(md|mdx)$/i, "");
  return titleCaseSegment(fileName === "index" ? sectionFor(sourcePath) || "handbook" : fileName);
}

function normalizeMarkdown(markdown) {
  const { body } = stripFrontmatter(markdown);
  const lines = [];
  let skippingComponent = false;
  for (const line of body.split("\n")) {
    const stripped = line.trim();
    if (stripped.startsWith("import ")) continue;
    if (stripped.startsWith("<") && /^<\/?[A-Z]/.test(stripped)) {
      if (!stripped.endsWith("/>") && !stripped.startsWith("</")) {
        skippingComponent = true;
      }
      continue;
    }
    if (skippingComponent) {
      if (stripped.startsWith("</")) skippingComponent = false;
      continue;
    }
    lines.push(line.replace(/\s+$/, ""));
  }
  return lines.join("\n").trim();
}

function absolutizeLink(href) {
  if (!href || href.startsWith("#") || href.startsWith("mailto:") || /^[a-z]+:/i.test(href)) {
    return href;
  }
  if (href.startsWith("/")) return `${BASE_URL}${href}`;
  return href;
}

function inlineMarkdown(value) {
  const code = [];
  let text = String(value).replace(/`([^`]+)`/g, (_, inner) => {
    code.push(`<code>${escapeHtml(inner)}</code>`);
    return `\u0000CODE${code.length - 1}\u0000`;
  });
  text = escapeHtml(text);
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
    return `<span class="image-ref">Image: ${escapeHtml(alt || src)}</span>`;
  });
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    return `<a href="${escapeHtml(absolutizeLink(href))}">${label}</a>`;
  });
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  text = text.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>");
  for (let i = 0; i < code.length; i += 1) {
    text = text.replace(`\u0000CODE${i}\u0000`, code[i]);
  }
  return text;
}

function markdownToHtml(markdown) {
  const lines = normalizeMarkdown(markdown).split("\n");
  const output = [];
  let paragraph = [];
  let listType = null;
  let inCode = false;
  let codeLang = "";
  let codeLines = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    output.push(`<p>${inlineMarkdown(paragraph.map((part) => part.trim()).join(" "))}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (!listType) return;
    output.push(`</${listType}>`);
    listType = null;
  };

  for (const line of lines) {
    const stripped = line.trim();
    if (inCode) {
      if (stripped.startsWith("```")) {
        const className = codeLang ? ` class="language-${escapeHtml(codeLang)}"` : "";
        output.push(`<pre><code${className}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        inCode = false;
        codeLang = "";
        codeLines = [];
      } else {
        codeLines.push(line);
      }
      continue;
    }

    if (stripped.startsWith("```")) {
      flushParagraph();
      closeList();
      inCode = true;
      codeLang = stripped.slice(3).trim();
      continue;
    }

    if (!stripped) {
      flushParagraph();
      closeList();
      continue;
    }

    const heading = stripped.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = Math.min(heading[1].length + 1, 6);
      const title = heading[2].trim();
      output.push(`<h${level} id="${slugify(title)}">${inlineMarkdown(title)}</h${level}>`);
      continue;
    }

    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    const numbered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (bullet || numbered) {
      flushParagraph();
      const target = bullet ? "ul" : "ol";
      if (listType !== target) {
        closeList();
        output.push(`<${target}>`);
        listType = target;
      }
      output.push(`<li>${inlineMarkdown((bullet || numbered)[1])}</li>`);
      continue;
    }

    if (stripped.startsWith(">")) {
      flushParagraph();
      closeList();
      output.push(`<blockquote><p>${inlineMarkdown(stripped.replace(/^>\s?/, ""))}</p></blockquote>`);
      continue;
    }

    if (/^<\/?[a-z][^>]*>$/i.test(stripped)) {
      flushParagraph();
      closeList();
      continue;
    }

    closeList();
    paragraph.push(line);
  }

  if (inCode) {
    output.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }
  flushParagraph();
  closeList();
  return output.join("\n");
}

function plainText(markdown) {
  return normalizeMarkdown(markdown)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/[#>*_`-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function discoverSourcePages(limit) {
  const tree = await fetchJson(TREE_API);
  const pages = tree.tree
    .filter((entry) => entry.type === "blob")
    .filter((entry) => /^contents\/handbook\/.+\.mdx?$/i.test(entry.path))
    .sort((a, b) => a.path.localeCompare(b.path));
  return Number.isFinite(limit) ? pages.slice(0, limit) : pages;
}

async function enrichPage(entry, index) {
  const sourcePath = entry.path;
  const markdown = await fetchText(rawUrl(sourcePath));
  const { frontmatter, body } = stripFrontmatter(markdown);
  const title = inferTitle(sourcePath, frontmatter, body);
  const text = plainText(markdown);
  const section = sectionFor(sourcePath);
  const contentHash = hash(normalizeMarkdown(markdown));
  return {
    id: slugify(sourcePath.replace(/^contents\/handbook\//, "").replace(/\.(md|mdx)$/i, "")),
    order: index + 1,
    title,
    section,
    sourcePath,
    canonicalUrl: `${BASE_URL}${canonicalPath(sourcePath)}`,
    pageDataUrl: pageDataUrl(sourcePath),
    rawUrl: rawUrl(sourcePath),
    githubUrl: githubUrl(sourcePath),
    contentHash,
    wordCount: text ? text.split(/\s+/).length : 0,
    readingTimeMinutes: Math.max(1, Math.ceil((text ? text.split(/\s+/).length : 0) / 225)),
    headings: [...normalizeMarkdown(markdown).matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => m[1].trim()),
    markdown,
    html: markdownToHtml(markdown),
    warnings: markdown.includes("<") && /<\/?[A-Z]/.test(markdown)
      ? [{ code: "MDX_COMPONENT_OMITTED", message: "One or more MDX components were omitted from the static reader output." }]
      : [],
  };
}

function groupSections(pages) {
  const map = new Map();
  for (const page of pages) {
    const id = page.section || "root";
    if (!map.has(id)) {
      map.set(id, {
        id,
        title: id === "root" ? "Handbook Front Door" : titleCaseSegment(id),
        pages: [],
        wordCount: 0,
      });
    }
    const section = map.get(id);
    section.pages.push(page);
    section.wordCount += page.wordCount;
  }
  return [...map.values()].sort((a, b) => a.title.localeCompare(b.title));
}

function pageHref(page) {
  return `pages/${page.id}.html`;
}

function htmlShell(title, body, relativeCss = "assets/library.css") {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="${relativeCss}">
</head>
<body>
${body}
</body>
</html>
`;
}

function renderIndex({ pages, sections, buildDate, manifestPath, artifacts = [] }) {
  const sectionItems = sections.map((section) => {
    return `<li><a href="sections/${section.id}.html">${escapeHtml(section.title)}</a> <span>${section.pages.length} pages</span></li>`;
  }).join("\n");
  const artifactItems = artifacts
    .filter((artifact) => artifact.public)
    .map((artifact) => `<li><a href="${escapeHtml(artifact.path)}">${escapeHtml(artifact.label)}</a> <span>${escapeHtml(artifact.type)}</span></li>`)
    .join("\n");
  const body = `<main class="site-shell">
  <header class="library-header">
    <p class="kicker">Unofficial generated edition</p>
    <h1>PostHog Handbook Library</h1>
    <p class="build-note">Generated ${escapeHtml(buildDate)} from <a href="https://github.com/PostHog/posthog.com/tree/master/contents/handbook">PostHog/posthog.com contents/handbook</a>. The live handbook remains canonical.</p>
  </header>
  <section class="summary-grid" aria-label="Build summary">
    <div class="metric"><strong>${pages.length}</strong> pages discovered</div>
    <div class="metric"><strong>${sections.length}</strong> sections</div>
    <div class="metric"><strong>${pages.reduce((sum, page) => sum + page.wordCount, 0).toLocaleString()}</strong> words</div>
    <div class="metric"><strong>${pages.filter((page) => page.warnings.length).length}</strong> pages with warnings</div>
  </section>
  <section>
    <h2>Sections</h2>
    <ol class="section-list">${sectionItems}</ol>
  </section>
  <section>
    <h2>Downloads and Data</h2>
    <ul class="toc">
      <li><a href="${escapeHtml(manifestPath)}">Manifest JSON</a></li>
      <li><a href="search-index.json">Search index JSON</a></li>
      <li><a href="changes.md">Change digest</a></li>
      <li><a href="company.html">Company narrative edition</a></li>
      ${artifactItems}
    </ul>
  </section>
</main>`;
  return htmlShell("PostHog Handbook Library", body);
}

function renderSection(section) {
  const items = section.pages.map((page) => {
    return `<li><a href="../${pageHref(page)}">${escapeHtml(page.title)}</a> <span>${page.wordCount.toLocaleString()} words</span></li>`;
  }).join("\n");
  const body = `<main class="site-shell">
  <p class="kicker"><a href="../index.html">PostHog Handbook Library</a></p>
  <h1>${escapeHtml(section.title)}</h1>
  <p class="build-note">${section.pages.length} pages, ${section.wordCount.toLocaleString()} words.</p>
  <ol class="toc">${items}</ol>
</main>`;
  return htmlShell(section.title, body, "../assets/library.css");
}

function renderPage(page) {
  const warnings = page.warnings.map((warning) => {
    return `<p class="warning">${escapeHtml(warning.code)}: ${escapeHtml(warning.message)}</p>`;
  }).join("\n");
  const body = `<main class="site-shell reader">
  <p class="kicker"><a href="../index.html">PostHog Handbook Library</a>${page.section ? ` / ${escapeHtml(titleCaseSegment(page.section))}` : ""}</p>
  <article>
    <h1>${escapeHtml(page.title)}</h1>
    <p class="build-note">${page.wordCount.toLocaleString()} words. Estimated reading time: ${page.readingTimeMinutes} min.</p>
    ${warnings}
    ${page.html}
  </article>
  <section class="source-list">
    <p>Canonical URL: <a href="${escapeHtml(page.canonicalUrl)}">${escapeHtml(page.canonicalUrl)}</a></p>
    <p>GitHub source: <a href="${escapeHtml(page.githubUrl)}">${escapeHtml(page.sourcePath)}</a></p>
    <p>Content hash: <code>${escapeHtml(page.contentHash.slice(0, 16))}</code></p>
  </section>
</main>`;
  return htmlShell(page.title, body, "../assets/library.css");
}

function renderCompany(pages, buildDate) {
  const ordered = COMPANY_ORDER
    .map((sourcePath) => pages.find((page) => page.sourcePath === sourcePath))
    .filter(Boolean);
  const toc = ordered.map((page, index) => `<li><a href="#${page.id}">${index + 1}. ${escapeHtml(page.title)}</a></li>`).join("\n");
  const articles = ordered.map((page, index) => `<article id="${page.id}">
    <h1>${index + 1}. ${escapeHtml(page.title)}</h1>
    <p class="build-note">Source: <a href="${escapeHtml(page.canonicalUrl)}">${escapeHtml(page.canonicalUrl)}</a></p>
    ${page.html}
  </article>`).join("\n<hr>\n");
  const body = `<main class="site-shell reader">
  <header class="library-header">
    <p class="kicker">Unofficial generated edition</p>
    <h1>PostHog Company Handbook</h1>
    <p class="build-note">Generated ${escapeHtml(buildDate)}. This is a readable snapshot; the live handbook remains canonical.</p>
  </header>
  <nav aria-label="Contents">
    <h2>Contents</h2>
    <ol class="toc">${toc}</ol>
  </nav>
  ${articles}
</main>`;
  return htmlShell("PostHog Company Handbook", body);
}

function renderPrintHtml(pages, sections, buildDate) {
  const sectionToc = sections.map((section) => {
    const items = section.pages.map((page) => `<li><a href="#${page.id}">${escapeHtml(page.title)}</a></li>`).join("\n");
    return `<li>${escapeHtml(section.title)}<ol>${items}</ol></li>`;
  }).join("\n");
  const articles = sections.flatMap((section) => section.pages.map((page) => `<article id="${page.id}">
    <h1>${escapeHtml(page.title)}</h1>
    <p class="build-note">${escapeHtml(section.title)} | Source: <a href="${escapeHtml(page.canonicalUrl)}">${escapeHtml(page.canonicalUrl)}</a></p>
    ${page.html}
  </article>`)).join("\n");
  const body = `<main class="site-shell reader">
  <header class="library-header">
    <p class="kicker">Print-ready generated edition</p>
    <h1>PostHog Handbook Library</h1>
    <p class="build-note">Generated ${escapeHtml(buildDate)} from PostHog's public handbook source. The live handbook remains canonical.</p>
  </header>
  <nav aria-label="Contents">
    <h2>Contents</h2>
    <ol class="toc">${sectionToc}</ol>
  </nav>
  ${articles}
</main>`;
  return htmlShell("PostHog Handbook Library Print Edition", body);
}

function xhtmlShell(title, body, extra = "") {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css" />
</head>
<body>
${body}
${extra}
</body>
</html>
`;
}

function renderEpubCover(title, subtitle, pages, buildDate) {
  const body = `<section class="cover">
  <h1>${escapeHtml(title)}</h1>
  <p class="build-note">${escapeHtml(subtitle)}</p>
  <p>Generated ${escapeHtml(buildDate)} from PostHog's public handbook source.</p>
  <p>The live handbook at <a href="${BASE_URL}/handbook">${BASE_URL}/handbook</a> remains canonical.</p>
  <p>${pages.length} pages included.</p>
</section>`;
  return xhtmlShell(title, body);
}

function renderEpubNav(title, pages) {
  const items = pages.map((page, index) => `<li><a href="pages/${escapeHtml(page.id)}.xhtml">${index + 1}. ${escapeHtml(page.title)}</a></li>`).join("\n");
  const body = `<nav epub:type="toc" id="toc">
  <h1>${escapeHtml(title)}</h1>
  <ol>
    <li><a href="cover.xhtml">Cover</a></li>
    ${items}
  </ol>
</nav>`;
  return xhtmlShell(`${title} Contents`, body);
}

function renderEpubPage(page, index) {
  const body = `<article>
  <h1>${index + 1}. ${escapeHtml(page.title)}</h1>
  <p class="build-note">Source: <a href="${escapeHtml(page.canonicalUrl)}">${escapeHtml(page.canonicalUrl)}</a></p>
  ${page.html}
</article>`;
  return xhtmlShell(page.title, body);
}

function renderContentOpf({ title, identifier, pages, buildDate }) {
  const pageItems = pages.map((page) => `<item id="${escapeHtml(page.id)}" href="pages/${escapeHtml(page.id)}.xhtml" media-type="application/xhtml+xml"/>`).join("\n    ");
  const spineItems = pages.map((page) => `<itemref idref="${escapeHtml(page.id)}"/>`).join("\n    ");
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${escapeHtml(identifier)}</dc:identifier>
    <dc:title>${escapeHtml(title)}</dc:title>
    <dc:creator>PostHog</dc:creator>
    <dc:language>en</dc:language>
    <dc:publisher>Unofficial PostHog Handbook Library generator</dc:publisher>
    <dc:date>${escapeHtml(buildDate)}</dc:date>
    <meta property="dcterms:modified">${escapeHtml(buildDate)}T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="styles" href="styles.css" media-type="text/css"/>
    ${pageItems}
  </manifest>
  <spine>
    <itemref idref="cover"/>
    ${spineItems}
  </spine>
</package>
`;
}

async function writeEpub({ pages, outputPath, title, subtitle, buildDate }) {
  const container = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;
  const css = await readFile("styles/library.css", "utf8");
  const identifier = hash(`${title}:${buildDate}:${pages.map((page) => page.contentHash).join(":")}`).slice(0, 32);
  const entries = [
    zipEntry("mimetype", "application/epub+zip"),
    zipEntry("META-INF/container.xml", container),
    zipEntry("OEBPS/styles.css", css),
    zipEntry("OEBPS/cover.xhtml", renderEpubCover(title, subtitle, pages, buildDate)),
    zipEntry("OEBPS/nav.xhtml", renderEpubNav(title, pages)),
    zipEntry("OEBPS/content.opf", renderContentOpf({ title, identifier, pages, buildDate })),
    ...pages.map((page, index) => zipEntry(`OEBPS/pages/${page.id}.xhtml`, renderEpubPage(page, index))),
  ];
  await writeZip(outputPath, entries);
}

async function writeDirectoryArchive({ sourceDir, outputPath, prefix }) {
  const files = await collectFiles(sourceDir);
  const entries = [];
  for (const file of files) {
    if (path.resolve(file.absolutePath) === path.resolve(outputPath)) continue;
    entries.push(zipEntry(`${prefix}/${file.relativePath}`, await readFile(file.absolutePath)));
  }
  await writeZip(outputPath, entries);
}

async function artifactMetadata(outDir, artifact) {
  const target = path.join(outDir, artifact.path);
  const info = await stat(target);
  return {
    ...artifact,
    bytes: info.size,
    contentHash: await fileHash(target),
  };
}

function manifestFor({ pages, sections, buildDate, artifacts }) {
  return {
    schemaVersion: "0.1",
    generatedAt: buildDate,
    generatorVersion: GENERATOR_VERSION,
    sourceRepo: SOURCE_REPO,
    sourceRef: SOURCE_REF,
    pageCount: pages.length,
    sectionCount: sections.length,
    contentHash: hash(pages.map((page) => `${page.sourcePath}:${page.contentHash}`).join("\n")),
    sections: sections.map((section) => ({
      id: section.id,
      title: section.title,
      pageCount: section.pages.length,
      wordCount: section.wordCount,
      contentHash: hash(section.pages.map((page) => page.contentHash).join("\n")),
    })),
    pages: pages.map((page) => ({
      id: page.id,
      title: page.title,
      section: page.section,
      sourcePath: page.sourcePath,
      githubUrl: page.githubUrl,
      canonicalUrl: page.canonicalUrl,
      rawUrl: page.rawUrl,
      pageDataUrl: page.pageDataUrl,
      wordCount: page.wordCount,
      readingTimeMinutes: page.readingTimeMinutes,
      contentHash: page.contentHash,
      warnings: page.warnings,
    })),
    artifacts,
  };
}

function compareManifests(previous, current) {
  const previousByPath = new Map(previous.pages.map((page) => [page.sourcePath, page]));
  const currentByPath = new Map(current.pages.map((page) => [page.sourcePath, page]));
  const removedCandidates = [];
  const addedCandidates = [];
  const added = [];
  const removed = [];
  const moved = [];
  const changed = [];
  const metadataOnly = [];
  for (const page of current.pages) {
    const old = previousByPath.get(page.sourcePath);
    if (!old) {
      addedCandidates.push(page);
    } else if (old.contentHash !== page.contentHash) {
      changed.push({ before: old, after: page });
    } else if (old.title !== page.title || old.canonicalUrl !== page.canonicalUrl) {
      metadataOnly.push({ before: old, after: page });
    }
  }
  for (const page of previous.pages) {
    if (!currentByPath.has(page.sourcePath)) {
      removedCandidates.push(page);
    }
  }
  for (const page of addedCandidates) {
    const movedFrom = removedCandidates.find((candidate) => candidate.contentHash === page.contentHash);
    if (movedFrom) {
      moved.push({ before: movedFrom, after: page });
      removedCandidates.splice(removedCandidates.indexOf(movedFrom), 1);
    } else {
      added.push(page);
    }
  }
  removed.push(...removedCandidates);
  return { added, removed, moved, changed, metadataOnly };
}

function renderChangeMarkdown(diff, current, previous = null) {
  const lines = [
    "# PostHog Handbook Changes",
    "",
    `Generated: ${current.generatedAt}`,
    previous ? `Compared with: ${previous.generatedAt}` : "Compared with: baseline build",
    "",
  ];
  if (!previous) {
    lines.push("This is the first manifest in this build output, so every discovered page is treated as part of the baseline edition.", "");
  }
  const groups = [
    ["Added Pages", diff.added.map((page) => page.sourcePath)],
    ["Removed Pages", diff.removed.map((page) => page.sourcePath)],
    ["Moved Pages", (diff.moved || []).map(({ before, after }) => `${before.sourcePath} -> ${after.sourcePath}`)],
    ["Changed Pages", diff.changed.map(({ after }) => after.sourcePath)],
    ["Metadata-Only Changes", diff.metadataOnly.map(({ after }) => after.sourcePath)],
  ];
  for (const [title, items] of groups) {
    lines.push(`## ${title}`, "");
    if (!items.length) {
      lines.push("- None", "");
      continue;
    }
    for (const item of items) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}

function serializeDiff(diff) {
  const pageRef = (page) => ({
    title: page.title,
    sourcePath: page.sourcePath,
    canonicalUrl: page.canonicalUrl,
    contentHash: page.contentHash,
  });
  return {
    added: diff.added.map(pageRef),
    removed: diff.removed.map(pageRef),
    moved: (diff.moved || []).map(({ before, after }) => ({ before: pageRef(before), after: pageRef(after) })),
    changed: diff.changed.map(({ before, after }) => ({ before: pageRef(before), after: pageRef(after) })),
    metadataOnly: diff.metadataOnly.map(({ before, after }) => ({ before: pageRef(before), after: pageRef(after) })),
  };
}

async function commandDiscover(args) {
  const limit = args.limit ? Number(args.limit) : Number.POSITIVE_INFINITY;
  const pages = await discoverSourcePages(limit);
  const cacheDir = ".cache/posthog-handbook";
  await ensureDir(cacheDir);
  const payload = {
    sourceRepo: SOURCE_REPO,
    sourceRef: SOURCE_REF,
    generatedAt: new Date().toISOString(),
    pageCount: pages.length,
    pages: pages.map((page) => ({
      sourcePath: page.path,
      canonicalUrl: `${BASE_URL}${canonicalPath(page.path)}`,
      rawUrl: rawUrl(page.path),
      githubUrl: githubUrl(page.path),
      section: sectionFor(page.path),
    })),
  };
  await writeFile(path.join(cacheDir, "source-tree.json"), `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Discovered ${pages.length} handbook pages.`);
  console.log(`Wrote ${cacheDir}/source-tree.json`);
}

async function commandBuild(args) {
  const buildDate = args.date || today();
  const edition = args.edition || "all";
  const limit = args.limit ? Number(args.limit) : Number.POSITIVE_INFINITY;
  const outRoot = args["out-dir"] || "dist";
  const outDir = path.join(outRoot, `posthog-handbook-library-${buildDate}`);
  await rm(outDir, { recursive: true, force: true });
  await ensureDir(outDir);
  await ensureDir(path.join(outDir, "assets"));
  await ensureDir(path.join(outDir, "pages"));
  await ensureDir(path.join(outDir, "sections"));
  await ensureDir(path.join(outDir, "downloads"));

  const entries = await discoverSourcePages(limit);
  const pages = [];
  for (let i = 0; i < entries.length; i += 1) {
    const page = await enrichPage(entries[i], i);
    pages.push(page);
    if ((i + 1) % 25 === 0 || i + 1 === entries.length) {
      console.log(`Fetched ${i + 1}/${entries.length} pages...`);
    }
  }
  const sections = groupSections(pages);
  await cp("styles/library.css", path.join(outDir, "assets/library.css"));

  const artifactDrafts = [];
  if (edition === "all" || edition === "library") {
    for (const page of pages) {
      await writeFile(path.join(outDir, pageHref(page)), renderPage(page));
    }
    for (const section of sections) {
      await writeFile(path.join(outDir, "sections", `${section.id}.html`), renderSection(section));
    }
    await writeFile(path.join(outDir, "search-index.json"), `${JSON.stringify(pages.map((page) => ({
      id: page.id,
      title: page.title,
      section: page.section,
      url: pageHref(page),
      canonicalUrl: page.canonicalUrl,
      sourcePath: page.sourcePath,
      headings: page.headings,
    })), null, 2)}\n`);
    await writeFile(path.join(outDir, "print.html"), renderPrintHtml(pages, sections, buildDate));
    artifactDrafts.push({ type: "html-library", label: "Full HTML library", path: "index.html", public: false });
    artifactDrafts.push({ type: "print-html", label: "Print-ready HTML", path: "print.html", public: true });
    artifactDrafts.push({ type: "search-index", label: "Search index JSON", path: "search-index.json", public: false });
  }
  if (edition === "all" || edition === "company") {
    await writeFile(path.join(outDir, "company.html"), renderCompany(pages, buildDate));
    artifactDrafts.push({ type: "html", edition: "company", label: "Company narrative HTML", path: "company.html", public: true });
  }

  const companyPages = COMPANY_ORDER
    .map((sourcePath) => pages.find((page) => page.sourcePath === sourcePath))
    .filter(Boolean);
  const sectionVolumes = sections.filter((section) => section.pages.length > 0);
  const companyEpub = `downloads/posthog-company-handbook-${buildDate}.epub`;
  const libraryEpub = `downloads/posthog-handbook-library-${buildDate}.epub`;
  await writeEpub({
    pages: companyPages,
    outputPath: path.join(outDir, companyEpub),
    title: "PostHog Company Handbook",
    subtitle: "Company narrative edition",
    buildDate,
  });
  await writeEpub({
    pages,
    outputPath: path.join(outDir, libraryEpub),
    title: "PostHog Handbook Library",
    subtitle: "Complete generated edition",
    buildDate,
  });
  artifactDrafts.push({ type: "epub", edition: "company", label: "Company narrative EPUB", path: companyEpub, public: true });
  artifactDrafts.push({ type: "epub", edition: "library", label: "Complete library EPUB", path: libraryEpub, public: true });

  for (const section of sectionVolumes) {
    const sectionPath = `downloads/posthog-handbook-${section.id}-${buildDate}.epub`;
    await writeEpub({
      pages: section.pages,
      outputPath: path.join(outDir, sectionPath),
      title: `PostHog Handbook: ${section.title}`,
      subtitle: `${section.title} section volume`,
      buildDate,
    });
    artifactDrafts.push({ type: "epub", edition: "section", section: section.id, label: `${section.title} EPUB`, path: sectionPath, public: true });
  }

  const artifactsBeforeDigest = [];
  for (const artifact of artifactDrafts) {
    if (await exists(path.join(outDir, artifact.path))) {
      artifactsBeforeDigest.push(await artifactMetadata(outDir, artifact));
    }
  }
  let manifest = manifestFor({ pages, sections, buildDate, artifacts: artifactsBeforeDigest });
  const previous = args["previous-manifest"]
    ? JSON.parse(await readFile(args["previous-manifest"], "utf8"))
    : null;
  const diff = previous
    ? compareManifests(previous, manifest)
    : { added: pages, removed: [], moved: [], changed: [], metadataOnly: [] };
  const digest = renderChangeMarkdown(diff, manifest, previous);
  await writeFile(path.join(outDir, "changes.md"), digest);
  await writeFile(path.join(outDir, "changes.html"), htmlShell("PostHog Handbook Changes", `<main class="site-shell reader">${markdownToHtml(digest)}</main>`));
  await writeFile(path.join(outDir, "changes.json"), `${JSON.stringify(serializeDiff(diff), null, 2)}\n`);
  artifactDrafts.push({ type: "changes", label: "Change digest Markdown", path: "changes.md", public: true });
  artifactDrafts.push({ type: "changes-json", label: "Change digest JSON", path: "changes.json", public: false });

  const htmlArchive = `downloads/posthog-handbook-library-${buildDate}.html.zip`;
  artifactDrafts.push({ type: "html-archive", label: "Complete HTML library ZIP", path: htmlArchive, public: true });
  await writeFile(path.join(outDir, "index.html"), renderIndex({
    pages,
    sections,
    buildDate,
    manifestPath: "manifest.json",
    artifacts: artifactDrafts,
  }));
  await writeFile(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeDirectoryArchive({
    sourceDir: outDir,
    outputPath: path.join(outDir, htmlArchive),
    prefix: `posthog-handbook-library-${buildDate}`,
  });

  const artifacts = [];
  for (const artifact of artifactDrafts) {
    artifacts.push(await artifactMetadata(outDir, artifact));
  }
  manifest = manifestFor({ pages, sections, buildDate, artifacts });
  await writeFile(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  const latestDir = path.join(outRoot, "latest");
  await rm(latestDir, { recursive: true, force: true });
  await cp(outDir, latestDir, { recursive: true, force: true });
  console.log(`Built ${outDir}`);
  console.log(`Built ${latestDir}`);
  console.log(`Pages: ${pages.length}`);
  console.log(`Artifacts: ${artifacts.length}`);
}

async function commandDiff(args) {
  if (!args.previous || !args.current) {
    throw new Error("diff requires --previous and --current manifest paths.");
  }
  const previous = JSON.parse(await readFile(args.previous, "utf8"));
  const current = JSON.parse(await readFile(args.current, "utf8"));
  const diff = compareManifests(previous, current);
  const markdown = renderChangeMarkdown(diff, current, previous);
  if (args.out) {
    await ensureDir(path.dirname(args.out));
    await writeFile(args.out, markdown);
  } else {
    console.log(markdown);
  }
}

async function commandValidate(args) {
  const dist = args.dist || "dist/latest";
  const manifestPath = path.join(dist, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const failures = [];
  const required = ["index.html", "company.html", "print.html", "manifest.json", "changes.md", "changes.json", "search-index.json", "assets/library.css"];
  for (const file of required) {
    const target = path.join(dist, file);
    if (!(await exists(target))) failures.push(`Missing ${file}`);
  }
  for (const page of manifest.pages) {
    if (!(await exists(path.join(dist, pageHref(page))))) {
      failures.push(`Missing page HTML for ${page.sourcePath}`);
    }
  }
  const pageFiles = await collectFiles(path.join(dist, "pages"));
  if (pageFiles.length !== manifest.pages.length) {
    failures.push(`Generated page file count ${pageFiles.length} does not match manifest pages length ${manifest.pages.length}`);
  }
  if (manifest.pageCount !== manifest.pages.length) {
    failures.push(`Manifest pageCount ${manifest.pageCount} does not match pages length ${manifest.pages.length}`);
  }
  for (const artifact of manifest.artifacts || []) {
    const target = path.join(dist, artifact.path);
    if (!(await exists(target))) {
      failures.push(`Missing artifact ${artifact.path}`);
      continue;
    }
    if (artifact.contentHash && artifact.contentHash !== await fileHash(target)) {
      failures.push(`Artifact hash mismatch for ${artifact.path}`);
    }
    if (artifact.path.endsWith(".epub")) {
      const data = await readFile(target);
      if (data.slice(0, 4).toString("binary") !== "PK\u0003\u0004") {
        failures.push(`EPUB does not start with a ZIP local header: ${artifact.path}`);
      }
      const mimetype = data.slice(30, 30 + "mimetype".length).toString("utf8");
      const value = data.slice(30 + "mimetype".length, 30 + "mimetype".length + "application/epub+zip".length).toString("utf8");
      if (mimetype !== "mimetype" || value !== "application/epub+zip") {
        failures.push(`EPUB mimetype is not first and uncompressed: ${artifact.path}`);
      }
    }
  }
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
    return;
  }
  console.log(`Validated ${dist}: ${manifest.pageCount} pages, ${manifest.sectionCount} sections.`);
}

async function commandServe(args) {
  const dist = args.dist || "dist/latest";
  const port = Number(args.port || 4173);
  const server = createServer(async (request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url, `http://localhost:${port}`).pathname);
    const filePath = path.join(dist, requestPath === "/" ? "index.html" : requestPath);
    try {
      const body = await readFile(filePath);
      const ext = path.extname(filePath);
      const type = ext === ".html" ? "text/html; charset=utf-8" : ext === ".css" ? "text/css; charset=utf-8" : "application/octet-stream";
      response.writeHead(200, { "content-type": type });
      response.end(body);
    } catch {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
    }
  });
  server.listen(port, () => {
    console.log(`Serving ${dist} at http://127.0.0.1:${port}`);
  });
}

function printHelp() {
  console.log(`PostHog Handbook Library

Commands:
  discover                         Discover handbook source pages
  build --edition all              Build generated reader artifacts
  diff --previous <p> --current <p> Compare two manifests
  validate --dist <path>           Validate generated artifacts
  serve --dist <path>              Serve generated artifacts locally

Options:
  --limit <n>                      Limit live pages for smoke builds
  --out-dir <path>                 Output directory, default dist
`);
}

async function main() {
  const { command, args } = parseArgs(process.argv.slice(2));
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }
  if (command === "discover") return commandDiscover(args);
  if (command === "build") return commandBuild(args);
  if (command === "diff") return commandDiff(args);
  if (command === "validate") return commandValidate(args);
  if (command === "serve") return commandServe(args);
  throw new Error(`Unknown command: ${command}`);
}

export {
  buildZip,
  canonicalPath,
  compareManifests,
  markdownToHtml,
  sectionFor,
  serializeDiff,
};

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
