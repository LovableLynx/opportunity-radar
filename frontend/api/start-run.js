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
const MIN_FREE_TEXT_LENGTH = 3;
const NO_VOWELS_PATTERN = /^[^aeiouAEIOU\s]+$/;

// gpaOrGrade, unlike fieldOfStudy/country, has a real expected shape — a
// number (optionally out of a scale), a percentage, or a named
// classification — so it gets a genuine format check rather than a
// heuristic floor. "00" matches none of these.
const GPA_PATTERNS = [
    /^\d+(\.\d+)?\s*\/\s*\d+(\.\d+)?$/, // "3.6/4.0"
    /^\d+(\.\d+)?\s*%$/, // "85%"
    /^\d+(\.\d+)?$/, // "3.6" or "85" (bare number, range-checked below)
    /first class|second class|upper|lower|distinction|merit|pass|honou?rs|cgpa/i, // named classifications
];

function isPlausibleGpa(value) {
    const trimmed = value.trim();
    if (!GPA_PATTERNS.some((p) => p.test(trimmed))) return false;
    // A bare number needs to fall in a plausible range for either a 0-4/0-5
    // scale GPA or a 0-100 percentage-style grade — "00" (0) is technically
    // in range but functionally meaningless as a grade someone would report,
    // so require a positive value too.
    const bareNumber = /^\d+(\.\d+)?$/.test(trimmed) ? parseFloat(trimmed) : null;
    if (bareNumber !== null && (bareNumber <= 0 || bareNumber > 100)) return false;
    return true;
}

export function validateProfile(body) {
    if (!body || typeof body !== 'object') return 'Request body must be a JSON object.';

    const { educationLevel, fieldOfStudy, country, fundingNeeded, gpaOrGrade, cvText } = body;

    if (typeof educationLevel !== 'string' || !EDUCATION_LEVELS.includes(educationLevel)) {
        return `educationLevel must be one of: ${EDUCATION_LEVELS.join(', ')}.`;
    }
    if (typeof fieldOfStudy !== 'string' || !fieldOfStudy.trim()) {
        return 'fieldOfStudy is required.';
    }
    if (fieldOfStudy.trim().length < MIN_FREE_TEXT_LENGTH || NO_VOWELS_PATTERN.test(fieldOfStudy.trim())) {
        return 'fieldOfStudy does not look like a real field of study.';
    }
    if (typeof country !== 'string' || !country.trim()) {
        return 'country is required.';
    }
    if (country.trim().length < MIN_FREE_TEXT_LENGTH || NO_VOWELS_PATTERN.test(country.trim())) {
        return 'country does not look like a real country name.';
    }
    if (fundingNeeded !== undefined && typeof fundingNeeded !== 'boolean') {
        return 'fundingNeeded must be a boolean.';
    }
    if (gpaOrGrade !== undefined && gpaOrGrade !== null && typeof gpaOrGrade !== 'string') {
        return 'gpaOrGrade must be a string.';
    }
    if (typeof gpaOrGrade === 'string' && gpaOrGrade.trim() && !isPlausibleGpa(gpaOrGrade)) {
        return 'gpaOrGrade does not look like a real grade (expected e.g. "3.6/4.0", "85%", or "First Class").';
    }
    if (cvText !== undefined && cvText !== null && typeof cvText !== 'string') {
        return 'cvText must be a string.';
    }

    for (const [field, max] of Object.entries(MAX_LENGTHS)) {
        const value = body[field];
        if (typeof value === 'string' && value.length > max) {
            return `${field} is too long (max ${max} characters).`;
        }
    }

    return null;
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Use POST' });
        return;
    }

    const validationError = validateProfile(req.body);
    if (validationError) {
        res.status(400).json({ error: validationError });
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
