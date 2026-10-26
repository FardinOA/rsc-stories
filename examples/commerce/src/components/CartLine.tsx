'use client';

import { useState } from 'react';
import { PriceLabel } from './PriceLabel';

/** Client Component with local state; pulls PriceLabel into the client bundle. */
export function CartLine({ name, unitCents, initialQuantity = 1 }: { name: string; unitCents: number; initialQuantity?: number }) {
  const [quantity, setQuantity] = useState(initialQuantity);
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span>{name}</span>
      <span className="flex items-center gap-2">
        <button
          type="button"
          aria-label={`Remove one ${name}`}
          onClick={() => setQuantity((q) => Math.max(0, q - 1))}
          className="h-7 w-7 rounded border"
        >
          −
        </button>
        <output aria-live="polite" className="w-6 text-center tabular-nums">
          {quantity}
        </output>
        <button type="button" aria-label={`Add one ${name}`} onClick={() => setQuantity((q) => q + 1)} className="h-7 w-7 rounded border">
          +
        </button>
        <PriceLabel cents={unitCents * quantity} />
      </span>
    </div>
  );
}
