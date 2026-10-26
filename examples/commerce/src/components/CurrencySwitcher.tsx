'use client';

import { useTransition } from 'react';
import type { Currency } from '@/lib/rates';

/** Calls a Server Action that writes a cookie. */
export function CurrencySwitcher({ current, setCurrency }: { current: Currency; setCurrency: (currency: Currency) => Promise<void> }) {
  const [pending, startTransition] = useTransition();
  return (
    <label className="text-sm">
      Currency{' '}
      <select
        value={current}
        disabled={pending}
        onChange={(event) => startTransition(() => setCurrency(event.target.value as Currency))}
        className="rounded border px-2 py-1"
      >
        {(['USD', 'EUR', 'GBP', 'JPY'] as const).map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
    </label>
  );
}
