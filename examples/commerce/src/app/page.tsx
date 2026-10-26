import { ProductGrid } from '@/components/ProductGrid';

export default function Home({ searchParams }: { searchParams: Promise<{ category?: string; sort?: string }> }) {
  return (
    <>
      <h1 className="text-2xl font-semibold">Goods &amp; Co</h1>
      <ProductGrid searchParams={searchParams} />
    </>
  );
}
