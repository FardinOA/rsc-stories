import { expect, test } from '../src/playwright/index';
import { COMMERCE } from './helpers';

test.use({ baseURL: COMMERCE });

test('the rsc-stories/playwright fixture opens stories, runs play and reads reports (FR-7.2)', async ({ stories }) => {
  const story = await stories.open('commerce-ordersummary--submitsrefund');
  await expect(story.root.getByRole('heading', { name: 'Order ord_123' })).toBeVisible();
  await story.play();
  await expect(story.root.getByText('Refund requested')).toBeVisible();
  const report = await story.report();
  expect(report.boundaries.map((b) => b.to)).toContain('RefundButton');
  const withArgs = await stories.open('commerce-ordersummary--britishlocale', { args: { orderId: 'ord_999' } });
  await expect(withArgs.root.getByText('12 Oct 2026')).toBeVisible();
});
