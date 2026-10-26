'use client';

import { useState } from 'react';

export function Toggle({ label, onToggle }: { label: string; onToggle?: (on: boolean) => void }) {
  const [on, setOn] = useState(false);
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => {
        setOn(!on);
        onToggle?.(!on);
      }}
    >
      {label}: {on ? 'on' : 'off'}
    </button>
  );
}
