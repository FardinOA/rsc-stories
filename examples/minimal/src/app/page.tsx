import { Feed } from '@/components/Feed';
import { UserCard } from '@/components/UserCard';

export default function Home() {
  return (
    <main style={{ display: 'grid', gap: 16, padding: 24 }}>
      <UserCard userId="u1" />
      <Feed />
    </main>
  );
}
