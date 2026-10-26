import { useEffect, useMemo, useRef, useState } from 'react';
import type { LogEntry, MockCall } from '../../shared/global';
import { config } from '../lib/api';
import { postToCanvas, selection } from '../lib/actions';
import { compact, ms } from '../lib/format';
import { store, useStore } from '../lib/store';
import { Callout, Empty, EnvTag, Icon, Status } from '../components/primitives';

// --- Console -------------------------------------------------------------------------------------

const LEVELS: Array<LogEntry['level'] | 'all'> = ['all', 'error', 'warn', 'info', 'log', 'debug'];

/** Server and client logs for the current story, labelled by origin (FR-4.6). */
export function ConsolePanel() {
  const record = useStore((s) => s.record);
  const allActionRecords = useStore((s) => s.actionRecords);
  const actionRecords = allActionRecords.filter((r) => r.renderId !== record?.renderId);
  const clientLogs = useStore((s) => s.clientLogs);
  const [origin, setOrigin] = useState<'all' | 'server' | 'client'>('all');
  const [level, setLevel] = useState<(typeof LEVELS)[number]>('all');
  const [query, setQuery] = useState('');

  const entries = useMemo(() => {
    const server: Array<LogEntry & { group: string }> = [
      ...(record?.logs ?? []).map((entry) => ({ ...entry, group: 'render' })),
      ...actionRecords.flatMap((r) => r.logs.map((entry) => ({ ...entry, group: 'action' }))),
      ...(record?.warnings ?? []).map((w) => ({
        origin: 'server' as const,
        level: 'warn' as const,
        message: w.message,
        time: 0,
        group: 'warning',
      })),
    ];
    const client = clientLogs.map((entry) => ({ ...entry, group: 'client' }));
    return [...server, ...client].filter(
      (entry) =>
        (origin === 'all' || entry.origin === origin) &&
        (level === 'all' || entry.level === level) &&
        (!query || entry.message.toLowerCase().includes(query.toLowerCase())),
    );
  }, [record, actionRecords, clientLogs, origin, level, query]);

  return (
    <div>
      <div className="panel-toolbar">
        <label htmlFor="console-origin" className="sr-only">
          Origin
        </label>
        <select id="console-origin" className="select" value={origin} onChange={(e) => setOrigin(e.target.value as typeof origin)}>
          <option value="all">All origins</option>
          <option value="server">Server</option>
          <option value="client">Client</option>
        </select>
        <label htmlFor="console-level" className="sr-only">
          Level
        </label>
        <select id="console-level" className="select" value={level} onChange={(e) => setLevel(e.target.value as typeof level)}>
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              {l === 'all' ? 'All levels' : l}
            </option>
          ))}
        </select>
        <input
          className="input"
          style={{ width: 220 }}
          type="search"
          placeholder="Filter messages"
          aria-label="Filter messages"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="spacer" />
        <button type="button" className="btn outline" onClick={() => store.set({ clientLogs: [] })}>
          Clear client logs
        </button>
      </div>
      {entries.length === 0 ? (
        <p className="panel-body muted">No log output for this render.</p>
      ) : (
        <div role="log" aria-label="Console output">
          {entries.map((entry, index) => (
            <div key={index} className="logline" data-level={entry.level}>
              <EnvTag env={entry.origin === 'server' ? 'server' : 'client'} compact />
              <span className="muted">{entry.level}</span>
              <span className="msg">{entry.message}</span>
              <span className="muted num">{entry.origin === 'server' && entry.time ? ms(entry.time) : ''}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Calls ---------------------------------------------------------------------------------------

function CallRow({ call, source }: { call: MockCall; source: string }) {
  return (
    <tr>
      <td className="mono small">{call.kind}</td>
      <td className="mono">{call.label}</td>
      <td>
        {call.mocked ? 'mocked' : <Status tone="warning">real</Status>}
        {call.variant ? <span className="muted small"> · {call.variant}</span> : null}
      </td>
      <td className="mono small">{call.args.length ? compact(call.args) : '—'}</td>
      <td className="mono small">
        {call.status === 'error' ? (
          <Status tone="error">{call.error}</Status>
        ) : call.status === 'pending' ? (
          <span className="muted">pending…</span>
        ) : (
          compact(call.result ?? '—')
        )}
      </td>
      <td className="right num">{call.duration === undefined ? '—' : ms(call.duration)}</td>
      <td className="small muted">{source}</td>
    </tr>
  );
}

/** Every mocked call, Server Action, client action and router call (FR-3.8). */
export function CallsPanel() {
  const record = useStore((s) => s.record);
  const allActionRecords = useStore((s) => s.actionRecords);
  // An action that re-renders the page becomes the current render too; list it once.
  const actionRecords = allActionRecords.filter((r) => r.renderId !== record?.renderId);
  const events = useStore((s) => s.events);
  const [showPrefetch, setShowPrefetch] = useState(false);
  const clientEvents = events.filter((e) => showPrefetch || e.name !== 'prefetch');
  const serverCalls = record?.calls ?? [];
  if (!serverCalls.length && !actionRecords.length && !clientEvents.length) {
    return (
      <Empty title="No calls yet">
        <p>Mocked modules, fetches and Next.js APIs the story calls appear here, along with actions and router calls from the canvas.</p>
      </Empty>
    );
  }
  return (
    <div>
      {serverCalls.length || actionRecords.length ? (
        <table className="table">
          <caption className="sr-only">Server calls</caption>
          <thead>
            <tr>
              <th scope="col">Kind</th>
              <th scope="col">Call</th>
              <th scope="col">Answered by</th>
              <th scope="col">Arguments</th>
              <th scope="col">Result</th>
              <th scope="col" className="right">
                Duration
              </th>
              <th scope="col">During</th>
            </tr>
          </thead>
          <tbody>
            {serverCalls.map((call) => (
              <CallRow key={`r${call.id}`} call={call} source="render" />
            ))}
            {actionRecords.flatMap((r, i) =>
              r.calls.map((call) => <CallRow key={`a${i}-${call.id}`} call={call} source="server action" />),
            )}
          </tbody>
        </table>
      ) : null}
      <div className="panel-toolbar">
        <strong className="small">Client events</strong>
        <span className="spacer" />
        <label className="switch">
          <input type="checkbox" role="switch" checked={showPrefetch} onChange={(e) => setShowPrefetch(e.target.checked)} />
          <span>Show prefetches</span>
        </label>
        <button type="button" className="btn outline" onClick={() => store.set({ events: [] })}>
          Clear
        </button>
      </div>
      {clientEvents.length ? (
        <table className="table">
          <caption className="sr-only">Client events</caption>
          <tbody>
            {clientEvents.map((event) => (
              <tr key={event.id}>
                <td className="mono small">{event.kind === 'action' ? 'action' : 'router'}</td>
                <td className="mono">{event.kind === 'action' ? event.name : `router.${event.name}`}</td>
                <td className="mono small">{compact(event.args, 200)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="panel-body muted small">No client actions or router calls yet. Interact with the story in the canvas.</p>
      )}
    </div>
  );
}

// --- Interactions --------------------------------------------------------------------------------

/** Runs the story's play function after hydration (FR-1.9). */
export function InteractionsPanel() {
  const storyId = useStore((s) => s.storyId);
  const descriptors = useStore((s) => s.descriptors);
  const renderId = useStore((s) => s.renderId);
  const play = useStore((s) => s.play);
  const autoRan = useRef<string | undefined>(undefined);
  void storyId;
  void descriptors;
  const sel = selection();
  const hasPlay = !!sel?.descriptor?.hasPlay;

  useEffect(() => {
    if (hasPlay && renderId && autoRan.current !== renderId && !play) {
      autoRan.current = renderId;
      postToCanvas({ type: 'play' });
    }
  }, [hasPlay, renderId, play]);

  if (!sel) return <Empty title="No story selected" />;
  if (!hasPlay) {
    return (
      <Empty title="No play function">
        <p>
          Add <code>play</code> to the story to script interactions after hydration. They run here and in{' '}
          <code>rsc-stories test --browser</code>.
        </p>
      </Empty>
    );
  }
  return (
    <div>
      <div className="panel-toolbar">
        <button type="button" className="btn primary" disabled={play?.status === 'running'} onClick={() => postToCanvas({ type: 'play' })}>
          <Icon name="play" /> Run play function
        </button>
        <span role="status" aria-live="polite">
          {play?.status === 'running' ? (
            'Running…'
          ) : play?.status === 'passed' ? (
            <Status tone="success">Passed</Status>
          ) : play?.status === 'failed' ? (
            <Status tone="error">Failed</Status>
          ) : null}
        </span>
      </div>
      {play?.error ? (
        <div className="panel-body" style={{ paddingBottom: 0 }}>
          <Callout tone="error">
            <pre className="prewrap mono small">{play.error}</pre>
          </Callout>
        </div>
      ) : null}
      {play?.steps.length ? (
        <ol className="steps">
          {play.steps.map((step, index) => (
            <li key={index}>
              {step.status === 'passed' ? (
                <Status tone="success">pass</Status>
              ) : step.status === 'failed' ? (
                <Status tone="error">fail</Status>
              ) : (
                <span className="muted">running</span>
              )}
              <span>{step.label}</span>
              {step.error ? <span className="mono small">{step.error}</span> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

// --- Accessibility -------------------------------------------------------------------------------

/** axe-core on the canvas (NFR-6.2). */
export function A11yPanel() {
  const a11y = useStore((s) => s.a11y);
  const renderId = useStore((s) => s.renderId);
  const run = () => {
    store.set({ a11y: { running: true } });
    postToCanvas({ type: 'a11y' });
  };
  if (!renderId) return <Empty title="Waiting for the story to render" />;
  const violations = a11y?.result?.violations ?? [];
  return (
    <div>
      <div className="panel-toolbar">
        <button type="button" className="btn primary" onClick={run} disabled={a11y?.running}>
          Run accessibility check
        </button>
        <span role="status" aria-live="polite" className="small">
          {a11y?.running ? (
            'Checking…'
          ) : a11y?.result ? (
            violations.length ? (
              <Status tone="error">
                {violations.length} violation{violations.length === 1 ? '' : 's'}
              </Status>
            ) : (
              <Status tone="success">No violations ({a11y.result.passes} rules passed)</Status>
            )
          ) : (
            'Runs axe-core against the story root.'
          )}
        </span>
      </div>
      {a11y?.error ? (
        <div className="panel-body">
          <Callout tone="error">{a11y.error}</Callout>
        </div>
      ) : null}
      {violations.length ? (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Impact</th>
              <th scope="col">Rule</th>
              <th scope="col">Elements</th>
            </tr>
          </thead>
          <tbody>
            {violations.map((violation) => (
              <tr key={violation.id}>
                <td>
                  <Status tone={violation.impact === 'critical' || violation.impact === 'serious' ? 'error' : 'warning'}>
                    {violation.impact ?? 'minor'}
                  </Status>
                </td>
                <td>
                  <a href={violation.helpUrl} target="_blank" rel="noreferrer">
                    {violation.help}
                  </a>{' '}
                  <code className="muted">{violation.id}</code>
                </td>
                <td className="mono small">
                  {violation.nodes.slice(0, 5).map((node, index) => (
                    <div key={index}>{node.target.join(' ')}</div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {config.static ? null : null}
    </div>
  );
}
