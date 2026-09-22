import { test, expect } from '@playwright/test';

// The demo path is the only one that doesn't depend on the live Apify
// backend (/api/start-run, /api/check-run) — it just fetches the committed
// demo-data.json and renders it, so it's the one flow we can test fully
// end-to-end without mocking or a running backend.

test.describe('demo run', () => {
  test('See a live example renders results from demo-data.json', async ({ page }) => {
    const demoData = await (await fetch(`http://127.0.0.1:4173/demo-data.json`)).json();

    await page.goto('/');
    await page.getByRole('button', { name: 'See a live example' }).click();

    // The local demo-data.json fetch resolves fast enough that the loading
    // view can come and go before an assertion on it would even run, so we
    // only assert the settled end state here.
    await expect(page.locator('#view-results')).toBeVisible();

    // Demo banner marks this clearly as example data, not a real run.
    await expect(page.locator('#demo-banner')).toBeVisible();
    await expect(page.locator('#demo-banner')).toContainText('real example run');

    // Digest summary line reflects the actual demo data counts.
    const eligibleCount = demoData.results.filter((r) => r.eligibilityMatch === 'Eligible').length;
    await expect(page.locator('#digest-summary')).toContainText(`${demoData.results.length} opportunities`);
    await expect(page.locator('#digest-summary')).toContainText(`${eligibleCount}`);

    // One listing card per result.
    const cards = page.locator('.listing-card');
    await expect(cards).toHaveCount(demoData.results.length);
  });

  test('each listing card shows its eligibility and trust badges', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'See a live example' }).click();
    await expect(page.locator('#view-results')).toBeVisible();

    const firstCard = page.locator('.listing-card').first();
    await expect(firstCard.locator('.badge-eligible, .badge-partial, .badge-noteligible')).toHaveCount(1);
    await expect(firstCard.locator('.badge-lowrisk, .badge-someconcerns, .badge-highrisk')).toHaveCount(1);
    await expect(firstCard.locator('.badge-confidence')).toBeVisible();
  });

  test('Not Eligible listings show their missing requirements', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'See a live example' }).click();
    await expect(page.locator('#view-results')).toBeVisible();

    const notEligibleCard = page.locator('.listing-card').filter({ has: page.locator('.badge-noteligible') }).first();
    await expect(notEligibleCard.getByText('Missing:')).toBeVisible();
  });

  test('Start over returns to the landing page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'See a live example' }).click();
    await expect(page.locator('#view-results')).toBeVisible();

    await page.getByRole('button', { name: '← Start over' }).click();
    await expect(page.locator('#view-landing')).toBeVisible();
    await expect(page.locator('#view-results')).toBeHidden();
  });
});
