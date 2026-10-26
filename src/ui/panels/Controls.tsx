import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ControlType, JsonValue } from '../../types';
import type { InferredArgType } from '../../node/server/argtypes';
import { config } from '../lib/api';
import { resetArgs, selection, setArg } from '../lib/actions';
import { store, useStore } from '../lib/store';
import { Callout, Empty, Icon } from '../components/primitives';

interface ArgTypeLike {
  name?: string;
  description?: string;
  control?: ControlType | { type: ControlType; min?: number; max?: number; step?: number; labels?: Record<string, string> } | false;
  options?: JsonValue[];
  action?: string | boolean;
  type?: { name?: string; required?: boolean };
  table?: { disable?: boolean; category?: string };
  if?: { arg: string; truthy?: boolean; eq?: unknown; neq?: unknown };
}

type Tagged = { $fn?: string; $date?: string; $component?: string; $element?: string; $undefined?: boolean; $value?: unknown };

function tagged(value: unknown): Tagged | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const keys = Object.keys(value);
  return keys.some((key) => key.startsWith('$')) && keys.every((key) => key.startsWith('$') || key === 'serverAction')
    ? (value as Tagged)
    : undefined;
}

function inferControl(
  value: unknown,
  argType: ArgTypeLike,
  inferred?: InferredArgType,
): { type: ControlType | 'action' | 'readonly' | 'none'; min?: number; max?: number; step?: number; labels?: Record<string, string> } {
  if (argType.action || inferred?.action) return { type: 'action' };
  const explicit = argType.control;
  if (explicit === false) return { type: 'none' };
  if (typeof explicit === 'string') return { type: explicit };
  if (explicit && typeof explicit === 'object') return explicit;
  if (argType.options?.length) return { type: argType.options.length <= 4 ? 'radio' : 'select' };
  const tag = tagged(value);
  if (tag?.$fn) return { type: 'action' };
  if (tag?.$date) return { type: 'date' };
  if (tag?.$component || tag?.$element || tag?.$value !== undefined) return { type: 'readonly' };
  if (inferred && inferred.control !== false) return { type: inferred.control };
  if (inferred && inferred.control === false) return { type: 'readonly' };
  switch (typeof value) {
    case 'boolean':
      return { type: 'boolean' };
    case 'number':
      return { type: 'number' };
    case 'string':
      return { type: /^#[0-9a-f]{3,8}$/i.test(value) ? 'color' : value.length > 60 ? 'textarea' : 'text' };
    case 'object':
      return { type: 'object' };
    default:
      return { type: 'text' };
  }
}

function useDebounced(commit: (value: unknown) => void, delay = 250) {
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (value: unknown) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => commit(value), delay);
  };
}

function toDateInput(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function Control({
  name,
  value,
  control,
  options,
  disabled,
}: {
  name: string;
  value: unknown;
  control: ReturnType<typeof inferControl>;
  options?: JsonValue[];
  disabled: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const commit = useDebounced((v) => setArg(name, v));
  const label = `${name} value`;
  useEffect(() => {
    setDraft(undefined);
    setError(undefined);
  }, [value]);

  switch (control.type) {
    case 'boolean':
      return (
        <label className="switch">
          <input
            type="checkbox"
            role="switch"
            aria-label={label}
            checked={value === true}
            disabled={disabled}
            onChange={(e) => setArg(name, e.target.checked)}
          />
          <span className="muted small">{value === true ? 'true' : 'false'}</span>
        </label>
      );
    case 'number':
    case 'range':
      return (
        <div className="control-row">
          {control.type === 'range' ? (
            <input
              type="range"
              aria-label={label}
              min={control.min ?? 0}
              max={control.max ?? 100}
              step={control.step ?? 1}
              value={typeof value === 'number' ? value : 0}
              disabled={disabled}
              onChange={(e) => setArg(name, Number(e.target.value))}
            />
          ) : null}
          <input
            className="input"
            style={{ width: 120 }}
            type="number"
            aria-label={label}
            min={control.min}
            max={control.max}
            step={control.step}
            value={draft ?? (typeof value === 'number' ? String(value) : '')}
            disabled={disabled}
            onChange={(e) => {
              setDraft(e.target.value);
              if (e.target.value !== '' && Number.isFinite(Number(e.target.value))) commit(Number(e.target.value));
            }}
          />
        </div>
      );
    case 'select':
    case 'radio':
      if (control.type === 'radio') {
        return (
          <fieldset className="radio-group" disabled={disabled}>
            <legend className="sr-only">{name}</legend>
            {(options ?? []).map((option) => (
              <label key={String(option)}>
                <input
                  type="radio"
                  name={id}
                  checked={JSON.stringify(option) === JSON.stringify(value)}
                  onChange={() => setArg(name, option)}
                />
                {control.labels?.[String(option)] ?? String(option)}
              </label>
            ))}
          </fieldset>
        );
      }
      return (
        <select
          className="select"
          aria-label={label}
          disabled={disabled}
          value={JSON.stringify(value ?? null)}
          onChange={(e) => setArg(name, JSON.parse(e.target.value) as unknown)}
        >
          {value === undefined ? <option value="null">—</option> : null}
          {(options ?? []).map((option) => (
            <option key={JSON.stringify(option)} value={JSON.stringify(option)}>
              {control.labels?.[String(option)] ?? String(option)}
            </option>
          ))}
        </select>
      );
    case 'multi-select':
      return (
        <fieldset className="radio-group" disabled={disabled}>
          <legend className="sr-only">{name}</legend>
          {(options ?? []).map((option) => {
            const list = Array.isArray(value) ? (value as unknown[]) : [];
            const checked = list.some((v) => JSON.stringify(v) === JSON.stringify(option));
            return (
              <label key={String(option)}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    setArg(name, checked ? list.filter((v) => JSON.stringify(v) !== JSON.stringify(option)) : [...list, option])
                  }
                />
                {String(option)}
              </label>
            );
          })}
        </fieldset>
      );
    case 'color':
      return (
        <div className="control-row">
          <input
            type="color"
            aria-label={`${name} colour picker`}
            value={/^#[0-9a-f]{6}$/i.test(String(draft ?? value)) ? String(draft ?? value) : '#000000'}
            disabled={disabled}
            onChange={(e) => {
              setDraft(e.target.value);
              commit(e.target.value);
            }}
          />
          <input
            className="input mono"
            style={{ width: 140 }}
            aria-label={label}
            value={draft ?? (typeof value === 'string' ? value : '')}
            disabled={disabled}
            onChange={(e) => {
              setDraft(e.target.value);
              commit(e.target.value);
            }}
          />
        </div>
      );
    case 'date': {
      const iso = tagged(value)?.$date ?? (value instanceof Date ? value.toISOString() : undefined);
      return (
        <input
          className="input"
          style={{ width: 220 }}
          type="datetime-local"
          aria-label={label}
          value={toDateInput(iso)}
          disabled={disabled}
          onChange={(e) => {
            const date = new Date(e.target.value);
            // A real Date: the state encoding carries it to the server as a Date.
            if (!Number.isNaN(date.getTime())) setArg(name, date);
          }}
        />
      );
    }
    case 'object': {
      const text = draft ?? JSON.stringify(value ?? null, null, 2);
      return (
        <div>
          <textarea
            className="input"
            aria-label={label}
            aria-invalid={!!error}
            rows={Math.min(10, text.split('\n').length + 1)}
            value={text}
            disabled={disabled}
            spellCheck={false}
            onChange={(e) => {
              setDraft(e.target.value);
              try {
                const parsed = JSON.parse(e.target.value) as unknown;
                setError(undefined);
                commit(parsed);
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          />
          {error ? <div className="field-error">Invalid JSON: {error}</div> : null}
        </div>
      );
    }
    case 'action':
      return <span className="muted small">Function — calls are logged in the Calls panel.</span>;
    case 'readonly': {
      const tag = tagged(value);
      const text = tag?.$component ? `<${tag.$component} />` : tag?.$element ? `<${tag.$element}>` : JSON.stringify(tag?.$value ?? value);
      return <code className="muted">{text}</code>;
    }
    case 'none':
      return <span className="muted small">No control</span>;
    case 'textarea':
      return (
        <textarea
          className="input"
          aria-label={label}
          rows={3}
          style={{ fontFamily: 'var(--font)', fontSize: 'var(--text-md)' }}
          value={draft ?? (typeof value === 'string' ? value : '')}
          disabled={disabled}
          onChange={(e) => {
            setDraft(e.target.value);
            commit(e.target.value);
          }}
        />
      );
    default:
      return (
        <input
          className="input"
          aria-label={label}
          value={draft ?? (typeof value === 'string' ? value : value === undefined || tagged(value)?.$undefined ? '' : String(value))}
          disabled={disabled}
          onChange={(e) => {
            setDraft(e.target.value);
            commit(e.target.value);
          }}
        />
      );
  }
}

function visible(argType: ArgTypeLike, args: Record<string, unknown>): boolean {
  const rule = argType.if;
  if (!rule) return true;
  const value = args[rule.arg];
  if ('eq' in rule) return JSON.stringify(value) === JSON.stringify(rule.eq);
  if ('neq' in rule) return JSON.stringify(value) !== JSON.stringify(rule.neq);
  if (rule.truthy === false) return !value;
  return !!value;
}

/** Live arg editing (FR-4.3); every change re-renders the story on the server. */
export function ControlsPanel() {
  const storyId = useStore((s) => s.storyId);
  const descriptors = useStore((s) => s.descriptors);
  const inferredAll = useStore((s) => s.inferred);
  const overrides = useStore((s) => s.story.args);
  void storyId;
  void descriptors;
  const sel = selection();
  const descriptor = sel?.descriptor;
  const inferred = sel ? inferredAll[sel.file.fileKey] : undefined;

  const rows = useMemo(() => {
    if (!descriptor) return [];
    const argTypes = (descriptor.argTypes ?? {}) as Record<string, ArgTypeLike>;
    const names = new Set([...Object.keys(inferred ?? {}), ...Object.keys(descriptor.args), ...Object.keys(argTypes)]);
    const current: Record<string, unknown> = { ...descriptor.args, ...overrides };
    return [...names]
      .map((name) => {
        const argType: ArgTypeLike = argTypes[name] ?? {};
        const info = inferred?.[name];
        const value = overrides && name in overrides ? overrides[name] : descriptor.args[name];
        return {
          name,
          argType,
          info,
          value: value instanceof Date ? { $date: value.toISOString() } : value,
          control: inferControl(value, argType, info),
          options: argType.options ?? info?.options,
          overridden: !!overrides && name in overrides,
          show: !argType.table?.disable && visible(argType, current),
        };
      })
      .filter((row) => row.show);
  }, [descriptor, inferred, overrides]);

  if (!sel) return <Empty title="No story selected" />;
  const loaded = store.get().descriptors[sel.file.fileKey];
  if (loaded && 'error' in loaded) {
    return (
      <div className="panel-body">
        <Callout tone="error" title="Could not evaluate the story file.">
          <span className="mono">{loaded.error}</span>
        </Callout>
      </div>
    );
  }
  if (!descriptor) return <div className="panel-body muted">Loading story…</div>;
  if (descriptor.error) {
    return (
      <div className="panel-body">
        <Callout tone="error" title="This story could not be resolved.">
          {descriptor.error}
        </Callout>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <Empty title="No args">
        <p>
          This story has no args. Add <code>args</code> to the story or meta, or give the component typed props.
        </p>
      </Empty>
    );
  }
  const hasOverrides = !!overrides && Object.keys(overrides).length > 0;
  return (
    <div>
      <div className="panel-toolbar">
        <span className="muted small">
          {config.static ? 'Read-only in a static build.' : 'Changes re-run the server render.'}
          {inferred === null ? ' Prop types unavailable (no TypeScript); controls are inferred from values.' : ''}
        </span>
        <span className="spacer" />
        <button type="button" className="btn outline" disabled={!hasOverrides || config.static} onClick={resetArgs}>
          Reset args
        </button>
      </div>
      <table className="table controls">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Description</th>
            <th scope="col">Control</th>
            <th scope="col">
              <span className="sr-only">Reset</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name}>
              <td>
                <span className="mono">{row.argType.name ?? row.name}</span>
                {row.info?.required || row.argType.type?.required ? (
                  <span className="tone" data-tone="error" title="Required" aria-label="required">
                    {' '}
                    *
                  </span>
                ) : null}
              </td>
              <td>
                {(row.argType.description ?? row.info?.description) ? <div>{row.argType.description ?? row.info?.description}</div> : null}
                <code className="muted">
                  {row.argType.type?.name ?? row.info?.type ?? (row.value === undefined ? 'unknown' : typeof row.value)}
                </code>
                {row.info?.defaultValue ? <span className="muted small"> = {row.info.defaultValue}</span> : null}
              </td>
              <td>
                <Control name={row.name} value={row.value} control={row.control} options={row.options} disabled={config.static} />
              </td>
              <td>
                {row.overridden ? (
                  <button
                    type="button"
                    className="btn"
                    title={`Reset ${row.name}`}
                    onClick={() => setArg(row.name, descriptor.args[row.name])}
                  >
                    <Icon name="refresh" />
                    <span className="sr-only">Reset {row.name}</span>
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
