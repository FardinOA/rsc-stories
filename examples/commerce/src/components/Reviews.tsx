import { Suspense } from 'react';
import { db } from '@/lib/db';
import { Rating } from './Rating';

async function ReviewList({ productId }: { productId: string }) {
  const reviews = await db.reviews.forProduct(productId);
  if (reviews.length === 0) return <p className="text-stone-500">No reviews yet.</p>;
  return (
    <ul className="space-y-3">
      {reviews.map((review) => (
        <li key={review.id}>
          <Rating value={review.rating} /> <strong>{review.author}</strong>
          <p className="text-stone-700">{review.body}</p>
        </li>
      ))}
    </ul>
  );
}

/** Streams slow reviews behind a Suspense boundary. */
export function Reviews({ productId }: { productId: string }) {
  return (
    <section className="max-w-md space-y-3">
      <h2 className="text-lg font-semibold">Reviews</h2>
      <Suspense fallback={<p className="text-stone-500">Loading reviews…</p>}>
        <ReviewList productId={productId} />
      </Suspense>
    </section>
  );
}
