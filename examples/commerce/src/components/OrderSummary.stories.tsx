// The story sketched in the SRS (§5.1), running for real.
import type { Meta, StoryObj } from 'rsc-stories';
import { OrderSummary } from './OrderSummary'; // async Server Component
import { fixtures } from '@/fixtures';

const meta = {
  title: 'Commerce/OrderSummary',
  component: OrderSummary,
  mocks: {
    modules: {
      // `db` is the module's only object export, so the export name can be omitted.
      '@/lib/db': {
        orders: { findById: async () => fixtures.order, requestRefund: async () => ({ ...fixtures.order, status: 'refund-requested' }) },
      },
    },
    next: { cookies: { locale: 'en' }, headers: { 'x-region': 'eu' } },
  },
} satisfies Meta<typeof OrderSummary>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { orderId: 'ord_123' } };

export const Loading: Story = {
  args: { orderId: 'ord_123' },
  mocks: { latency: { '@/lib/db': 3000 } },
};

export const NotFound: Story = {
  args: { orderId: 'missing' },
  mocks: { modules: { '@/lib/db': { orders: { findById: async () => null } } } },
};

export const SubmitsRefund: Story = {
  args: { orderId: 'ord_123' },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Request refund' }));
    await canvas.findByText('Refund requested');
  },
};

export const BritishLocale: Story = {
  args: { orderId: 'ord_123' },
  mocks: { next: { cookies: { locale: 'en-GB' } } },
};
