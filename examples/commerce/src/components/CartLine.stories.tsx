import type { Meta, StoryObj } from 'rsc-stories';
import { CartLine } from './CartLine';

const meta = {
  title: 'Commerce/CartLine',
  component: CartLine,
  args: { name: 'Stoneware mug', unitCents: 2400, initialQuantity: 2 },
} satisfies Meta<typeof CartLine>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A Client Component on its own. The inspector flags PriceLabel as inherited client code. */
export const Default: Story = {};

export const Increments: Story = {
  play: async ({ canvas, userEvent, step }) => {
    await step('add one', async () => {
      await userEvent.click(canvas.getByRole('button', { name: 'Add one Stoneware mug' }));
    });
    await canvas.findByText('$72.00');
  },
};
