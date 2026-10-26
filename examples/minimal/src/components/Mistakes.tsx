import type { ReactNode } from 'react';
import { Toggle } from './Toggle';

/** Throws while rendering on the server. */
export async function Explodes({ message = 'The database is on fire' }: { message?: string }): Promise<ReactNode> {
  await Promise.resolve();
  throw new Error(message);
}

/** Passes a plain function from the server to a Client Component — React refuses to serialize it. */
export function PassesAFunction() {
  return <Toggle label="Notifications" onToggle={(on) => console.log('toggled', on)} />;
}
