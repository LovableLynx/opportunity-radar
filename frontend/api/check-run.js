// Checks a run's status, and fetches its dataset items once it succeeds.
// The frontend polls this every few seconds instead of holding one request
// open for the whole run (see start-run.js for why).
export default async function handler(req, res) {
    const token = process.env.APIFY_API_TOKEN;
    if (!token) {
        res.status(500).json({ error: 'Server is missing its Apify token. Set APIFY_API_TOKEN in Vercel project settings.' });
        return;
    }

    const { runId } = req.query;
    if (!runId) {
        res.status(400).json({ error: 'Missing runId' });
        return;
    }

    try {
        const runRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${token}`);
        if (!runRes.ok) {
            const text = await runRes.text();
            res.status(runRes.status).json({ error: `Could not check run status: ${text}` });
            return;
        }

        const runData = await runRes.json();
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
        res.status(500).json({ error: `Could not reach Apify: ${err.message}` });
    }
}
