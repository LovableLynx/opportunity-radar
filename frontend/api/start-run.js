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

export function validateProfile(body) {
    if (!body || typeof body !== 'object') return 'Request body must be a JSON object.';

    const { educationLevel, fieldOfStudy, country, fundingNeeded, gpaOrGrade, cvText } = body;

    if (typeof educationLevel !== 'string' || !EDUCATION_LEVELS.includes(educationLevel)) {
        return `educationLevel must be one of: ${EDUCATION_LEVELS.join(', ')}.`;
    }
    if (typeof fieldOfStudy !== 'string' || !fieldOfStudy.trim()) {
        return 'fieldOfStudy is required.';
    }
    if (typeof country !== 'string' || !country.trim()) {
        return 'country is required.';
    }
    if (fundingNeeded !== undefined && typeof fundingNeeded !== 'boolean') {
        return 'fundingNeeded must be a boolean.';
    }
    if (gpaOrGrade !== undefined && gpaOrGrade !== null && typeof gpaOrGrade !== 'string') {
        return 'gpaOrGrade must be a string.';
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
            const text = await apifyRes.text();
            res.status(apifyRes.status).json({ error: `Could not start the Actor: ${text}` });
            return;
        }

        const data = await apifyRes.json();
        res.status(200).json({ runId: data.data.id });
    } catch (err) {
        res.status(500).json({ error: `Could not reach Apify: ${err.message}` });
    }
}
