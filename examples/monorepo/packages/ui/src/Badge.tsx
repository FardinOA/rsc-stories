const tones = {
  owner: { background: '#efe9fb', color: '#5b3a9e' },
  admin: { background: '#e3f2f1', color: '#0c6b66' },
  member: { background: '#eef0f2', color: '#4d545d' },
} as const;

export function Badge({ role }: { role: keyof typeof tones }) {
  return <span style={{ ...tones[role], padding: '1px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600 }}>{role}</span>;
}
