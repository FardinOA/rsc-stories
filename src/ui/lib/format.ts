/** `1234` → `1.2 kB`; `512` → `512 B`. */
export function bytes(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} kB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

/** `1234.5` → `1.23 s`; `12.3` → `12 ms`. */
export function ms(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  if (value >= 10) return `${Math.round(value)} ms`;
  return `${value.toFixed(1)} ms`;
}

/** Compact JSON for table cells. */
export function compact(value: unknown, max = 120): string {
  let text: string;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (text === undefined) return 'undefined';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function pretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Title path segments: `Commerce/OrderSummary` → `['Commerce', 'OrderSummary']`. */
export function titleParts(title: string): string[] {
  return title
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
}
