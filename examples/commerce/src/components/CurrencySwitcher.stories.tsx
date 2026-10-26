import type { Meta, StoryObj } from 'rsc-stories';
import { setCurrency } from '@/app/actions';
import { CurrencySwitcher } from './CurrencySwitcher';

const meta = {
  title: 'Commerce/CurrencySwitcher',
  component: CurrencySwitcher,
  // A real Server Action as an arg: it runs on the server with the story's mocks applied.
  args: { current: 'USD', setCurrency },
} satisfies Meta<typeof CurrencySwitcher>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
