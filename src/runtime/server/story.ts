import { isStoryExport, storyNameFromExport, toStoryId } from '../../shared/ids';
import type { RenderMode, RenderWarning } from '../../shared/global';
import type { StoryState } from '../../shared/state';
import type { Args, ArgTypes, Decorator, Globals, Meta, MocksInput, Parameters, StoryContext, StoryObj, StoryRender } from '../../types';
import { deepMerge, resolveMocks, type ResolvedMocks } from './mocks';

/** Render-time globals a project provides in `.rsc-stories/preview.tsx` or `config.ts`. */
export interface ProjectAnnotations {
  decorators?: Decorator[];
  parameters?: Parameters;
  mocks?: MocksInput;
  args?: Args;
  argTypes?: ArgTypes;
  globals?: Globals;
}

/** What the indexer knows about a story file; embedded into its generated page. */
export interface FileInfo {
  fileKey: string;
  componentId: string;
  title: string;
  /** Path relative to the project root, for messages. */
  path: string;
}

/** A story ready to render. */
export interface ResolvedStory {
  file: FileInfo;
  exportName: string;
  id: string;
  name: string;
  component: unknown;
  render?: StoryRender<Args>;
  hasPlay: boolean;
  args: Args;
  argTypes: ArgTypes;
  parameters: Parameters;
  globals: Globals;
  /** Inner → outer: story, meta, preview, config. */
  decorators: Decorator[];
  mocks: ResolvedMocks;
  tags: string[];
  context: StoryContext<Args>;
  warnings: RenderWarning[];
}

/** Thrown when a URL names an export the file does not have. */
export class StoryNotFoundError extends Error {
  constructor(file: FileInfo, exportName: string, available: string[]) {
    super(`Story "${exportName}" not found in ${file.path}. Available: ${available.join(', ') || '(none)'}.`);
    this.name = 'StoryNotFoundError';
  }
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** The default export, tolerating CJS interop shapes. */
export function getMeta(stories: Record<string, unknown>): Meta {
  const meta = stories.default as Meta | { default?: Meta } | undefined;
  if (meta && typeof meta === 'object' && 'default' in meta && meta.default) return meta.default;
  return (meta ?? {}) as Meta;
}

/** Export names that are stories, in file order. */
export function storyExports(stories: Record<string, unknown>): string[] {
  const meta = getMeta(stories);
  return Object.keys(stories).filter(
    (key) =>
      isStoryExport(key, {
        ...(meta.includeStories !== undefined ? { includeStories: meta.includeStories } : {}),
        ...(meta.excludeStories !== undefined ? { excludeStories: meta.excludeStories } : {}),
      }) && typeof stories[key] === 'object',
  );
}

function normalizeProject(module: unknown): ProjectAnnotations {
  if (!module || typeof module !== 'object') return {};
  const record = module as ProjectAnnotations & { default?: ProjectAnnotations };
  // Config files export `defineConfig(...)` as default; preview files export named annotations.
  const fromDefault = record.default && typeof record.default === 'object' ? record.default : {};
  return {
    ...fromDefault,
    ...(record.decorators ? { decorators: record.decorators } : {}),
    ...(record.parameters ? { parameters: record.parameters } : {}),
    ...(record.mocks ? { mocks: record.mocks } : {}),
    ...(record.args ? { args: record.args } : {}),
    ...(record.argTypes ? { argTypes: record.argTypes } : {}),
    ...(record.globals ? { globals: record.globals } : {}),
  };
}

/** Layers a story from config, preview, meta, story and the URL state. */
export function resolveStory(options: {
  file: FileInfo;
  stories: Record<string, unknown>;
  exportName: string;
  state: StoryState;
  config?: unknown;
  /** Preview modules in order: the project's `preview.tsx`, then addon previews. */
  previews?: unknown[];
  mode: RenderMode;
}): ResolvedStory {
  const { file, stories, exportName, state, mode } = options;
  const available = storyExports(stories);
  if (!available.includes(exportName)) throw new StoryNotFoundError(file, exportName, available);
  const meta = getMeta(stories);
  const story = (stories[exportName] ?? {}) as StoryObj<Meta>;
  const config = normalizeProject(options.config);
  const previews = (options.previews ?? []).map(normalizeProject);
  // Lowest priority first: config, addon previews, the project's preview.
  const layers = [config, ...[...previews].reverse()];
  const merge = <K extends 'args' | 'argTypes' | 'parameters' | 'globals'>(key: K) =>
    layers.reduce<Record<string, unknown>>((acc, layer) => deepMerge(acc, layer[key] ?? {}), {});

  const args: Args = {
    ...merge('args'),
    ...(meta.args as Args | undefined),
    ...(story.args as Args | undefined),
    ...state.args,
  };
  const argTypes = deepMerge(deepMerge(merge('argTypes'), meta.argTypes ?? {}), story.argTypes ?? {}) as ArgTypes;
  const parameters = deepMerge(deepMerge(merge('parameters'), meta.parameters ?? {}), story.parameters ?? {}) as Parameters;
  const globals = { ...merge('globals'), ...state.globals } as Globals;
  const mocks = resolveMocks(
    [...layers.map((layer) => layer.mocks), meta.mocks as MocksInput | undefined, story.mocks as MocksInput | undefined],
    state.mocks,
  );

  const warnings: RenderWarning[] = [];
  const knownKeys = new Set(mocks.catalog.map((entry) => entry.key));
  const overrideKeys = [
    ...(state.mocks?.off ?? []),
    ...Object.keys(state.mocks?.variants ?? {}),
    ...Object.keys(state.mocks?.latency ?? {}),
  ];
  for (const key of overrideKeys) {
    if (!knownKeys.has(key) && !key.startsWith('module:') && key !== 'fetch') {
      warnings.push({
        type: 'unknown-mock-override',
        message: `Mock override "${key}" does not match any mock of this story and was ignored.`,
      });
    }
  }

  const name = story.name ?? storyNameFromExport(exportName);
  const id = toStoryId(file.componentId, exportName, story.id);
  const decorators = [
    ...asArray(story.decorators as Decorator[] | undefined),
    ...asArray(meta.decorators as Decorator[] | undefined),
    ...previews.flatMap((preview) => asArray(preview.decorators)),
    ...asArray(config.decorators),
  ];
  const render = (story.render ?? meta.render) as StoryRender<Args> | undefined;
  const context: StoryContext<Args> = {
    id,
    name,
    title: file.title,
    exportName,
    args,
    argTypes,
    parameters,
    globals,
    mode,
  };
  return {
    file,
    exportName,
    id,
    name,
    component: meta.component,
    ...(render ? { render } : {}),
    hasPlay: typeof (story.play ?? meta.play) === 'function',
    args,
    argTypes,
    parameters,
    globals,
    decorators,
    mocks,
    tags: [...(meta.tags ?? []), ...(story.tags ?? [])],
    context,
    warnings,
  };
}
