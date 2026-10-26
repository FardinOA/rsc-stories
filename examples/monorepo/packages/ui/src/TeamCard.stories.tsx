import type { Meta, StoryObj } from 'rsc-stories';
import { TeamCard } from './TeamCard';

const team = {
  id: 't1',
  name: 'Platform',
  plan: 'pro',
  members: [
    { id: 'm1', name: 'Rhea', role: 'owner' },
    { id: 'm2', name: 'Ilya', role: 'admin' },
    { id: 'm3', name: 'Sam', role: 'member' },
  ],
};

const meta = {
  title: 'Shared UI/TeamCard',
  component: TeamCard,
  args: { teamId: 't1' },
  mocks: {
    fetch: [
      {
        name: 'team',
        match: 'GET https://internal.acme.test/teams/:id',
        response: (_request, { params }) => ({ ...team, id: params.id }),
        variants: { forbidden: { status: 403, response: { error: 'forbidden' } } },
      },
    ],
  },
} satisfies Meta<typeof TeamCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Mocks the workspace package itself instead of its HTTP call. */
export const MockedPackage: Story = {
  mocks: {
    modules: {
      '@acme/data': { getTeam: async () => ({ ...team, name: 'Design', plan: 'enterprise', members: team.members.slice(0, 1) }) },
    },
  },
};
