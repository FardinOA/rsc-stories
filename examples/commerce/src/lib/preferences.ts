import { cookies, headers } from 'next/headers';
import type { Currency } from './rates';

const CURRENCIES: Currency[] = ['USD', 'EUR', 'GBP', 'JPY'];

/** The shopper's currency: cookie first, then a guess from the region header. */
export async function preferredCurrency(): Promise<Currency> {
  const fromCookie = (await cookies()).get('currency')?.value as Currency | undefined;
  if (fromCookie && CURRENCIES.includes(fromCookie)) return fromCookie;
  const region = (await headers()).get('x-region');
  return region === 'eu' ? 'EUR' : region === 'uk' ? 'GBP' : region === 'jp' ? 'JPY' : 'USD';
}

export async function preferredLocale(): Promise<string> {
  return (await cookies()).get('locale')?.value ?? 'en-US';
}
