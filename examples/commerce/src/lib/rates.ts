export type Currency = 'USD' | 'EUR' | 'GBP' | 'JPY';

/** Exchange rates from USD, fetched from a public API (mocked in stories). */
export async function getRates(): Promise<Record<Currency, number>> {
  const response = await fetch('https://api.frankfurter.app/latest?from=USD&to=EUR,GBP,JPY', {
    next: { revalidate: 3600 },
  });
  if (!response.ok) throw new Error(`Rates service answered ${response.status}`);
  const data = (await response.json()) as { rates: Record<string, number> };
  return { USD: 1, EUR: data.rates.EUR ?? 1, GBP: data.rates.GBP ?? 1, JPY: data.rates.JPY ?? 1 };
}
