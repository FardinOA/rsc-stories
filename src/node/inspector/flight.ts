/** One row of a React Flight (RSC) payload. */
export interface FlightRow {
  /** Hex row id; empty for global rows such as the time origin (`:N…`) or console replays. */
  id: string;
  /** Row tag (`I`, `D`, `E`, `T`, …) or `''` for a JSON model row. */
  tag: string;
  /** Row data as text (binary rows are base64). */
  text: string;
  /** Parsed JSON for model and JSON-carrying tagged rows. */
  value?: unknown;
  /** Size of the row on the wire, including id, tag and newline. */
  bytes: number;
  /** Byte offset in the payload, for the raw viewer. */
  offset: number;
}

/** Tags whose data is `<hex length>,<bytes>` instead of a newline-terminated line. */
const LENGTH_PREFIXED = new Set(['T', 'A', 'O', 'o', 'U', 'S', 's', 'L', 'l', 'G', 'g', 'M', 'm', 'V', 'b']);
/** Single-letter tags that start newline-terminated rows (`n`/`t`/`f` would be JSON literals). */
const LINE_TAGS = new Set(['I', 'H', 'E', 'D', 'W', 'N', 'J', 'P', 'R', 'r', 'X', 'x', 'C', 'K', 'Y', 'Z']);
const JSON_TAGS = new Set(['', 'I', 'H', 'E', 'D', 'W', 'J', 'P', 'K']);

const decoder = new TextDecoder();

/** Parses a Flight payload. Never throws: malformed rows become unparsed text rows. */
export function parseFlight(input: string | Uint8Array): FlightRow[] {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const rows: FlightRow[] = [];
  let pos = 0;
  while (pos < bytes.length) {
    // Length-prefixed rows end without a newline; tolerate separators anyway.
    while (bytes[pos] === 0x0a) pos++;
    if (pos >= bytes.length) break;
    const start = pos;
    // Row id: hex digits up to ':'.
    let colon = pos;
    while (colon < bytes.length && bytes[colon] !== 0x3a /* : */ && bytes[colon] !== 0x0a) colon++;
    if (colon >= bytes.length || bytes[colon] !== 0x3a) {
      // Trailing garbage or a partial row; keep it so byte totals stay honest.
      const text = decoder.decode(bytes.subarray(pos));
      if (text.trim()) rows.push({ id: '', tag: '?', text, bytes: bytes.length - pos, offset: start });
      break;
    }
    const id = decoder.decode(bytes.subarray(pos, colon));
    pos = colon + 1;
    const tagChar = String.fromCharCode(bytes[pos] ?? 0);
    if (LENGTH_PREFIXED.has(tagChar)) {
      let comma = pos + 1;
      while (comma < bytes.length && bytes[comma] !== 0x2c /* , */) comma++;
      const length = Number.parseInt(decoder.decode(bytes.subarray(pos + 1, comma)), 16);
      const dataStart = comma + 1;
      const dataEnd = Math.min(bytes.length, dataStart + (Number.isFinite(length) ? length : 0));
      const data = bytes.subarray(dataStart, dataEnd);
      rows.push({
        id,
        tag: tagChar,
        text: tagChar === 'T' ? decoder.decode(data) : Buffer.from(data).toString('base64'),
        bytes: dataEnd - start,
        offset: start,
      });
      pos = dataEnd;
      continue;
    }
    let end = pos;
    while (end < bytes.length && bytes[end] !== 0x0a) end++;
    let line = decoder.decode(bytes.subarray(pos, end));
    let tag = '';
    if (line.length > 0 && LINE_TAGS.has(line[0]!)) {
      tag = line[0]!;
      line = line.slice(1);
    }
    const row: FlightRow = { id, tag, text: line, bytes: end + 1 - start, offset: start };
    if (JSON_TAGS.has(tag) && line.length > 0) {
      try {
        row.value = JSON.parse(line) as unknown;
      } catch {
        // Unparseable rows are kept as text.
      }
    } else if (tag === 'N') {
      row.value = Number.parseFloat(line);
    }
    rows.push(row);
    pos = end + 1;
  }
  return rows;
}

/** A client reference (`I` row): module, chunks, export. */
export interface ClientReference {
  rowId: string;
  moduleId: string;
  chunks: string[];
  exportName: string;
  async: boolean;
}

/** Indexed payload with reference resolution. */
export class FlightPayload {
  readonly rows: FlightRow[];
  readonly totalBytes: number;
  /** Last model/value row per id (debug rows are kept separately). */
  readonly models = new Map<string, FlightRow>();
  readonly debug = new Map<string, FlightRow[]>();
  readonly imports = new Map<string, FlightRow>();
  readonly errors = new Map<string, FlightRow>();
  readonly texts = new Map<string, FlightRow>();
  readonly other: FlightRow[] = [];
  timeOrigin?: number;

  constructor(input: string | Uint8Array) {
    this.rows = parseFlight(input);
    this.totalBytes = this.rows.reduce((sum, row) => sum + row.bytes, 0);
    for (const row of this.rows) {
      switch (row.tag) {
        case '':
          this.models.set(row.id, row);
          break;
        case 'D': {
          const list = this.debug.get(row.id) ?? [];
          list.push(row);
          this.debug.set(row.id, list);
          break;
        }
        case 'I':
          this.imports.set(row.id, row);
          break;
        case 'E':
          this.errors.set(row.id, row);
          break;
        case 'T':
          this.texts.set(row.id, row);
          break;
        case 'N':
          if (typeof row.value === 'number') this.timeOrigin = row.value;
          break;
        default:
          this.other.push(row);
      }
    }
  }

  /** Row id referenced by a `$…` string, or undefined for literals and symbols. */
  static refId(value: unknown): string | undefined {
    if (typeof value !== 'string' || value[0] !== '$' || value.length < 2) return undefined;
    const code = value[1]!;
    if (/[0-9a-f]/.test(code)) return value.slice(1);
    if ('L@QWBKFhTRrXxYZ'.includes(code) && /^[0-9a-f]+$/.test(value.slice(2))) return value.slice(2);
    return undefined;
  }

  /** Follows plain `$<id>` references to a model value (one hop at a time, cycle-safe). */
  deref(value: unknown, depth = 0): unknown {
    if (depth > 20) return value;
    if (typeof value === 'string' && /^\$[0-9a-f]+$/.test(value)) {
      const id = value.slice(1);
      const model = this.models.get(id);
      if (model) return this.deref(model.value, depth + 1);
      const text = this.texts.get(id);
      if (text) return text.text;
    }
    return value;
  }

  /** The client reference an element type points at, if any. */
  clientReference(type: unknown): ClientReference | undefined {
    const id = FlightPayload.refId(type);
    if (!id) return undefined;
    const row = this.imports.get(id);
    if (!row || !Array.isArray(row.value)) return undefined;
    const [moduleId, chunks, exportName, async] = row.value as [unknown, unknown, unknown, unknown];
    const asString = (v: unknown) => {
      const resolved = this.deref(v);
      return typeof resolved === 'string' ? resolved : String(resolved ?? '');
    };
    const chunkList = Array.isArray(chunks) ? chunks.map(asString) : [];
    return {
      rowId: id,
      moduleId: asString(moduleId),
      chunks: chunkList,
      exportName: asString(exportName) || 'default',
      async: async === 1 || async === true,
    };
  }

  /** Server component infos (`{ name, env, … }`) attached to a chunk by its `D` rows, outer first. */
  componentsOf(chunkId: string): ComponentInfo[] {
    const out: ComponentInfo[] = [];
    for (const row of this.debug.get(chunkId) ?? []) {
      const info = this.deref(row.value);
      if (isComponentInfo(info)) out.push(info);
    }
    return out;
  }

  /** `D{"time":…}` markers of a chunk, relative to the time origin. */
  timesOf(chunkId: string): number[] {
    const out: number[] = [];
    for (const row of this.debug.get(chunkId) ?? []) {
      const value = row.value as { time?: unknown } | undefined;
      if (value && typeof value.time === 'number') out.push(value.time);
    }
    return out;
  }

  /** I/O spans (`J` rows) recorded in development builds. */
  ioSpans(): Array<{ name: string; start: number; end: number; owner?: string }> {
    const spans: Array<{ name: string; start: number; end: number; owner?: string }> = [];
    for (const row of this.other) {
      if (row.tag !== 'J') continue;
      const value = row.value as { name?: unknown; start?: unknown; end?: unknown; owner?: unknown } | undefined;
      if (!value || typeof value.start !== 'number' || typeof value.end !== 'number') continue;
      const owner = this.deref(value.owner);
      // React names a span after the awaited call's frame; a mock's proxy frame (`Object.apply`) says nothing.
      const named = typeof value.name === 'string' && !/^(?:\w+\.)?(?:apply|call|construct)$/.test(value.name);
      spans.push({
        name: named ? (value.name as string) : 'await',
        start: value.start,
        end: value.end,
        ...(isComponentInfo(owner) ? { owner: owner.name } : {}),
      });
    }
    return spans;
  }
}

/** Debug info React emits for a Server Component in development. */
export interface ComponentInfo {
  name: string;
  env: string;
  key?: string | null;
  owner?: unknown;
  props?: Record<string, unknown>;
}

export function isComponentInfo(value: unknown): value is ComponentInfo {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as ComponentInfo).name === 'string' &&
    typeof (value as ComponentInfo).env === 'string' &&
    !('awaited' in value)
  );
}

/** Parses Next's inline payload (`self.__next_f.push([1,"…"])`) out of an HTML document. */
export function extractInlineFlight(html: string): Uint8Array {
  const parts: Uint8Array[] = [];
  const encoder = new TextEncoder();
  const pattern = /self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g;
  for (const match of html.matchAll(pattern)) {
    try {
      const [kind, data] = JSON.parse(match[1]!) as [number, string?];
      if (kind === 1 && typeof data === 'string') parts.push(encoder.encode(data));
      else if (kind === 3 && typeof data === 'string') parts.push(Uint8Array.from(Buffer.from(data, 'base64')));
    } catch {
      // A script that is not a payload push.
    }
  }
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Makes Flight-encoded values readable: `$undefined`, `$D…`, `$h…` and friends. */
export function decodeForDisplay(payload: FlightPayload, value: unknown, depth = 0): unknown {
  if (depth > 12) return '…';
  if (typeof value === 'string') {
    if (value[0] !== '$' || value.length < 2) return value;
    if (value === '$undefined' || value === '$u') return '[undefined]';
    if (value.startsWith('$$')) return value.slice(1);
    if (value.startsWith('$D')) return `[Date ${value.slice(2)}]`;
    if (value.startsWith('$n')) return `${value.slice(2)}n`;
    if (value === '$NaN') return 'NaN';
    if (value === '$Infinity' || value === '$I') return 'Infinity';
    if (value === '$-Infinity' || value === '$-I') return '-Infinity';
    if (value === '$-0') return -0;
    if (value.startsWith('$S')) return `[Symbol ${value.slice(2)}]`;
    if (value.startsWith('$E')) return '[ƒ (dev source)]';
    if (value.startsWith('$h') || value.startsWith('$F')) {
      const ref = payload.deref(`$${value.slice(2)}`) as { name?: string } | undefined;
      return `[Server Action ${ref?.name ?? value.slice(2)}]`;
    }
    if (value.startsWith('$L')) {
      const client = payload.clientReference(value);
      return client ? `[Client ${client.exportName}]` : '[Lazy element]';
    }
    if (value.startsWith('$@')) return '[Promise]';
    if (value.startsWith('$Q')) return { '[Map]': decodeForDisplay(payload, payload.deref(`$${value.slice(2)}`), depth + 1) };
    if (value.startsWith('$W')) return { '[Set]': decodeForDisplay(payload, payload.deref(`$${value.slice(2)}`), depth + 1) };
    if (value.startsWith('$K')) return '[FormData]';
    if (value.startsWith('$B')) return '[Blob]';
    if (value.startsWith('$T')) return '[Temporary reference]';
    if (value.startsWith('$Y')) return '[Omitted in dev]';
    if (/^\$[0-9a-f]+$/.test(value)) return decodeForDisplay(payload, payload.deref(value), depth + 1);
    return value;
  }
  if (Array.isArray(value)) {
    if (value[0] === '$' && value.length >= 4) {
      const type = value[1];
      const client = payload.clientReference(type);
      const name = typeof type === 'string' && type[0] !== '$' ? type : client ? client.exportName : 'Element';
      return `[<${name}>]`;
    }
    return value.map((item) => decodeForDisplay(payload, item, depth + 1));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decodeForDisplay(payload, item, depth + 1)]));
  }
  return value;
}
