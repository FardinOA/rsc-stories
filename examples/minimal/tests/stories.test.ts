import { describe, expect, it } from 'vitest';
import { renderStory } from 'rsc-stories/vitest';
import * as userCard from '../src/components/UserCard.stories';
import * as feed from '../src/components/Feed.stories';

describe('UserCard', () => {
  it('renders the mocked user on the server', async () => {
    const story = await renderStory(userCard.Default);
    expect(story.status).toBe(200);
    expect(story.container?.querySelector('h2')?.textContent).toBe('Ada Lovelace');
    expect(story.calls.map((call) => call.label)).toContain('db.users.findById');
    expect(story.report.boundaries.map((b) => b.to)).toEqual(['FollowButton']);
  });

  it('keeps the payload within budget and flags the Badge leak', async () => {
    const story = await renderStory(userCard.Default);
    expect(story.report.storyPayloadBytes).toBeLessThan(20 * 1024);
    expect(story.report.clientLeaks.map((leak) => leak.component)).toContain('Badge');
  });

  it('accepts arg overrides', async () => {
    const story = await renderStory('people-usercard--default', { args: { userId: 'missing' } });
    expect(story.report.navigation).toEqual([{ type: 'notFound' }]);
  });
});

describe('Feed', () => {
  it('streams the list with mocked data', async () => {
    const story = await renderStory(feed.Default);
    expect(story.html).toMatchSnapshot();
  });

  it('renders the empty variant', async () => {
    const story = await renderStory(feed.Empty);
    expect(story.container?.textContent).toContain('Nothing here yet.');
  });
});
