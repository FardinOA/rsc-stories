'use client';

import { useActionState } from 'react';
import type { RefundState } from '@/app/actions';

/** Client Component driving the `requestRefund` Server Action. */
export function RefundButton({
  orderId,
  action,
}: {
  orderId: string;
  action: (state: RefundState, data: FormData) => Promise<RefundState>;
}) {
  const [state, formAction, pending] = useActionState(action, { status: 'idle' });
  if (state.status === 'requested')
    return (
      <p role="status" className="text-emerald-700">
        {state.message}
      </p>
    );
  return (
    <form action={formAction}>
      <input type="hidden" name="orderId" value={orderId} />
      <button type="submit" disabled={pending} className="rounded-lg bg-stone-900 px-4 py-2 text-white disabled:opacity-60">
        {pending ? 'Requesting…' : 'Request refund'}
      </button>
      {state.status === 'error' ? (
        <p role="alert" className="mt-2 text-red-700">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
