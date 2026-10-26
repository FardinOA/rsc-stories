export type Category = 'kitchen' | 'lighting' | 'furniture' | 'stationery';

export interface Product {
  id: string;
  slug: string;
  name: string;
  category: Category;
  /** Price in US cents. */
  priceCents: number;
  image: string;
  rating: number;
  inStock: boolean;
}

export interface OrderLine {
  productId: string;
  name: string;
  quantity: number;
  unitCents: number;
}

export interface Order {
  id: string;
  status: 'paid' | 'shipped' | 'refund-requested' | 'refunded';
  placedAt: string;
  lines: OrderLine[];
  shippingCents: number;
}

export interface Review {
  id: string;
  productId: string;
  author: string;
  rating: number;
  body: string;
}
