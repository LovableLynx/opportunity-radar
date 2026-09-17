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
    proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
});

const { items } = await client.dataset(contentCrawlerRun.defaultDatasetId).listItems();

if (items.length === 0) {
    throw new Error('Website Content Crawler returned no pages — check the sub-run for errors.');
}

const pageText = items[0].text ?? items[0].markdown ?? '';

if (!pageText) {
    throw new Error('Fetched page had no text/markdown content to extract from.');
}

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });

const extraction = await model.generateContent(
    `Here is the text content of a scholarship listing page (PhDportal). Extract every distinct scholarship/opportunity listing you can find as a JSON array. For each one include: title, deadline (if stated), description (short summary), and eligibility (any stated requirements, as plain text). If a field isn't present, use null. Return ONLY the JSON array, no other text.\n\nPAGE CONTENT:\n${pageText.slice(0, 15000)}`,
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

for (const listing of listings) {
    await Actor.pushData({
        ...listing,
        source: 'phdportal',
        scrapedFor: { fieldOfStudy, country },
    });
}

await Actor.exit();
