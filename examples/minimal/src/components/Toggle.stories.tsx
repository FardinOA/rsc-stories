import { fn, type Meta, type StoryObj } from 'rsc-stories';
import { Toggle } from './Toggle';

const meta = {
  title: 'Controls/Toggle',
  component: Toggle,
  args: { label: 'Dark mode', onToggle: fn() },
} satisfies Meta<typeof Toggle>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A Client Component story: `onToggle` becomes an action logged in the Calls panel. */
export const Default: Story = {};
