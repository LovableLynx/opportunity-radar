import { Actor } from 'apify';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { scrapeListings } from './scrape.js';
import { matchListing } from './match.js';

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const { educationLevel = '', fieldOfStudy = '', country = '', fundingNeeded = true, gpaOrGrade = null } = input;
const profile = { educationLevel, fieldOfStudy, country, fundingNeeded, gpaOrGrade };

const client = await Actor.newClient();
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

console.log(`Matching ${listings.length} listings against the student profile.`);

for (const listing of listings) {
    const match = await matchListing(listing, profile, generateContentWithRetry);

    await Actor.pushData({
        ...listing,
        ...match,
        scrapedFor: profile,
    });
}

await Actor.exit();
