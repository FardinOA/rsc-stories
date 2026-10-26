import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { currentUserId } from '@/lib/session';

/** Redirects signed-out visitors; reads the session cookie. */
export async function AccountGate({ children }: { children: ReactNode }) {
  const userId = await currentUserId();
  if (!userId) redirect('/login');
  return (
    <section className="card column">
      <p className="muted">Signed in as {userId}</p>
      {children}
    </section>
  );
}
