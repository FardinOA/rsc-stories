'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

/** Reads and writes the URL with `next/navigation` client hooks. */
export function SearchBox({ placeholder = 'Search people' }: { placeholder?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  return (
    <form
      role="search"
      className="search"
      onSubmit={(event) => {
        event.preventDefault();
        router.push(`${pathname}?q=${encodeURIComponent(query)}`);
      }}
    >
      <label htmlFor="q">Search</label>
      <input id="q" value={query} placeholder={placeholder} onChange={(event) => setQuery(event.target.value)} />
      <button type="submit">Go</button>
    </form>
  );
}
