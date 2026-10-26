import { fn, type Meta, type StoryObj } from 'rsc-stories';
import { InviteButton } from './InviteButton';

const meta = {
  title: 'Shared UI/InviteButton',
  component: InviteButton,
  // Function args of a Client Component become actions logged in the Calls panel. (Passing a
  // function to a Client Component inside a custom `render` is an RSC error, as in the app.)
  args: { teamName: 'Platform', onInvite: fn() },
} satisfies Meta<typeof InviteButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

export const SendsInvite: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Invite to Platform' }));
    await userEvent.type(canvas.getByLabelText('Email'), 'new@acme.test');
    await userEvent.click(canvas.getByRole('button', { name: 'Send invite' }));
  },
};
