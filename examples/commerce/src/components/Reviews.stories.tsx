import type { Meta, StoryObj } from 'rsc-stories';
import { reviews } from '@/fixtures';
import { Reviews } from './Reviews';

const meta = {
  title: 'Commerce/Reviews',
  component: Reviews,
  args: { productId: 'p1' },
  mocks: {
    modules: { '@/lib/db': { reviews: { forProduct: async () => reviews.value } } },
    latency: { '@/lib/db': 1200 },
  },
} satisfies Meta<typeof Reviews>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The heading renders at once; reviews stream in after 1.2 s. */
export const Streaming: Story = {};

export const Empty: Story = {
  mocks: { modules: { '@/lib/db': { reviews: { forProduct: async () => [] } } }, latency: { '@/lib/db': 0 } },
};
