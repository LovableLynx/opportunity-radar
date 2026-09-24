import { Actor } from 'apify';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { makeOpenRouterGenerateContent } from './llm-openrouter.js';
import { makeGroqGenerateContent } from './llm-groq.js';
import { scrapeListings, sourceKeysForEducationLevel } from './scrape.js';
import { matchListing } from './match.js';
import { searchForListingEvidence, checkPartnerSitePresence, VERIFICATION_PARTNERS } from './search.js';
import { checkAlumniMentions } from './alumni-signal.js';
import { scoreListing } from './trust.js';
import { buildDigest } from './digest.js';
import { urgencyFor } from './urgency.js';
import { detectCrossListingPatterns } from './cross-listing-patterns.js';
import { loadLearnedPatterns, saveLearnedPatterns, patternsFromPhrases } from './learned-patterns.js';
import { compareListings } from './compare-listings.js';
import { composeGpaOrGrade } from './gpa-format.js';
import { extractPdfText } from './pdf-extract.js';

// A real CV is 1-3 pages; even with embedded photos, that's comfortably
// under a few MB as a PDF. 5MB is generous enough for any genuine CV while
// still catching an obviously-wrong upload (a mislabeled large file, a
// scanned multi-page document) before spending time on extraction.
const CV_FILE_MAX_BYTES = 5 * 1024 * 1024;

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
    const { educationLevel = '', fieldOfStudy = '', country = '', fundingNeeded = true, gpaFormat = '', gpaOrGrade = null, cvFile = null, cvText = null } = input;

    // cvFile (Apify Console upload / direct API) is a separate entry point
    // from the website's own PDF handling, which extracts text client-side
    // in the browser via pdf.js before ever reaching the Actor. This mirrors
    // that same extraction server-side, so a CV uploaded directly to the
    // Actor is used for real instead of silently ignored. cvFile's value is
    // a URL to the uploaded file (Apify's fileupload editor convention);
    // when present it takes priority over cvText, matching the website's
    // own extracted-PDF-beats-pasted-text priority rule.
    let resolvedCvText = cvText;
    if (cvFile) {
        try {
            // A temporary key-value store upload (the Console's default when
            // you upload a file for a single run, per its own "New temporary
            // storage" option) requires authentication to download — a bare
            // unauthenticated fetch returns 403. APIFY_TOKEN is set
            // automatically in every Actor run's environment by the
            // platform itself (Actor.getEnv().token), distinct from a
            // user's own personal account token, so no extra setup is
            // needed for this to work.
            const { token: runToken } = Actor.getEnv();
            const pdfResponse = await fetch(cvFile, runToken ? { headers: { Authorization: `Bearer ${runToken}` } } : undefined);
            if (!pdfResponse.ok) {
                console.log(`Could not download the uploaded CV file (${pdfResponse.status}), falling back to pasted CV text if any.`);
            } else if (Number(pdfResponse.headers.get('content-length')) > CV_FILE_MAX_BYTES) {
                console.log(`Uploaded CV file exceeds the ${CV_FILE_MAX_BYTES / (1024 * 1024)}MB limit, falling back to pasted CV text if any.`);
            } else {
                const buffer = Buffer.from(await pdfResponse.arrayBuffer());
                // Content-Length can be missing or wrong (chunked responses,
                // a misbehaving proxy); the real byte count from the actual
                // download is the backstop that can't be spoofed or absent.
                if (buffer.length > CV_FILE_MAX_BYTES) {
                    console.log(`Uploaded CV file exceeds the ${CV_FILE_MAX_BYTES / (1024 * 1024)}MB limit, falling back to pasted CV text if any.`);
                } else {
                    const { text, error } = await extractPdfText(buffer);
                    if (error) {
                        console.log(`CV PDF extraction failed, falling back to pasted CV text if any: ${error}`);
                    } else {
                        resolvedCvText = text;
                    }
                }
            }
        } catch (err) {
            console.log(`Could not process the uploaded CV file, falling back to pasted CV text if any: ${err.message}`);
        }
    }

    // The Actor's input form (Console, direct API, MCP) is a separate entry
    // point from the website and previously had zero GPA validation at all —
    // gpaFormat lets a Console/API caller pick a scale the same way the
    // website's GPA picker does, composed here into the single gpaOrGrade
    // string the rest of the pipeline expects. gpaFormat left blank behaves
    // exactly as before this feature existed.
    const { value: composedGpaOrGrade, error: gpaError } = composeGpaOrGrade(gpaFormat, gpaOrGrade);
    if (gpaError) {
        console.log(`Invalid GPA input, ignoring gpaOrGrade for this run: ${gpaError}`);
    }
    const profile = { educationLevel, fieldOfStudy, country, fundingNeeded, gpaOrGrade: gpaError ? null : (composedGpaOrGrade || null) };

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

    // Groq is the default provider. Gemini's free tier (20 requests/day per
    // key) is too small to survive a real run once search-evidence
    // relevance filtering and matching are both drawing from it, and
    // OpenRouter's free tier (50 requests/day, shared across every free
    // model on the account) exhausted mid-run in production and crashed the
    // Actor once already. Groq's free tier is rate-limited per-model
    // per-minute instead of one tight shared daily cap, and holds up better
    // across a full run, see llm-groq.js for the detail.
    //
    // Set LLM_PROVIDER=gemini or LLM_PROVIDER=openrouter plus the matching
    // API key to opt back into either as a fallback; any other value
    // (including unset) uses Groq, so a misconfigured or unrecognized
    // LLM_PROVIDER can never silently fall through to Gemini's tiny quota
    // the way it used to.
    const useGemini = process.env.LLM_PROVIDER === 'gemini';
    const useOpenRouter = process.env.LLM_PROVIDER === 'openrouter';

    // GROQ_MODEL is optional: Groq deprecates/removes models from time to
    // time (llama-3.3-70b-versatile 404'd in production once already), so
    // this lets the model be swapped via an env var and a rebuild instead
    // of a code change, if the current default ever goes the same way.
    const generateContentWithRetry = useGemini
        ? makeGenerateContentWithRetry(process.env.GOOGLE_API_KEY)
        : useOpenRouter
            ? makeOpenRouterGenerateContent(process.env.OPENROUTER_API_KEY)
            : makeGroqGenerateContent(process.env.GROQ_API_KEY, process.env.GROQ_MODEL ? { model: process.env.GROQ_MODEL } : {});

    // Falls back to the main key/provider if no second Gemini key is set, so
    // this works whether or not GOOGLE_API_KEY_SEARCH is configured. Only
    // relevant when explicitly on Gemini, since Groq and OpenRouter aren't
    // as tightly capped per-key as Gemini's free tier is.
    const generateContentForSearch = (useGemini && process.env.GOOGLE_API_KEY_SEARCH)
        ? makeGenerateContentWithRetry(process.env.GOOGLE_API_KEY_SEARCH)
        : generateContentWithRetry;

    const isTestRun = process.env.OPPORTUNITY_RADAR_TEST_MODE === '1';

    // Maintenance mode: meant for an Apify Schedule rather than a student,
    // no profile is attached so nothing gets matched, trust-scored, or
    // PPE-billed (Actor.charge only ever fires further down in the real
    // profile-matching path this returns before reaching). It exists to
    // catch a scholarship-portal source going down or getting blocked on a
    // schedule, instead of a real student's run being the first to
    // discover it. It reuses the same generateContentWithRetry built above
    // (extraction from a scraped page's text genuinely needs an LLM call,
    // see fetchAndExtractListings in scrape.js) but skips detail-page
    // enrichment (enrichLimitPerSource: 0), which is the more expensive,
    // per-listing LLM cost this mode has no reason to pay for.
    if (input.maintenanceRun) {
        console.log('Maintenance run: scraping every education-level source to check they still work, no profile attached, no billing.');
        const client = await Actor.newClient();
        for (const level of ['High school', 'Bachelors', 'Masters', 'PhD']) {
            const sourceKeys = sourceKeysForEducationLevel(level);
            try {
                const listings = await scrapeListings({
                    client,
                    generateContentWithRetry,
                    actorSetValue: (...args) => Actor.setValue(...args),
                    sourceKeys,
                    enrichLimitPerSource: 0,
                });
                console.log(`Maintenance scrape for ${level}: ${listings.length} listing(s) from ${sourceKeys.join(', ')}.`);
            } catch (err) {
                // One source/level failing shouldn't stop the others from
                // still being checked in this same run.
                console.log(`Maintenance scrape failed for ${level}, skipping: ${err.message}`);
            }
        }
        await Actor.exit();
        // Actor.exit() ends the run on Apify's side but does not itself halt
        // JS execution (this is top-level script code, not inside a
        // function, so there's no `return` to reach for) — without this,
        // execution would fall through into the profile-matching code below
        // with an empty profile. process.exit(0) is the actual stop.
        process.exit(0);
    }

    // Pick the scholarship-portal site matching the student's own education
    // level (Bachelorsportal/Mastersportal/PhDportal — sibling sites, same
    // network, one per level) instead of always scraping PhD listings
    // regardless of who's asking. See sourceKeysForEducationLevel in scrape.js.
    const levelSourceKeys = sourceKeysForEducationLevel(educationLevel);

    // Opportunity Desk is off by default: it's Cloudflare-protected, and
    // unlike the *portal sites (confirmed working live through Website
    // Content Crawler), it's never actually been tested against our
    // pipeline. Set ENABLE_OPPORTUNITY_DESK=1 once there's quota to spare
    // for a real test. enrichLimitPerSource stays 5 total either way, split
    // across whichever sources are active, so turning this on doesn't
    // silently double the LLM call budget for a run.
    const sourceKeys = process.env.ENABLE_OPPORTUNITY_DESK === '1'
        ? [...levelSourceKeys, 'opportunitydesk']
        : levelSourceKeys;

    // A stale Apify build silently ran old code for hours on 2026-09-22 (a
    // Docker layer cache hit on `COPY . ./` reused the previous image
    // instead of picking up new commits, despite the build showing
    // "Succeeded"), with no way to tell from the logs alone. This line pins
    // an exact source identifier to every run, so "is this actually running
    // what I just pushed" is a log line, not a guess: bump BUILD_MARKER any
    // time you need to force-verify a deploy actually landed.
    const BUILD_MARKER = '2026-09-22-trust-scoring-missing-data-fix';
    console.log(`Build marker: ${BUILD_MARKER}`);

    // Env-gated flags have silently failed to take effect before (set in
    // the console but not actually baked into the build that ran, with no
    // visible sign why), so every run logs exactly what it saw, checkable
    // in the run log instead of guessed at.
    console.log(`Config: LLM_PROVIDER=${JSON.stringify(process.env.LLM_PROVIDER)} (using ${useGemini ? 'Gemini' : useOpenRouter ? 'OpenRouter' : 'Groq'}), GROQ_API_KEY set=${Boolean(process.env.GROQ_API_KEY)}, OPPORTUNITY_RADAR_TEST_MODE=${JSON.stringify(process.env.OPPORTUNITY_RADAR_TEST_MODE)} (isTestRun=${isTestRun}), ENABLE_OPPORTUNITY_DESK=${JSON.stringify(process.env.ENABLE_OPPORTUNITY_DESK)}, ENABLE_ALUMNI_SIGNAL=${JSON.stringify(process.env.ENABLE_ALUMNI_SIGNAL)}, GOOGLE_API_KEY_SEARCH set=${Boolean(process.env.GOOGLE_API_KEY_SEARCH)}`);

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
        const match = await matchListing(listing, profile, generateContentWithRetry, resolvedCvText);

        // Search evidence is only worth fetching for listings a student could
        // actually pursue — no point checking the trust of something already
        // ruled out on hard requirements. Uses generateContentForSearch (a
        // separate key, if configured) so relevance-filtering has its own quota
        // instead of competing with scraping/matching for the same daily limit.
        const searchEvidence = match.hardRequirementsMet
            ? await searchForListingEvidence(listing, { sourceHostname: 'phdportal.com', generateContentWithRetry: generateContentForSearch })
            : null;

        // Opt-in, off by default: two more DuckDuckGo + relevance-filter
        // calls per checked listing (Scholar Africa, Opportunity Desk), on
        // top of an already rate-limit-pressured LLM quota. Set
        // ENABLE_PARTNER_VERIFICATION=1 once quota allows testing it for
        // real. A listing genuinely found on one of these sites — both of
        // which manually verify every listing against its issuing
        // institution — is real positive trust evidence, not just another
        // page that happens to mention the name.
        let partnerSiteEvidence = null;
        if (process.env.ENABLE_PARTNER_VERIFICATION === '1' && match.hardRequirementsMet) {
            partnerSiteEvidence = await Promise.all(
                Object.keys(VERIFICATION_PARTNERS).map((key) =>
                    checkPartnerSitePresence(listing, key, { generateContentWithRetry: generateContentForSearch })
                )
            );
        }

        const trust = scoreListing(listing, searchEvidence, learnedPatterns, partnerSiteEvidence);

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

        // Pay-per-event billing: one charge per listing that's been fully
        // matched against the profile AND trust-scored, since that pairing —
        // not just scraping a listing — is what this Actor actually does
        // differently. "listing-processed" must exist in the Actor's PPE
        // pricing configuration on Apify Console for this to charge anything;
        // locally and on non-monetized runs it's a harmless no-op.
        await Actor.charge({ eventName: 'listing-processed' });
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
