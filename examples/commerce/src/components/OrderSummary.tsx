import { notFound } from 'next/navigation';
import { requestRefund } from '@/app/actions';
import { db } from '@/lib/db';
import { preferredLocale } from '@/lib/preferences';
import { PriceLabel } from './PriceLabel';
import { RefundButton } from './RefundButton';

/** The SRS's example: an async Server Component reading the database, with a client refund button. */
export async function OrderSummary({ orderId }: { orderId: string }) {
  const [order, locale] = await Promise.all([db.orders.findById(orderId), preferredLocale()]);
  if (!order) notFound();
  const subtotal = order.lines.reduce((sum, line) => sum + line.unitCents * line.quantity, 0);
  return (
    <section className="max-w-md space-y-3 rounded-xl border border-stone-200 bg-white p-5">
      <header className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Order {order.id}</h2>
        <span className="text-sm capitalize text-stone-600">{order.status.replace('-', ' ')}</span>
      </header>
      <p className="text-sm text-stone-600">
        Placed {new Date(order.placedAt).toLocaleDateString(locale, { dateStyle: 'medium', timeZone: 'UTC' })}
      </p>
      <ul className="divide-y divide-stone-100">
        {order.lines.map((line) => (
          <li key={line.productId} className="flex justify-between py-2">
            <span>
              {line.quantity} × {line.name}
            </span>
            <PriceLabel cents={line.unitCents * line.quantity} />
          </li>
        ))}
      </ul>
      <dl className="grid grid-cols-2 gap-1 text-sm">
        <dt>Shipping</dt>
        <dd className="text-right">
          <PriceLabel cents={order.shippingCents} />
        </dd>
        <dt className="font-semibold">Total</dt>
        <dd className="text-right font-semibold">
          <PriceLabel cents={subtotal + order.shippingCents} />
        </dd>
      </dl>
      {order.status === 'shipped' ? <RefundButton orderId={order.id} action={requestRefund} /> : null}
    </section>
  );
}
