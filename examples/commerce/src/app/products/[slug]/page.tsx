import { notFound } from 'next/navigation';
import { ProductCard } from '@/components/ProductCard';
import { Reviews } from '@/components/Reviews';
import { db } from '@/lib/db';

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await db.products.findBySlug(slug);
  if (!product) notFound();
  return (
    <div className="grid gap-8 md:grid-cols-2">
      <ProductCard product={product} />
      <Reviews productId={product.id} />
    </div>
  );
}
