import 'server-only';

export interface Member {
  id: string;
  name: string;
  role: 'owner' | 'admin' | 'member';
}

export interface Team {
  id: string;
  name: string;
  plan: 'free' | 'pro' | 'enterprise';
  members: Member[];
}

/** Loads a team from the internal API (mocked in stories). */
export async function getTeam(id: string): Promise<Team> {
  const response = await fetch(`https://internal.acme.test/teams/${id}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Team ${id}: HTTP ${response.status}`);
  return (await response.json()) as Team;
}
