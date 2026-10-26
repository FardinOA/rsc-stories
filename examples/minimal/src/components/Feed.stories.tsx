import { fixture, type Meta, type StoryObj } from 'rsc-stories';
import { Feed } from './Feed';

const posts = fixture([
  { id: 'p1', authorId: 'u1', text: 'Streaming means the heading never waits for the list.', createdAt: '2026-10-25T11:15:00Z' },
  { id: 'p2', authorId: 'u2', text: 'Suspense boundaries are where the stream can pause.', createdAt: '2026-10-24T08:00:00Z' },
]);

const meta = {
  title: 'Feed/Feed',
  component: Feed,
  args: { title: 'Latest', limit: 10 },
  argTypes: { limit: { control: { type: 'range', min: 0, max: 50, step: 1 } } },
  mocks: {
    modules: { '@/lib/db': { posts: { latest: async (limit: number) => posts.value.slice(0, limit) } } },
    latency: { '@/lib/db': 800 },
  },
} satisfies Meta<typeof Feed>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The heading streams first; the list follows when the (mocked) query resolves. */
export const Default: Story = {};

export const Empty: Story = {
  mocks: { modules: { '@/lib/db': { posts: { latest: async () => posts.empty() } } } },
};

export const Large: Story = {
  args: { limit: 50 },
  mocks: { modules: { '@/lib/db': { posts: { latest: async () => posts.large(50) } } } },
};

/** The query never resolves, so the Suspense fallback stays on screen. */
export const Loading: Story = {
  mocks: { latency: { '@/lib/db': Infinity } },
};
