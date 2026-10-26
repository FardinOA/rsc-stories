import { cookies } from 'next/headers';

/** The signed-in user id from the `session` cookie, if any. */
export async function currentUserId(): Promise<string | null> {
  return (await cookies()).get('session')?.value ?? null;
}
