'use client';

/** Renders the current time: different on the server and the client — a hydration mismatch. */
export function Clock() {
  return <p className="muted">Rendered at {new Date().toISOString()}</p>;
}
