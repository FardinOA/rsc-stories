export interface Quote {
  text: string;
  author: string;
}

/** Fetches a quote from a third-party API (mocked in stories). */
export async function fetchQuote(): Promise<Quote> {
  const response = await fetch('https://quotes.example.com/api/today', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Quote service answered ${response.status}`);
  return (await response.json()) as Quote;
}
