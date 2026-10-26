'use client';

/**
 * Formats a date relative to "now". `now` differs between the server render and hydration, so
 * without `suppressHydrationWarning` this is a classic hydration mismatch.
 */
export function RelativeTime({ date, now }: { date: Date; now?: number }) {
  const minutes = Math.round(((now ?? Date.now()) - date.getTime()) / 60000);
  const text =
    minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.round(minutes / 60)} h ago` : `${Math.round(minutes / 1440)} d ago`;
  return <time dateTime={date.toISOString()}>{text}</time>;
}
