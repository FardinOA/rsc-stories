/** Why a value cannot cross the server → client boundary as a prop. */
export interface SerializationIssue {
  /** Dotted prop path, e.g. `onSelect` or `items[2].createdAt`. */
  path: string;
  kind: 'function' | 'class-instance' | 'symbol' | 'null-prototype' | 'date' | 'bigint-key' | 'other';
  /** `error` values make React throw; `warning` values serialize but are risky. */
  severity: 'error' | 'warning';
  message: string;
}

const CLIENT_REFERENCE = Symbol.for('react.client.reference');
const SERVER_REFERENCE = Symbol.for('react.server.reference');
const ELEMENT_TYPES = new Set([Symbol.for('react.element'), Symbol.for('react.transitional.element'), Symbol.for('react.lazy')]);

/** A `'use server'` function: serializable as a reference. */
export function isServerReference(value: unknown): boolean {
  return typeof value === 'function' && (value as { $$typeof?: symbol }).$$typeof === SERVER_REFERENCE;
}

/** A `'use client'` export as seen from the server. */
export function isClientReference(value: unknown): boolean {
  return (
    (typeof value === 'function' || (typeof value === 'object' && value !== null)) &&
    (value as { $$typeof?: symbol }).$$typeof === CLIENT_REFERENCE
  );
}

function isPlainPrototype(proto: object | null): boolean {
  return proto === Object.prototype || proto === null;
}

/**
 * Checks a props object the way React's Flight serializer will (React 19), without throwing. Dates
 * serialize, but are reported as warnings because locale/timezone formatting on the client is a
 * common hydration-mismatch source.
 */
export function findSerializationIssues(props: Record<string, unknown>): SerializationIssue[] {
  const issues: SerializationIssue[] = [];
  const seen = new WeakSet<object>();

  const visit = (value: unknown, path: string, depth: number): void => {
    if (depth > 20) return;
    if (value === null || value === undefined) return;
    const type = typeof value;
    if (type === 'string' || type === 'number' || type === 'boolean' || type === 'bigint') return;
    if (type === 'symbol') {
      const key = Symbol.keyFor(value as symbol);
      if (key === undefined) {
        issues.push({
          path,
          kind: 'symbol',
          severity: 'error',
          message: `Symbol ${String(value)} is not registered with Symbol.for() and cannot be serialized.`,
        });
      }
      return;
    }
    if (type === 'function') {
      if (isServerReference(value) || isClientReference(value)) return;
      const name = (value as { name?: string }).name || 'anonymous';
      issues.push({
        path,
        kind: 'function',
        severity: 'error',
        message: `Function \`${name}\` cannot be passed to a Client Component. Mark it with "use server" to pass it as a Server Action, or move the handler into the Client Component.`,
      });
      return;
    }
    const object = value as object;
    if (seen.has(object)) return;
    seen.add(object);
    if (ELEMENT_TYPES.has((object as { $$typeof?: symbol }).$$typeof as symbol)) return;
    if (isClientReference(object)) return;
    if (object instanceof Date) {
      issues.push({
        path,
        kind: 'date',
        severity: 'warning',
        message:
          'Date crosses the boundary. It serializes, but formatting it with the client timezone or locale can cause hydration mismatches.',
      });
      return;
    }
    if (Array.isArray(object)) {
      object.forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
      return;
    }
    if (object instanceof Map) {
      for (const [key, item] of object) {
        visit(key, `${path}.<key>`, depth + 1);
        visit(item, `${path}.get(${String(key)})`, depth + 1);
      }
      return;
    }
    if (object instanceof Set) {
      let index = 0;
      for (const item of object) visit(item, `${path}.<${index++}>`, depth + 1);
      return;
    }
    if (
      ArrayBuffer.isView(object) ||
      object instanceof ArrayBuffer ||
      (typeof FormData !== 'undefined' && object instanceof FormData) ||
      (typeof Blob !== 'undefined' && object instanceof Blob) ||
      (typeof ReadableStream !== 'undefined' && object instanceof ReadableStream) ||
      typeof (object as Promise<unknown>).then === 'function' ||
      typeof (object as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function'
    ) {
      return;
    }
    const proto = Object.getPrototypeOf(object) as object | null;
    if (proto === null) {
      issues.push({
        path,
        kind: 'null-prototype',
        severity: 'error',
        message: 'Objects with a null prototype cannot be passed to Client Components.',
      });
      return;
    }
    if (!isPlainPrototype(proto)) {
      const name = (proto as { constructor?: { name?: string } }).constructor?.name ?? 'Object';
      issues.push({
        path,
        kind: 'class-instance',
        severity: 'error',
        message: `Instance of class \`${name}\` cannot be passed to a Client Component. Only plain objects and a few built-ins serialize; pass a plain object instead.`,
      });
      return;
    }
    for (const key of Object.getOwnPropertySymbols(object)) {
      issues.push({
        path: `${path}[${String(key)}]`,
        kind: 'symbol',
        severity: 'warning',
        message: 'Symbol-keyed properties are dropped during serialization.',
      });
    }
    for (const [key, item] of Object.entries(object)) {
      visit(item, path ? `${path}.${key}` : key, depth + 1);
    }
  };

  for (const [key, value] of Object.entries(props)) {
    if (key === 'children') continue;
    visit(value, key, 0);
  }
  return issues;
}
