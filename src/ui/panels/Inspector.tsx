import { useEffect, useMemo, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import type { InspectorNode } from '../../node/inspector/tree';
import type { InspectorReport } from '../../node/inspector/report';
import { api, config } from '../lib/api';
import { lastDiff, onDiff, selection } from '../lib/actions';
import { bytes, compact, ms } from '../lib/format';
import { store, useStore } from '../lib/store';
import { Callout, Empty, EnvTag, Icon, JsonView, Status, TabPanel, Tabs, type Env } from '../components/primitives';

// --- Tree --------------------------------------------------------------------------------------

interface ViewNode {
  key: string;
  node: InspectorNode;
  children: ViewNode[];
  /** A server → client handoff happens right above this node. */
  seam?: { bytes: number };
}

function toView(nodes: InspectorNode[], showHost: boolean, prefix: string, parentEnv: Env | undefined): ViewNode[] {
  const out: ViewNode[] = [];
  nodes.forEach((node, index) => {
    const key = `${prefix}.${index}`;
    const isComponent =
      node.kind === 'server' || node.kind === 'client' || node.kind === 'suspense' || node.kind === 'error' || node.kind === 'pending';
    const env = node.env ?? parentEnv;
    const children = [...node.children, ...(node.fallback ?? [])];
    if (!isComponent && !showHost) {
      out.push(...toView(children, showHost, key, env));
      return;
    }
    if (node.kind === 'text' && !showHost) return;
    out.push({
      key,
      node,
      children: toView(node.children, showHost, key, node.kind === 'client' ? 'client' : env),
      ...(node.kind === 'client' && parentEnv !== 'client' ? { seam: { bytes: node.propsBytes ?? 0 } } : {}),
    });
  });
  return out;
}

function nodeEnv(node: InspectorNode): Env | undefined {
  if (node.env) return node.env;
  return undefined;
}

function TreeView({ report }: { report: InspectorReport }) {
  const [showHost, setShowHost] = useState(false);
  const [selected, setSelected] = useState<string | undefined>();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const view = useMemo(() => (report.tree ? toView(report.tree.children, showHost, 'n', 'server') : []), [report, showHost]);

  const flat = useMemo(() => {
    const items: Array<{ view: ViewNode; depth: number; parent?: string }> = [];
    const walk = (nodes: ViewNode[], depth: number, parent?: string) => {
      for (const v of nodes) {
        items.push({ view: v, depth, ...(parent ? { parent } : {}) });
        if (v.children.length && !collapsed.has(v.key)) walk(v.children, depth + 1, v.key);
      }
    };
    walk(view, 0);
    return items;
  }, [view, collapsed]);

  const selectedNode = flat.find((item) => item.view.key === selected)?.view.node;
  const focusKey = selected ?? flat[0]?.view.key;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, position: number) => {
    const item = flat[position]!;
    let target: string | undefined;
    if (event.key === 'ArrowDown') target = flat[position + 1]?.view.key;
    else if (event.key === 'ArrowUp') target = flat[position - 1]?.view.key;
    else if (event.key === 'ArrowRight' && item.view.children.length) {
      if (collapsed.has(item.view.key)) setCollapsed((c) => new Set([...c].filter((k) => k !== item.view.key)));
      else target = flat[position + 1]?.view.key;
    } else if (event.key === 'ArrowLeft') {
      if (item.view.children.length && !collapsed.has(item.view.key)) setCollapsed((c) => new Set([...c, item.view.key]));
      else target = item.parent;
    } else if (event.key === 'Home') target = flat[0]?.view.key;
    else if (event.key === 'End') target = flat[flat.length - 1]?.view.key;
    else return;
    event.preventDefault();
    if (target) {
      setSelected(target);
      document.getElementById(`cnode-${target}`)?.focus();
    }
  };

  if (!report.tree || view.length === 0) {
    return (
      <div className="panel-body">
        <Callout tone="info">
          {report.response === 'other'
            ? 'This render produced no RSC payload (redirect or error response).'
            : 'The story rendered no components. Host elements are hidden; turn them on to see the raw output.'}
        </Callout>
      </div>
    );
  }

  return (
    <div className="split">
      <div>
        <div className="panel-toolbar">
          <label className="switch">
            <input type="checkbox" role="switch" checked={showHost} onChange={(e) => setShowHost(e.target.checked)} />
            <span>Show host elements</span>
          </label>
          <span className="spacer" />
          <span className="small muted">
            {report.mode === 'dev' ? 'Server components come from React debug info.' : 'Production payloads omit server component names.'}
          </span>
        </div>
        <ul role="tree" aria-label="Component tree" className="ctree">
          {flat.map(({ view: v, depth }, position) => {
            const node = v.node;
            const env = nodeEnv(node);
            return (
              <li key={v.key} role="none">
                {v.seam ? (
                  <div className="seam" style={{ paddingLeft: 12 + depth * 16 }} aria-hidden="true">
                    boundary · {bytes(v.seam.bytes)} of props cross to the client
                  </div>
                ) : null}
                <div
                  id={`cnode-${v.key}`}
                  role="treeitem"
                  aria-level={depth + 1}
                  aria-selected={v.key === selected}
                  aria-expanded={v.children.length ? !collapsed.has(v.key) : undefined}
                  tabIndex={v.key === focusKey ? 0 : -1}
                  className="cnode"
                  style={{ paddingLeft: 12 + depth * 16 }}
                  onClick={() => setSelected(v.key)}
                  onKeyDown={(e) => onKeyDown(e, position)}
                >
                  {env && (node.kind === 'server' || node.kind === 'client') ? <EnvTag env={env} compact /> : null}
                  {node.kind === 'suspense' ? <span className="meta">⟨Suspense⟩</span> : null}
                  {node.kind === 'host' ? <span className="host">&lt;{node.name}&gt;</span> : null}
                  {node.kind === 'text' ? <span className="host">“{node.name}”</span> : null}
                  {node.kind === 'error' ? <Status tone="error">{node.message}</Status> : null}
                  {node.kind === 'pending' ? <span className="meta">still streaming…</span> : null}
                  {node.kind === 'server' || node.kind === 'client' ? <span>{node.name}</span> : null}
                  {node.kind === 'suspense' && node.pending ? <span className="meta">pending</span> : null}
                  {node.kind === 'client' && node.propsBytes !== undefined ? <span className="meta">{bytes(node.propsBytes)}</span> : null}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="panel-body">
        {selectedNode ? (
          <NodeDetails node={selectedNode} />
        ) : (
          <p className="muted">
            Select a node. <EnvTag env="server" /> ran on the server only. <EnvTag env="client" /> ships to the browser and hydrates.{' '}
            <EnvTag env="shared" /> has no environment of its own and also appears in the client bundle.
          </p>
        )}
      </div>
    </div>
  );
}

function NodeDetails({ node }: { node: InspectorNode }) {
  return (
    <div>
      <h3 style={{ margin: '0 0 8px', fontSize: 'var(--text-lg)' }}>
        {node.kind === 'host' ? `<${node.name}>` : node.name} {node.env ? <EnvTag env={node.env} /> : null}
      </h3>
      <dl className="kv">
        <dt>Kind</dt>
        <dd>{node.kind}</dd>
        {node.owner ? (
          <>
            <dt>Rendered by</dt>
            <dd className="mono">{node.owner}</dd>
          </>
        ) : null}
        {node.module ? (
          <>
            <dt>Module</dt>
            <dd className="mono small" style={{ wordBreak: 'break-all' }}>
              {node.module}
            </dd>
          </>
        ) : null}
        {node.propsBytes !== undefined ? (
          <>
            <dt>Serialized props</dt>
            <dd className="num">{bytes(node.propsBytes)}</dd>
          </>
        ) : null}
        {node.key ? (
          <>
            <dt>Key</dt>
            <dd className="mono">{node.key}</dd>
          </>
        ) : null}
      </dl>
      {node.props !== undefined ? (
        <>
          <h4 className="small muted" style={{ margin: '12px 0 4px' }}>
            Props
          </h4>
          <JsonView value={node.props} />
        </>
      ) : null}
    </div>
  );
}

// --- Other views -------------------------------------------------------------------------------

function BoundariesView({ report }: { report: InspectorReport }) {
  return (
    <div>
      {report.nonSerializable.length ? (
        <div className="panel-body" style={{ paddingBottom: 0 }}>
          {report.nonSerializable.map((item, index) => (
            <Callout
              key={index}
              tone={item.severity === 'error' ? 'error' : 'warning'}
              title={`${item.from} → ${item.to}: prop "${item.prop}"`}
            >
              {item.reason}
              {item.source === 'arg-check' ? ' (caught in the story args before rendering)' : ' (reported by React)'}
            </Callout>
          ))}
        </div>
      ) : null}
      {report.boundaries.length === 0 ? (
        <Empty title="No server → client boundaries">
          <p>Nothing in this story crosses into a Client Component, so it ships no component JavaScript of its own.</p>
        </Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">From (server)</th>
              <th scope="col">To (client)</th>
              <th scope="col" className="right">
                Props
              </th>
              <th scope="col">Largest props</th>
              <th scope="col">Problems</th>
            </tr>
          </thead>
          <tbody>
            {report.boundaries.map((boundary, index) => {
              const largest = Object.entries(boundary.propSizes)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 4);
              return (
                <tr key={index}>
                  <td>
                    <EnvTag env="server" compact /> <span className="mono">{boundary.from}</span>
                  </td>
                  <td>
                    <EnvTag env="client" compact /> <span className="mono">{boundary.to}</span>
                  </td>
                  <td className="right num">{bytes(boundary.propsBytes)}</td>
                  <td className="mono small">{largest.map(([name, size]) => `${name} ${bytes(size)}`).join(', ') || '—'}</td>
                  <td>
                    {boundary.nonSerializable.length ? (
                      <Status tone="error">{boundary.nonSerializable.map((n) => n.prop).join(', ')}</Status>
                    ) : (
                      <span className="muted small">none</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

const LANES: Array<{ lane: 'server' | 'data' | 'io' | 'client'; label: string }> = [
  { lane: 'server', label: 'Server render' },
  { lane: 'data', label: 'Data (mocks)' },
  { lane: 'io', label: 'Awaited I/O' },
  { lane: 'client', label: 'Client' },
];

function TimelineView({ report, commitMs }: { report: InspectorReport; commitMs: number | undefined }) {
  const total = report.timings.total ?? 0;
  const entries = [...report.timeline];
  if (commitMs !== undefined) {
    entries.push({ lane: 'client', label: `hydrate / commit ${ms(commitMs)}`, start: total, end: total + commitMs });
  }
  const end = Math.max(total, ...entries.map((e) => e.end), 1);
  const start = Math.min(0, ...entries.map((e) => e.start));
  const span = end - start;
  return (
    <div className="timeline">
      <dl className="kv" style={{ marginBottom: 12 }}>
        <dt>Data</dt>
        <dd className="num">{ms(report.timings.fetch)} — time in mocked and real data calls</dd>
        <dt>Render</dt>
        <dd className="num">{ms(report.timings.render)} — server work outside data waits (includes compile on first load in dev)</dd>
        <dt>Serialize</dt>
        <dd className="num">{ms(report.timings.serialize)} — streaming after the last data call</dd>
        <dt>Hydrate</dt>
        <dd className="num">{ms(commitMs)} — client commit, measured in the canvas</dd>
      </dl>
      {LANES.map(({ lane, label }) => {
        const bars = entries.filter((e) => e.lane === lane);
        return (
          <div key={lane} className="lane">
            <div className="lane-label small">
              {lane === 'server' ? <EnvTag env="server" compact /> : lane === 'client' ? <EnvTag env="client" compact /> : null} {label}
            </div>
            <div className="lane-track" role="list" aria-label={label}>
              {bars.length === 0 ? <span className="small muted">—</span> : null}
              {bars.map((bar, index) => (
                <div
                  key={index}
                  role="listitem"
                  className="bar"
                  data-lane={lane}
                  style={{
                    marginLeft: `${((bar.start - start) / span) * 100}%`,
                    width: `max(2px, ${((bar.end - bar.start) / span) * 100}%)`,
                  }}
                  title={`${bar.label}: ${ms(bar.start)} → ${ms(bar.end)} (${ms(bar.end - bar.start)})${bar.detail ? ` · ${bar.detail}` : ''}`}
                >
                  {bar.label} <span className="muted">{ms(bar.end - bar.start)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      <div className="axis" aria-hidden="true">
        <span>{ms(start)}</span>
        <span>{ms(start + span / 2)}</span>
        <span>{ms(end)}</span>
      </div>
    </div>
  );
}

function ClientJsView({ report }: { report: InspectorReport }) {
  if (report.clientComponents.length === 0) {
    return <Empty title="No client components">This story ships no component JavaScript beyond the framework.</Empty>;
  }
  return (
    <div>
      <div className="panel-body" style={{ paddingBottom: 0 }}>
        <Callout tone="info">
          Estimates from the bundler's chunks: a chunk shared by several components counts for each of them. Framework chunks (
          {bytes(report.frameworkJsBytes)}) are excluded.
          {report.mode === 'dev' ? ' Development chunks are unminified; run rsc-stories test or build for production sizes.' : ''}
        </Callout>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Component</th>
            <th scope="col">File</th>
            <th scope="col" className="right">
              Size
            </th>
            <th scope="col" className="right">
              Gzip
            </th>
            <th scope="col" className="right">
              Chunks
            </th>
          </tr>
        </thead>
        <tbody>
          {report.clientComponents.map((component, index) => (
            <tr key={index}>
              <td>
                <EnvTag env="client" compact /> <span className="mono">{component.name}</span>
              </td>
              <td className="mono small">{component.file ?? component.module}</td>
              <td className="right num">{bytes(component.bytes)}</td>
              <td className="right num">{bytes(component.gzip)}</td>
              <td className="right num">{component.chunks.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LeaksView({ report }: { report: InspectorReport }) {
  if (report.clientLeaks.length === 0) {
    return (
      <Empty title="No client leaks">
        <p>Every component in the client bundle uses at least one client-only API (state, effects, event handlers, browser globals).</p>
      </Empty>
    );
  }
  return (
    <div className="panel-body">
      {report.clientLeaks.map((leak, index) => (
        <Callout key={index} tone={leak.kind === 'marked' ? 'warning' : 'info'} title={`${leak.component} — ${leak.reason}.`}>
          <p>{leak.fix}</p>
          <p className="mono small muted">{leak.file}</p>
        </Callout>
      ))}
    </div>
  );
}

function useDiff() {
  return useSyncExternalStore(onDiff, () => lastDiff);
}

function HydrationView({ report }: { report: InspectorReport }) {
  const mismatches = useStore((s) => s.mismatches);
  const diff = useDiff();
  if (report.response !== 'html') {
    return (
      <Empty title="No hydration in this render">
        <p>
          This render was an RSC navigation (args or mocks changed), which the client renders without hydrating. Reload the canvas to check
          hydration.
        </p>
      </Empty>
    );
  }
  const changed = diff?.lines.filter((line) => line.op !== ' ').length ?? 0;
  return (
    <div className="panel-body">
      {mismatches.length === 0 && diff?.matches !== false ? (
        <p>
          <Status tone="success">No hydration mismatches.</Status>{' '}
          <span className="muted">The client's first render matched the server HTML.</span>
        </p>
      ) : null}
      {mismatches.map((message, index) => (
        <Callout key={index} tone="error" title="React reported a hydration mismatch.">
          <pre className="prewrap mono small">{message}</pre>
        </Callout>
      ))}
      {diff && !diff.matches ? (
        <>
          <h4 className="small muted">
            DOM diff after hydration ({changed} line{changed === 1 ? '' : 's'}): <span className="del">−</span> server HTML,{' '}
            <span className="add">+</span> client DOM
          </h4>
          <pre className="diff" aria-label="DOM diff">
            {diff.lines.map((line, index) => (
              <div key={index} className={line.op === '+' ? 'add' : line.op === '-' ? 'del' : undefined}>
                {line.op} {line.text}
              </div>
            ))}
          </pre>
        </>
      ) : null}
      {!diff ? <p className="muted small">Waiting for the canvas to report its DOM…</p> : null}
    </div>
  );
}

function PayloadView({ report }: { report: InspectorReport }) {
  const [rows, setRows] = useState<Array<{ id: string; tag: string; bytes: number; text: string; debug: boolean }>>();
  const [error, setError] = useState<string>();
  const [hideDebug, setHideDebug] = useState(true);
  const [query, setQuery] = useState('');
  useEffect(() => {
    setRows(undefined);
    api.payload(report.renderId, report.storyId ?? undefined).then(setRows, (e: unknown) => setError((e as Error).message));
  }, [report.renderId, report.storyId]);
  if (error) return <div className="panel-body">Could not load the payload: {error}</div>;
  if (!rows) return <div className="panel-body muted">Loading payload…</div>;
  const visibleRows = rows.filter((row) => (!hideDebug || !row.debug) && (!query || row.text.includes(query) || row.id === query));
  return (
    <div>
      <div className="panel-toolbar">
        <label className="switch">
          <input type="checkbox" role="switch" checked={hideDebug} onChange={(e) => setHideDebug(e.target.checked)} />
          <span>Hide debug rows</span>
        </label>
        <input
          className="input"
          style={{ width: 220 }}
          type="search"
          aria-label="Filter rows"
          placeholder="Filter rows"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="spacer" />
        <span className="small muted num">
          {visibleRows.length} of {rows.length} rows · {bytes(report.payloadBytes)}
        </span>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Row</th>
            <th scope="col">Tag</th>
            <th scope="col" className="right">
              Bytes
            </th>
            <th scope="col">Data</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.slice(0, 1000).map((row, index) => (
            <tr key={index}>
              <td className="mono">{row.id || '·'}</td>
              <td className="mono">{row.tag || 'model'}</td>
              <td className="right num">{row.bytes}</td>
              <td className="mono small" style={{ wordBreak: 'break-all' }}>
                {row.text.length > 400 ? `${row.text.slice(0, 400)}…` : row.text}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExportView({ report }: { report: InspectorReport }) {
  const commitMs = useStore((s) => s.commitMs);
  const full = { ...report, timings: { ...report.timings, hydrate: commitMs ?? null } };
  const text = JSON.stringify(full, null, 2);
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${report.storyId ?? 'story'}.report.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div>
      <div className="panel-toolbar">
        <button type="button" className="btn primary" onClick={download}>
          <Icon name="download" /> Download report JSON
        </button>
        <button type="button" className="btn outline" onClick={() => void navigator.clipboard?.writeText(text)}>
          <Icon name="copy" /> Copy
        </button>
        <span className="small muted">
          Same schema as <code>rsc-stories test --json</code>, for CI assertions.
        </span>
      </div>
      <div className="panel-body">
        <pre className="json" style={{ maxHeight: 'none' }}>
          {compact(text, 20000)}
        </pre>
      </div>
    </div>
  );
}

const TABS = [
  { id: 'tree', label: 'Tree' },
  { id: 'boundaries', label: 'Boundaries' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'clientjs', label: 'Client JS' },
  { id: 'leaks', label: 'Client leaks' },
  { id: 'hydration', label: 'Hydration' },
  { id: 'payload', label: 'Payload' },
  { id: 'export', label: 'Export' },
];

/** The RSC Boundary Inspector (FR-5.1–5.9). */
export function InspectorPanel() {
  const report = useStore((s) => s.report);
  const reportError = useStore((s) => s.reportError);
  const renderPending = useStore((s) => s.renderPending);
  const tab = useStore((s) => s.inspectorTab);
  const commitMs = useStore((s) => s.commitMs);
  const mismatches = useStore((s) => s.mismatches);
  const diff = useDiff();
  const sel = selection();

  if (!sel) return <Empty title="No story selected" />;
  if (reportError) {
    return (
      <div className="panel-body">
        <Callout tone="error" title="Could not build the inspector report.">
          {reportError}
        </Callout>
      </div>
    );
  }
  if (!report) {
    return (
      <div className="panel-body muted" role="status">
        {renderPending || !config.static ? 'Waiting for the server render to finish…' : 'No report for this story.'}
      </div>
    );
  }

  const failedBudgets = report.budgets.filter((b) => !b.ok);
  const skippedBudgets = report.budgets.filter((b) => b.skipped);
  const hydrationProblems = mismatches.length + (diff && !diff.matches ? 1 : 0);
  const items = TABS.map((t) => ({
    ...t,
    ...(t.id === 'boundaries' && report.boundaries.length
      ? {
          badge: {
            value: report.boundaries.length,
            ...(report.nonSerializable.some((n) => n.severity === 'error') ? { tone: 'error' as const } : {}),
          },
        }
      : {}),
    ...(t.id === 'leaks' && report.clientLeaks.length ? { badge: { value: report.clientLeaks.length, tone: 'warning' as const } } : {}),
    ...(t.id === 'hydration' && hydrationProblems ? { badge: { value: hydrationProblems, tone: 'error' as const } } : {}),
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <dl className="metrics">
        <div className="metric">
          <dt>RSC payload (story)</dt>
          <dd>
            {bytes(report.storyPayloadBytes)} <small>of {bytes(report.payloadBytes)}</small>
          </dd>
        </div>
        <div className="metric">
          <dt>Client JS (gzip, est.)</dt>
          <dd>{bytes(report.clientJsGzipBytes)}</dd>
        </div>
        <div className="metric">
          <dt>Boundaries</dt>
          <dd>{report.boundaries.length}</dd>
        </div>
        <div className="metric">
          <dt>Server render</dt>
          <dd>{ms(report.timings.total)}</dd>
        </div>
        <div className="metric">
          <dt>Hydrate</dt>
          <dd>{ms(commitMs)}</dd>
        </div>
        <div className="metric">
          <dt>Budgets</dt>
          <dd>
            {report.budgets.length === 0 ? (
              <small>none set</small>
            ) : failedBudgets.length ? (
              <Status tone="error">{failedBudgets.length} over</Status>
            ) : (
              <Status tone="success">within</Status>
            )}
            {skippedBudgets.length ? (
              <small title={skippedBudgets.map((b) => `${b.name}: ${b.skipped}`).join('\n')}>
                {' '}
                · {skippedBudgets.length} production only
              </small>
            ) : null}
          </dd>
        </div>
      </dl>
      {failedBudgets.map((budget) => (
        <div key={budget.name} className="panel-body" style={{ paddingBottom: 0 }}>
          <Callout tone="error" title={`Budget ${budget.name} exceeded:`}>
            {budget.actual} {budget.unit} &gt; {budget.limit} {budget.unit}
          </Callout>
        </div>
      ))}
      <Tabs
        items={items}
        selected={tab}
        onSelect={(id) => store.set({ inspectorTab: id })}
        label="Inspector views"
        idPrefix="inspector"
        secondary
      />
      <TabPanel idPrefix="inspector" id={tab}>
        {tab === 'tree' ? <TreeView report={report} /> : null}
        {tab === 'boundaries' ? <BoundariesView report={report} /> : null}
        {tab === 'timeline' ? <TimelineView report={report} commitMs={commitMs} /> : null}
        {tab === 'clientjs' ? <ClientJsView report={report} /> : null}
        {tab === 'leaks' ? <LeaksView report={report} /> : null}
        {tab === 'hydration' ? <HydrationView report={report} /> : null}
        {tab === 'payload' ? <PayloadView report={report} /> : null}
        {tab === 'export' ? <ExportView report={report} /> : null}
      </TabPanel>
    </div>
  );
}
