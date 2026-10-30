import { test, expect } from '@playwright/test';

test('offline creation survives logout/reload and stays hidden from another account', async ({ page }) => {
  await page.goto('/tests/ui/workspace-recovery.html');
  await expect(page.getByRole('heading', { name: 'Workspace account-a' })).toBeVisible();
  await page.getByRole('button', { name: 'Save offline creation' }).click();
  await expect(page.getByAltText('Recovered offline creation')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Workspace account-a' })).toBeHidden();
  await page.getByRole('button', { name: 'Choose account B' }).click();
  await expect(page.getByRole('heading', { name: 'Workspace account-b' })).toBeVisible();
  await expect(page.getByAltText('Recovered offline creation')).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Choose account A' }).click();
  await expect(page.getByAltText('Recovered offline creation')).toBeVisible();
  await page.reload();
  await expect(page.getByAltText('Recovered offline creation')).toBeVisible();
});

test('real composer handles the submit shortcut once and suppresses it in a modal', async ({ page }) => {
  await page.goto('/tests/ui/keyboard-shortcuts.html');
  const count = page.getByRole('status', { name: 'Synthetic generation count' });
  await page.locator('textarea').first().fill('Synthetic keyboard test');
  await page.keyboard.press('Control+Enter');
  await expect(count).toHaveText('1');
  await page.getByRole('button', { name: 'Open synthetic admin' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Control+Enter');
  await expect(count).toHaveText('1');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('image zoom shortcut respects text inputs', async ({ page }) => {
  await page.goto('/tests/ui/gallery-zoom.html');
  await expect(page.getByAltText('Synthetic framing test')).toBeVisible();
  const stage = page.locator('[data-gallery-image-zoom]');
  await page.getByRole('heading').click();
  await page.keyboard.press('+');
  await expect(stage).toHaveAttribute('data-gallery-image-zoom', '1.25');
  const input = page.getByRole('textbox', { name: 'Typing test' });
  await input.fill('+0');
  await expect(input).toHaveValue('+0');
  await expect(stage).toHaveAttribute('data-gallery-image-zoom', '1.25');
  await page.getByRole('heading').click();
  await page.keyboard.press('0');
  await expect(stage).toHaveAttribute('data-gallery-image-zoom', '1');
});

test('startup distinguishes a connection outage from missing configuration and offers retry', async ({ page }) => {
  let reads = 0;
  await page.route('**/api/workspace-config', async route => {
    if (++reads <= 3) return route.abort('failed');
    return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'WORKSPACE_NOT_CONFIGURED' }) });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Banana Studio could not open' })).toBeVisible();
  expect(reads).toBe(3);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome to Banana Studio' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the setup guide' })).toBeVisible();
});
