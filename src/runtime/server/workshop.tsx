import { Suspense, type ComponentType, type CSSProperties, type ReactNode } from 'react';
import { ClientArgs, StoryErrorBoundary } from 'rsc-stories/runtime/client';
import { primitiveExports } from 'rsc-stories/runtime/mock';
import { getGlobal, getStore, type RenderMode, type RenderStore } from '../../shared/global';
import { toPreview } from '../../shared/preview';
import { findSerializationIssues, isClientReference, isServerReference } from '../../shared/serializable';
import { decodeState } from '../../shared/state';
import type { Args, ClientStoryContext, Decorator, JsonValue, StoryComponent } from '../../types';
import { componentKind, componentName, toControlValue, toJsonSafe } from './describe';
import type { ResolvedMocks } from './mocks';
import { resolveStory, storyExports, type FileInfo, type ResolvedStory } from './story';

/** Props the generated `NavigationMock` client component accepts. */
interface NavigationMockProps {
  pathname: string;
  searchParams: Record<string, string | string[]>;
  params: Record<string, string | string[]>;
  children: ReactNode;
}

/** Props the generated `CanvasBridge` client component accepts. */
interface CanvasBridgeProps {
  renderId: string;
  storyId: string;
  fileKey: string;
  exportName: string;
  hasPlay: boolean;
  args: JsonValue;
  parameters: JsonValue;
  isStatic: boolean;
}

export interface WorkshopOptions {
  /** Namespace of `.rsc-stories/config.*`, if present. */
  config?: unknown;
  /** Namespaces of `.rsc-stories/preview.*` and addon previews, in that order. */
  previews?: unknown[];
  /** Fallback when a request carries no mode (never, when served by the workshop server). */
  mode: RenderMode;
  NavigationMock: ComponentType<NavigationMockProps>;
  CanvasBridge: ComponentType<CanvasBridgeProps>;
  /** `connection` from `next/server`; opts the canvas into dynamic rendering. */
  connection?: () => Promise<void>;
}

interface PageProps {
  params: Promise<{ story: string; state?: string }>;
}

interface RegisteredEntry {
  fileKey: string;
  stories: Record<string, unknown>;
  resolve: (exportName: string, state: RenderStore['state'], mode?: RenderMode) => ResolvedStory;
}

function files(): Map<string, RegisteredEntry> {
  const g = getGlobal();
  return (g.files ??= new Map()) as unknown as Map<string, RegisteredEntry>;
}

/** Reports a resolved story to the server once per render: id, budgets and resolution warnings. */
function announce(store: RenderStore, story: ResolvedStory): void {
  const flags = store as RenderStore & { announced?: boolean };
  if (flags.announced) return;
  flags.announced = true;
  for (const warning of story.warnings) store.emit({ type: 'warning', warning });
  for (const mock of story.mocks.modules.values()) {
    const primitives = primitiveExports(mock.specifier).filter((name: string) => name in mock.impl);
    for (const name of primitives) {
      store.emit({
        type: 'warning',
        warning: {
          type: 'unmockable-export',
          message: `"${name}" from "${mock.specifier}" is a primitive and cannot be mocked per story; mock the function that reads it instead.`,
        },
      });
    }
  }
  store.emit({
    type: 'story',
    storyId: story.id,
    title: story.file.title,
    name: story.name,
    ...(story.parameters.budgets ? { budgets: story.parameters.budgets } : {}),
  });
}

/** Resolves (once per render) the story a request is for. Errors leave the store unresolved. */
function ensureStory(store: RenderStore): ResolvedStory | undefined {
  if (store.story) return store.story as ResolvedStory;
  const entry = files().get(store.fileKey);
  if (!entry) return undefined;
  try {
    const story = entry.resolve(store.exportName, store.state, store.mode);
    store.story = story;
    announce(store, story);
    return story;
  } catch {
    return undefined;
  }
}

function installHooks(): void {
  getGlobal().runtime = {
    resolveFetchMocks: (store) => ensureStory(store)?.mocks.fetch ?? [],
    resolveMocks: (store: RenderStore): ResolvedMocks | undefined => ensureStory(store)?.mocks,
  } as NonNullable<ReturnType<typeof getGlobal>['runtime']>;
}

const layouts: Record<string, CSSProperties> = {
  padded: { padding: '1rem' },
  fullscreen: { padding: 0 },
  centered: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '1rem',
    minHeight: '100vh',
    boxSizing: 'border-box',
  },
};

function backgroundFor(story: ResolvedStory): string | undefined {
  const chosen = story.globals.background;
  const config = story.parameters.backgrounds;
  if (config?.disable) return undefined;
  const lookup = (name: unknown) => (typeof name === 'string' ? (config?.values?.find((v) => v.name === name)?.value ?? name) : undefined);
  return lookup(chosen) ?? lookup(config?.default);
}

function wrapArgFunction(store: RenderStore, name: string, fn: (...args: unknown[]) => unknown) {
  const wrapped = (...args: unknown[]) => {
    const call = {
      id: store.nextCallId++,
      kind: 'arg' as const,
      key: `arg:${name}`,
      label: name,
      args: args.map((arg) => toPreview(arg)),
      mocked: true,
      status: 'ok' as const,
      start: Math.round(performance.now() - store.startedAt),
    };
    store.emit({ type: 'call:end', call });
    return fn(...args);
  };
  Object.defineProperty(wrapped, 'name', { value: fn.name || name });
  return wrapped;
}

/** The element for the story's component with args applied (no decorators). */
function componentElement(story: ResolvedStory, store: RenderStore): ReactNode {
  const Component = story.component as ComponentType<Args> | undefined;
  if (!Component) {
    throw new Error(`Story "${story.id}" has no component and no render function. Set meta.component or a render function.`);
  }
  const args: Args = { ...story.args };
  const next = story.mocks.next;
  if (next.pageProps) {
    args.params ??= Promise.resolve(next.params ?? {});
    args.searchParams ??= Promise.resolve(next.searchParams ?? {});
  }
  if (isClientReference(Component)) {
    const actions: string[] = [];
    const serializable: Args = {};
    for (const [key, value] of Object.entries(args)) {
      if (typeof value === 'function' && !isServerReference(value) && !isClientReference(value)) {
        actions.push(key);
      } else {
        serializable[key] = value;
      }
    }
    for (const issue of findSerializationIssues(serializable)) {
      store.emit({
        type: 'warning',
        warning: {
          type: 'non-serializable-arg',
          message: `Arg "${issue.path}" → ${componentName(Component) ?? 'Client Component'}: ${issue.message}`,
          detail: { path: issue.path, kind: issue.kind, severity: issue.severity },
        },
      });
    }
    if (actions.length) {
      return <ClientArgs component={Component} args={serializable} actions={actions} />;
    }
    return <Component {...serializable} />;
  }
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'function' && !isServerReference(value) && !isClientReference(value)) {
      args[key] = wrapArgFunction(store, key, value as (...a: unknown[]) => unknown);
    }
  }
  return <Component {...args} />;
}

function clientContext(story: ResolvedStory): ClientStoryContext {
  const parameters = toJsonSafe(story.parameters);
  return {
    id: story.id,
    name: story.name,
    title: story.file.title,
    exportName: story.exportName,
    globals: story.globals,
    parameters: (parameters && typeof parameters === 'object' && !Array.isArray(parameters) ? parameters : {}) as Record<string, JsonValue>,
  };
}

/** Story element with render function and decorators applied, inner → outer. */
function decoratedElement(story: ResolvedStory, store: RenderStore): ReactNode {
  const render = story.render;
  let Story: StoryComponent = render
    ? async function RscStoriesRender() {
        return render(story.args, story.context);
      }
    : function RscStoriesComponent() {
        return componentElement(story, store);
      };
  for (const decorator of story.decorators) {
    const Inner = Story;
    if (isClientReference(decorator)) {
      const ClientDecorator = decorator as unknown as ComponentType<{
        children: ReactNode;
        context: ClientStoryContext;
      }>;
      const context = clientContext(story);
      Story = function RscStoriesClientDecorator() {
        return (
          <ClientDecorator context={context}>
            <Inner />
          </ClientDecorator>
        );
      };
    } else {
      const fn = decorator as Decorator<Args>;
      Story = async function RscStoriesDecorator() {
        return fn(Inner, story.context);
      };
    }
  }
  const Outer = Story;
  return <Outer />;
}

function Message({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      role="alert"
      style={{
        font: '13px/1.5 ui-sans-serif, system-ui, sans-serif',
        border: '1px solid rgba(200,52,52,0.7)',
        borderRadius: 4,
        padding: '12px 16px',
        margin: 16,
        maxWidth: 880,
      }}
    >
      <strong style={{ display: 'block', marginBottom: 4 }}>{title}</strong>
      {children}
    </section>
  );
}

function Fallback() {
  return (
    <div
      data-rsc-stories-fallback=""
      role="status"
      style={{ font: '13px/1.5 ui-sans-serif, system-ui, sans-serif', opacity: 0.7, padding: 4 }}
    >
      Rendering on the server…
    </div>
  );
}

/**
 * Creates the workshop runtime used by the generated Next.js app. Each story file gets a page
 * (renders one story through the real RSC pipeline) and a descriptor route (JSON for the UI).
 */
export function createWorkshop(options: WorkshopOptions) {
  installHooks();
  const { NavigationMock, CanvasBridge } = options;

  function register(info: FileInfo, stories: Record<string, unknown>): RegisteredEntry {
    const entry: RegisteredEntry = {
      fileKey: info.fileKey,
      stories,
      resolve: (exportName, state, mode) =>
        resolveStory({
          file: info,
          stories,
          exportName,
          state,
          config: options.config,
          previews: options.previews ?? [],
          mode: mode ?? options.mode,
        }),
    };
    files().set(info.fileKey, entry);
    return entry;
  }

  async function renderPage(info: FileInfo, stories: Record<string, unknown>, props: PageProps) {
    const entry = register(info, stories);
    if (options.connection) await options.connection();
    const params = await props.params;
    const exportName = decodeURIComponent(params.story);
    let store = getStore();
    if (!store) {
      return (
        <Message title="This page must be served by RSC Stories">
          Run <code>rsc-stories dev</code> and open the workshop instead of serving this app directly.
        </Message>
      );
    }
    if (store.fileKey !== info.fileKey || store.exportName !== exportName) {
      // Defensive: the server derives the store from the same URL, so this only happens when a
      // request reaches the page through an unexpected rewrite.
      store = { ...store, fileKey: info.fileKey, exportName, state: decodeState(params.state), story: undefined };
    }
    let story: ResolvedStory;
    try {
      story = (store.story as ResolvedStory | undefined) ?? entry.resolve(exportName, store.state, store.mode);
      store.story = story;
      announce(store, story);
    } catch (error) {
      store.emit({
        type: 'warning',
        warning: { type: 'story-not-found', message: (error as Error).message },
      });
      return <Message title="Story not found">{(error as Error).message}</Message>;
    }

    const layout = story.parameters.layout ?? 'padded';
    const background = backgroundFor(story);
    const next = story.mocks.next;
    const root = (
      <div data-rsc-stories-root="" data-story-id={story.id}>
        {decoratedElement(story, store)}
      </div>
    );
    return (
      <div
        data-rsc-stories-canvas=""
        data-layout={layout}
        style={{ minHeight: '100vh', boxSizing: 'border-box', ...layouts[layout], ...(background ? { background } : {}) }}
      >
        <NavigationMock pathname={next.pathname ?? '/'} searchParams={next.searchParams ?? {}} params={next.params ?? {}}>
          <StoryErrorBoundary resetKey={store.renderId}>
            {story.parameters.suspense === false ? root : <Suspense fallback={<Fallback />}>{root}</Suspense>}
          </StoryErrorBoundary>
        </NavigationMock>
        <CanvasBridge
          renderId={store.renderId}
          storyId={story.id}
          fileKey={info.fileKey}
          exportName={exportName}
          hasPlay={story.hasPlay}
          args={toControlValue(story.args)}
          parameters={toJsonSafe(story.parameters)}
          isStatic={!!store.isStatic}
        />
      </div>
    );
  }

  function describe(info: FileInfo, stories: Record<string, unknown>): Response {
    const entry = register(info, stories);
    const meta = (stories.default ?? {}) as { component?: unknown; tags?: string[] };
    const described = storyExports(stories).map((exportName) => {
      try {
        const story = entry.resolve(exportName, {});
        return {
          id: story.id,
          exportName,
          name: story.name,
          args: toControlValue(story.args),
          argTypes: toJsonSafe(story.argTypes),
          parameters: toJsonSafe(story.parameters),
          hasPlay: story.hasPlay,
          hasRender: !!story.render,
          tags: story.tags,
          decorators: story.decorators.length,
          mocks: story.mocks.catalog,
          next: toJsonSafe(story.mocks.next),
          component: componentName(story.component) ?? null,
          componentKind: componentKind(story.component),
        };
      } catch (error) {
        return { exportName, error: (error as Error).message };
      }
    });
    return Response.json({
      fileKey: info.fileKey,
      componentId: info.componentId,
      title: info.title,
      path: info.path,
      component: componentName(meta.component) ?? null,
      componentKind: componentKind(meta.component),
      tags: meta.tags ?? [],
      stories: described,
    });
  }

  return {
    /** Binds a story file; the generated route files re-export the returned handlers. */
    file(info: FileInfo, stories: Record<string, unknown>) {
      register(info, stories);
      return {
        Page: (props: PageProps) => renderPage(info, stories, props),
        GET: () => describe(info, stories),
      };
    },
  };
}
