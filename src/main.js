import { Actor } from 'apify';
import { GoogleGenerativeAI } from '@google/generative-ai';

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const { fieldOfStudy = '', country = '' } = input;

// Phase 1: fetch PhDportal's scholarship search results and extract structured
// listings. PhDportal blocks bare Playwright requests outright (403), even with a
// residential proxy and browser fingerprinting, so instead of fighting that block
// directly we call Apify's own "Website Content Crawler" Actor to fetch the page
// (it has stronger anti-blocking built in) and then use an LLM to read the
// returned text and pull out structured listings, instead of guessing CSS
// selectors against a page we can't reliably render ourselves.
const startUrl = 'https://www.phdportal.com/search/scholarships/phd';

const client = await Actor.newClient();

const contentCrawlerRun = await client.actor('apify/website-content-crawler').call({
    startUrls: [{ url: startUrl }],
    crawlerType: 'playwright:firefox',
    maxCrawlPages: 1,
    // Markdown output keeps [text](url) links, which plain text strips out and we
    // need to visit each listing's own detail page for richer eligibility text.
    saveMarkdown: true,
    proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
});

const { items } = await client.dataset(contentCrawlerRun.defaultDatasetId).listItems();

if (items.length === 0) {
    throw new Error('Website Content Crawler returned no pages — check the sub-run for errors.');
}

// Prefer markdown over plain text: markdown keeps [text](url) link syntax, which
// plain text strips out entirely. We need those links to visit each listing's own
// detail page for richer eligibility text later.
const pageText = items[0].markdown ?? items[0].text ?? '';

if (!pageText) {
    throw new Error('Fetched page had no text/markdown content to extract from.');
}

// Diagnostic: keep the raw fetched content so we can check whether individual
// listing links survive in it, before deciding how to fetch listing detail pages.
await Actor.setValue('SEARCH_PAGE_RAW', pageText, { contentType: 'text/plain' });

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });

// Gemini occasionally returns a transient 503 under load. Retry with backoff
// rather than letting one hiccup fail a run that already paid for real scraping.
async function generateContentWithRetry(prompt, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await model.generateContent(prompt);
        } catch (err) {
            const isRetryable = err.status === 503 || err.status === 429;
            if (!isRetryable || attempt === retries) throw err;
            const delayMs = 2000 * attempt;
            console.log(`Gemini call failed (${err.status}), retrying in ${delayMs}ms (attempt ${attempt}/${retries})`);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }
}

const extraction = await generateContentWithRetry(
    `Here is the text/markdown content of a scholarship listing page (PhDportal). Extract every distinct scholarship/opportunity listing you can find as a JSON array. For each one include: title, link (the URL to the listing's own detail page, if one appears in the content, otherwise null), deadline (if stated), description (short summary), and eligibility (any stated requirements, as plain text). If a field isn't present, use null. Return ONLY the JSON array, no other text.\n\nPAGE CONTENT:\n${pageText.slice(0, 15000)}`,
);

const rawText = extraction.response.text() ?? '[]';

let listings;
try {
    const jsonMatch = rawText.match(/\[[\s\S]*\]/);
    listings = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
} catch (err) {
    throw new Error(`Could not parse LLM extraction output as JSON: ${err.message}\nRaw output: ${rawText.slice(0, 500)}`);
}

console.log(`Extracted ${listings.length} listings from PhDportal via LLM.`);

// The search results page only gives thin summaries ("Merit-based", "various
// benefits"), which isn't enough for phase 2's eligibility matching to check
// against. Visit each listing's own detail page for the real eligibility text.
// Capped to keep sub-Actor cost and runtime bounded for a hackathon-scale run —
// raise ENRICH_LIMIT once this is confirmed working end to end.
const ENRICH_LIMIT = 5;
const toEnrich = listings.filter((l) => l.link).slice(0, ENRICH_LIMIT);

console.log(`Fetching detail pages for ${toEnrich.length} listings to get richer eligibility text.`);

let detailPagesText = new Map();
if (toEnrich.length > 0) {
    const detailCrawlerRun = await client.actor('apify/website-content-crawler').call({
        startUrls: toEnrich.map((l) => ({ url: l.link })),
        crawlerType: 'playwright:firefox',
        maxCrawlPages: toEnrich.length,
        saveMarkdown: true,
        proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
    });
    const { items: detailItems } = await client.dataset(detailCrawlerRun.defaultDatasetId).listItems();
    for (const item of detailItems) {
        detailPagesText.set(item.url, item.markdown ?? item.text ?? '');
    }
}

for (const listing of listings) {
    const detailText = detailPagesText.get(listing.link);
    let enriched = listing;

    if (detailText) {
        try {
            const enrichExtraction = await generateContentWithRetry(
                `Here is the full detail page content for a single scholarship listing titled "${listing.title}". Extract a fuller description and the full eligibility requirements as stated on the page. Return ONLY a JSON object with keys "description" and "eligibility" (both strings, or null if not present).\n\nPAGE CONTENT:\n${detailText.slice(0, 10000)}`,
            );
            const jsonMatch = enrichExtraction.response.text().match(/\{[\s\S]*\}/);
            const enrichedFields = JSON.parse(jsonMatch ? jsonMatch[0] : '{}');
            enriched = { ...listing, ...enrichedFields, enriched: true };
        } catch (err) {
            console.log(`Could not enrich "${listing.title}", keeping summary-page data: ${err.message}`);
        }
    }

    await Actor.pushData({
        ...enriched,
        source: 'phdportal',
        scrapedFor: { fieldOfStudy, country },
    });
}

await Actor.exit();
