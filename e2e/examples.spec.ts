import { expect, test } from '@playwright/test';
import { COMMERCE, MONOREPO, openPanel, openStory } from './helpers';

test.describe('commerce example (DB mocks, Tailwind, next/image, next/font)', () => {
  test('the SRS OrderSummary story runs its refund action with mocks', async ({ page }) => {
    const canvas = await openStory(page, COMMERCE, 'commerce-ordersummary--default', '&panel=calls');
    await expect(canvas.getByRole('heading', { name: 'Order ord_123' })).toBeVisible();
    await canvas.getByRole('button', { name: 'Request refund' }).click();
    await expect(canvas.getByText('Refund requested')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'db.orders.requestRefund' }).first()).toBeVisible();
  });

  test('cookies, search params and fetch mocks drive the product grid', async ({ page }) => {
    const canvas = await openStory(page, COMMERCE, 'commerce-productgrid--ineuros');
    await expect(canvas.getByText('22,08 €')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'kitchen' })).toHaveAttribute('aria-pressed', 'true');
    await expect(canvas.locator('img').first()).toHaveAttribute('src', /_next\/image|products\/mug\.svg/);
  });

  test('Tailwind styles from the host PostCSS config apply', async ({ page }) => {
    const canvas = await openStory(page, COMMERCE, 'commerce-ordersummary--default');
    // text-white (Tailwind v4 writes colors in lab()) on bg-stone-900.
    await expect(canvas.getByRole('button', { name: 'Request refund' })).toHaveCSS(
      'color',
      /^(rgb\(255, 255, 255\)|lab\(100% 0 0\)|lab\(100 0 0\))$/,
    );
  });

  test('play functions pass', async ({ page }) => {
    await openStory(page, COMMERCE, 'commerce-cartline--increments', '&panel=interactions');
    await expect(page.getByText('Passed')).toBeVisible();
  });
});

test.describe('monorepo example', () => {
  test('stories from a workspace package mock another workspace package', async ({ page }) => {
    const canvas = await openStory(page, MONOREPO, 'shared-ui-teamcard--mockedpackage', '&panel=inspector');
    await expect(canvas.getByRole('heading', { name: 'Design' })).toBeVisible();
    await openPanel(page, /^Calls/);
    await expect(page.getByRole('cell', { name: 'getTeam' })).toBeVisible();
  });
});
