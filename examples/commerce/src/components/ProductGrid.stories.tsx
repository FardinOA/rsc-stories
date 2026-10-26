import { mockVariants, type Meta, type StoryObj } from 'rsc-stories';
import { products, rates } from '@/fixtures';
import { ProductGrid } from './ProductGrid';

const meta = {
  title: 'Commerce/ProductGrid',
  component: ProductGrid,
  parameters: { layout: 'fullscreen' },
  mocks: {
    modules: {
      '@/lib/db': mockVariants(
        { products: { list: async () => products.value } },
        { empty: { products: { list: async () => products.empty() } }, large: { products: { list: async () => products.large(24) } } },
      ),
    },
    fetch: [
      {
        name: 'rates',
        match: 'GET https://api.frankfurter.app/latest',
        response: rates,
        variants: { down: { status: 503, response: { message: 'maintenance' } } },
      },
    ],
    next: { pageProps: true, searchParams: { category: 'kitchen' }, pathname: '/' },
  },
} satisfies Meta<typeof ProductGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

/** `searchParams` comes from `mocks.next` (as a page prop, and for `useSearchParams`). */
export const Default: Story = {};

export const InEuros: Story = {
  mocks: { next: { cookies: { currency: 'EUR', locale: 'de-DE' } } },
};

export const SlowRates: Story = {
  mocks: { latency: { fetch: 1500 } },
};
