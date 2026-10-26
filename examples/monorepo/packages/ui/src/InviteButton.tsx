'use client';

import { useState } from 'react';

export function InviteButton({ teamName, onInvite }: { teamName: string; onInvite?: (email: string) => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}>
        Invite to {teamName}
      </button>
    );
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onInvite?.(email);
        setOpen(false);
      }}
    >
      <label>
        Email <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
      </label>
      <button type="submit">Send invite</button>
    </form>
  );
}
