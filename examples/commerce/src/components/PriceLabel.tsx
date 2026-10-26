/** Formats cents. No client APIs — CartLine imports it, so it ships to the browser anyway. */
export function PriceLabel({ cents }: { cents: number }) {
  return <span className="tabular-nums">${(cents / 100).toFixed(2)}</span>;
}
