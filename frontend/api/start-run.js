// Starts an Actor run and returns immediately with a run ID, instead of
// waiting for the whole multi-minute run to finish. A real run takes 10+
// minutes, far past any Vercel serverless function's timeout — the old
// run-radar.js awaited the whole thing in one request and would have been
// killed by Vercel long before Apify finished. The frontend now starts a
// run here, then polls check-run.js for status.

// Mirrors .actor/input_schema.json's contract (required fields, the
// educationLevel enum) at the actual public entry point. The frontend form
// already validates client-side, but that only stops the UI — this route
// is a public API that accepts whatever body is POSTed to it, and nothing
// here previously checked it before forwarding straight to Apify. An empty
// or garbage request would still start a real, billed Actor run (Groq
// calls, Apify compute) before ever failing. String length caps exist
// because cvText in particular gets embedded directly into LLM prompts
// (see src/match.js) — an unbounded paste wastes tokens for no benefit, the
// eligibility-matching prompt only needs a CV's actual content, not an
// arbitrarily large blob.
const EDUCATION_LEVELS = ['High school', 'Bachelors', 'Masters', 'PhD'];
const MAX_LENGTHS = {
    fieldOfStudy: 200,
    country: 200,
    gpaOrGrade: 100,
    cvText: 20000,
};

// A real production test caught this: submitting fieldOfStudy="hy" and
// gpaOrGrade="00" passed every check above (both are non-empty strings
// under the length cap) and still triggered a full, real, billed Actor
// run — 20 listings scraped, 20 real LLM calls made — before anything
// noticed the input was nonsense. fieldOfStudy and country are genuinely
// free text (an international field/country name has no reliable
// "is this real" check short of a hardcoded list that would wrongly reject
// legitimate niche entries, or another LLM call, which defeats the point of
// blocking garbage cheaply), so this is a best-effort minimum-plausibility
// floor, not a guarantee: reject a bare minimum length and pure gibberish
// (no vowels at all, since virtually no real field-of-study or country name
// in any language is consonants-only), not a claim that everything past
// this filter is definitely real.
// 2, not 3: real, common inputs like "UK", "US", "IT", and "AI" are two
// letters. The no-vowel rule below still rejects two-letter junk like "hy".
const MIN_FREE_TEXT_LENGTH = 2;
const NO_VOWELS_PATTERN = /^[^aeiouAEIOU\s]+$/;

// gpaOrGrade, unlike fieldOfStudy/country, has a real expected shape — a
// number (optionally out of a scale), a percentage, or a named
// classification — so it gets a genuine format check rather than a
// heuristic floor. "00" matches none of these.
const GPA_FRACTION_PATTERN = /^\d+(\.\d+)?\s*\/\s*\d+(\.\d+)?$/; // "3.6/4.0"
const GPA_PERCENT_PATTERN = /^\d+(\.\d+)?\s*%$/; // "85%"
const GPA_BARE_NUMBER_PATTERN = /^\d+(\.\d+)?$/; // "3.6" or "85", scale-checked below
const GPA_CLASSIFICATION_PATTERN = /first class|second class|upper|lower|distinction|merit|pass|honou?rs|cgpa/i;

// 5-30 is genuinely ambiguous ("8" could mean 8/10 or a typo). At or below 5
// it's unambiguous CGPA/5.00, a standard Nigerian scale. Above 30 it can
// only be a percentage.
const BARE_NUMBER_UNAMBIGUOUS_LOW_CEILING = 5;
const BARE_NUMBER_UNAMBIGUOUS_FLOOR = 30;

function isPlausibleGpa(value) {
    const trimmed = value.trim();

    if (GPA_FRACTION_PATTERN.test(trimmed) || GPA_PERCENT_PATTERN.test(trimmed) || GPA_CLASSIFICATION_PATTERN.test(trimmed)) {
        return true;
    }

    if (GPA_BARE_NUMBER_PATTERN.test(trimmed)) {
        const n = parseFloat(trimmed);
        // "0"/"0.0" is technically in range but functionally meaningless as
        // a grade someone would report, and anything past 100 isn't a
        // sensible percentage either.
        if (n <= 0) return false;
        return n <= BARE_NUMBER_UNAMBIGUOUS_LOW_CEILING || (n > BARE_NUMBER_UNAMBIGUOUS_FLOOR && n <= 100);
    }

    return false;
}

// Returns { valid: true } or { valid: false, fieldErrors: { field: message },
// error: "first message, for callers that only want one string" }.
// Collects every field's problem in one pass instead of stopping at the
// first, since a real user hit exactly this: fieldOfStudy="hy" AND
// country="7" submitted together, but the old return-on-first-error
// behavior only ever reported fieldOfStudy, so fixing it and resubmitting
// would have then failed again on country, one frustrating round-trip at a
// time instead of seeing every problem at once.
export function validateProfile(body) {
    if (!body || typeof body !== 'object') {
        return { valid: false, fieldErrors: {}, error: 'Request body must be a JSON object.' };
    }

    const { educationLevel, fieldOfStudy, country, fundingNeeded, gpaOrGrade, cvText } = body;
    const fieldErrors = {};

    if (typeof educationLevel !== 'string' || !EDUCATION_LEVELS.includes(educationLevel)) {
        fieldErrors.educationLevel = `educationLevel must be one of: ${EDUCATION_LEVELS.join(', ')}.`;
    }

    if (typeof fieldOfStudy !== 'string' || !fieldOfStudy.trim()) {
        fieldErrors.fieldOfStudy = 'fieldOfStudy is required.';
    } else if (fieldOfStudy.trim().length < MIN_FREE_TEXT_LENGTH || NO_VOWELS_PATTERN.test(fieldOfStudy.trim())) {
        fieldErrors.fieldOfStudy = 'fieldOfStudy does not look like a real field of study.';
    } else if (fieldOfStudy.length > MAX_LENGTHS.fieldOfStudy) {
        fieldErrors.fieldOfStudy = `fieldOfStudy is too long (max ${MAX_LENGTHS.fieldOfStudy} characters).`;
    }

    if (typeof country !== 'string' || !country.trim()) {
        fieldErrors.country = 'country is required.';
    } else if (country.trim().length < MIN_FREE_TEXT_LENGTH || NO_VOWELS_PATTERN.test(country.trim())) {
        fieldErrors.country = 'country does not look like a real country name.';
    } else if (country.length > MAX_LENGTHS.country) {
        fieldErrors.country = `country is too long (max ${MAX_LENGTHS.country} characters).`;
    }

    if (fundingNeeded !== undefined && typeof fundingNeeded !== 'boolean') {
        fieldErrors.fundingNeeded = 'fundingNeeded must be a boolean.';
    }

    if (gpaOrGrade !== undefined && gpaOrGrade !== null && typeof gpaOrGrade !== 'string') {
        fieldErrors.gpaOrGrade = 'gpaOrGrade must be a string.';
    } else if (typeof gpaOrGrade === 'string' && gpaOrGrade.trim()) {
        if (gpaOrGrade.length > MAX_LENGTHS.gpaOrGrade) {
            fieldErrors.gpaOrGrade = `gpaOrGrade is too long (max ${MAX_LENGTHS.gpaOrGrade} characters).`;
        } else if (!isPlausibleGpa(gpaOrGrade)) {
            fieldErrors.gpaOrGrade = 'gpaOrGrade does not look like a real grade (expected e.g. "3.6/4.0", "85%", or "First Class").';
        }
    }

    if (cvText !== undefined && cvText !== null && typeof cvText !== 'string') {
        fieldErrors.cvText = 'cvText must be a string.';
    } else if (typeof cvText === 'string' && cvText.length > MAX_LENGTHS.cvText) {
        fieldErrors.cvText = `cvText is too long (max ${MAX_LENGTHS.cvText} characters).`;
    }

    const messages = Object.values(fieldErrors);
    if (messages.length === 0) return { valid: true };
    return { valid: false, fieldErrors, error: messages[0] };
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Use POST' });
        return;
    }

    const validation = validateProfile(req.body);
    if (!validation.valid) {
        res.status(400).json({ error: validation.error, fieldErrors: validation.fieldErrors });
        return;
    }

    const token = process.env.APIFY_API_TOKEN;
    if (!token) {
        res.status(500).json({ error: 'Server is missing its Apify token. Set APIFY_API_TOKEN in Vercel project settings.' });
        return;
    }

    try {
        const apifyRes = await fetch(
            `https://api.apify.com/v2/acts/lovablelynx~opportunity-radar/runs?token=${token}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(req.body),
            }
        );

        if (!apifyRes.ok) {
            // Apify's raw error text could include internal account/actor
            // details not meant for a public caller — logged server-side
            // for real debugging, but the response to the caller stays
            // generic.
            const text = await apifyRes.text();
            console.error(`Apify run start failed (${apifyRes.status}): ${text}`);
            res.status(apifyRes.status).json({ error: 'Could not start the Actor run.' });
            return;
        }

        const data = await apifyRes.json();
        res.status(200).json({ runId: data.data.id });
    } catch (err) {
        console.error(`Could not reach Apify: ${err.message}`);
        res.status(500).json({ error: 'Could not reach Apify.' });
    }
}
