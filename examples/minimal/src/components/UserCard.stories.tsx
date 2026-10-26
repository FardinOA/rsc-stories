import { mockVariants, type Meta, type StoryObj } from 'rsc-stories';
import { UserCard } from './UserCard';

const ada = { id: 'u1', name: 'Ada Lovelace', handle: 'ada', bio: 'Poet of numbers.', followers: 1815 };

const meta = {
  title: 'People/UserCard',
  component: UserCard,
  args: { userId: 'u1' },
  mocks: () => {
    // A function: every render gets a fresh follower count, so actions never leak between renders.
    let followers = ada.followers;
    return {
      modules: {
        '@/lib/db': mockVariants(
          {
            users: {
              findById: async (id: string) => (id === ada.id ? { ...ada, followers } : null),
              follow: async () => ++followers,
            },
          },
          {
            missing: { users: { findById: async () => null } },
            failingFollow: {
              users: {
                follow: async () => {
                  throw new Error('Rate limited, try again later');
                },
              },
            },
          },
        ),
      },
    };
  },
} satisfies Meta<typeof UserCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Unknown: Story = {
  name: 'Unknown user (notFound)',
  args: { userId: 'nobody' },
};

export const SlowDatabase: Story = {
  mocks: { latency: { '@/lib/db': 2000 } },
};
