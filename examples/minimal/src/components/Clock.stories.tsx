import type { Meta, StoryObj } from 'rsc-stories';
import { Clock } from './Clock';

const meta = {
  title: 'Diagnostics/Clock',
  component: Clock,
  tags: ['!test'],
} satisfies Meta<typeof Clock>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Renders the time on both sides: the Hydration tab shows the mismatch and the DOM diff. */
export const HydrationMismatch: Story = {};
