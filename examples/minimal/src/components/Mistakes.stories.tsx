import type { Meta, StoryObj } from 'rsc-stories';
import { Explodes, PassesAFunction } from './Mistakes';

const meta = {
  title: 'Diagnostics/Mistakes',
  // These stories fail on purpose; keep them out of `rsc-stories test`.
  tags: ['!test'],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** A server render error: shown in the canvas with the server stack in the Console panel. */
export const ServerError: Story = {
  render: () => <Explodes />,
};

/** A function crossing the boundary: the Boundaries tab names the prop React rejected. */
export const FunctionProp: Story = {
  render: () => <PassesAFunction />,
};
