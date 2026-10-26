import { Suspense } from 'react';
import { db } from '@/lib/db';
import { RelativeTime } from './RelativeTime';

async function FeedItems({ limit }: { limit: number }) {
  const posts = await db.posts.latest(limit);
  if (posts.length === 0) return <p className="muted">Nothing here yet.</p>;
  return (
    <ul className="feed">
      {posts.map((post) => (
        <li key={post.id}>
          <p>{post.text}</p>
          <RelativeTime date={new Date(post.createdAt)} now={Date.parse('2026-10-25T12:00:00Z')} />
        </li>
      ))}
    </ul>
  );
}

/** Streams its items: the heading renders immediately, the list when the query resolves. */
export function Feed({ title = 'Latest', limit = 10 }: { title?: string; limit?: number }) {
  return (
    <section className="card column">
      <h2>{title}</h2>
      <Suspense fallback={<p className="muted">Loading posts…</p>}>
        <FeedItems limit={limit} />
      </Suspense>
    </section>
  );
}
