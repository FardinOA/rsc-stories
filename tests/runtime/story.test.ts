import { describe, expect, it } from 'vitest';
import { getMeta, resolveStory, storyExports, StoryNotFoundError } from '../../src/runtime/server/story';
import type { Decorator } from '../../src/types';

const file = { fileKey: 'button', componentId: 'ui-button', title: 'UI/Button', path: 'src/Button.stories.tsx' };
const Button = (props: { label: string }) => props.label;
const d = (name: string): Decorator => Object.assign((Story: () => unknown) => Story(), { label: name }) as unknown as Decorator;

describe('resolveStory', () => {
  const stories = {
    default: {
      component: Button,
      args: { label: 'meta', size: 'm' },
      argTypes: { size: { control: 'select', options: ['s', 'm'] } },
      parameters: { layout: 'centered', backgrounds: { default: 'Light' } },
      decorators: [d('meta')],
      mocks: { modules: { db: { a: 1 } } },
      tags: ['ui'],
    },
    Primary: { args: { label: 'story' }, decorators: [d('story')], tags: ['primary'], play: async () => {} },
    Secondary: { name: 'Second one', id: 'second', mocks: () => ({ modules: { db: { a: 2 } } }) },
    helper: () => null,
  };

  it('layers config, previews, meta, story and URL state', () => {
    const story = resolveStory({
      file,
      stories,
      exportName: 'Primary',
      state: { args: { size: 'l' }, globals: { background: 'Dark' } },
      config: { default: { parameters: { layout: 'padded', a: 1 }, decorators: [d('config')], globals: { theme: 'x' } } },
      previews: [{ decorators: [d('preview')], args: { size: 's', extra: true } }, { decorators: [d('addon')] }],
      mode: 'dev',
    });
    expect(story.id).toBe('ui-button--primary');
    expect(story.name).toBe('Primary');
    expect(story.args).toEqual({ label: 'story', size: 'l', extra: true });
    expect(story.parameters).toMatchObject({ layout: 'centered', a: 1 });
    expect(story.globals).toEqual({ theme: 'x', background: 'Dark' });
    expect(story.decorators.map((x) => (x as unknown as { label: string }).label)).toEqual(['story', 'meta', 'preview', 'addon', 'config']);
    expect(story.hasPlay).toBe(true);
    expect(story.tags).toEqual(['ui', 'primary']);
    expect(story.component).toBe(Button);
    expect(story.context).toMatchObject({ title: 'UI/Button', exportName: 'Primary', mode: 'dev' });
  });

  it('uses explicit names, ids and function mocks', () => {
    const story = resolveStory({ file, stories, exportName: 'Secondary', state: {}, mode: 'test' });
    expect(story.id).toBe('ui-button--second');
    expect(story.name).toBe('Second one');
    expect(story.mocks.modules.get('db')!.impl).toEqual({ a: 2 });
  });

  it('warns about overrides that match nothing', () => {
    const story = resolveStory({
      file,
      stories,
      exportName: 'Primary',
      state: { mocks: { variants: { 'fetch:nope': 'x' } } },
      mode: 'dev',
    });
    expect(story.warnings[0]?.type).toBe('unknown-mock-override');
  });

  it('throws for unknown exports and lists stories', () => {
    expect(() => resolveStory({ file, stories, exportName: 'helper', state: {}, mode: 'dev' })).toThrow(StoryNotFoundError);
    expect(storyExports(stories)).toEqual(['Primary', 'Secondary']);
    expect(getMeta({ default: { default: { title: 'cjs' } } }).title).toBe('cjs');
    expect(getMeta({})).toEqual({});
  });
});
