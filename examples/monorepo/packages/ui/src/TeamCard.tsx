import { getTeam } from '@acme/data';
import { Badge } from './Badge';
import { InviteButton } from './InviteButton';

/** Async Server Component from a shared package, reading a server-only data package. */
export async function TeamCard({ teamId }: { teamId: string }) {
  const team = await getTeam(teamId);
  return (
    <section style={{ fontFamily: 'system-ui, sans-serif', border: '1px solid #dcdfe4', borderRadius: 8, padding: 16, maxWidth: 420 }}>
      <h2 style={{ margin: '0 0 4px' }}>{team.name}</h2>
      <p style={{ margin: '0 0 12px', color: '#5a616b' }}>
        {team.plan} plan · {team.members.length} members
      </p>
      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 12px' }}>
        {team.members.map((member) => (
          <li key={member.id} style={{ display: 'flex', gap: 8, padding: '4px 0' }}>
            {member.name} <Badge role={member.role} />
          </li>
        ))}
      </ul>
      <InviteButton teamName={team.name} />
    </section>
  );
}
