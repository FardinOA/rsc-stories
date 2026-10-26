import { useMemo, type ComponentType } from 'react';
import { toPreview } from '../../shared/preview';
import { post } from './channel';

interface Props {
  component: ComponentType<Record<string, unknown>>;
  args: Record<string, unknown>;
  /** Arg names that were functions on the server; recreated here as logging actions. */
  actions: string[];
}

/**
 * Renders a Client Component story whose args contain functions. Functions cannot cross the
 * server → client boundary, so the server sends their names and this component recreates them as
 * actions that log to the Actions panel.
 */
export function ClientArgs({ component: Story, args, actions }: Props) {
  const key = actions.join('\u0000');
  const handlers = useMemo(() => {
    const out: Record<string, (...callArgs: unknown[]) => void> = {};
    for (const name of key ? key.split('\u0000') : []) {
      out[name] = (...callArgs: unknown[]) => {
        post({
          type: 'action',
          name,
          // React events are large and circular; keep the useful part.
          args: callArgs.map((arg) =>
            arg && typeof arg === 'object' && 'nativeEvent' in arg
              ? toPreview({ type: (arg as { type?: string }).type, event: '[SyntheticEvent]' })
              : toPreview(arg),
          ),
          time: performance.now(),
        });
      };
    }
    return out;
  }, [key]);
  return <Story {...args} {...handlers} />;
}
