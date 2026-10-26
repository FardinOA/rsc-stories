import path from 'node:path';
import { ownPackagePath } from '../package-root';
import type { RenderRecord } from '../server/records';
import { extractInlineFlight, FlightPayload, isComponentInfo } from './flight';
import { normalizeGeneratedNames } from './html';
import { locateModule } from './modules';
import type { InspectorReport } from './report';
import { findStoryRoot } from './tree';

/** Deterministic snapshot of one story render (FR-7.3). */
export interface StorySnapshot {
  /** Normalized server HTML of the story root. */
  dom: string;
  /** The story's RSC model: references inlined, client references as `file#Export`, keys sorted. */
  rsc: unknown;
  /** Report fields that are stable across machines and builds (no timings, hashes or chunk names). */
  report: Record<string, unknown>;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

const ACTION_ID = /^[0-9a-f]{40,}$/;

function isElement(value: unknown): value is unknown[] {
  return Array.isArray(value) && value[0] === '$' && value.length >= 4;
}

/**
 * The story's RSC model in a stable form. Production and development payloads normalize to the
 * same shape: debug slots are dropped and server component boundaries are not recorded (they only
 * exist in development payloads).
 */
export interface SnapshotOptions {
  /** Turbopack root: `[project]/…` module ids are relative to it. */
  rootDir: string;
  workshopDir: string;
  distDir: string;
  /** Client reference paths in snapshots are relative to this directory (the host project). */
  projectRoot: string;
}

export function normalizedModel(payload: FlightPayload, options: SnapshotOptions): unknown {
  const root = findStoryRoot(payload);
  if (!root) return null;
  const clientName = (type: unknown) => {
    const ref = payload.clientReference(type);
    if (!ref) return undefined;
    const location = locateModule(ref.moduleId, options);
    const own = location.file ? ownPackagePath(location.file) : undefined;
    let file = own ?? (location.file ? path.relative(options.projectRoot, location.file).split(path.sep).join('/') : ref.moduleId);
    // Packages by name: store paths (pnpm) and ESM/CJS builds differ between machines and bundlers.
    const nodeModules = file.lastIndexOf('node_modules/');
    if (nodeModules !== -1) file = file.slice(nodeModules + 'node_modules/'.length);
    if (nodeModules !== -1 || own) {
      file = file.replace('/dist/esm/', '/dist/').replace(/\.[cm]?js$/, '');
    }
    return `${file}#${ref.exportName}`;
  };
  const seen = new Set<string>();
  const visit = (value: unknown, depth: number): unknown => {
    if (depth > 300) return '…';
    if (typeof value === 'string') {
      if (value[0] !== '$') return ACTION_ID.test(value) ? '<action-id>' : normalizeGeneratedNames(value);
      if (value.startsWith('$$')) return value.slice(1);
      // Production references carry no name; keep snapshots identical across modes.
      if (value.startsWith('$h') || value.startsWith('$F')) return { $serverAction: true };
      if (value.startsWith('$S')) return { $symbol: value.slice(2) };
      if (value.startsWith('$D')) return { $date: value.slice(2) };
      if (value === '$undefined' || value === '$u') return { $undefined: true };
      const client = clientName(value);
      if (client) return { $client: client };
      const id = FlightPayload.refId(value);
      if (!id) return value;
      if (seen.has(id)) return { $ref: 'cycle' };
      const error = payload.errors.get(id);
      if (error) {
        // Digests hash the message and stack, which differ per bundle; navigation digests are stable.
        const digest = (error.value as { digest?: string } | undefined)?.digest ?? '';
        return { $error: digest.startsWith('RSC_STORIES_NAV') ? digest : true };
      }
      const text = payload.texts.get(id);
      if (text) return text.text;
      const model = payload.models.get(id);
      if (!model) return { $pending: true };
      seen.add(id);
      const result = value.startsWith('$@') ? { $promise: visit(model.value, depth + 1) } : visit(model.value, depth + 1);
      seen.delete(id);
      return result;
    }
    if (Array.isArray(value)) {
      if (isElement(value)) {
        const [, type, key, props] = value;
        const resolvedType = payload.deref(type);
        const typeName =
          typeof resolvedType === 'string' && resolvedType[0] !== '$'
            ? resolvedType
            : clientName(type)
              ? { $client: clientName(type) }
              : visit(type, depth + 1);
        const out: Record<string, unknown> = { type: typeName, props: visit(payload.deref(props), depth + 1) };
        if (key !== null && key !== undefined) out.key = key;
        return out;
      }
      return value.map((item) => visit(item, depth + 1));
    }
    if (value && typeof value === 'object') {
      if (isComponentInfo(value)) return { $component: value.name };
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, key.startsWith('$ACTION_ID_') ? '<action-id>' : visit(item, depth + 1)]),
      );
    }
    return value;
  };
  const props = payload.deref(root[3]) as Record<string, unknown>;
  return sortKeys(visit(props.children, 0));
}

/** The stable subset of a report used in snapshots. */
/** Production payloads name Server Actions by id, development ones by function name. */
function unnamedActions(value: unknown): unknown {
  if (typeof value === 'string') return value.startsWith('[Server Action ') ? '[Server Action]' : value;
  if (Array.isArray(value)) return value.map(unnamedActions);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unnamedActions(item)]));
  }
  return value;
}

export function stableReport(report: InspectorReport): Record<string, unknown> {
  // Sizes and `from` (owner names exist only in development payloads) are left out so dev and
  // production runs share snapshots; budgets cover sizes.
  return sortKeys({
    storyId: report.storyId,
    status: report.status,
    boundaries: report.boundaries.map((b) => ({
      to: b.to,
      propsBytes: b.propsBytes,
      props: unnamedActions(b.props),
      nonSerializable: b.nonSerializable,
    })),
    clientComponents: report.clientComponents.map((c) => ({ name: c.name, file: c.file ?? null })),
    clientLeaks: report.clientLeaks.map((l) => ({ component: l.component, file: l.file, kind: l.kind, reason: l.reason })),
    nonSerializable: report.nonSerializable,
    navigation: report.navigation,
    warnings: report.warnings.map((w) => w.message),
    calls: report.calls
      .map((c) => ({ kind: c.kind, label: c.label, mocked: c.mocked, status: c.status }))
      .sort((a, b) => `${a.kind}${a.label}`.localeCompare(`${b.kind}${b.label}`)),
  }) as Record<string, unknown>;
}

/** Builds the snapshot for a finished render. */
export function storySnapshot(record: RenderRecord, report: InspectorReport, options: SnapshotOptions): StorySnapshot {
  const body = Buffer.concat(record.body);
  const payload = record.contentType === 'html' ? new FlightPayload(extractInlineFlight(body.toString('utf8'))) : new FlightPayload(body);
  return {
    dom: report.serverHtml ?? '',
    rsc: normalizedModel(payload, options),
    report: stableReport(report),
  };
}
