import type { Meta, StoryObj } from 'rsc-stories';
import { AccountGate } from './AccountGate';

const meta = {
  title: 'Account/AccountGate',
  component: AccountGate,
  args: { children: 'Your settings' },
} satisfies Meta<typeof AccountGate>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SignedIn: Story = {
  mocks: { next: { cookies: { session: 'u1' } } },
};

/** No session cookie: `redirect('/login')` is intercepted and shown in the canvas. */
export const SignedOut: Story = {};
