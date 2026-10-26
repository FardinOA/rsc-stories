import { preferredCurrency, preferredLocale } from '@/lib/preferences';
import { getRates } from '@/lib/rates';

/** Async Server Component: converts a USD price with live rates and the shopper's cookie currency. */
export async function Price({ cents, className }: { cents: number; className?: string }) {
  const [rates, currency, locale] = await Promise.all([getRates(), preferredCurrency(), preferredLocale()]);
  const amount = (cents / 100) * rates[currency];
  return (
    <span className={className} data-currency={currency}>
      {new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount)}
    </span>
  );
}
