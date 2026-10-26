import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

const PATHS: Record<string, string> = {
  chevron: 'M6 4l4 4-4 4',
  search: 'M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zm4-1 3 3',
  refresh: 'M13 8a5 5 0 1 1-1.5-3.5M13 2v3h-3',
  external: 'M9 3h4v4M13 3 7 9M11 9v4H3V5h4',
  link: 'M7 9a3 3 0 0 0 4 0l2-2a3 3 0 0 0-4-4l-1 1M9 7a3 3 0 0 0-4 0L3 9a3 3 0 0 0 4 4l1-1',
  sun: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5 13 13M3 13l1.5-1.5M11.5 4.5 13 3',
  moon: 'M13 9.5A5.5 5.5 0 1 1 6.5 3a4.5 4.5 0 0 0 6.5 6.5z',
  monitor: 'M2 3h12v8H2zM6 14h4M8 11v3',
  outline: 'M2 2h4M10 2h4v4M14 10v4h-4M6 14H2v-4M2 6V2',
  ruler: 'M2 11 11 2l3 3-9 9zM5 8l1 1M7 6l1 1M9 4l1 1',
  rotate: 'M4 4h6a2 2 0 0 1 2 2v6M2 6l2-2 2 2M10 12h2',
  menu: 'M2 4h12M2 8h12M2 12h12',
  play: 'M5 3v10l8-5z',
  download: 'M8 2v8M5 7l3 3 3-3M3 13h10',
  copy: 'M5 5V3h8v8h-2M3 5h8v8H3z',
  close: 'M4 4l8 8M12 4l-8 8',
  resize: 'M14 8 8 14M14 12l-2 2',
  check: 'M3 8.5 6.5 12 13 4',
  cross: 'M4 4l8 8M12 4l-8 8',
  alert: 'M8 2 1.5 13.5h13zM8 6v4M8 11.5v.5',
};

/** 16px stroke glyph in the current text colour. */
export function Icon({ name, label }: { name: keyof typeof PATHS | string; label?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}

export type Env = 'server' | 'client' | 'shared';

const ENV_TEXT: Record<Env, { glyph: string; label: string }> = {
  server: { glyph: 'S', label: 'Server' },
  client: { glyph: 'C', label: 'Client' },
  shared: { glyph: '⇄', label: 'Shared' },
};

/** The environment code from the design DNA: hue + glyph + label, never hue alone. */
export function EnvTag({ env, compact = false }: { env: Env; compact?: boolean }) {
  const { glyph, label } = ENV_TEXT[env];
  return (
    <span
      className="env"
      data-env={env}
      title={`${label} — ${env === 'server' ? 'rendered on the server' : env === 'client' ? 'ships to the browser and hydrates' : 'renders in either environment'}`}
    >
      <b aria-hidden="true">{glyph}</b>
      {compact ? <span className="sr-only">{label}</span> : label}
    </span>
  );
}

export type Tone = 'error' | 'warning' | 'success' | 'info';

/** Status text with an icon, so status never depends on colour alone. */
export function Status({ tone, children }: { tone: Tone; children: ReactNode }) {
  const icon = tone === 'success' ? 'check' : tone === 'error' ? 'cross' : 'alert';
  return (
    <span className="tone" data-tone={tone}>
      <Icon name={icon} />
      {children}
    </span>
  );
}

export function Callout({ tone, title, children }: { tone: 'error' | 'warning' | 'info'; title?: string; children: ReactNode }) {
  return (
    <div className="callout" data-tone={tone} role={tone === 'error' ? 'alert' : undefined}>
      <div>
        {title ? <strong>{title} </strong> : null}
        {children}
      </div>
    </div>
  );
}

export interface TabItem {
  id: string;
  label: ReactNode;
  badge?: { value: number | string; tone?: 'error' | 'warning' };
}

/**
 * ARIA tabs with roving focus: arrow keys move between tabs and activate them (automatic
 * activation, since panels are cheap to render).
 */
export function Tabs({
  items,
  selected,
  onSelect,
  label,
  secondary = false,
  idPrefix,
}: {
  items: TabItem[];
  selected: string;
  onSelect: (id: string) => void;
  label: string;
  secondary?: boolean;
  idPrefix: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % items.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else return;
    event.preventDefault();
    onSelect(items[next]!.id);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className={`tablist${secondary ? ' secondary' : ''}`}>
      {items.map((item, index) => (
        <button
          key={item.id}
          ref={(el) => {
            refs.current[index] = el;
          }}
          role="tab"
          type="button"
          id={`${idPrefix}-tab-${item.id}`}
          aria-controls={`${idPrefix}-panel-${item.id}`}
          aria-selected={item.id === selected}
          tabIndex={item.id === selected ? 0 : -1}
          className="tab"
          onClick={() => onSelect(item.id)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {item.label}
          {item.badge !== undefined && item.badge.value !== 0 ? (
            <span className="badge" data-tone={item.badge.tone}>
              {item.badge.value}
              {item.badge.tone ? <span className="sr-only"> {item.badge.tone === 'error' ? 'errors' : 'warnings'}</span> : null}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({ idPrefix, id, children }: { idPrefix: string; id: string; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`${idPrefix}-panel-${id}`} aria-labelledby={`${idPrefix}-tab-${id}`} className="tabpanel" tabIndex={0}>
      {children}
    </div>
  );
}

/** A labelled switch (checkbox with role="switch"). */
export function Switch({
  checked,
  onChange,
  label,
  hideLabel = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hideLabel?: boolean;
}) {
  const id = useId();
  return (
    <label className="switch" htmlFor={id}>
      <input id={id} type="checkbox" role="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className={hideLabel ? 'sr-only' : undefined}>{label}</span>
    </label>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

export function JsonView({ value }: { value: unknown }) {
  let text: string;
  try {
    text = JSON.stringify(value, null, 2) ?? 'undefined';
  } catch {
    text = String(value);
  }
  return <pre className="json">{text}</pre>;
}
