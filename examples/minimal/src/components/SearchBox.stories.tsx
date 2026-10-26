import type { Meta, StoryObj } from 'rsc-stories';
import { expect } from 'rsc-stories/test';
import { SearchBox } from './SearchBox';

const meta = {
  title: 'Navigation/SearchBox',
  component: SearchBox,
  mocks: { next: { pathname: '/people', searchParams: { q: 'grace' } } },
} satisfies Meta<typeof SearchBox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Types a query and submits; `router.push` is recorded instead of navigating. */
export const Submits: Story = {
  play: async ({ canvas, userEvent }) => {
    const input = canvas.getByLabelText('Search');
    await expect(input).toHaveValue('grace');
    await userEvent.clear(input);
    await userEvent.type(input, 'ada');
    await userEvent.click(canvas.getByRole('button', { name: 'Go' }));
  },
};
