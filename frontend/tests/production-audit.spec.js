import { test, expect } from '@playwright/test';

// Runs against the real, deployed production site, not the local static
// server the rest of the suite uses — this is a live-site audit, checking
// what's actually publicly reachable right now, not just what the code
// looks like locally. Uses full URLs throughout instead of relying on
// playwright.config.js's baseURL (which points at the local dev server),
// so this file has no dependency on the local webServer being up.
const PROD_URL = 'https://opportunity-radar-by-edubridge.vercel.app';

test.describe('production site audit', () => {
  test('the live site loads and shows the landing page', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    const response = await page.goto(PROD_URL);
    expect(response.status()).toBe(200);

    await expect(page.locator('#view-landing')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Check my eligibility' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'See a live example' })).toBeVisible();

    // No uncaught JS errors on initial load — a real signal of broken
    // deploys (missing file, CDN 404, syntax error only visible at runtime).
    expect(consoleErrors, `Console errors on page load: ${consoleErrors.join('; ')}`).toEqual([]);
  });

  test('pdf.js and its worker actually load from the CDN in production', async ({ page }) => {
    // The module-script CDN import (index.html) and the worker URL it sets
    // are both real network dependencies — confirms they resolve for real
    // visitors, not just in local dev where caching/network conditions differ.
    await page.goto(PROD_URL);
    const pdfjsLoaded = await page.waitForFunction(() => window.pdfjsLib !== undefined, null, { timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    expect(pdfjsLoaded, 'window.pdfjsLib did not become available — the CDN import may be failing in production').toBe(true);
  });

  test('the theme toggle works on the live site', async ({ page }) => {
    await page.goto(PROD_URL);
    const darkBtn = page.locator('.theme-option[data-theme-choice="dark"]');
    await darkBtn.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('the demo path renders real results on the live site', async ({ page }) => {
    await page.goto(PROD_URL);
    await page.getByRole('button', { name: 'See a live example' }).click();
    await expect(page.locator('#view-results')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.listing-card').first()).toBeVisible();
  });

  test('security response headers on the live site', async ({ request }) => {
    const response = await request.get(PROD_URL);
    const headers = response.headers();
    // Not asserting hard failures here (Vercel's own defaults vary and
    // adding these isn't this audit's job to enforce), just surfacing what's
    // actually present so a human can judge whether it's enough.
    console.log('x-frame-options:', headers['x-frame-options'] ?? '(not set)');
    console.log('content-security-policy:', headers['content-security-policy'] ?? '(not set)');
    console.log('strict-transport-security:', headers['strict-transport-security'] ?? '(not set)');
    console.log('x-content-type-options:', headers['x-content-type-options'] ?? '(not set)');
  });

  test('/api/start-run on production rejects an empty body with 400, not a real Apify run', async ({ request }) => {
    const response = await request.post(`${PROD_URL}/api/start-run`, {
      data: {},
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toBeTruthy();
  });

  test('/api/start-run on production rejects an invalid educationLevel', async ({ request }) => {
    const response = await request.post(`${PROD_URL}/api/start-run`, {
      data: {
        educationLevel: 'Postdoc',
        fieldOfStudy: 'Physics',
        country: 'Kenya',
      },
    });
    expect(response.status()).toBe(400);
  });

  test('/api/start-run on production rejects nonsense fieldOfStudy/gpaOrGrade instead of running a real Actor', async ({ request }) => {
    // A real manual test caught this: fieldOfStudy="hy" and gpaOrGrade="00"
    // both passed the earlier (type/presence-only) validation and triggered
    // a full, real, billed Actor run — 20 listings scraped, 20 real LLM
    // calls — before anything noticed the input was garbage.
    const response = await request.post(`${PROD_URL}/api/start-run`, {
      data: {
        educationLevel: 'Bachelors',
        fieldOfStudy: 'hy',
        country: 'Nigeria',
        gpaOrGrade: '00',
      },
    });
    expect(response.status()).toBe(400);
  });

  test('/api/start-run on production rejects an oversized cvText instead of forwarding it', async ({ request }) => {
    const response = await request.post(`${PROD_URL}/api/start-run`, {
      data: {
        educationLevel: 'Bachelors',
        fieldOfStudy: 'Physics',
        country: 'Kenya',
        cvText: 'x'.repeat(20001),
      },
    });
    expect(response.status()).toBe(400);
  });

  test('/api/start-run on production does NOT leak raw Apify error internals on a validation failure', async ({ request }) => {
    const response = await request.post(`${PROD_URL}/api/start-run`, { data: {} });
    const body = await response.json();
    // A validation error should be our own clean message, never Apify's raw
    // response text (which could include internal actor/account details).
    expect(body.error).not.toMatch(/apify\.com|actor-runs|acts\//i);
  });

  test('/api/check-run on production rejects a missing runId', async ({ request }) => {
    const response = await request.get(`${PROD_URL}/api/check-run`);
    expect(response.status()).toBe(400);
  });

  test('/api/check-run on production handles an obviously-invalid runId without a 500 crash', async ({ request }) => {
    const response = await request.get(`${PROD_URL}/api/check-run?runId=not-a-real-run-id-at-all`);
    // Should come back as a clean 4xx from Apify being asked about a bad ID,
    // not an unhandled 500 from our own code.
    expect(response.status()).toBeLessThan(500);
  });

  test('/api/check-run on production rejects a runId containing path/query injection characters', async ({ request }) => {
    const response = await request.get(`${PROD_URL}/api/check-run?runId=${encodeURIComponent('../../etc/passwd')}`);
    expect(response.status()).toBe(400);
  });

  test('GET on /api/start-run is rejected (POST-only), not silently accepted', async ({ request }) => {
    const response = await request.get(`${PROD_URL}/api/start-run`);
    expect(response.status()).toBe(405);
  });
});
