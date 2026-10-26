import { expect, type FrameLocator, type Page } from '@playwright/test';

export const MINIMAL = 'http://localhost:6201';
export const COMMERCE = 'http://localhost:6202';
export const MONOREPO = 'http://localhost:6203';

/** Opens the workshop on a story and waits until its server render has been inspected. */
export async function openStory(page: Page, origin: string, storyId: string, query = ''): Promise<FrameLocator> {
  await page.goto(`${origin}/?story=${storyId}${query}`);
  const canvas = page.frameLocator('iframe');
  await expect(canvas.locator('[data-rsc-stories-root], [data-rsc-stories-error], [data-rsc-stories-navigation]').first()).toBeVisible({
    timeout: 90_000,
  });
  return canvas;
}

export async function openPanel(page: Page, name: RegExp | string) {
  await page.getByRole('tab', { name }).first().click();
}
