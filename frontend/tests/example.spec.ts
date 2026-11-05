import { test, expect } from '@playwright/test';
import { prepareGuestSession } from './support/guest-session';

test('local storefront loads', async ({ page }) => {
  await prepareGuestSession(page);

  const response = await page.goto('/');
  expect(response?.ok()).toBeTruthy();
  await expect(page).toHaveTitle(/货觉AI/);
  await expect(page.locator('#root')).not.toBeEmpty();
});
