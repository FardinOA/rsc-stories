import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { MINIMAL, openPanel, openStory } from './helpers';

test.describe('workshop UI (minimal example)', () => {
  test('lists stories and navigates the tree with the keyboard (FR-4.1)', async ({ page }) => {
    await page.goto(MINIMAL);
    const tree = page.getByRole('tree', { name: 'Story tree' });
    await expect(tree.getByRole('treeitem', { name: /UserCard/ })).toBeVisible();
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('searchbox', { name: 'Search stories' })).toBeFocused();
    await page.keyboard.type('slow data');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('treeitem', { name: 'Slow Database' })).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search stories' }).focus();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('searchbox', { name: 'Search stories' })).toHaveValue('');
    await expect(tree.getByRole('treeitem', { name: /AccountGate/ })).toBeVisible();
    const userCard = tree.getByRole('treeitem', { name: /UserCard/ });
    await userCard.focus();
    if ((await userCard.getAttribute('aria-expanded')) === 'false') await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(tree.getByRole('treeitem', { name: 'Default' }).last()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/story=people-usercard--default/);
  });

  test('browser Back returns to the previous story', async ({ page }) => {
    const canvas = await openStory(page, MINIMAL, 'people-usercard--default');
    await page.getByRole('treeitem', { name: 'Slow Database' }).click();
    await expect(page).toHaveURL(/story=people-usercard--slowdatabase/);
    await expect(canvas.locator('[data-story-id="people-usercard--slowdatabase"]')).toBeAttached({ timeout: 30_000 });
    await page.goBack();
    await expect(page).toHaveURL(/story=people-usercard--default/);
    await expect(canvas.locator('[data-story-id="people-usercard--default"]')).toBeAttached({ timeout: 30_000 });
  });

  test('renders an async Server Component with mocks and shows the inspector (FR-2.1, FR-5)', async ({ page }) => {
    const canvas = await openStory(page, MINIMAL, 'people-usercard--default', '&panel=inspector');
    await expect(canvas.getByRole('heading', { name: 'Ada Lovelace' })).toBeVisible();
    await expect(page.getByText('boundary ·').first()).toBeVisible();
    await expect(page.getByRole('treeitem', { name: /UserCard/ }).first()).toBeVisible();
    await page.getByRole('tab', { name: /Client leaks/ }).click();
    await expect(page.getByText("Badge — inherited 'use client' from FollowButton.")).toBeVisible();
    await page.getByRole('tab', { name: /^Boundaries/ }).click();
    await expect(page.getByRole('cell', { name: /FollowButton/ })).toBeVisible();
  });

  test('re-renders on the server when args change, and deep links restore state (FR-4.3, FR-4.8)', async ({ page }) => {
    const canvas = await openStory(page, MINIMAL, 'people-usercard--default');
    await page.getByLabel('userId value').fill('nobody');
    await expect(canvas.locator('[data-rsc-stories-navigation="notFound"]')).toBeVisible();
    const url = page.url();
    expect(url).toContain('state=');
    const reopened = await openStory(page, MINIMAL, 'people-usercard--default', `&state=${new URL(url).searchParams.get('state')}`);
    await expect(reopened.locator('[data-rsc-stories-navigation="notFound"]')).toBeVisible();
  });

  test('switches mock variants at runtime (FR-4.4)', async ({ page }) => {
    const canvas = await openStory(page, MINIMAL, 'feed-quote--default', '&panel=mocks');
    await expect(canvas.getByText('Simplicity is prerequisite for reliability.')).toBeVisible();
    await page.getByLabel('quote variant').selectOption('error');
    await expect(canvas.locator('[data-rsc-stories-error]')).toContainText('Quote service answered 503');
  });

  test('suggests a fetch mock for an unmocked request (FR-3.6)', async ({ page }) => {
    await openStory(page, MINIMAL, 'feed-quote--default', '&panel=mocks');
    await page.getByLabel('quote active').click();
    await expect(page.getByText('Unmocked request: GET https://quotes.example.com/api/today').first()).toBeVisible();
    await expect(page.getByText("{ match: 'GET https://quotes.example.com/api/today', response: {} }")).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy mock' })).toBeVisible();
  });

  test('records calls, console output and Server Actions (FR-3.8, FR-4.6, FR-2.5)', async ({ page }) => {
    const canvas = await openStory(page, MINIMAL, 'people-usercard--default', '&panel=calls');
    await expect(page.getByRole('cell', { name: 'db.users.findById' })).toBeVisible();
    await canvas.getByRole('button', { name: 'Follow' }).click();
    await expect(canvas.getByRole('button', { name: 'Following' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'db.users.follow' }).first()).toBeVisible();
  });

  test('runs play functions and records router calls (FR-1.9, FR-3.4)', async ({ page }) => {
    await openStory(page, MINIMAL, 'navigation-searchbox--submits', '&panel=interactions');
    await expect(page.getByText('Passed')).toBeVisible();
    await openPanel(page, /^Calls/);
    await expect(page.getByRole('cell', { name: 'router.push' })).toBeVisible();
  });

  test('shows server errors and intercepted redirects in the canvas (FR-2.4, FR-3.3)', async ({ page }) => {
    const errored = await openStory(page, MINIMAL, 'diagnostics-mistakes--servererror');
    await expect(errored.locator('[data-rsc-stories-error]')).toContainText('The database is on fire');
    const redirected = await openStory(page, MINIMAL, 'account-accountgate--signedout');
    await expect(redirected.locator('[data-rsc-stories-navigation="redirect"]')).toContainText('redirect("/login")');
  });

  test('the workshop UI has no serious accessibility violations, in both themes (NFR-6.1)', async ({ page }) => {
    await openStory(page, MINIMAL, 'people-usercard--default', '&panel=inspector');
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      const results = await new AxeBuilder({ page })
        .exclude('iframe')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    }
  });
});
