import { describe, expect, it } from 'vitest';
import { buildIndex, createIndex, findStory, indexToJson } from '../../src/node/indexer';
import { parseMockSpecifiers, parseStoryFile } from '../../src/node/indexer/parse';
import { tempProject } from '../helpers/project';

describe('parseStoryFile (FR-1.1, FR-1.10)', () => {
  it('reads meta, stories, ids, mocks and the component import', () => {
    const source = `
      import type { Meta, StoryObj } from 'rsc-stories';
      import { OrderSummary } from './OrderSummary';
      import * as UI from '@/ui';
      const shared = { modules: { '@/lib/shared': {} } };
      const meta = {
        title: 'Commerce/OrderSummary',
        component: OrderSummary,
        tags: ['commerce'],
        excludeStories: ['NotAStory'],
        mocks: { ...shared, modules: { '@/lib/db': { orders: {} }, 'stripe': {} } },
      } satisfies Meta<typeof OrderSummary>;
      export default meta;
      type Story = StoryObj<typeof meta>;
      export const Default: Story = { args: { orderId: 'ord_123' } };
      export const Loading: Story = { name: 'Still loading', mocks: () => ({ modules: { '@/lib/slow': {} } }) };
      export const SubmitsRefund: Story = { id: 'refund', tags: ['play'], play: async () => {} };
      export const NotAStory = { args: {} };
      export const Shared = { mocks: shared };
      export const fixtures = {};
      export function helper() {}
      const Local = {};
      export { Local as Renamed };
    `;
    const parsed = parseStoryFile(source, '/x/OrderSummary.stories.tsx', 'src/OrderSummary.stories.tsx');
    expect(parsed.title).toBe('Commerce/OrderSummary');
    expect(parsed.componentId).toBe('commerce-ordersummary');
    expect(parsed.component).toEqual({ localName: 'OrderSummary', source: './OrderSummary', importedName: 'OrderSummary' });
    expect(parsed.stories.map((s) => [s.exportName, s.id, s.name, s.tags, s.hasPlay])).toEqual([
      ['Default', 'commerce-ordersummary--default', 'Default', ['commerce'], false],
      ['Loading', 'commerce-ordersummary--loading', 'Still loading', ['commerce'], false],
      ['SubmitsRefund', 'commerce-ordersummary--refund', 'Submits Refund', ['commerce', 'play'], true],
      ['Shared', 'commerce-ordersummary--shared', 'Shared', ['commerce'], false],
      ['Renamed', 'commerce-ordersummary--renamed', 'Renamed', ['commerce'], false],
    ]);
    expect(parsed.mockSpecifiers).toEqual(['@/lib/db', '@/lib/shared', '@/lib/slow', 'stripe']);
    expect(parsed.isStorybook).toBe(false);
  });

  it('derives titles, handles inline meta, member components and Storybook files', () => {
    const inline = parseStoryFile(
      `import * as UI from './ui'; export default { component: UI.Button, id: 'btn' }; export const A = {};`,
      '/x/Button.stories.jsx',
      'src/ui/Button.stories.jsx',
    );
    expect(inline.title).toBe('ui/Button');
    expect(inline.componentId).toBe('btn');
    expect(inline.component).toEqual({ localName: 'UI.Button', source: './ui', importedName: 'Button' });
    const storybook = parseStoryFile(
      `import type { Meta } from '@storybook/react'; export default {}; export const A = {};`,
      '/x/a.stories.ts',
      'a.stories.ts',
    );
    expect(storybook.isStorybook).toBe(true);
    const noMeta = parseStoryFile(`export const A = {};`, '/x/a.stories.ts', 'a.stories.ts');
    expect(noMeta.warnings[0]).toMatch(/No default export/);
    const included = parseStoryFile(
      `export default { title: 'T', includeStories: /^Only/ }; export const OnlyThis = {}; export const NotThis = {};`,
      '/x/t.stories.js',
      't.stories.js',
    );
    expect(included.stories.map((s) => s.exportName)).toEqual(['OnlyThis']);
  });

  it('reads mock specifiers from preview modules', () => {
    expect(parseMockSpecifiers(`export const mocks = { modules: { '@/lib/auth': {} } };`, 'preview.tsx')).toEqual(['@/lib/auth']);
  });
});

describe('index', () => {
  it('scans a project, keeps keys unique and reports duplicates', async () => {
    const root = await tempProject({
      'src/a/Button.stories.tsx': `export default { title: 'UI/Button' }; export const Primary = {};`,
      'src/b/Button.stories.tsx': `export default { title: 'UI/Button' }; export const Primary = {};`,
      'src/Broken.stories.tsx': `export default {{{`,
      'src/Legacy.stories.tsx': `import { fn } from '@storybook/test'; export default {}; export const A = {};`,
      'node_modules_like/x.stories.tsx': `export default {}; export const A = {};`,
    });
    const index = await createIndex(root, ['src/**/*.stories.tsx'], ['@/extra']);
    expect(index.files.map((f) => f.fileKey).sort()).toEqual(['broken', 'ui-button', 'ui-button-2']);
    expect(index.problems.some((p) => p.includes('Duplicate story id "ui-button--primary"'))).toBe(true);
    expect(index.skipped).toEqual(['src/Legacy.stories.tsx']);
    expect(index.mockSpecifiers).toEqual(['@/extra']);
    expect(index.files.find((f) => f.fileKey === 'broken')?.error).toBeTruthy();
    expect(findStory(index, 'ui-button--primary')?.story.exportName).toBe('Primary');
    expect(findStory(index, 'nope')).toBeUndefined();
    expect(indexToJson(index).files).toHaveLength(3);
    expect(buildIndex([]).files).toEqual([]);
  });
});
