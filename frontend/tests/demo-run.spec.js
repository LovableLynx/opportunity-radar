import { test, expect } from '@playwright/test';

// The demo path is the only one that doesn't depend on the live Apify
// backend (/api/start-run, /api/check-run), it just fetches the committed
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
    // Two distinct confidence badges: eligibilityConfidence (next to the
    // eligibility verdict) and trustConfidence (next to the risk verdict) —
    // kept separate so "High confidence" never implies eligibility was
    // checked when only the trust/scam evidence was strong.
    await expect(firstCard.locator('.badge-confidence')).toHaveCount(2);
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

  test('zero results shows the dedicated no-results state, not a blank list', async ({ page }) => {
    await page.goto('/');
    // renderResults is a real global in app.js; calling it directly with an
    // empty array exercises the same no-results state a live run with 0
    // matches would hit, without needing the backend.
    await page.evaluate(() => renderResults([], null, false));

    await expect(page.locator('#view-results')).toBeVisible();
    await expect(page.locator('#no-results')).toBeVisible();
    await expect(page.locator('#no-results')).toContainText('No matching opportunities found');
    await expect(page.locator('#results-list')).toBeHidden();

    await page.getByRole('button', { name: 'Edit profile' }).click();
    await expect(page.locator('#view-form')).toBeVisible();
  });

  test('a listing with a javascript: URL as its link does not render as a clickable XSS payload', async ({ page }) => {
    // Regression test for a real finding: escapeHtml() guards against HTML
    // injection (< > & etc.) but not against a malicious URL *scheme* in an
    // href — "javascript:alert(1)" contains none of those characters, so it
    // passed through escapeHtml completely unchanged and would have
    // rendered as a live, clickable XSS payload. r.link comes from scraped
    // third-party listing pages via an LLM extraction step, so a
    // compromised or malicious source page planting a javascript: URL as
    // the "link" field is a real path for this to reach a visitor, not a
    // contrived one.
    await page.goto('/');

    let dialogFired = false;
    page.on('dialog', async (dialog) => {
      dialogFired = true;
      await dialog.dismiss();
    });

    await page.evaluate(() => renderResults([
      {
        title: 'Malicious Listing',
        link: 'javascript:alert(document.cookie)',
        eligibilityMatch: 'Eligible',
        trustRisk: 'Low Risk',
      },
    ], null, false));

    const card = page.locator('.listing-card').first();
    await expect(card).toContainText('Malicious Listing');

    // The title must render as plain text, never a clickable link, when the
    // link's scheme isn't http/https.
    await expect(card.locator('a')).toHaveCount(0);

    // Actually click where the link would have been, to prove nothing fires.
    await card.locator('.listing-title').click();
    expect(dialogFired).toBe(false);
  });

  test('a listing with a genuine https link still renders as a real, clickable link', async ({ page }) => {
    await page.goto('/');

    await page.evaluate(() => renderResults([
      {
        title: 'Real Listing',
        link: 'https://example.com/scholarship',
        eligibilityMatch: 'Eligible',
        trustRisk: 'Low Risk',
      },
    ], null, false));

    const link = page.locator('.listing-card').first().locator('a');
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute('href', 'https://example.com/scholarship');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener');
  });
});
