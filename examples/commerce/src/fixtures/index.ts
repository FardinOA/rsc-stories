import { fixture } from 'rsc-stories';
import type { Order, Product, Review } from '@/lib/types';

export const products = fixture<Product[]>([
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
]);

export const order = fixture<Order>({
  id: 'ord_123',
  status: 'shipped',
  placedAt: '2026-10-12T10:00:00Z',
  shippingCents: 900,
  lines: [
    { productId: 'p1', name: 'Stoneware mug', quantity: 2, unitCents: 2400 },
    { productId: 'p4', name: 'Linen notebook', quantity: 1, unitCents: 1800 },
  ],
});

export const reviews = fixture<Review[]>([
  { id: 'r1', productId: 'p1', author: 'Mina', rating: 5, body: 'Keeps coffee hot and feels great in the hand.' },
  { id: 'r2', productId: 'p1', author: 'Jon', rating: 4, body: 'Lovely glaze, a little heavy.' },
]);

/** Exchange rates answered by the fetch mock for api.frankfurter.app. */
export const rates = { amount: 1, base: 'USD', rates: { EUR: 0.92, GBP: 0.79, JPY: 151.2 } };

export const fixtures = { order: order.value, products: products.value, reviews: reviews.value, rates };
