import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkshop } from '../../src/runtime/server/workshop';
import { getGlobal } from '../../src/shared/global';
import { encodeState } from '../../src/shared/state';
import { fn } from '../../src/helpers';
import { makeStore, storage, useMocks } from '../helpers/store';

const NavigationMock = (props: { children: ReactNode }) => props.children;
const CanvasBridge = () => null;
const info = { fileKey: 'card', componentId: 'ui-card', title: 'UI/Card', path: 'src/Card.stories.tsx' };

/** Calls function components until only host elements and client references remain. */
async function expand(node: unknown): Promise<unknown> {
  if (Array.isArray(node)) return Promise.all(node.map(expand));
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<Record<string, unknown>>;
  const type = element.type as unknown;
  if (
    typeof type === 'function' &&
    !(type as { $$typeof?: symbol }).$$typeof &&
    !/^(NavigationMock|CanvasBridge|StoryErrorBoundary|ClientArgs)$/.test((type as { name: string }).name)
  ) {
    return expand(await (type as (p: unknown) => unknown)(element.props));
  }
  const { children, ...props } = element.props;
  return {
    type: typeof type === 'string' ? type : ((type as { name?: string }).name ?? String(type)),
    props,
    children: await expand(children),
  };
}

const clientRef = <P,>(impl: (props: P) => ReactNode, id: string) =>
  Object.assign(impl, { $$typeof: Symbol.for('react.client.reference'), $$id: id });

afterEach(() => useMocks(undefined));

describe('createWorkshop (FR-1.2 – FR-1.8)', () => {
  const Card = async ({ title }: { title: string }) => <h2>{title}</h2>;
  const ClientButton = clientRef(({ label }: { label: string }) => <button>{label}</button>, '/src/Button.tsx#Button');
  const ClientWrapper = clientRef(({ children }: { children: ReactNode }) => <section>{children}</section>, '/src/Wrapper.tsx#Wrapper');
  const stories = {
    default: {
      component: Card,
      args: { title: 'Hello' },
      parameters: { layout: 'centered', backgrounds: { values: [{ name: 'Dark', value: '#111' }] } },
      decorators: [
        (Story: () => ReactNode) => (
          <main>
            <Story />
          </main>
        ),
      ],
    },
    Default: {},
    Rendered: { render: (args: { title: string }) => <p>custom {args.title}</p>, decorators: [ClientWrapper] },
    WithSpy: { args: { title: 'x', onPick: fn() }, parameters: { suspense: false } },
    ClientStory: { render: undefined },
    PageProps: { mocks: { next: { pageProps: true, params: { id: '7' } } } },
  };
  const clientStories = { default: { component: ClientButton, args: { label: 'Go', onClick: fn(), when: new Date(0) } }, Default: {} };

  it('renders a story inside the canvas chrome with layout, background and navigation mocks', async () => {
    const workshop = createWorkshop({
      mode: 'dev',
      NavigationMock,
      CanvasBridge,
      previews: [
        {
          decorators: [
            (S: () => ReactNode) => (
              <div id="preview">
                <S />
              </div>
            ),
          ],
        },
      ],
    });
    const file = workshop.file(info, stories);
    const store = makeStore({ fileKey: 'card', exportName: 'Default', state: { globals: { background: 'Dark' } } });
    const element = await storage.run(store, () => file.Page({ params: Promise.resolve({ story: 'Default', state: encodeState({}) }) }));
    const tree = JSON.stringify(await storage.run(store, () => expand(element)));
    expect(tree).toContain('"data-layout":"centered"');
    expect(tree).toContain('"background":"#111"');
    expect(tree).toMatch(/"type":"div","props":\{"id":"preview"\}.*"type":"main".*"type":"h2".*"Hello"/);
    expect(tree).toContain('"renderId":"r1"');
    expect(store.events.find((e) => e.type === 'story')).toMatchObject({ storyId: 'ui-card--default', title: 'UI/Card' });
  });

  it('uses render functions and client decorators, and logs arg function calls', async () => {
    const workshop = createWorkshop({ mode: 'dev', NavigationMock, CanvasBridge });
    const file = workshop.file(info, stories);
    const rendered = makeStore({ fileKey: 'card', exportName: 'Rendered' });
    const tree = JSON.stringify(
      await storage.run(rendered, async () => expand(await file.Page({ params: Promise.resolve({ story: 'Rendered' }) }))),
    );
    expect(tree).toContain('custom ');
    expect(tree).toContain('"context":{"id":"ui-card--rendered"');

    const spyStore = makeStore({ fileKey: 'card', exportName: 'WithSpy' });
    await storage.run(spyStore, async () => {
      const element = await file.Page({ params: Promise.resolve({ story: 'WithSpy' }) });
      const root = JSON.stringify(await expand(element));
      expect(root).not.toContain('Rendering on the server');
    });
    const resolved = spyStore.story as { args: Record<string, unknown> };
    expect(resolved.args.onPick).toBeTypeOf('function');
  });

  it('turns function args of client components into actions and checks serializability', async () => {
    const workshop = createWorkshop({ mode: 'dev', NavigationMock, CanvasBridge });
    const file = workshop.file({ ...info, fileKey: 'button' }, clientStories);
    const store = makeStore({ fileKey: 'button', exportName: 'Default' });
    const tree = JSON.stringify(
      await storage.run(store, async () => expand(await file.Page({ params: Promise.resolve({ story: 'Default' }) }))),
    );
    expect(tree).toContain('"actions":["onClick"]');
    expect(store.events.find((e) => e.type === 'warning')).toMatchObject({ warning: { type: 'non-serializable-arg' } });
  });

  it('passes page props when asked', async () => {
    const workshop = createWorkshop({ mode: 'dev', NavigationMock, CanvasBridge });
    const file = workshop.file(info, stories);
    const store = makeStore({ fileKey: 'card', exportName: 'PageProps' });
    await storage.run(store, async () => {
      await file.Page({ params: Promise.resolve({ story: 'PageProps' }) });
      const element = (store.story as { args: Record<string, unknown> }).args;
      expect(element.params).toBeUndefined();
    });
  });

  it('explains missing stories and requests outside the workshop', async () => {
    const workshop = createWorkshop({ mode: 'dev', NavigationMock, CanvasBridge });
    const file = workshop.file(info, stories);
    const outside = JSON.stringify(await expand(await file.Page({ params: Promise.resolve({ story: 'Default' }) })));
    expect(outside).toContain('must be served by RSC Stories');
    const store = makeStore({ fileKey: 'card', exportName: 'Nope' });
    const missing = JSON.stringify(
      await storage.run(store, async () => expand(await file.Page({ params: Promise.resolve({ story: 'Nope' }) }))),
    );
    expect(missing).toContain('Story not found');
    const noComponent = workshop.file(info, { default: {}, Empty: {} });
    const emptyStore = makeStore({ fileKey: 'card', exportName: 'Empty' });
    await expect(
      storage.run(emptyStore, async () => expand(await noComponent.Page({ params: Promise.resolve({ story: 'Empty' }) }))),
    ).rejects.toThrow(/no component and no render/);
  });

  it('describes a file and registers runtime hooks', async () => {
    const workshop = createWorkshop({ mode: 'dev', NavigationMock, CanvasBridge });
    const file = workshop.file(info, {
      ...stories,
      Broken: {
        mocks: () => {
          throw new Error('bad mocks');
        },
      },
    });
    const json = (await file.GET().json()) as {
      stories: Array<{ exportName: string; error?: string; args?: unknown; component?: string }>;
      componentKind: string;
    };
    expect(json.componentKind).toBe('server');
    expect(json.stories.map((s) => s.exportName)).toEqual(['Default', 'Rendered', 'WithSpy', 'ClientStory', 'PageProps', 'Broken']);
    expect(json.stories[0]).toMatchObject({ args: { title: 'Hello' }, component: 'Card' });
    expect(json.stories.at(-1)!.error).toBe('bad mocks');
    const store = makeStore({ fileKey: 'card', exportName: 'Default' });
    const runtime = getGlobal().runtime!;
    expect(runtime.resolveFetchMocks(store)).toEqual([]);
    expect(runtime.resolveMocks(makeStore({ fileKey: 'unknown' }))).toBeUndefined();
    expect(runtime.resolveMocks(makeStore({ fileKey: 'card', exportName: 'Broken' }))).toBeUndefined();
  });
});
