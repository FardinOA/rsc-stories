import { isClientReference, isServerReference } from '../../shared/serializable';
import { toPreview } from '../../shared/preview';
import type { JsonValue } from '../../types';

const ELEMENT = new Set([Symbol.for('react.element'), Symbol.for('react.transitional.element')]);

/** Display name of a component, including client references (`file#Export`). */
export function componentName(component: unknown): string | undefined {
  if (!component) return undefined;
  if (isClientReference(component)) {
    const id = (component as { $$id?: string }).$$id ?? '';
    const exportName = id.split('#').pop();
    return exportName && exportName !== 'default' ? exportName : id.split('/').pop()?.split('#')[0];
  }
  if (typeof component === 'function') {
    const fn = component as { displayName?: string; name?: string };
    return fn.displayName || fn.name || undefined;
  }
  const object = component as { displayName?: string; render?: { name?: string } };
  return object.displayName ?? object.render?.name;
}

/** `client`, `server` (async function), or `shared` (sync, could run in either environment). */
export function componentKind(component: unknown): 'client' | 'server' | 'shared' | 'none' {
  if (!component) return 'none';
  if (isClientReference(component)) return 'client';
  if (typeof component === 'function') {
    return component.constructor?.name === 'AsyncFunction' ? 'server' : 'shared';
  }
  return 'shared';
}

/**
 * Converts an arg value into JSON for the Controls panel. Values JSON cannot carry are tagged so
 * the panel can show them read-only: `{ $fn }`, `{ $date }`, `{ $component }`, `{ $element }`,
 * `{ $undefined }`, `{ $value }`.
 */
export function toControlValue(value: unknown, depth = 0): JsonValue {
  if (value === undefined) return { $undefined: true };
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : { $value: String(value) };
  if (typeof value === 'bigint') return { $value: `${value}n` };
  if (typeof value === 'symbol') return { $value: value.toString() };
  if (typeof value === 'function') {
    if (isServerReference(value)) return { $fn: (value as { name?: string }).name || 'action', serverAction: true };
    if (isClientReference(value)) return { $component: componentName(value) ?? 'Client' };
    return { $fn: (value as { name?: string }).name || 'anonymous' };
  }
  if (value instanceof Date) return { $date: Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString() };
  const object = value as { $$typeof?: symbol; type?: unknown };
  if (ELEMENT.has(object.$$typeof as symbol)) {
    const type = object.type;
    return { $element: typeof type === 'string' ? type : (componentName(type) ?? 'Component') };
  }
  if (isClientReference(value)) return { $component: componentName(value) ?? 'Client' };
  if (depth > 6) return { $value: toPreview(value) };
  if (Array.isArray(value)) return value.map((item) => toControlValue(item, depth + 1));
  const proto = Object.getPrototypeOf(value) as object | null;
  if (proto !== Object.prototype && proto !== null) return { $value: toPreview(value) };
  const out: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(value)) out[key] = toControlValue(item, depth + 1);
  return out;
}

/** JSON-safe copy of parameters/argTypes; non-JSON leaves become previews. */
export function toJsonSafe(value: unknown, depth = 0): JsonValue {
  if (value === undefined) return null;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value !== 'object' || depth > 8) return toPreview(value);
  if (Array.isArray(value)) return value.map((item) => toJsonSafe(item, depth + 1));
  const proto = Object.getPrototypeOf(value) as object | null;
  if (proto !== Object.prototype && proto !== null) return toPreview(value);
  const out: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) out[key] = toJsonSafe(item, depth + 1);
  }
  return out;
}
