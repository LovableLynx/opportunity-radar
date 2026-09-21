import { Actor } from 'apify';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { scrapeListings } from './scrape.js';
import { matchListing } from './match.js';
import { searchForListingEvidence } from './search.js';
import { checkAlumniMentions } from './alumni-signal.js';
import { scoreListing } from './trust.js';
import { buildDigest } from './digest.js';
import { urgencyFor } from './urgency.js';
import { detectCrossListingPatterns } from './cross-listing-patterns.js';
import { loadLearnedPatterns, saveLearnedPatterns, patternsFromPhrases } from './learned-patterns.js';
import { compareListings } from './compare-listings.js';

await Actor.init();

const input = (await Actor.getInput()) ?? {};

// Compare mode is a separate input shape entirely: two already-scored
// listing records (the same shape this Actor's own output produces) under
// compareListingA / compareListingB, instead of a student profile. It's
// checked first and the rest of the file lives in the else branch below,
// so the profile-based scraping/matching flow is completely unaffected
// whether or not compare mode exists or gets used.
if (input.compareListingA && input.compareListingB) {
    const comparison = compareListings(input.compareListingA, input.compareListingB);
    if (!comparison) {
        console.log('Could not compare the two listings provided, check they both have a "title" field at minimum.');
    } else {
        await Actor.pushData(comparison);
        console.log(comparison.verdict);
    }
    await Actor.exit();
} else {
    const { educationLevel = '', fieldOfStudy = '', country = '', fundingNeeded = true, gpaOrGrade = null, cvText = null } = input;
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

    // Opportunity Desk is off by default: it's Cloudflare-protected, and
    // unlike PhDportal (confirmed working live through Website Content
    // Crawler), it's never actually been tested against our pipeline. Set
    // ENABLE_OPPORTUNITY_DESK=1 once there's quota to spare for a real test.
    // enrichLimitPerSource stays 5 total either way, split across whichever
    // sources are active, so turning this on doesn't silently double the
    // LLM call budget for a run.
    const sourceKeys = process.env.ENABLE_OPPORTUNITY_DESK === '1'
        ? ['phdportal', 'opportunitydesk']
        : ['phdportal'];

    const listings = await scrapeListings({
        client,
        generateContentWithRetry,
        actorSetValue: (...args) => Actor.setValue(...args),
        // While iterating, cap listings scraped/enriched so we don't burn the Gemini
        // free-tier daily quota (20 requests/day) on repeated test runs. Unset this
        // env var, or set it to 0, for a real full-scope run.
        listingLimit: isTestRun ? 3 : undefined,
        sourceKeys,
        enrichLimitPerSource: 5,
    });

    console.log(`Matching and trust-scoring ${listings.length} listings against the student profile.`);

    // Learned patterns from past runs, on top of trust.js's fixed starting
    // list. Failing to load just means we score with the static list only,
    // exactly like before this feature existed, never a hard failure.
    const learnedPhrases = await loadLearnedPatterns((key) => Actor.getValue(key));
    const learnedPatterns = patternsFromPhrases(learnedPhrases);
    if (learnedPhrases.length > 0) {
        console.log(`Loaded ${learnedPhrases.length} learned scam pattern(s) from past runs.`);
    }

    const results = [];

    for (const listing of listings) {
        const match = await matchListing(listing, profile, generateContentWithRetry, cvText);

        // Search evidence is only worth fetching for listings a student could
        // actually pursue — no point checking the trust of something already
        // ruled out on hard requirements. Uses generateContentForSearch (a
        // separate key, if configured) so relevance-filtering has its own quota
        // instead of competing with scraping/matching for the same daily limit.
        const searchEvidence = match.hardRequirementsMet
            ? await searchForListingEvidence(listing, { sourceHostname: 'phdportal.com', generateContentWithRetry: generateContentForSearch })
            : null;
        const trust = scoreListing(listing, searchEvidence, learnedPatterns);

        // Opt-in, off by default: costs one more paced Gemini call per searched
        // listing on top of relevance filtering, which matters given how tight
        // the free-tier daily quota already is. Set ENABLE_ALUMNI_SIGNAL=1 once
        // quota allows testing it for real.
        let alumniSignal = null;
        if (process.env.ENABLE_ALUMNI_SIGNAL === '1' && searchEvidence?.candidates) {
            alumniSignal = await checkAlumniMentions(listing, searchEvidence.candidates, generateContentForSearch);
        }

        // Urgency is a pure add-on computed from the deadline we already
        // scraped. A failure here (unexpected deadline format) shouldn't drop
        // the listing, it just means urgency stays Unknown for this one.
        let urgencyInfo = { urgency: 'Unknown', daysRemaining: null };
        try {
            urgencyInfo = urgencyFor(listing.deadline);
        } catch (err) {
            console.log(`Could not compute urgency for "${listing.title}": ${err.message}`);
        }

        const record = {
            ...listing,
            ...match,
            ...trust,
            ...urgencyInfo,
            alumniMentionsFound: alumniSignal?.alumniMentionsFound ?? null,
            alumniEvidence: alumniSignal?.evidence ?? [],
            scrapedFor: profile,
        };
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

    // Cross-listing pattern detection is a pure, no-cost add-on: no API calls,
    // operates on results we already have. Only activates with enough volume
    // to make repetition meaningful, single-listing or small-batch runs are
    // unaffected. If it throws for any reason, log it and move on.
    try {
        const crossListing = detectCrossListingPatterns(results);
        await Actor.setValue('CROSS_LISTING_PATTERNS', crossListing);
        if (crossListing.patterns.length > 0) {
            console.log(`Found ${crossListing.patterns.length} phrase(s) repeating across multiple listings, possible shared template.`);
            // A phrase repeating across 3+ independent listings in one run is a
            // validated signal, not a single unverified guess, so it's a
            // reasonable source to grow the learned-pattern library from. Only
            // the phrase text is stored, not which listings it came from.
            const newPhrases = crossListing.patterns.map((p) => p.phrase);
            await saveLearnedPatterns(
                (key) => Actor.getValue(key),
                (key, value) => Actor.setValue(key, value),
                newPhrases,
            );
        }
    } catch (err) {
        console.log(`Could not run cross-listing pattern detection: ${err.message}`);
    }

    await Actor.exit();
}
