'use client';

import { useActionState } from 'react';
import type { FollowState } from '@/app/actions';
import { Badge } from './Badge';

interface Props {
  userId: string;
  followers: number;
  /** A Server Action, passed from the server. */
  follow: (state: FollowState, formData: FormData) => Promise<FollowState>;
}

/** Client Component driving a Server Action with `useActionState`. */
export function FollowButton({ userId, followers, follow }: Props) {
  const [state, action, pending] = useActionState(follow, { followers, following: false });
  return (
    <form action={action} className="follow">
      <input type="hidden" name="userId" value={userId} />
      <button type="submit" disabled={pending || state.following}>
        {state.following ? 'Following' : pending ? 'Following…' : 'Follow'}
      </button>
      <Badge count={state.followers} label="followers" />
      {state.error ? <p role="alert">{state.error}</p> : null}
    </form>
  );
}
