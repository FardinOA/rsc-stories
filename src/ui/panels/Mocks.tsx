import { useMemo } from 'react';
import type { MockCatalogItem } from '../../shared/descriptor';
import type { RenderWarning } from '../../shared/global';
import { NEVER_RESOLVE } from '../../shared/state';
import { config } from '../lib/api';
import { resetMocks, selection, setMockActive, setMockLatency, setMockVariant } from '../lib/actions';
import { compact, ms } from '../lib/format';
import { useStore } from '../lib/store';
import { Empty, Switch } from '../components/primitives';

const LATENCIES: Array<{ label: string; value: number }> = [
  { label: 'None', value: 0 },
  { label: '300 ms', value: 300 },
  { label: '1 s', value: 1000 },
  { label: '3 s', value: 3000 },
  { label: 'Never resolves', value: NEVER_RESOLVE },
];

const GROUPS: Array<{ kind: MockCatalogItem['kind']; title: string }> = [
  { kind: 'module', title: 'Modules' },
  { kind: 'fetch', title: 'Fetch' },
  { kind: 'next', title: 'Next.js APIs' },
];

function latencyLabel(value: number): string {
  if (value >= NEVER_RESOLVE || !Number.isFinite(value)) return 'never resolves';
  return value ? ms(value) : 'none';
}

/** Active mocks with runtime overrides: toggle, variant, latency (FR-4.4, FR-3.10). */
export function MocksPanel() {
  const storyId = useStore((s) => s.storyId);
  const descriptors = useStore((s) => s.descriptors);
  const overrides = useStore((s) => s.story.mocks);
  const record = useStore((s) => s.record);
  const actionRecords = useStore((s) => s.actionRecords);
  void storyId;
  void descriptors;
  const sel = selection();
  const catalog = sel?.descriptor?.mocks ?? [];

  const callCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const call of [...(record?.calls ?? []), ...actionRecords.flatMap((r) => r.calls)]) {
      counts.set(call.key, (counts.get(call.key) ?? 0) + 1);
    }
    return counts;
  }, [record, actionRecords]);

  if (!sel) return <Empty title="No story selected" />;
  if (!sel.descriptor) return <div className="panel-body muted">Loading story…</div>;
  const warnings =
    record?.warnings.filter((w) => w.type === 'unmocked-request' || w.type === 'unmockable-export' || w.type === 'unknown-mock-override') ??
    [];
  if (catalog.length === 0 && warnings.length === 0) {
    return (
      <Empty title="No mocks">
        <p>
          This story renders against real modules and the network. Declare <code>mocks</code> on the story or meta to stub modules,{' '}
          <code>fetch</code> calls and Next.js APIs.
        </p>
      </Empty>
    );
  }
  const off = new Set(overrides?.off ?? []);
  const hasOverrides =
    !!overrides &&
    ((overrides.off?.length ?? 0) > 0 ||
      Object.keys(overrides.variants ?? {}).length > 0 ||
      Object.keys(overrides.latency ?? {}).length > 0);

  return (
    <div>
      <div className="panel-toolbar">
        <span className="muted small">
          {config.static ? 'Read-only in a static build.' : 'Overrides apply to this story and are part of the link.'}
        </span>
        <span className="spacer" />
        <button type="button" className="btn outline" disabled={!hasOverrides || config.static} onClick={resetMocks}>
          Reset mocks
        </button>
      </div>
      <div className="panel-body">
        {warnings.map((warning) => {
          const suggestion = suggestedFetchMock(warning);
          return (
            <div key={warning.message} className="callout" data-tone="warning">
              <div className="callout-body">
                <p>{warning.message}</p>
                {suggestion ? (
                  <div className="suggestion">
                    <code>{suggestion}</code>
                    <button type="button" className="btn outline" onClick={() => void navigator.clipboard?.writeText(suggestion)}>
                      Copy mock
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
        {GROUPS.map(({ kind, title }) => {
          const items = catalog.filter((item) => item.kind === kind);
          if (!items.length) return null;
          return (
            <section key={kind} className="mock-group" aria-labelledby={`mocks-${kind}`}>
              <h3 id={`mocks-${kind}`}>{title}</h3>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Active</th>
                    <th scope="col">Mock</th>
                    <th scope="col">Details</th>
                    {kind !== 'next' ? <th scope="col">Variant</th> : null}
                    {kind !== 'next' ? <th scope="col">Latency</th> : null}
                    <th scope="col" className="right">
                      Calls
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const active = !off.has(item.key);
                    const variant = overrides?.variants?.[item.key] ?? '';
                    const latencyOverride = overrides?.latency?.[item.key];
                    const effectiveLatency = latencyOverride ?? item.latency;
                    return (
                      <tr key={item.key}>
                        <td>
                          <Switch
                            checked={active}
                            onChange={(value) => setMockActive(item.key, value)}
                            label={`${item.label} active`}
                            hideLabel
                          />
                        </td>
                        <td className="mono">{item.label}</td>
                        <td className="mono small muted">{compact(item.detail, 160)}</td>
                        {kind !== 'next' ? (
                          <td>
                            {item.variants.length ? (
                              <select
                                className="select"
                                aria-label={`${item.label} variant`}
                                value={variant}
                                disabled={!active || config.static}
                                onChange={(event) => setMockVariant(item.key, event.target.value || undefined)}
                              >
                                <option value="">default</option>
                                {item.variants.map((name) => (
                                  <option key={name} value={name}>
                                    {name}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="muted small">—</span>
                            )}
                          </td>
                        ) : null}
                        {kind !== 'next' ? (
                          <td>
                            <select
                              className="select"
                              aria-label={`${item.label} latency`}
                              value={latencyOverride === undefined ? '' : String(latencyOverride)}
                              disabled={!active || config.static}
                              onChange={(event) =>
                                setMockLatency(item.key, event.target.value === '' ? undefined : Number(event.target.value))
                              }
                            >
                              <option value="">Story default ({latencyLabel(item.latency)})</option>
                              {LATENCIES.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            {latencyOverride !== undefined ? (
                              <span className="sr-only">Effective latency {latencyLabel(effectiveLatency)}</span>
                            ) : null}
                          </td>
                        ) : null}
                        <td className="right num">{callCounts.get(item.key) ?? 0}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** A `mocks.fetch` entry answering an unmocked `fetch`; requests via node:http cannot be answered. */
function suggestedFetchMock(warning: RenderWarning): string | undefined {
  if (warning.type !== 'unmocked-request') return undefined;
  const detail = warning.detail as { method?: string; url?: string; via?: string } | undefined;
  if (!detail?.url || detail.via) return undefined;
  let target = detail.url;
  try {
    // Patterns without `?` ignore the query string.
    const url = new URL(detail.url);
    target = `${url.origin}${url.pathname}`;
  } catch {
    // keep the raw URL
  }
  return `{ match: '${detail.method ?? 'GET'} ${target}', response: {} }`;
}
