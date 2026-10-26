'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

const CATEGORIES = ['kitchen', 'lighting', 'furniture', 'stationery'] as const;

/** Client Component: filters write to the URL with next/navigation. */
export function Filters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = searchParams.get('category');
  const update = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`${pathname}?${next.toString()}`);
  };
  return (
    <nav aria-label="Filters" className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        aria-pressed={!active}
        onClick={() => update('category', null)}
        className="rounded-full border px-3 py-1 text-sm aria-pressed:bg-stone-900 aria-pressed:text-white"
      >
        All
      </button>
      {CATEGORIES.map((category) => (
        <button
          key={category}
          type="button"
          aria-pressed={active === category}
          onClick={() => update('category', category)}
          className="rounded-full border px-3 py-1 text-sm capitalize aria-pressed:bg-stone-900 aria-pressed:text-white"
        >
          {category}
        </button>
      ))}
      <label className="ml-auto text-sm">
        Sort{' '}
        <select
          value={searchParams.get('sort') ?? ''}
          onChange={(event) => update('sort', event.target.value || null)}
          className="rounded border px-2 py-1"
        >
          <option value="">Featured</option>
          <option value="price-asc">Price: low to high</option>
          <option value="price-desc">Price: high to low</option>
          <option value="rating">Rating</option>
        </select>
      </label>
    </nav>
  );
}
