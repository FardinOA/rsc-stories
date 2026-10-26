import { notFound } from 'next/navigation';
import { follow } from '@/app/actions';
import { db } from '@/lib/db';
import { Avatar } from './Avatar';
import { FollowButton } from './FollowButton';

/** Async Server Component: reads the database, renders a Client Component with a Server Action. */
export async function UserCard({ userId }: { userId: string }) {
  const user = await db.users.findById(userId);
  if (!user) notFound();
  return (
    <article className="card">
      <Avatar name={user.name} />
      <div>
        <h2>{user.name}</h2>
        <p className="muted">@{user.handle}</p>
        <p>{user.bio}</p>
        <FollowButton userId={user.id} followers={user.followers} follow={follow} />
      </div>
    </article>
  );
}
