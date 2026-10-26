import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractInlineFlight, FlightPayload } from '../../src/node/inspector/flight';
import { diffLines, normalizeHtml, serverStoryHtml } from '../../src/node/inspector/html';
import { parseSerializationError } from '../../src/node/inspector/report';
import { normalizedModel, stableReport } from '../../src/node/inspector/snapshot';
import { buildTree, findStoryRoot, storyPayloadBytes, type InspectorNode } from '../../src/node/inspector/tree';

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
const payloadOf = (name: string) => new FlightPayload(name.endsWith('.rsc') ? fixture(name) : extractInlineFlight(fixture(name)));
const names = (node: InspectorNode | undefined, kinds = ['server', 'client', 'suspense']): string[] =>
  node
    ? [
        ...(kinds.includes(node.kind) ? [`${node.kind}:${node.name}`] : []),
        ...node.children.flatMap((c) => names(c, kinds)),
        ...(node.fallback ?? []).flatMap((c) => names(c, kinds)),
      ]
    : [];

describe('component tree (FR-5.1, FR-5.2)', () => {
  it('reads server components from development debug info', () => {
    const tree = buildTree(payloadOf('usercard.dev.html'));
    expect(names(tree.root)).toEqual(['server:UserCard', 'server:Avatar', 'client:FollowButton']);
    expect(tree.boundaries).toHaveLength(1);
    expect(tree.boundaries[0]).toMatchObject({ from: 'UserCard', to: 'FollowButton' });
    expect(Object.keys(tree.boundaries[0]!.propSizes).sort()).toEqual(['follow', 'followers', 'userId']);
    expect(tree.boundaries[0]!.props).toMatchObject({ userId: 'u1', followers: 1815, follow: expect.stringContaining('Server Action') });
  });

  it('reads the same story from an RSC navigation payload', () => {
    const tree = buildTree(payloadOf('usercard.dev.rsc'));
    expect(names(tree.root)).toEqual(['server:UserCard', 'server:Avatar', 'client:FollowButton']);
  });

  it('degrades gracefully on production payloads (no server component names)', () => {
    const tree = buildTree(payloadOf('usercard.prod.html'));
    expect(names(tree.root)).toEqual(['client:FollowButton']);
    expect(tree.boundaries[0]!.from).toBe('(story root)');
  });

  it('shows Suspense boundaries with their fallbacks', () => {
    const tree = buildTree(payloadOf('feed.dev.html'));
    const all = names(tree.root, ['server', 'client', 'suspense', 'host']);
    expect(all).toContain('suspense:Suspense');
    expect(all).toContain('server:FeedItems');
    expect(tree.boundaries.map((b) => b.to)).toEqual(['RelativeTime', 'RelativeTime']);
  });

  it('measures the story share of the payload', () => {
    const payload = payloadOf('usercard.prod.html');
    const tree = buildTree(payload);
    const bytes = storyPayloadBytes(payload, tree.reachable, tree.rootBytes);
    expect(bytes).toBeGreaterThan(200);
    expect(bytes).toBeLessThan(payload.totalBytes);
    expect(findStoryRoot(new FlightPayload('0:["$","div",null,{}]'))).toBeUndefined();
    expect(buildTree(new FlightPayload('0:1')).root).toBeUndefined();
  });
});

describe('server HTML (FR-5.7)', () => {
  it('reconstructs streamed boundaries', () => {
    const html = serverStoryHtml(fixture('feed.dev.html'))!;
    expect(html).toContain('Streaming means the heading never waits for the list.');
    expect(html).not.toContain('Loading posts');
    const synthetic = serverStoryHtml(
      '<div data-rsc-stories-root=""><!--$?--><template id="B:0"></template><p>fallback</p><!--/$--><template id="P:1"></template></div>' +
        '<div hidden id="S:0"><b>content</b></div><script>$RC("B:0","S:0")</script>' +
        '<div hidden id="S:1"><i>segment</i></div><script>$RS("S:1","P:1")</script>',
    );
    expect(synthetic).toBe('<!--$--><b>content</b><!--/$--><i>segment</i>');
    expect(
      serverStoryHtml(
        '<div data-rsc-stories-root=""><!--$?--><template id="B:0"></template>x<!--/$--></div><script>$RX("B:0","d")</script>',
      ),
    ).toContain('<!--$!-->');
    expect(serverStoryHtml('<p>no root</p>')).toBeUndefined();
    // A boundary that errored leaves its streamed segment hidden and unused (development builds).
    expect(
      serverStoryHtml(
        '<!--$?--><template id="B:0"></template>…<!--/$--><div hidden id="S:0"><div data-rsc-stories-root=""><div></div></div></div><script>$RX("B:0","d")</script>',
      ),
    ).toBeUndefined();
  });

  it('normalizes HTML deterministically', () => {
    const a = normalizeHtml(
      '<div  class="b"   id="«r0»" style="max-width: 640px;"><p>Hello <!-- -->Ada</p><input name="$ACTION_ID_abc123"><span style=""></span></div>',
    );
    const b = normalizeHtml(
      '<div id="«r9»" class="b" style="max-width:640px"><p>Hello Ada</p><input name="$ACTION_ID_def456"><span></span></div>',
    );
    expect(a).toBe(b);
    expect(a).toBe(
      '<div class="b" id="«id0»" style="max-width:640px">\n  <p>Hello Ada</p>\n  <input name="$ACTION_ID_<id>">\n  <span></span>\n</div>',
    );
    expect(normalizeHtml('text <b>x</b> more')).toBe('text\n<b>x</b>\nmore');
    expect(normalizeHtml('<div class="h1XLeG_variable font-sans"></div>')).toBe(
      normalizeHtml('<div class="__variable_d8ebd1 font-sans"></div>'),
    );
    expect(normalizeHtml('<div class="__className_d8ebd1"></div>')).toBe('<div class="<font-className>"></div>');
    expect(normalizeHtml('<div class="inter_8a594245-module__h1XLeG__variable font-sans"></div>')).toBe(
      '<div class="<font-variable> font-sans"></div>',
    );
    expect(
      normalizeHtml(
        '<input name="$ACTION_1:0" type="hidden" value=\'{"id":"604d6d364d303a07f4598c2548401b5151f379296b","bound":null}\'><input name="$ACTION_KEY" type="hidden" value="k9bc5206aa3fe69478d66854bc837124d">',
      ),
    ).toBe(
      '<input name="$ACTION_1:0" type="hidden" value="{&quot;id&quot;:&quot;<action-id>&quot;,&quot;bound&quot;:null}">\n<input name="$ACTION_KEY" type="hidden" value="<action-key>">',
    );
  });

  it('diffs lines', () => {
    expect(diffLines('a\nb\nc', 'a\nx\nc')).toEqual([
      { op: ' ', text: 'a' },
      { op: '-', text: 'b' },
      { op: '+', text: 'x' },
      { op: ' ', text: 'c' },
    ]);
    expect(diffLines('', 'a')).toEqual([{ op: '+', text: 'a' }]);
    expect(diffLines('a', '')).toEqual([{ op: '-', text: 'a' }]);
    expect(diffLines('same', 'same').every((l) => l.op === ' ')).toBe(true);
  });
});

describe('serialization errors (FR-5.3)', () => {
  it('finds the prop React pointed at', () => {
    const message = [
      'Event handlers cannot be passed to Client Component props.',
      '  <... label=... onToggle={function onToggle}>',
      '                          ^^^^^^^^^^^^^^^^^^^',
      'If you need interactivity, consider converting part of this to a Client Component.',
    ].join('\n');
    expect(parseSerializationError(message)).toEqual({
      prop: 'onToggle',
      reason: 'Event handlers cannot be passed to Client Component props',
    });
    expect(
      parseSerializationError(
        'Only plain objects, and a few built-ins, can be passed to Client Components from Server Components. Classes or null prototypes are not supported.\n  <Price amount={{}}>\n               ^^^^',
      ),
    ).toEqual({
      prop: 'amount',
      component: 'Price',
      reason: 'Only plain objects, and a few built-ins, can be passed to Client Components',
    });
    expect(parseSerializationError('Something else')).toBeUndefined();
  });

  it('is found in a real development payload', () => {
    const payload = payloadOf('functionprop.dev.html');
    const message = [...payload.errors.values()].map((row) => (row.value as { message?: string }).message ?? '').join('\n');
    expect(parseSerializationError(message)?.prop).toBe('onToggle');
  });
});

describe('snapshots (FR-7.3)', () => {
  const options = {
    rootDir: '/repo',
    projectRoot: '/repo/examples/minimal',
    workshopDir: '/repo/examples/minimal/.rsc-stories/.cache/workshop',
    distDir: '/nowhere',
  };

  it('produces the same RSC model from development and production payloads', () => {
    const dev = normalizedModel(payloadOf('usercard.dev.html'), options);
    const prod = normalizedModel(payloadOf('usercard.prod.html'), options);
    expect(JSON.stringify(dev)).toContain('"$client":"src/components/FollowButton.tsx#FollowButton"');
    // Production module ids are numeric and resolve through the build's client-reference manifest,
    // which this fixture does not include; compare everything else.
    const withoutFiles = (model: unknown) => JSON.parse(JSON.stringify(model).replace(/"\$client":"[^"#]*#/g, '"$client":"#'));
    expect(withoutFiles(dev)).toEqual(withoutFiles(prod));
  });

  it('keeps only stable report fields', () => {
    const report = stableReport({
      storyId: 'a--b',
      status: 200,
      boundaries: [
        { from: 'X', to: 'Y', propsBytes: 3, props: { a: 1 }, nonSerializable: [], module: 'm', exportName: 'Y', propSizes: {} },
      ],
      clientComponents: [{ name: 'Y', module: 'm', file: 'src/Y.tsx', chunks: ['c1'], bytes: 1, gzip: 1 }],
      clientLeaks: [],
      nonSerializable: [],
      navigation: [],
      warnings: [{ type: 'unmocked-request', message: 'w' }],
      calls: [
        { id: 2, kind: 'module', key: 'k', label: 'b', args: [], mocked: true, status: 'ok', start: 9 },
        { id: 1, kind: 'fetch', key: 'k', label: 'a', args: [], mocked: true, status: 'ok', start: 1 },
      ],
    } as never);
    expect(report).toEqual({
      boundaries: [{ nonSerializable: [], props: { a: 1 }, propsBytes: 3, to: 'Y' }],
      calls: [
        { kind: 'fetch', label: 'a', mocked: true, status: 'ok' },
        { kind: 'module', label: 'b', mocked: true, status: 'ok' },
      ],
      clientComponents: [{ file: 'src/Y.tsx', name: 'Y' }],
      clientLeaks: [],
      navigation: [],
      nonSerializable: [],
      status: 200,
      storyId: 'a--b',
      warnings: ['w'],
    });
  });
});
