/** Lowercases and collapses anything outside `[a-z0-9]` into single dashes (Storybook-compatible). */
export function sanitize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** `SubmitsRefund` → `Submits Refund`, `with_long-name` → `With Long Name`. */
export function storyNameFromExport(exportName: string): string {
  return exportName
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

/**
 * Title for a story file without `meta.title`: its path relative to the project, without the
 * `src/` prefix and the `.stories.*` suffix. `src/components/Button.stories.tsx` → `components/Button`.
 */
export function titleFromPath(relativePath: string): string {
  const parts = relativePath
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\.(stories|story)\.[cm]?[jt]sx?$/, '')
    .split('/')
    .filter((part) => part && part !== '..' && part !== '.');
  if (parts[0] === 'src') parts.shift();
  // `Button/Button.stories.tsx` reads as `Button`, not `Button/Button`.
  if (parts.length >= 2 && parts[parts.length - 1] === parts[parts.length - 2]) parts.pop();
  if (parts.length >= 2 && parts[parts.length - 1] === 'index') parts.pop();
  return parts.join('/');
}

/** Component id: explicit `meta.id`, else the sanitized title. */
export function toComponentId(title: string, explicitId?: string): string {
  return sanitize(explicitId ?? title);
}

/** Story id: `<componentId>--<story>`, using the explicit story `id` when given. */
export function toStoryId(componentId: string, exportName: string, explicitId?: string): string {
  return `${componentId}--${sanitize(explicitId ?? exportName)}`;
}

/** Story export filtering that mirrors CSF's `includeStories`/`excludeStories`. */
export function isStoryExport(
  exportName: string,
  options: {
    includeStories?: Array<string | RegExp> | RegExp;
    excludeStories?: Array<string | RegExp> | RegExp;
  } = {},
): boolean {
  if (exportName === 'default' || exportName === '__esModule' || exportName.startsWith('__')) {
    return false;
  }
  const matches = (pattern: Array<string | RegExp> | RegExp | undefined): boolean | undefined => {
    if (pattern === undefined) return undefined;
    const list = Array.isArray(pattern) ? pattern : [pattern];
    return list.some((p) => (typeof p === 'string' ? p === exportName : p.test(exportName)));
  };
  if (matches(options.includeStories) === false) return false;
  if (matches(options.excludeStories) === true) return false;
  // Lowercase exports are helpers by convention (fixtures, constants), not stories.
  return /^[A-Z]/.test(exportName);
}

/**
 * A short, route-safe key for a story file, used as a Next.js route segment. Based on the
 * component id so URLs read naturally; uniqueness is enforced by the indexer.
 */
export function toFileKey(componentId: string): string {
  return componentId || 'story';
}
