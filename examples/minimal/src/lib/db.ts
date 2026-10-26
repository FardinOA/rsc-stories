import 'server-only';

export interface User {
  id: string;
  name: string;
  handle: string;
  bio: string;
  followers: number;
}

export interface Post {
  id: string;
  authorId: string;
  text: string;
  createdAt: string;
}

const users: User[] = [
  { id: 'u1', name: 'Ada Lovelace', handle: 'ada', bio: 'Poet of numbers.', followers: 1815 },
  { id: 'u2', name: 'Grace Hopper', handle: 'grace', bio: 'Compilers, nanoseconds, and naval humour.', followers: 1906 },
];

const posts: Post[] = [
  { id: 'p1', authorId: 'u1', text: 'The engine weaves algebraic patterns.', createdAt: '2026-10-20T09:00:00Z' },
  { id: 'p2', authorId: 'u2', text: 'It is easier to ask forgiveness than permission.', createdAt: '2026-10-21T14:30:00Z' },
];

/** Stands in for a real database client; stories replace it with mocks. */
const latency = () => new Promise((resolve) => setTimeout(resolve, 40));

export const db = {
  users: {
    async findById(id: string): Promise<User | null> {
      await latency();
      return users.find((user) => user.id === id) ?? null;
    },
    async follow(id: string): Promise<number> {
      await latency();
      const user = users.find((u) => u.id === id);
      if (!user) throw new Error(`No user ${id}`);
      user.followers += 1;
      return user.followers;
    },
  },
  posts: {
    async latest(limit = 10): Promise<Post[]> {
      await latency();
      return posts.slice(0, limit);
    },
  },
};
