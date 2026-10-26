/** Star rating. Pure markup: renders on the server, or in the client when a client module imports it. */
export function Rating({ value, max = 5 }: { value: number; max?: number }) {
  const full = Math.round(value);
  return (
    <span className="text-amber-600" aria-label={`${value.toFixed(1)} out of ${max} stars`}>
      {'★'.repeat(full)}
      <span className="text-stone-300">{'★'.repeat(max - full)}</span>
    </span>
  );
}
