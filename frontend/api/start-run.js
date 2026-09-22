// Starts an Actor run and returns immediately with a run ID, instead of
// waiting for the whole multi-minute run to finish. A real run takes 10+
// minutes, far past any Vercel serverless function's timeout — the old
// run-radar.js awaited the whole thing in one request and would have been
// killed by Vercel long before Apify finished. The frontend now starts a
// run here, then polls check-run.js for status.
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Use POST' });
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
