import 'server-only';
import type { Category, Order, Product, Review } from './types';

const products: Product[] = [
  {
    id: 'p1',
    slug: 'stoneware-mug',
    name: 'Stoneware mug',
    category: 'kitchen',
    priceCents: 2400,
    image: '/products/mug.svg',
    rating: 4.6,
    inStock: true,
  },
  {
    id: 'p2',
    slug: 'brass-desk-lamp',
    name: 'Brass desk lamp',
    category: 'lighting',
    priceCents: 12900,
    image: '/products/lamp.svg',
    rating: 4.2,
    inStock: true,
  },
  {
    id: 'p3',
    slug: 'oak-chair',
    name: 'Oak side chair',
    category: 'furniture',
    priceCents: 32000,
    image: '/products/chair.svg',
    rating: 4.8,
    inStock: false,
  },
  {
    id: 'p4',
    slug: 'linen-notebook',
    name: 'Linen notebook',
    category: 'stationery',
    priceCents: 1800,
    image: '/products/notebook.svg',
    rating: 4.4,
    inStock: true,
  },
];

const orders: Order[] = [
  {
    id: 'ord_123',
    status: 'shipped',
    placedAt: '2026-10-12T10:00:00Z',
    shippingCents: 900,
    lines: [
      { productId: 'p1', name: 'Stoneware mug', quantity: 2, unitCents: 2400 },
      { productId: 'p4', name: 'Linen notebook', quantity: 1, unitCents: 1800 },
    ],
  },
];

const reviews: Review[] = [
  { id: 'r1', productId: 'p1', author: 'Mina', rating: 5, body: 'Keeps coffee hot and feels great in the hand.' },
  { id: 'r2', productId: 'p1', author: 'Jon', rating: 4, body: 'Lovely glaze, a little heavy.' },
];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The shop's data access layer. In the app this would wrap an ORM client; stories replace it with
 * story-scoped mocks (`mocks.modules['@/lib/db']`).
 */
export const db = {
  products: {
    async list(filter: { category?: Category; sort?: 'price-asc' | 'price-desc' | 'rating' } = {}): Promise<Product[]> {
      await wait(30);
      let list = products.filter((p) => !filter.category || p.category === filter.category);
      if (filter.sort === 'price-asc') list = [...list].sort((a, b) => a.priceCents - b.priceCents);
      if (filter.sort === 'price-desc') list = [...list].sort((a, b) => b.priceCents - a.priceCents);
      if (filter.sort === 'rating') list = [...list].sort((a, b) => b.rating - a.rating);
      return list;
    },
    async findBySlug(slug: string): Promise<Product | null> {
      await wait(20);
      return products.find((p) => p.slug === slug) ?? null;
    },
  },
  orders: {
    async findById(id: string): Promise<Order | null> {
      await wait(30);
      return orders.find((o) => o.id === id) ?? null;
    },
    async requestRefund(id: string): Promise<Order> {
      await wait(30);
      const order = orders.find((o) => o.id === id);
      if (!order) throw new Error(`Order ${id} not found`);
      order.status = 'refund-requested';
      return order;
    },
  },
  reviews: {
    async forProduct(productId: string): Promise<Review[]> {
      await wait(400);
      return reviews.filter((r) => r.productId === productId);
    },
  },
};
