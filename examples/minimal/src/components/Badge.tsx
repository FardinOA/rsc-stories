/** A count badge. No client APIs — but FollowButton imports it, so it ships to the browser. */
export function Badge({ count, label }: { count: number; label: string }) {
  return (
    <span className="badge">
      {count.toLocaleString('en-US')} {label}
    </span>
  );
}
