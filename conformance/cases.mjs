/**
 * Conformance cases (NFR-2.1): the same component, with the same inputs, rendered by the example
 * app's own `next build` and by an RSC Stories story. Story mocks return the same data as the
 * app's real modules, so the outputs must be identical.
 */
export const cases = [
  {
    example: 'examples/minimal',
    route: '/',
    selector: 'article.card',
    story: 'people-usercard--default',
    clientComponents: ['FollowButton'],
  },
  {
    example: 'examples/commerce',
    route: '/orders/ord_123',
    selector: 'section',
    story: 'commerce-ordersummary--default',
    clientComponents: ['RefundButton'],
  },
  {
    example: 'examples/commerce',
    route: '/products/stoneware-mug',
    selector: 'section',
    story: 'commerce-reviews--streaming',
    clientComponents: [],
  },
];
