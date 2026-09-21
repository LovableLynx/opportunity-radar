// Serverless proxy: holds the Apify token server-side so it never reaches
// the browser. The frontend calls this endpoint instead of Apify directly.
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
            `https://api.apify.com/v2/acts/lovablelynx~opportunity-radar/run-sync-get-dataset-items?token=${token}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(req.body),
            }
        );

        if (!apifyRes.ok) {
            const text = await apifyRes.text();
            res.status(apifyRes.status).json({ error: `Actor call failed: ${text}` });
            return;
        }

        const results = await apifyRes.json();
        res.status(200).json({ results });
    } catch (err) {
        res.status(500).json({ error: `Could not reach the Actor: ${err.message}` });
    }
}
