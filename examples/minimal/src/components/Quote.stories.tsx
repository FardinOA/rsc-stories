import type { Meta, StoryObj } from 'rsc-stories';
import { Quote } from './Quote';

const meta = {
  title: 'Feed/Quote',
  component: Quote,
  mocks: {
    fetch: [
      {
        name: 'quote',
        match: 'GET https://quotes.example.com/api/today',
        response: { text: 'Simplicity is prerequisite for reliability.', author: 'Edsger W. Dijkstra' },
        variants: {
          error: { status: 503, response: { error: 'unavailable' } },
          offline: { error: 'getaddrinfo ENOTFOUND quotes.example.com' },
          slow: { delay: 1500 },
        },
      },
    ],
  },
} satisfies Meta<typeof Quote>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** The service answers 503: the component throws and the error boundary shows it. */
export const ServiceDown: Story = {
  tags: ['expect-error'],
  mocks: {
    fetch: [{ name: 'quote', match: 'GET https://quotes.example.com/api/today', status: 503, response: { error: 'unavailable' } }],
  },
};
