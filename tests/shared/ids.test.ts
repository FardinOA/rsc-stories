import { describe, expect, it } from 'vitest';
import { isStoryExport, sanitize, storyNameFromExport, titleFromPath, toComponentId, toStoryId } from '../../src/shared/ids';

describe('ids', () => {
  it('sanitizes like Storybook', () => {
    expect(sanitize('Commerce/OrderSummary')).toBe('commerce-ordersummary');
    expect(sanitize('  Héllo  World!! ')).toBe('hello-world');
    expect(sanitize('a--b__c')).toBe('a-b-c');
  });

  it('derives story ids from the title and export (FR-1.10)', () => {
    expect(toStoryId(toComponentId('Commerce/OrderSummary'), 'Default')).toBe('commerce-ordersummary--default');
    expect(toStoryId('commerce-ordersummary', 'SubmitsRefund')).toBe('commerce-ordersummary--submitsrefund');
  });

  it('prefers explicit ids so renames keep ids stable', () => {
    expect(toComponentId('New/Title', 'orders')).toBe('orders');
    expect(toStoryId('orders', 'Renamed', 'default')).toBe('orders--default');
  });

  it('names stories from exports', () => {
    expect(storyNameFromExport('SubmitsRefund')).toBe('Submits Refund');
    expect(storyNameFromExport('with_long-name')).toBe('With long name');
    expect(storyNameFromExport('HTMLParser')).toBe('HTML Parser');
  });

  it('derives titles from paths', () => {
    expect(titleFromPath('src/components/Button.stories.tsx')).toBe('components/Button');
    expect(titleFromPath('src/Button/Button.stories.tsx')).toBe('Button');
    expect(titleFromPath('./ui/card/index.stories.ts')).toBe('ui/card');
  });

  it('filters story exports', () => {
    expect(isStoryExport('Default')).toBe(true);
    expect(isStoryExport('default')).toBe(false);
    expect(isStoryExport('helper')).toBe(false);
    expect(isStoryExport('__private')).toBe(false);
    expect(isStoryExport('Primary', { excludeStories: /Prim/ })).toBe(false);
    expect(isStoryExport('Primary', { includeStories: ['Secondary'] })).toBe(false);
    expect(isStoryExport('Secondary', { includeStories: ['Secondary'] })).toBe(true);
  });
});
