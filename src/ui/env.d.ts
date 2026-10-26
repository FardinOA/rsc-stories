// chai's types are a transitive dependency of @vitest/expect and not hoisted under pnpm.
declare module 'chai' {
  export const expect: ((value: unknown, message?: string) => unknown) & Record<string, unknown>;
  export function use(plugin: unknown): void;
}
