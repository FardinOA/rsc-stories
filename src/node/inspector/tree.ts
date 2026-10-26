import { byteLength } from '../../shared/preview';
import { decodeForDisplay, FlightPayload, isComponentInfo, type ClientReference } from './flight';

/** A node of the inspector's component tree. */
export interface InspectorNode {
  kind: 'server' | 'client' | 'host' | 'suspense' | 'text' | 'pending' | 'error';
  name: string;
  /** Environment marking (FR-5.1); `shared` is filled in by module-graph analysis. */
  env?: 'server' | 'client' | 'shared';
  /** Readable props (Flight encoding decoded). */
  props?: unknown;
  /** For client nodes: serialized props size, excluding children. */
  propsBytes?: number;
  /** For client nodes: the module that ships to the browser. */
  module?: string;
  exportName?: string;
  key?: string | null;
  /** Server component that created this element (development payloads only). */
  owner?: string;
  /** Suspense: content still streaming when the payload ended. */
  pending?: boolean;
  fallback?: InspectorNode[];
  message?: string;
  children: InspectorNode[];
}

/** One server → client boundary (FR-5.2). */
export interface Boundary {
  /** Nearest server component (owner in development, nearest server ancestor otherwise). */
  from: string;
  to: string;
  module: string;
  exportName: string;
  propsBytes: number;
  /** Bytes per top-level prop. */
  propSizes: Record<string, number>;
  props: unknown;
  /** Filled in by the report from errors and arg checks. */
  nonSerializable: Array<{ prop: string; reason: string }>;
}

/** Internal wrapper components; collapsed out of the tree. */
const INTERNAL = /^RscStories/;
const HOST_SKIP_PROPS = new Set(['children']);

interface WalkContext {
  serverParent?: string;
  visited: Set<string>;
  boundaries: Boundary[];
  clientRefs: Map<string, ClientReference>;
  reachable: Set<string>;
}

function isElement(value: unknown): value is [string, unknown, unknown, unknown, ...unknown[]] {
  return Array.isArray(value) && value[0] === '$' && value.length >= 4;
}

/**
 * Size of a value as serialized, following outlined `$<id>` rows (deduped or large values React
 * moved into their own rows) so a prop's cost includes what it pulled in.
 */
function serializedSize(payload: FlightPayload, value: unknown, seen: Set<string>): number {
  let total = byteLength(JSON.stringify(value) ?? '');
  const visit = (v: unknown, depth: number) => {
    if (depth > 30) return;
    if (typeof v === 'string') {
      const id = FlightPayload.refId(v);
      if (id && !seen.has(id) && !v.startsWith('$L') && !v.startsWith('$h') && !v.startsWith('$F')) {
        const row = payload.models.get(id) ?? payload.texts.get(id);
        if (row) {
          seen.add(id);
          total += row.bytes;
          if (row.value !== undefined) visit(row.value, depth + 1);
        }
      }
      return;
    }
    if (Array.isArray(v)) {
      // Element owner/stack slots are debug-only; do not charge them to the prop.
      const items = isElement(v) ? v.slice(0, 4) : v;
      for (const item of items) visit(item, depth + 1);
      return;
    }
    if (v && typeof v === 'object') for (const item of Object.values(v)) visit(item, depth + 1);
  };
  visit(value, 0);
  return total;
}

function ownerName(payload: FlightPayload, element: unknown[]): string | undefined {
  const owner = payload.deref(element[4]);
  return isComponentInfo(owner) ? owner.name : undefined;
}

function hostProps(payload: FlightPayload, props: Record<string, unknown>): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (HOST_SKIP_PROPS.has(key)) continue;
    out[key] = decodeForDisplay(payload, value);
  }
  return Object.keys(out).length ? out : undefined;
}

function markReachable(ctx: WalkContext, value: unknown): void {
  const id = FlightPayload.refId(value);
  if (id) ctx.reachable.add(id);
}

function walk(payload: FlightPayload, value: unknown, ctx: WalkContext, depth = 0): InspectorNode[] {
  if (depth > 200 || value === null || value === undefined || typeof value === 'boolean') return [];
  if (typeof value === 'number') return [{ kind: 'text', name: String(value), children: [] }];
  if (typeof value === 'string') {
    if (value[0] !== '$') {
      return value.trim() ? [{ kind: 'text', name: value.length > 80 ? `${value.slice(0, 80)}…` : value, children: [] }] : [];
    }
    if (value.startsWith('$$')) return [{ kind: 'text', name: value.slice(1), children: [] }];
    const id = FlightPayload.refId(value);
    if (!id) return [];
    if (ctx.visited.has(id)) return [];
    markReachable(ctx, value);
    const error = payload.errors.get(id);
    if (error) {
      const info = error.value as { message?: string; digest?: string } | undefined;
      return [{ kind: 'error', name: 'Error', message: info?.message ?? info?.digest ?? 'Server error', children: [] }];
    }
    const text = payload.texts.get(id);
    if (text) return [{ kind: 'text', name: text.text.slice(0, 80), children: [] }];
    const model = payload.models.get(id);
    if (!model) {
      return payload.debug.has(id) ? [{ kind: 'pending', name: 'Pending (still streaming)', children: [] }] : [];
    }
    ctx.visited.add(id);
    // A lazy chunk: the output of one or more Server Components (development payloads).
    const components = payload.componentsOf(id);
    let parentName = ctx.serverParent;
    const chain: InspectorNode[] = [];
    for (const info of components) {
      if (INTERNAL.test(info.name)) continue;
      chain.push({
        kind: 'server',
        env: 'server',
        name: info.name,
        key: info.key ?? null,
        ...(info.props ? { props: decodeForDisplay(payload, info.props) } : {}),
        children: [],
      });
      parentName = info.name;
    }
    const inner = walk(payload, model.value, { ...ctx, serverParent: parentName }, depth + 1);
    ctx.visited.delete(id);
    if (chain.length === 0) return inner;
    for (let i = 0; i < chain.length - 1; i++) chain[i]!.children.push(chain[i + 1]!);
    chain[chain.length - 1]!.children.push(...inner);
    return [chain[0]!];
  }
  if (Array.isArray(value)) {
    if (!isElement(value)) return value.flatMap((item) => walk(payload, item, ctx, depth + 1));
    return [elementNode(payload, value, ctx, depth)];
  }
  return [];
}

function elementNode(payload: FlightPayload, element: unknown[], ctx: WalkContext, depth: number): InspectorNode {
  const [, rawType, key, rawProps] = element;
  const props = (payload.deref(rawProps) ?? {}) as Record<string, unknown>;
  markReachable(ctx, rawProps);
  const owner = ownerName(payload, element);
  const type = payload.deref(rawType);
  const children = () => walk(payload, props.children, ctx, depth + 1);

  if (typeof type === 'string' && type[0] !== '$') {
    return {
      kind: 'host',
      name: type,
      key: (key as string | null) ?? null,
      ...(owner ? { owner } : {}),
      ...(() => {
        const p = hostProps(payload, props);
        return p ? { props: p } : {};
      })(),
      children: children(),
    };
  }
  if (typeof type === 'string' && type.startsWith('$S')) {
    const symbol = type.slice(2);
    if (symbol === 'react.suspense') {
      const content = children();
      return {
        kind: 'suspense',
        name: 'Suspense',
        ...(owner ? { owner } : {}),
        pending: content.some((node) => node.kind === 'pending'),
        fallback: walk(payload, props.fallback, ctx, depth + 1),
        children: content,
      };
    }
    // Fragments, Activity, ViewTransition and friends: transparent.
    return { kind: 'host', name: symbol.replace(/^react\./, ''), children: children() };
  }
  const client = payload.clientReference(rawType);
  if (client) {
    markReachable(ctx, rawType);
    ctx.clientRefs.set(client.rowId, client);
    const { children: childProps, ...rest } = props;
    const seen = new Set<string>();
    const propSizes: Record<string, number> = {};
    for (const [name, value] of Object.entries(rest)) propSizes[name] = serializedSize(payload, value, seen);
    const propsBytes = Object.keys(rest).length ? serializedSize(payload, rest, new Set()) : 0;
    const decoded = decodeForDisplay(payload, rest);
    const from = owner ?? ctx.serverParent ?? '(story root)';
    ctx.boundaries.push({
      from,
      to: client.exportName,
      module: client.moduleId,
      exportName: client.exportName,
      propsBytes,
      propSizes,
      props: decoded,
      nonSerializable: [],
    });
    return {
      kind: 'client',
      env: 'client',
      name: client.exportName,
      module: client.moduleId,
      exportName: client.exportName,
      key: (key as string | null) ?? null,
      ...(owner ? { owner } : {}),
      props: decoded,
      propsBytes,
      // Children passed from the server are still server-rendered output.
      children: walk(payload, childProps, ctx, depth + 1),
    };
  }
  // A lazy or outlined element type (rare); walk into it.
  return { kind: 'host', name: 'Element', children: [...walk(payload, rawType, ctx, depth + 1), ...children()] };
}

/** Finds the element rendered by the workshop around a story (`data-rsc-stories-root`). */
export function findStoryRoot(payload: FlightPayload): unknown[] | undefined {
  let found: unknown[] | undefined;
  const seen = new Set<unknown>();
  const visit = (value: unknown, depth: number) => {
    if (found || depth > 400 || !value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (isElement(value)) {
      const props = payload.deref(value[3]) as Record<string, unknown> | undefined;
      if (props && typeof props === 'object' && 'data-rsc-stories-root' in props) {
        found = value;
        return;
      }
    }
    for (const item of Array.isArray(value) ? value : Object.values(value)) visit(item, depth + 1);
  };
  for (const row of payload.models.values()) {
    visit(row.value, 0);
    if (found) break;
  }
  return found;
}

/** The tree under the story root, every boundary, and the rows the story's subtree uses. */
export function buildTree(payload: FlightPayload): {
  root?: InspectorNode;
  boundaries: Boundary[];
  clientRefs: ClientReference[];
  /** Row ids reachable from the story root (for the story's share of the payload). */
  reachable: Set<string>;
  rootBytes: number;
} {
  const ctx: WalkContext = { visited: new Set(), boundaries: [], clientRefs: new Map(), reachable: new Set() };
  const element = findStoryRoot(payload);
  if (!element) return { boundaries: [], clientRefs: [], reachable: ctx.reachable, rootBytes: 0 };
  const props = (payload.deref(element[3]) ?? {}) as Record<string, unknown>;
  const children = walk(payload, props.children, ctx);
  return {
    root: { kind: 'host', name: 'story', children },
    boundaries: ctx.boundaries,
    clientRefs: [...ctx.clientRefs.values()],
    reachable: ctx.reachable,
    rootBytes: byteLength(JSON.stringify(element.slice(0, 4))),
  };
}

/** Story share of the payload: rows reachable from the root, excluding debug-only rows. */
export function storyPayloadBytes(payload: FlightPayload, reachable: Set<string>, rootBytes: number): number {
  let total = rootBytes;
  const seen = new Set<string>();
  const queue = [...reachable];
  while (queue.length) {
    const id = queue.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const row = payload.models.get(id) ?? payload.imports.get(id) ?? payload.texts.get(id) ?? payload.errors.get(id);
    if (!row) continue;
    total += row.bytes;
    const visit = (value: unknown, depth: number) => {
      if (depth > 50) return;
      if (typeof value === 'string') {
        const ref = FlightPayload.refId(value);
        if (ref && !seen.has(ref)) queue.push(ref);
      } else if (Array.isArray(value)) {
        for (const item of isElement(value) ? value.slice(0, 4) : value) visit(item, depth + 1);
      } else if (value && typeof value === 'object') {
        for (const item of Object.values(value)) visit(item, depth + 1);
      }
    };
    visit(row.value, 0);
  }
  return total;
}
