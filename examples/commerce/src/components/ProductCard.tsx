import Image from 'next/image';
import Link from 'next/link';
import type { Product } from '@/lib/types';
import { Price } from './Price';
import { Rating } from './Rating';

/** Server Component using next/image and next/link, with an async child (Price). */
export function ProductCard({ product }: { product: Product }) {
  return (
    <article className="overflow-hidden rounded-xl border border-stone-200 bg-white">
      <Link href={`/products/${product.slug}`} className="block">
        <Image src={product.image} alt="" width={400} height={300} className="aspect-[4/3] w-full object-cover" />
      </Link>
      <div className="space-y-1 p-4">
        <h3 className="font-medium text-stone-900">
          <Link href={`/products/${product.slug}`}>{product.name}</Link>
        </h3>
        <Rating value={product.rating} />
        <div className="flex items-center justify-between">
          <Price cents={product.priceCents} className="font-semibold" />
          {product.inStock ? null : <span className="text-sm text-stone-500">Sold out</span>}
        </div>
      </div>
    </article>
  );
}
