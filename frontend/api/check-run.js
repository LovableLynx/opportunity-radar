// Checks a run's status, and fetches its dataset items once it succeeds.
// The frontend polls this every few seconds instead of holding one request
// open for the whole run (see start-run.js for why).

// Apify run IDs are globally addressable — this endpoint had no check that
// a given runId actually belongs to this Actor before returning its status
// and results. The token used here is scoped to this Apify account, so it
// can only ever see runs on that account, but if that account ever runs
// more than one Actor, someone with (or guessing) a valid run ID from a
// different Actor on the same account could pull its results through this
// endpoint. Fixed by comparing a run's actId against this Actor's own real
// ID, fetched from Apify directly rather than hardcoded/guessed — Apify's
// actor-runs response returns actId as its raw internal ID, not the
// username~name form used in request URLs, and guessing that format wrong
// would either make this check too strict (breaks real runs) or too loose
// (doesn't fix the bug), so it's resolved once, for real, at request time
// instead. No new persistent state needed (no session/auth system exists
// here, this is a public tool by design) — this just scopes the endpoint to
// only ever answer about opportunity-radar's own runs, whoever asks.
const ACTOR_SLUG = 'lovablelynx~opportunity-radar';
let cachedActorId = null;

async function getThisActorId(token) {
    if (cachedActorId) return cachedActorId;
    const res = await fetch(`https://api.apify.com/v2/acts/${ACTOR_SLUG}?token=${token}`);
    if (!res.ok) return null;
    const data = await res.json();
    cachedActorId = data.data.id;
    return cachedActorId;
}

export default async function handler(req, res) {
    const token = process.env.APIFY_API_TOKEN;
    if (!token) {
        res.status(500).json({ error: 'Server is missing its Apify token. Set APIFY_API_TOKEN in Vercel project settings.' });
        return;
    }

    const { runId } = req.query;
    if (!runId || typeof runId !== 'string' || !/^[A-Za-z0-9]+$/.test(runId)) {
        res.status(400).json({ error: 'Missing or invalid runId' });
        return;
    }

    try {
        const runRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${token}`);
        if (!runRes.ok) {
            res.status(runRes.status).json({ error: 'Could not check run status.' });
            return;
        }

        const runData = await runRes.json();

        const thisActorId = await getThisActorId(token);
        if (!thisActorId || runData.data.actId !== thisActorId) {
            // A run genuinely outside this Actor is treated as not found,
            // not detailed — and if we couldn't resolve this Actor's own ID
            // at all, fail closed rather than skip the check.
            res.status(404).json({ error: 'Run not found.' });
            return;
        }

        const status = runData.data.status;

        if (status === 'SUCCEEDED') {
            const datasetId = runData.data.defaultDatasetId;
            const itemsRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}`);
            const results = await itemsRes.json();
            res.status(200).json({ status, results });
            return;
        }

        if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
            res.status(200).json({ status, error: `Run ended with status ${status}` });
            return;
        }

        // RUNNING, READY, etc — still in progress, nothing to render yet.
        res.status(200).json({ status });
    } catch (err) {
        console.error(`Could not reach Apify: ${err.message}`);
        res.status(500).json({ error: 'Could not reach Apify.' });
    }
}
