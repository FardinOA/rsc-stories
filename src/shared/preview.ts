import type { JsonValue } from '../types';

const MAX_STRING = 240;
const MAX_ITEMS = 25;
const MAX_DEPTH = 4;

/**
 * A JSON-safe, size-bounded preview of any value, for call logs and the inspector. Never throws:
 * getters that throw, cycles and exotic objects all degrade to descriptive strings.
 */
export function toPreview(value: unknown, depth = 0, seen = new WeakSet<object>()): JsonValue {
  if (value === null) return null;
  switch (typeof value) {
    case 'string':
      return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}… (${value.length} chars)` : value;
    case 'number':
      return Number.isFinite(value) ? value : String(value);
    case 'boolean':
      return value;
    case 'undefined':
      return '[undefined]';
    case 'bigint':
      return `${value}n`;
    case 'symbol':
      return value.toString();
    case 'function':
      return `[ƒ ${value.name || 'anonymous'}]`;
    default:
      break;
  }
  const object = value as object;
  if (seen.has(object)) return '[Circular]';
  if (object instanceof Date) {
    return Number.isNaN(object.getTime()) ? '[Invalid Date]' : `[Date ${object.toISOString()}]`;
  }
  if (object instanceof Error) return `[${object.name}: ${object.message}]`;
  if (object instanceof RegExp) return object.toString();
  if (typeof URL !== 'undefined' && object instanceof URL) return `[URL ${object.href}]`;
  if (typeof Response !== 'undefined' && object instanceof Response) {
    return `[Response ${object.status}]`;
  }
  if (typeof (object as Promise<unknown>).then === 'function') return '[Promise]';
  if (depth >= MAX_DEPTH) return Array.isArray(object) ? `[Array(${object.length})]` : '[Object]';
  seen.add(object);
  try {
    if (Array.isArray(object)) {
      const items = object.slice(0, MAX_ITEMS).map((item) => toPreview(item, depth + 1, seen));
      if (object.length > MAX_ITEMS) items.push(`… ${object.length - MAX_ITEMS} more`);
      return items;
    }
    if (object instanceof Map) {
      return {
        '[Map]': [...object.entries()].slice(0, MAX_ITEMS).map(([k, v]) => [toPreview(k, depth + 1, seen), toPreview(v, depth + 1, seen)]),
      };
    }
    if (object instanceof Set) {
      return { '[Set]': [...object].slice(0, MAX_ITEMS).map((v) => toPreview(v, depth + 1, seen)) };
    }
    if (ArrayBuffer.isView(object)) return `[${object.constructor.name}(${object.byteLength} bytes)]`;
    const out: Record<string, JsonValue> = {};
    const proto = Object.getPrototypeOf(object) as object | null;
    const className = proto && proto !== Object.prototype ? proto.constructor?.name : undefined;
    if (className) out['[class]'] = className;
    const keys = Object.keys(object);
    for (const key of keys.slice(0, MAX_ITEMS)) {
      let item: unknown;
      try {
        item = (object as Record<string, unknown>)[key];
      } catch (error) {
        item = `[Thrown: ${(error as Error).message}]`;
      }
      out[key] = toPreview(item, depth + 1, seen);
    }
    if (keys.length > MAX_ITEMS) out['…'] = `${keys.length - MAX_ITEMS} more keys`;
    return out;
  } finally {
    seen.delete(object);
  }
}

/** Byte length of a string as UTF-8. */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}
