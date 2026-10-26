import path from 'node:path';
import type { LogEntry, MockCall, NavigationSignal, RenderMode, RenderWarning } from '../../shared/global';
import type { Budgets } from '../../types';
import type { RenderRecord } from '../server/records';
import { extractInlineFlight, FlightPayload, type ClientReference } from './flight';
import { normalizeHtml, serverStoryHtml } from './html';
import { findClientLeaks, locateModule, moduleFacts, type ClientLeak } from './modules';
import { attributeSizes, type ChunkSizer, type ClientComponentSize } from './sizes';
import { buildTree, storyPayloadBytes, type Boundary, type InspectorNode } from './tree';

/** A non-serializable prop at a boundary (FR-5.3). */
export interface NonSerializableProp {
  from: string;
  to: string;
  prop: string;
  reason: string;
  /** `arg-check` was caught before rendering; `react-error` came from React's serializer. */
  source: 'arg-check' | 'react-error';
  severity: 'error' | 'warning';
}

/** One bar on the timeline (FR-5.6); times in ms since the request started. */
export interface TimelineEntry {
  lane: 'data' | 'server' | 'io' | 'client';
  label: string;
  start: number;
  end: number;
  detail?: string;
}

/** A budget check (FR-7.4). */
export interface BudgetResult {
  name: keyof Budgets;
  limit: number;
  actual: number;
  unit: 'kB' | 'ms';
  ok: boolean;
  /** Why the budget was measured but not enforced for this render. */
  skipped?: string;
}

/** The exported inspector report (FR-5.8). */
export interface InspectorReport {
  version: 1;
  storyId: string | null;
  renderId: string;
  mode: RenderMode;
  url: string;
  response: 'html' | 'rsc' | 'other';
  status: number | null;
  payloadBytes: number;
  storyPayloadBytes: number;
  clientJsBytes: number;
  clientJsGzipBytes: number;
  frameworkJsBytes: number;
  boundaries: Boundary[];
  nonSerializable: NonSerializableProp[];
  clientComponents: ClientComponentSize[];
  clientLeaks: ClientLeak[];
  tree: InspectorNode | null;
  timings: { fetch: number; render: number; serialize: number; hydrate: number | null; ttfb: number | null; total: number | null };
  timeline: TimelineEntry[];
  calls: MockCall[];
  warnings: RenderWarning[];
  errors: Array<{ message: string; digest?: string; source: 'payload' | 'log' }>;
  logs: LogEntry[];
  navigation: NavigationSignal[];
  /** Normalized server HTML of the story, for snapshots and the hydration diff. */
  serverHtml: string | null;
  budgets: BudgetResult[];
}

export interface ReportContext {
  /** Turbopack root (lockfile directory): module ids like `[project]/…` are relative to it. */
  rootDir: string;
  /** The host project; reported file paths are relative to it. */
  projectRoot: string;
  workshopDir: string;
  distDir: string;
  sizer: ChunkSizer;
  budgets?: Budgets;
  mode: RenderMode;
}

const round = (value: number) => Math.round(value * 10) / 10;

function union(intervals: Array<[number, number]>): number {
  const sorted = intervals.filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let current: [number, number] | undefined;
  for (const interval of sorted) {
    if (!current || interval[0] > current[1]) {
      if (current) total += current[1] - current[0];
      current = [...interval];
    } else {
      current[1] = Math.max(current[1], interval[1]);
    }
  }
  if (current) total += current[1] - current[0];
  return total;
}

const SERIALIZATION_ERROR =
  /(Functions cannot be passed directly to Client Components|Only plain objects, and a few built-ins, can be passed to Client Components|Symbols cannot be passed to Client Components|Only global symbols received from Symbol\.for|Event handlers cannot be passed to Client Component props|Classes or null prototypes are not supported)/;

/** Parses React's serialization error (with its `^^^` pointer) into prop and component. */
export function parseSerializationError(message: string): { prop?: string; component?: string; reason: string } | undefined {
  const kind = SERIALIZATION_ERROR.exec(message);
  if (!kind) return undefined;
  const lines = message.split('\n');
  const caret = lines.findIndex((line) => /\^{3,}/.test(line));
  let prop: string | undefined;
  let component: string | undefined;
  if (caret > 0) {
    const source = lines[caret - 1]!;
    const width = (/\^+/.exec(lines[caret]!)?.[0] ?? '').length;
    // React points at the offending value; pick the attribute whose value is that wide.
    const attributes = [...source.matchAll(/([A-Za-z_$][\w$-]*)=(\{(?:[^{}]|\{[^{}]*\})*\}|"[^"]*"|\.\.\.)/g)];
    const pointed =
      attributes.find((m) => m[2]!.length === width) ??
      attributes.find((m) => m[0].length === width) ??
      attributes.find((m) => /function|Symbol|\[object|class /.test(m[2]!));
    prop = pointed?.[1];
    component = /<([A-Z][\w.]*)/.exec(source)?.[1];
  }
  return {
    ...(prop ? { prop } : {}),
    ...(component ? { component } : {}),
    reason: kind[1]!.replace(/\.$/, ''),
  };
}

function markShared(node: InspectorNode, sharedNames: Set<string>): void {
  if (node.kind === 'server' && sharedNames.has(node.name)) node.env = 'shared';
  for (const child of node.children) markShared(child, sharedNames);
  for (const child of node.fallback ?? []) markShared(child, sharedNames);
}

function payloadBytesOf(record: RenderRecord): { payload?: FlightPayload; html?: string } {
  const body = Buffer.concat(record.body);
  if (body.length === 0) return {};
  if (record.contentType === 'html') {
    const html = body.toString('utf8');
    return { payload: new FlightPayload(extractInlineFlight(html)), html };
  }
  if (record.contentType === 'rsc') return { payload: new FlightPayload(body) };
  return {};
}

/** Builds the inspector report for a finished render. */
export async function buildReport(record: RenderRecord, ctx: ReportContext): Promise<InspectorReport> {
  const { payload, html } = payloadBytesOf(record);
  const tree = payload ? buildTree(payload) : undefined;
  const errors: InspectorReport['errors'] = [];
  for (const row of payload?.errors.values() ?? []) {
    const value = row.value as { message?: string; digest?: string } | undefined;
    errors.push({
      message: value?.message ?? 'Server Components render error',
      ...(value?.digest ? { digest: value.digest } : {}),
      source: 'payload',
    });
  }
  for (const log of record.logs) {
    if (log.level === 'error' && log.origin === 'server') errors.push({ message: log.message, source: 'log' });
  }

  // --- Non-serializable props -----------------------------------------------------------------
  const nonSerializable: NonSerializableProp[] = [];
  for (const warning of record.warnings) {
    if (warning.type !== 'non-serializable-arg') continue;
    const detail = (warning.detail ?? {}) as { path?: string; kind?: string; severity?: 'error' | 'warning' };
    const to = /→ ([^:]+):/.exec(warning.message)?.[1] ?? 'Client Component';
    nonSerializable.push({
      from: '(story args)',
      to,
      prop: detail.path ?? '?',
      reason: warning.message.replace(/^Arg "[^"]+" → [^:]+: /, ''),
      source: 'arg-check',
      severity: detail.severity ?? 'error',
    });
  }
  const seenProblems = new Set<string>();
  for (const error of errors) {
    const parsed = parseSerializationError(error.message);
    if (!parsed) continue;
    // React elides the component name (`<...>`); the prop name identifies the boundary instead.
    const boundary =
      tree?.boundaries.find((b) => b.to === parsed.component) ??
      (parsed.prop ? tree?.boundaries.find((b) => parsed.prop! in b.propSizes) : undefined);
    const item: NonSerializableProp = {
      from: boundary?.from ?? '(unknown)',
      to: parsed.component ?? boundary?.to ?? '(unknown)',
      prop: parsed.prop ?? '?',
      reason: parsed.reason,
      source: 'react-error',
      severity: 'error',
    };
    const key = `${item.to}|${item.prop}|${item.reason}`;
    if (seenProblems.has(key)) continue;
    seenProblems.add(key);
    nonSerializable.push(item);
  }
  for (const boundary of tree?.boundaries ?? []) {
    boundary.nonSerializable = nonSerializable
      .filter((item) => item.to === boundary.to)
      .map((item) => ({ prop: item.prop, reason: item.reason }));
  }

  // --- Client modules: sizes, leaks, shared -----------------------------------------------------
  const locate = (ref: ClientReference) =>
    locateModule(ref.moduleId, { rootDir: ctx.rootDir, workshopDir: ctx.workshopDir, distDir: ctx.distDir });
  const storyRefs = (tree?.clientRefs ?? []).map((ref) => ({ ...ref, ...locate(ref) }));
  const userRefs = storyRefs.filter((ref) => !ref.external && ref.file);
  // Next's router and layout components load on every page; their chunks are not the story's
  // cost. Next components the story itself renders (Link, Image) are.
  const storyRows = new Set(tree?.clientRefs.map((ref) => ref.rowId));
  const frameworkRefs = payload
    ? [...payload.imports.keys()]
        .filter((id) => !storyRows.has(id))
        .map((id) => payload.clientReference(`$L${id}`))
        .filter(
          (ref): ref is ClientReference =>
            !!ref && /node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?next[\\/]/.test(ref.moduleId),
        )
    : [];
  const sizes = await attributeSizes(ctx.sizer, userRefs, frameworkRefs);
  // The workshop's own client components (bridge, error boundary) are not the story's.
  const workshopRuntime = `${path.sep}rsc-stories${path.sep}dist${path.sep}`;
  const leakEntries = userRefs
    .map((ref) => ref.file!)
    .filter((file) => !file.startsWith(ctx.workshopDir + path.sep) && !file.includes(workshopRuntime));
  const { leaks, clientFiles } = await findClientLeaks(leakEntries);
  if (tree?.root) {
    const sharedNames = new Set<string>();
    for (const file of clientFiles) {
      try {
        for (const name of (await moduleFacts(file)).components) sharedNames.add(name);
      } catch {
        // Deleted between render and report.
      }
    }
    markShared(tree.root, sharedNames);
  }

  // --- Timings and timeline ---------------------------------------------------------------------
  const total = record.endedAt === undefined ? null : round(record.endedAt - record.startedAt);
  const ttfb = record.firstByteAt === undefined ? null : round(record.firstByteAt - record.startedAt);
  const dataIntervals: Array<[number, number]> = record.calls
    .filter((call) => call.kind === 'fetch' || call.kind === 'module')
    .map((call) => [call.start, call.start + (call.duration ?? (total ?? call.start) - call.start)]);
  const fetchTime = round(union(dataIntervals));
  const lastDataEnd = dataIntervals.reduce((max, [, end]) => Math.max(max, end), 0);
  const serialize = total === null ? 0 : round(Math.max(0, total - Math.max(lastDataEnd, ttfb ?? 0)));
  const render = total === null ? 0 : round(Math.max(0, total - fetchTime - serialize));
  const timeline: TimelineEntry[] = record.calls
    .filter((call) => call.kind === 'fetch' || call.kind === 'module')
    .map((call) => ({
      lane: 'data' as const,
      label: call.label,
      start: call.start,
      end: round(call.start + (call.duration ?? 0)),
      detail: call.mocked ? `mocked${call.variant ? ` (${call.variant})` : ''}` : 'real',
    }));
  if (payload?.timeOrigin !== undefined) {
    const offset = payload.timeOrigin - record.startedAtMs;
    for (const [chunkId] of payload.debug) {
      const components = payload.componentsOf(chunkId).filter((info) => !/^RscStories/.test(info.name));
      const times = payload.timesOf(chunkId);
      if (!components.length || times.length < 2) continue;
      if (!tree?.reachable.has(chunkId)) continue;
      timeline.push({
        lane: 'server',
        label: components.map((c) => c.name).join(' › '),
        start: round(offset + Math.min(...times)),
        end: round(offset + Math.max(...times)),
      });
    }
    const storyComponents = new Set<string>();
    const collect = (node: InspectorNode) => {
      if (node.kind === 'server' || node.kind === 'client') storyComponents.add(node.name);
      node.children.forEach(collect);
      node.fallback?.forEach(collect);
    };
    if (tree?.root) collect(tree.root);
    for (const span of payload.ioSpans()) {
      if (span.owner && !storyComponents.has(span.owner)) continue;
      timeline.push({
        lane: 'io',
        label: `${span.owner ? `${span.owner}: ` : ''}await${span.name === 'await' ? '' : ` ${span.name}`}`,
        start: round(offset + span.start),
        end: round(offset + span.end),
      });
    }
  }
  timeline.sort((a, b) => a.start - b.start);

  // --- Budgets ---------------------------------------------------------------------------------
  const storyBytes = payload && tree ? storyPayloadBytes(payload, tree.reachable, tree.rootBytes) : 0;
  const budgets: BudgetResult[] = [];
  const limits: Budgets = { ...ctx.budgets, ...record.budgets };
  if (limits.rscPayloadKb !== undefined) {
    const actual = round(storyBytes / 1024);
    budgets.push({ name: 'rscPayloadKb', limit: limits.rscPayloadKb, actual, unit: 'kB', ok: actual <= limits.rscPayloadKb });
  }
  if (limits.clientJsKbPerStory !== undefined) {
    const actual = round(sizes.storyGzip / 1024);
    // Development chunks are unminified and carry dev-only code; sizes only mean something in production.
    const development = ctx.mode === 'dev';
    budgets.push({
      name: 'clientJsKbPerStory',
      limit: limits.clientJsKbPerStory,
      actual,
      unit: 'kB',
      ok: development || actual <= limits.clientJsKbPerStory,
      ...(development ? { skipped: 'Checked on production builds (rsc-stories test); development chunks are unminified.' } : {}),
    });
  }
  if (limits.serverRenderMs !== undefined && total !== null) {
    const latency = record.calls.reduce((sum, call) => sum + (call.latency ?? 0), 0);
    const actual = round(Math.max(0, total - latency));
    budgets.push({ name: 'serverRenderMs', limit: limits.serverRenderMs, actual, unit: 'ms', ok: actual <= limits.serverRenderMs });
  }

  const storyHtml = html ? serverStoryHtml(html) : undefined;
  return {
    version: 1,
    storyId: record.storyId ?? null,
    renderId: record.renderId,
    mode: ctx.mode,
    url: record.url,
    response: record.contentType,
    status: record.status ?? null,
    payloadBytes: payload?.totalBytes ?? 0,
    storyPayloadBytes: storyBytes,
    clientJsBytes: sizes.storyBytes,
    clientJsGzipBytes: sizes.storyGzip,
    frameworkJsBytes: sizes.frameworkBytes,
    boundaries: tree?.boundaries ?? [],
    nonSerializable,
    clientComponents: sizes.components.map((component) => ({
      ...component,
      ...(component.file ? { file: path.relative(ctx.projectRoot, component.file).split(path.sep).join('/') } : {}),
    })),
    clientLeaks: leaks.map((leak) => ({
      ...leak,
      file: path.relative(ctx.projectRoot, leak.file).split(path.sep).join('/'),
      ...(leak.via ? { via: path.relative(ctx.projectRoot, leak.via).split(path.sep).join('/') } : {}),
    })),
    tree: tree?.root ?? null,
    timings: { fetch: fetchTime, render, serialize, hydrate: null, ttfb, total },
    timeline,
    calls: record.calls,
    warnings: record.warnings,
    errors,
    logs: record.logs,
    navigation: record.navigation,
    serverHtml: storyHtml === undefined ? null : normalizeHtml(storyHtml),
    budgets,
  };
}

/** Raw rows for the payload viewer (FR-5.9). */
export function payloadRows(record: RenderRecord) {
  const { payload } = payloadBytesOf(record);
  if (!payload) return [];
  return payload.rows.map((row) => ({
    id: row.id,
    tag: row.tag,
    bytes: row.bytes,
    text: row.text.length > 4000 ? `${row.text.slice(0, 4000)}… (${row.text.length} chars)` : row.text,
    debug: row.tag === 'D' || row.tag === 'J' || row.tag === 'W' || row.tag === 'N',
  }));
}
