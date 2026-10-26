import { parseHTML } from 'linkedom';

type DomNode = {
  nodeType: number;
  nodeName: string;
  data?: string;
  textContent: string | null;
  parentNode: DomNode | null;
  nextSibling: DomNode | null;
  previousSibling: DomNode | null;
  childNodes: ArrayLike<DomNode>;
  attributes?: ArrayLike<{ name: string; value: string }>;
  removeChild(node: DomNode): void;
  insertBefore(node: DomNode, ref: DomNode | null): void;
  remove(): void;
};

const COMMENT = 8;
const TEXT = 3;
const ELEMENT = 1;

function children(node: DomNode): DomNode[] {
  return Array.from(node.childNodes);
}

/** Applies React's streaming instructions (`$RC`, `$RS`, `$RX`) to the parsed document. */
function applyStreaming(
  document: { getElementById(id: string): DomNode | null; querySelectorAll(s: string): ArrayLike<DomNode> },
  scripts: string[],
): void {
  const take = (id: string): DomNode[] => {
    const segment = document.getElementById(id);
    if (!segment) return [];
    const nodes = children(segment);
    segment.remove();
    return nodes;
  };
  for (const script of scripts) {
    for (const match of script.matchAll(/\$R([CSX])\("([^"]+)"(?:,"([^"]*)")?/g)) {
      const [, op, first, second] = match;
      if (op === 'S' && first && second) {
        // Segment completed: `$RS(segmentId, placeholderId)`.
        const placeholder = document.getElementById(second);
        if (!placeholder?.parentNode) continue;
        for (const node of take(first)) placeholder.parentNode.insertBefore(node, placeholder);
        placeholder.remove();
      } else if (op === 'C' && first && second) {
        // Boundary completed: `$RC(boundaryId, segmentId)` replaces the fallback.
        const template = document.getElementById(first);
        const start = template?.previousSibling;
        const parent = template?.parentNode;
        if (!template || !parent) continue;
        let node = template.nextSibling;
        while (node && !(node.nodeType === COMMENT && node.data === '/$')) {
          const next = node.nextSibling;
          parent.removeChild(node);
          node = next;
        }
        for (const child of take(second)) parent.insertBefore(child, node);
        template.remove();
        if (start && start.nodeType === COMMENT && start.data === '$?') start.data = '$';
      } else if (op === 'X' && first) {
        // Boundary errored on the server and will render on the client.
        const template = document.getElementById(first);
        const start = template?.previousSibling;
        if (start && start.nodeType === COMMENT) start.data = '$!';
        template?.remove();
      }
    }
  }
  // Segments never revealed (their boundary errored, or the stream stopped) stay hidden; development
  // builds stream more of them than production ones.
  for (const segment of Array.from(document.querySelectorAll('div[hidden][id^="S:"]'))) segment.remove();
}

/**
 * Applies React's streaming instructions to an HTML document and returns the outer HTML of every
 * element matching `selector` — the server HTML a browser would show before hydration.
 */
export function resolveStreamedHtml(html: string, selector: string): string[] {
  const { document } = parseHTML(html) as unknown as {
    document: {
      getElementById(id: string): DomNode | null;
      querySelectorAll(selector: string): ArrayLike<DomNode & { outerHTML: string }>;
    };
  };
  const scripts = Array.from(document.querySelectorAll('script')).map((script) => script.textContent ?? '');
  applyStreaming(document, scripts);
  return Array.from(document.querySelectorAll(selector)).map((element) => element.outerHTML);
}

/**
 * Reconstructs the final server HTML of the story (what the browser shows before hydration, once
 * every streamed Suspense boundary has been revealed) from the raw HTML response.
 */
export function serverStoryHtml(html: string): string | undefined {
  const { document } = parseHTML(html) as unknown as {
    document: {
      getElementById(id: string): DomNode | null;
      querySelectorAll(selector: string): ArrayLike<DomNode & { innerHTML: string }>;
      querySelector(selector: string): (DomNode & { innerHTML: string }) | null;
    };
  };
  const scripts = Array.from(document.querySelectorAll('script')).map((script) => script.textContent ?? '');
  applyStreaming(document, scripts);
  const root = document.querySelector('[data-rsc-stories-root]');
  return root ? root.innerHTML : undefined;
}

/** `max-width: 640px;` and `max-width:640px` are the same declaration; browsers re-serialize. */
function normalizeStyle(value: string): string {
  return value
    .split(';')
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .map((declaration) => {
      const [property = '', ...rest] = declaration.split(':');
      return `${property.trim().toLowerCase()}:${rest.join(':').trim()}`;
    })
    .join(';');
}

/** React-generated ids differ between renders (`«r0»`, `_R_1_`, `:R1:`); give them stable names. */
function normalizeIds(html: string): string {
  const seen = new Map<string, string>();
  return html.replace(/«[^»]+»|_R_[0-9a-zA-Z]+_|:R[0-9a-zA-Z]+:|:r[0-9a-zA-Z]+:|_r_[0-9a-zA-Z]+_/g, (id) => {
    if (!seen.has(id)) seen.set(id, `«id${seen.size}»`);
    return seen.get(id)!;
  });
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

/**
 * Deterministic, line-per-node HTML: comments dropped, whitespace collapsed, attributes sorted,
 * React ids normalized. Used for snapshots (FR-7.3) and hydration diffs (FR-5.7).
 */
export function normalizeHtml(html: string): string {
  const { document } = parseHTML(`<!doctype html><html><body><div id="__root">${html}</div></body></html>`) as unknown as {
    document: { getElementById(id: string): DomNode | null };
  };
  const root = document.getElementById('__root');
  if (!root) return '';
  const lines: string[] = [];
  const emit = (node: DomNode, depth: number) => {
    const indent = '  '.repeat(depth);
    if (node.nodeType === TEXT) {
      const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (text) lines.push(indent + escapeText(text));
      return;
    }
    if (node.nodeType !== ELEMENT) return;
    const tag = node.nodeName.toLowerCase();
    if (tag === 'script' || tag === 'template') return;
    const attrs = Array.from(node.attributes ?? [])
      .map((attr) => ({
        name: attr.name.toLowerCase(),
        value: attr.name.toLowerCase() === 'style' ? normalizeStyle(attr.value) : attr.value,
      }))
      // Empty style/class attributes are serialization noise, not rendered differences.
      .filter((attr) => !((attr.name === 'style' || attr.name === 'class') && attr.value.trim() === ''))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((attr) => (attr.value === '' ? attr.name : `${attr.name}="${escapeAttr(attr.value.replace(/\s+/g, ' ').trim())}"`));
    const open = `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>`;
    if (VOID.has(tag)) {
      lines.push(indent + open);
      return;
    }
    // React separates adjacent text with `<!-- -->`; merge the runs so text reads as rendered.
    const kids: Array<DomNode | string> = [];
    for (const child of children(node)) {
      if (child.nodeType === TEXT) {
        const last = kids[kids.length - 1];
        if (typeof last === 'string') kids[kids.length - 1] = last + (child.textContent ?? '');
        else kids.push(child.textContent ?? '');
      } else if (child.nodeType === ELEMENT) {
        kids.push(child);
      }
    }
    const content = kids.map((kid) => (typeof kid === 'string' ? kid.replace(/\s+/g, ' ').trim() : kid)).filter((kid) => kid !== '');
    if (content.length === 0) {
      lines.push(`${indent}${open}</${tag}>`);
    } else if (content.length === 1 && typeof content[0] === 'string') {
      lines.push(`${indent}${open}${escapeText(content[0])}</${tag}>`);
    } else {
      lines.push(indent + open);
      for (const kid of content) {
        if (typeof kid === 'string') lines.push(`${indent}  ${escapeText(kid)}`);
        else emit(kid, depth + 1);
      }
      lines.push(`${indent}</${tag}>`);
    }
  };
  for (const child of children(root)) {
    if (child.nodeType === TEXT) {
      const text = (child.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (text) lines.push(escapeText(text));
    } else emit(child, 0);
  }
  // Server Action ids and the action encryption key change with every build.
  return normalizeGeneratedNames(normalizeIds(lines.join('\n')))
    .replace(/\$ACTION_ID_[0-9a-f]+/g, '$ACTION_ID_<id>')
    .replace(/(&quot;id&quot;:&quot;)[0-9a-f]{20,}(&quot;)/g, '$1<action-id>$2')
    .replace(/(name="\$ACTION_KEY" type="hidden" value=")k[0-9a-f]+"/g, '$1<action-key>"');
}

/**
 * next/font class names are hashed differently by Turbopack (`h1XLeG_variable` in production builds,
 * `inter_8a594245-module__h1XLeG__variable` in development) and webpack (`__variable_d8ebd1`); all
 * become `<font-variable>` / `<font-className>`.
 */
export function normalizeGeneratedNames(text: string): string {
  return text.replace(
    /\b(?:[\w-]+-module__[A-Za-z0-9]{6}__(variable|className)|__(variable|className)_[0-9a-f]{6}|[A-Za-z0-9]{6}_(variable|className))\b/g,
    (_match, dev: string | undefined, webpack: string | undefined, turbopack: string | undefined) =>
      `<font-${dev ?? webpack ?? turbopack}>`,
  );
}

/** One line of a diff. */
export interface DiffLine {
  op: ' ' | '+' | '-';
  text: string;
}

/** Myers line diff. `-` lines exist only in `a` (server), `+` only in `b` (client). */
export function diffLines(a: string, b: string): DiffLine[] {
  const x = a ? a.split('\n') : [];
  const y = b ? b.split('\n') : [];
  const n = x.length;
  const m = y.length;
  const max = n + m;
  const v = new Map<number, number>([[1, 0]]);
  const trace: Array<Map<number, number>> = [];
  outer: for (let d = 0; d <= max; d++) {
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      let i = k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1)) ? (v.get(k + 1) ?? 0) : (v.get(k - 1) ?? 0) + 1;
      let j = i - k;
      while (i < n && j < m && x[i] === y[j]) {
        i++;
        j++;
      }
      v.set(k, i);
      if (i >= n && j >= m) break outer;
    }
  }
  const out: DiffLine[] = [];
  let i = n;
  let j = m;
  for (let d = trace.length - 1; d >= 0 && (i > 0 || j > 0); d--) {
    const vd = trace[d]!;
    const k = i - j;
    const prevK = k === -d || (k !== d && (vd.get(k - 1) ?? -1) < (vd.get(k + 1) ?? -1)) ? k + 1 : k - 1;
    const prevI = vd.get(prevK) ?? 0;
    const prevJ = prevI - prevK;
    while (i > prevI && j > prevJ) {
      out.push({ op: ' ', text: x[--i]! });
      j--;
    }
    if (d > 0) {
      if (i === prevI) out.push({ op: '+', text: y[--j]! });
      else out.push({ op: '-', text: x[--i]! });
    }
  }
  return out.reverse();
}
