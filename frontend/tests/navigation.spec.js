import { test, expect } from '@playwright/test';

test.describe('landing and navigation', () => {
  test('landing page shows both entry points', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('#view-landing')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Check my eligibility' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'See a live example' })).toBeVisible();
  });

  test('Check my eligibility opens the form, back returns to landing', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'Check my eligibility' }).click();
    await expect(page.locator('#view-form')).toBeVisible();
    await expect(page.locator('#view-landing')).toBeHidden();

    await page.getByRole('button', { name: '← Back' }).click();
    await expect(page.locator('#view-landing')).toBeVisible();
    await expect(page.locator('#view-form')).toBeHidden();
  });

  test('form requires education level, field of study, and country', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Check my eligibility' }).click();

    // Submitting empty required fields should not navigate away from the form.
    await page.getByRole('button', { name: 'Run Opportunity Radar' }).click();
    await expect(page.locator('#view-form')).toBeVisible();

    const educationLevel = page.locator('#educationLevel');
    await expect(educationLevel).toHaveJSProperty('validity.valid', false);
  });
});
