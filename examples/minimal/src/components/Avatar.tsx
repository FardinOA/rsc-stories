/** Initials avatar. Pure markup: a Shared component, server-rendered unless a client module imports it. */
export function Avatar({ name, size = 48 }: { name: string; size?: number }) {
  const initials = name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2);
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size / 2.6 }} aria-hidden="true">
      {initials}
    </span>
  );
}
