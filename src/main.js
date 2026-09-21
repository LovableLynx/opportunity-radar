import { Actor } from 'apify';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { scrapeListings } from './scrape.js';
import { matchListing } from './match.js';
import { searchForListingEvidence } from './search.js';
import { scoreListing } from './trust.js';
import { buildDigest } from './digest.js';
import { urgencyFor } from './urgency.js';

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const { educationLevel = '', fieldOfStudy = '', country = '', fundingNeeded = true, gpaOrGrade = null } = input;
const profile = { educationLevel, fieldOfStudy, country, fundingNeeded, gpaOrGrade };

const client = await Actor.newClient();

// This Gemini free tier caps at 5 requests/minute AND 20 requests/day PER
// KEY. Relevance-filtering search results added enough extra calls to run
// past a single key's daily quota, so GOOGLE_API_KEY_SEARCH is optional: set
// it to a second key to give search-evidence filtering its own separate
// daily allowance instead of competing with scraping/matching for the same
// one. If unset, everything just shares GOOGLE_API_KEY as before.
function makeGenerateContentWithRetry(apiKey) {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });

    const MIN_MS_BETWEEN_CALLS = 13000;
    let lastCallAt = 0;

    return async function generateContentWithRetry(prompt, retries = 4) {
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
    };
}

const generateContentWithRetry = makeGenerateContentWithRetry(process.env.GOOGLE_API_KEY);

// Falls back to the main key if no second key is set, so this works whether
// or not GOOGLE_API_KEY_SEARCH is configured.
const generateContentForSearch = process.env.GOOGLE_API_KEY_SEARCH
    ? makeGenerateContentWithRetry(process.env.GOOGLE_API_KEY_SEARCH)
    : generateContentWithRetry;

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

const results = [];

for (const listing of listings) {
    const match = await matchListing(listing, profile, generateContentWithRetry);

    // Search evidence is only worth fetching for listings a student could
    // actually pursue — no point checking the trust of something already
    // ruled out on hard requirements. Uses generateContentForSearch (a
    // separate key, if configured) so relevance-filtering has its own quota
    // instead of competing with scraping/matching for the same daily limit.
    const searchEvidence = match.hardRequirementsMet
        ? await searchForListingEvidence(listing, { sourceHostname: 'phdportal.com', generateContentWithRetry: generateContentForSearch })
        : null;
    const trust = scoreListing(listing, searchEvidence);

    // Urgency is a pure add-on computed from the deadline we already
    // scraped. A failure here (unexpected deadline format) shouldn't drop
    // the listing, it just means urgency stays Unknown for this one.
    let urgencyInfo = { urgency: 'Unknown', daysRemaining: null };
    try {
        urgencyInfo = urgencyFor(listing.deadline);
    } catch (err) {
        console.log(`Could not compute urgency for "${listing.title}": ${err.message}`);
    }

    const record = { ...listing, ...match, ...trust, ...urgencyInfo, scrapedFor: profile };
    results.push(record);
    await Actor.pushData(record);
}

// Digest is a pure add-on: if it throws for any reason, log it and move on
// rather than losing the per-listing results we already pushed.
try {
    const digest = buildDigest(results);
    await Actor.setValue('DIGEST', digest);
    console.log(digest.summary);
} catch (err) {
    console.log(`Could not build results digest: ${err.message}`);
}

await Actor.exit();
