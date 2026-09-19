import { Actor } from 'apify';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { scrapeListings } from './scrape.js';
import { matchListing } from './match.js';
import { searchForListingEvidence } from './search.js';
import { scoreListing } from './trust.js';

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const { educationLevel = '', fieldOfStudy = '', country = '', fundingNeeded = true, gpaOrGrade = null } = input;
const profile = { educationLevel, fieldOfStudy, country, fundingNeeded, gpaOrGrade };

const client = await Actor.newClient();
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });

// This Gemini key's free tier caps at 5 requests/minute (not just a daily cap),
// so we pace every call at least 13 seconds apart regardless of retries — cheap
// insurance against bursting past the limit when scraping, enrichment, and
// matching calls land close together.
const MIN_MS_BETWEEN_CALLS = 13000;
let lastCallAt = 0;

async function generateContentWithRetry(prompt, retries = 4) {
    const waitFor = lastCallAt + MIN_MS_BETWEEN_CALLS - Date.now();
    if (waitFor > 0) await new Promise((resolve) => setTimeout(resolve, waitFor));
    lastCallAt = Date.now();

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await model.generateContent(prompt);
        } catch (err) {
            const isRetryable = err.status === 503 || err.status === 429;
            if (!isRetryable || attempt === retries) throw err;
            const delayMs = 15000 * attempt; // rate-limit errors need real recovery time, not a quick backoff
            console.log(`Gemini call failed (${err.status}), retrying in ${delayMs}ms (attempt ${attempt}/${retries})`);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            lastCallAt = Date.now();
        }
    }
}

const isTestRun = process.env.OPPORTUNITY_RADAR_TEST_MODE === '1';

const listings = await scrapeListings({
    client,
    generateContentWithRetry,
    actorSetValue: (...args) => Actor.setValue(...args),
    // While iterating, cap listings scraped/enriched so we don't burn the Gemini
    // free-tier daily quota (20 requests/day) on repeated test runs. Unset this
    // env var, or set it to 0, for a real full-scope run.
    listingLimit: isTestRun ? 3 : undefined,
});

console.log(`Matching and trust-scoring ${listings.length} listings against the student profile.`);

const searchConfig = {
    apiKey: process.env.GOOGLE_CSE_API_KEY,
    searchEngineId: process.env.GOOGLE_CSE_ID,
    sourceHostname: 'phdportal.com',
};

for (const listing of listings) {
    const match = await matchListing(listing, profile, generateContentWithRetry);

    // Search evidence is only worth fetching for listings a student could
    // actually pursue — no point spending an API call checking the trust of
    // something already ruled out on hard requirements.
    const searchEvidence = match.hardRequirementsMet
        ? await searchForListingEvidence(listing, searchConfig)
        : null;
    const trust = scoreListing(listing, searchEvidence);

    await Actor.pushData({
        ...listing,
        ...match,
        ...trust,
        scrapedFor: profile,
    });
}

await Actor.exit();
