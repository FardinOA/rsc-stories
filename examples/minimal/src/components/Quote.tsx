import { fetchQuote } from '@/lib/quotes';

/** Fetches from a third-party API; stories answer with fetch mocks. */
export async function Quote() {
  const quote = await fetchQuote();
  return (
    <figure className="card column">
      <blockquote>“{quote.text}”</blockquote>
      <figcaption className="muted">— {quote.author}</figcaption>
    </figure>
  );
}
