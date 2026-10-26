'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import type { Currency } from '@/lib/rates';

export interface RefundState {
  status: 'idle' | 'requested' | 'error';
  message?: string;
}

/** Requests a refund for an order. */
export async function requestRefund(_previous: RefundState, formData: FormData): Promise<RefundState> {
  const orderId = String(formData.get('orderId'));
  try {
    await db.orders.requestRefund(orderId);
    revalidatePath(`/orders/${orderId}`);
    return { status: 'requested', message: 'Refund requested' };
  } catch (error) {
    return { status: 'error', message: (error as Error).message };
  }
}

/** Stores the shopper's currency in a cookie. */
export async function setCurrency(currency: Currency): Promise<void> {
  (await cookies()).set('currency', currency, { path: '/', sameSite: 'lax' });
  revalidatePath('/');
}
