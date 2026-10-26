// Builds the documentation site (NFR-8.1) from docs/guide/*.md into docs/dist: one static HTML page
// per guide, no client-side JavaScript. Styling follows docs/design/design-dna.md, tuned for reading.
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';

const root = path.dirname(fileURLToPath(import.meta.url));
const guideDir = path.join(root, 'guide');
const out = path.join(root, 'dist');
const pkg = JSON.parse(await readFile(path.join(root, '..', 'package.json'), 'utf8'));

function frontmatter(source) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(source);
  if (!match) return { data: {}, body: source };
  const data = Object.fromEntries(
    match[1].split('\n').map((line) => {
      const index = line.indexOf(':');
      const value = line.slice(index + 1).trim();
      return [line.slice(0, index).trim(), /^\d+$/.test(value) ? Number(value) : value];
    }),
  );
  return { data, body: source.slice(match[0].length) };
}

const slug = (text) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');

const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function render(markdown) {
  const headings = [];
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        const id = slug(html);
        if (depth === 2) headings.push({ id, html });
        if (depth === 1) return `<h1>${html}</h1>\n`;
        return `<h${depth} id="${id}"><a class="anchor" href="#${id}">${html}</a></h${depth}>\n`;
      },
      code({ text }) {
        return `<pre tabindex="0"><code>${escape(text)}</code></pre>\n`;
      },
      table(token) {
        // Wide tables scroll inside their own box instead of the page.
        const header = token.header.map((cell) => `<th scope="col">${this.parser.parseInline(cell.tokens)}</th>`).join('');
        const rows = token.rows
          .map((row) => `<tr>${row.map((cell) => `<td>${this.parser.parseInline(cell.tokens)}</td>`).join('')}</tr>`)
          .join('\n');
        return `<div class="table" tabindex="0"><table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table></div>\n`;
      },
    },
  });
  return { html: marked.parse(markdown), headings };
}

const CSS = `
:root {
  --font: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
  color-scheme: light;
  --bg: #ffffff; --surface: #f5f6f7; --surface-2: #eef0f2; --border: #d8dce1;
  --text: #1b1e23; --text-2: #565d66; --ink: #1b1e23; --focus: #1b1e23;
  --server: #6a3eb3; --client: #0a746f;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    color-scheme: dark;
    --bg: #111316; --surface: #181b1f; --surface-2: #21252a; --border: #2f343b;
    --text: #e6e8eb; --text-2: #a2a9b2; --ink: #e6e8eb; --focus: #e6e8eb;
    --server: #b89df0; --client: #4fc6bc;
  }
}
:root[data-theme='dark'] {
  color-scheme: dark;
  --bg: #111316; --surface: #181b1f; --surface-2: #21252a; --border: #2f343b;
  --text: #e6e8eb; --text-2: #a2a9b2; --ink: #e6e8eb; --focus: #e6e8eb;
  --server: #b89df0; --client: #4fc6bc;
}
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.6 var(--font); -webkit-font-smoothing: antialiased; }
a { color: inherit; text-decoration-thickness: 1px; text-underline-offset: 2px; }
a:hover { text-decoration-thickness: 2px; }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.skip { position: absolute; left: -9999px; }
.skip:focus { left: 16px; top: 8px; background: var(--bg); padding: 4px 8px; z-index: 2; }
.layout { display: grid; grid-template-columns: 248px minmax(0, 1fr); min-height: 100vh; }
nav.site { border-right: 1px solid var(--border); background: var(--surface); padding: 20px 16px; position: sticky; top: 0; height: 100vh; overflow: auto; }
.brand { display: flex; align-items: baseline; gap: 8px; font-weight: 600; text-decoration: none; margin-bottom: 20px; }
.brand .mark { display: inline-flex; gap: 2px; }
.brand .mark span { font: 600 11px/1 var(--mono); padding: 3px 4px; border-radius: 2px; color: var(--bg); }
.brand .mark .s { background: var(--server); }
.brand .mark .c { background: var(--client); }
.version { color: var(--text-2); font: 12px var(--mono); }
nav.site ol { list-style: none; margin: 0; padding: 0; }
nav.site li a { display: block; padding: 4px 8px; border-radius: 4px; text-decoration: none; color: var(--text-2); }
nav.site li a:hover { color: var(--text); background: var(--surface-2); }
nav.site li a[aria-current='page'] { color: var(--text); background: var(--surface-2); font-weight: 600; box-shadow: inset 2px 0 0 var(--ink); }
main { padding: 40px 48px 96px; max-width: 860px; }
article { max-width: 72ch; }
h1 { font-size: 30px; line-height: 1.2; letter-spacing: -0.01em; margin: 0 0 16px; }
h2 { font-size: 21px; line-height: 1.3; margin: 48px 0 12px; padding-top: 16px; border-top: 1px solid var(--border); }
h3 { font-size: 16px; margin: 32px 0 8px; }
h2 .anchor, h3 .anchor { text-decoration: none; }
h2 .anchor:hover::after, h3 .anchor:hover::after { content: ' #'; color: var(--text-2); }
p, ul, ol { margin: 0 0 14px; }
li { margin: 4px 0; }
code { font: 13px var(--mono); background: var(--surface-2); padding: 1px 4px; border-radius: 3px; }
h2 code, h3 code { font-size: 0.85em; }
pre { margin: 0 0 18px; padding: 14px 16px; overflow: auto; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; }
pre code { background: none; padding: 0; font-size: 13px; line-height: 1.55; font-variant-numeric: tabular-nums; }
.table { overflow-x: auto; margin: 0 0 18px; border: 1px solid var(--border); border-radius: 4px; }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th, td { text-align: left; vertical-align: top; padding: 7px 12px; border-bottom: 1px solid var(--border); }
th { background: var(--surface); font-weight: 600; }
tr:last-child td { border-bottom: 0; }
.pager { display: flex; justify-content: space-between; gap: 16px; margin-top: 56px; padding-top: 16px; border-top: 1px solid var(--border); }
.pager a { text-decoration: none; display: flex; flex-direction: column; }
.pager small { color: var(--text-2); }
.pager .next { text-align: right; margin-left: auto; }
.toc { font-size: 13px; color: var(--text-2); margin: 0 0 24px; }
.toc a { color: var(--text-2); }
@media (max-width: 820px) {
  .layout { display: block; }
  nav.site { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--border); padding: 16px; }
  nav.site ol { display: flex; gap: 4px; overflow-x: auto; margin: 0 -16px; padding: 0 16px 4px; }
  nav.site li a { white-space: nowrap; }
  .brand { margin-bottom: 12px; }
  main { padding: 24px 16px 64px; }
  h1 { font-size: 26px; }
}
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
`;

const files = (await readdir(guideDir)).filter((file) => file.endsWith('.md'));
const pages = [];
for (const file of files) {
  const { data, body } = frontmatter(await readFile(path.join(guideDir, file), 'utf8'));
  const name = file.replace(/\.md$/, '');
  pages.push({ name, href: `${name}.html`, title: data.title ?? name, order: data.order ?? 99, body });
}
pages.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await writeFile(path.join(out, 'style.css'), CSS.trim() + '\n');

for (const [index, page] of pages.entries()) {
  const { html, headings } = render(page.body);
  const previous = pages[index - 1];
  const next = pages[index + 1];
  const nav = pages.map((p) => `<li><a href="${p.href}"${p === page ? ' aria-current="page"' : ''}>${escape(p.title)}</a></li>`).join('');
  const toc =
    headings.length > 2 ? `<p class="toc">On this page: ${headings.map((h) => `<a href="#${h.id}">${h.html}</a>`).join(' · ')}</p>` : '';
  const body = html.replace(/(<\/h1>\n)/, `$1${toc}`);
  const document = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(page.title)} · RSC Stories</title>
<meta name="description" content="RSC Stories documentation: ${escape(page.title)}.">
<link rel="stylesheet" href="style.css">
</head>
<body>
<a class="skip" href="#content">Skip to content</a>
<div class="layout">
<nav class="site" aria-label="Documentation">
<a class="brand" href="index.html"><span class="mark" aria-hidden="true"><span class="s">S</span><span class="c">C</span></span>RSC Stories <span class="version">${pkg.version}</span></a>
<ol>${nav}</ol>
</nav>
<main id="content">
<article>
${body}
</article>
<nav class="pager" aria-label="Pages">
${previous ? `<a href="${previous.href}"><small>Previous</small>${escape(previous.title)}</a>` : ''}
${next ? `<a class="next" href="${next.href}"><small>Next</small>${escape(next.title)}</a>` : ''}
</nav>
</main>
</div>
</body>
</html>
`;
  await writeFile(path.join(out, page.href), document);
}

// Every relative link and fragment must resolve: broken docs links fail the build.
const ids = new Map();
for (const page of pages) {
  const html = await readFile(path.join(out, page.href), 'utf8');
  ids.set(page.href, new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1])));
}
const broken = [];
for (const page of pages) {
  const html = await readFile(path.join(out, page.href), 'utf8');
  for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
    if (/^(https?:|mailto:)/.test(href) || href === 'style.css') continue;
    const [file, fragment] = href.split('#');
    const target = file || page.href;
    if (!ids.has(target)) broken.push(`${page.href}: ${href}`);
    else if (fragment && !ids.get(target).has(fragment)) broken.push(`${page.href}: ${href}`);
  }
}
if (broken.length) {
  console.error(`Broken links:\n  ${broken.join('\n  ')}`);
  process.exit(1);
}
console.log(`docs: ${pages.length} pages → ${path.relative(process.cwd(), out) || out}`);
