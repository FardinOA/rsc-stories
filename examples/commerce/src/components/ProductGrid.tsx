import { db } from '@/lib/db';
import type { Category } from '@/lib/types';
import { Filters } from './Filters';
import { ProductCard } from './ProductCard';

/** Async Server Component reading page `searchParams`. */
export async function ProductGrid({ searchParams }: { searchParams: Promise<{ category?: string; sort?: string }> }) {
  const { category, sort } = await searchParams;
  const products = await db.products.list({ category: category as Category | undefined, sort: sort as 'rating' | undefined });
  return (
    <section className="space-y-4">
      <Filters />
      {products.length === 0 ? (
        <p className="text-stone-500">No products in this category yet.</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </section>
  );
}
