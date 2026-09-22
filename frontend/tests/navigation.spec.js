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

    // Submitting empty required fields should not navigate away from the form,
    // and should show the inline per-field errors plus the top banner
    // (matches the Figma 01B validation-error screen).
    await page.getByRole('button', { name: 'Run Opportunity Radar' }).click();
    await expect(page.locator('#view-form')).toBeVisible();

    await expect(page.locator('#form-error-banner')).toBeVisible();
    await expect(page.locator('#error-educationLevel')).toBeVisible();
    await expect(page.locator('#error-fieldOfStudy')).toBeVisible();
    await expect(page.locator('#error-country')).toBeVisible();

    // Filling in the fields and resubmitting clears the errors.
    await page.selectOption('#educationLevel', 'Bachelors');
    await page.fill('#fieldOfStudy', 'Computer Science');
    await page.fill('#country', 'Nigeria');
    await page.getByRole('button', { name: 'Run Opportunity Radar' }).click();

    await expect(page.locator('#form-error-banner')).toBeHidden();
  });
});

test.describe('theme toggle', () => {
  test('defaults to system, switches to dark and light, and persists across reload', async ({ page }) => {
    await page.goto('/');

    const html = page.locator('html');
    const systemBtn = page.locator('.theme-option[data-theme-choice="system"]');
    const darkBtn = page.locator('.theme-option[data-theme-choice="dark"]');
    const lightBtn = page.locator('.theme-option[data-theme-choice="light"]');

    await expect(systemBtn).toHaveAttribute('aria-checked', 'true');
    await expect(html).not.toHaveAttribute('data-theme', /.+/);

    await darkBtn.click();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(darkBtn).toHaveAttribute('aria-checked', 'true');

    // Persists across a reload (localStorage), and applies before first
    // paint so there's no flash of the wrong theme.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('.theme-option[data-theme-choice="dark"]')).toHaveAttribute('aria-checked', 'true');

    await lightBtn.click();
    await expect(html).toHaveAttribute('data-theme', 'light');

    await systemBtn.click();
    await expect(html).not.toHaveAttribute('data-theme', /.+/);
  });
});
