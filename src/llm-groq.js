// Groq as another alternative to Gemini/OpenRouter. Added after OpenRouter's
// free tier (50 requests/day, shared across every free model) got exhausted
// mid-run in production and crashed the Actor. Groq's free tier is per-model
// and rate-limited per-minute rather than a single tight daily cap shared
// across everything, so it holds up better across a full run. Matches
// generateContentWithRetry's exact interface (a function returning
// { response: { text: () => string } }) so it's a drop-in swap everywhere
// that interface is already used.
//
// llama-3.3-70b-versatile (the original default here) was deprecated from
// Groq's catalog and started 404ing in production, confirmed directly
// against the account's actual available models. openai/gpt-oss-20b is a
// real, current model on the account (verified in Groq Console), and is
// deliberately the smaller "text to text" model rather than the 120b
// reasoning-focused one, plenty for eligibility interpretation and listing
// extraction, and cheaper/faster on the free tier.
const DEFAULT_MODEL = 'openai/gpt-oss-20b';

export function makeGroqGenerateContent(apiKey, { model = DEFAULT_MODEL, minMsBetweenCalls = 2000 } = {}) {
    let lastCallAt = 0;

    return async function generateContentWithRetry(prompt, retries = 4) {
        const waitFor = lastCallAt + minMsBetweenCalls - Date.now();
        if (waitFor > 0) await new Promise((resolve) => setTimeout(resolve, waitFor));
        lastCallAt = Date.now();

        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${apiKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model,
                        messages: [{ role: 'user', content: prompt }],
                        // gpt-oss models are reasoning models by default and can mix
                        // chain-of-thought text into the response, which would break
                        // the plain-JSON parsing every caller of this function does
                        // (the same failure mode hit with an OpenRouter reasoning
                        // model earlier in this project). Set defensively, before
                        // ever seeing it actually break something in production.
                        reasoning_effort: 'low',
                    }),
                });

                if (!res.ok) {
                    const isRetryable = res.status === 429 || res.status === 503;
                    if (!isRetryable || attempt === retries) {
                        const body = await res.text();
                        throw new Error(`Groq call failed (${res.status}): ${body}`);
                    }
                    const delayMs = 3000 * attempt;
                    console.log(`Groq call failed (${res.status}), retrying in ${delayMs}ms (attempt ${attempt}/${retries})`);
                    await new Promise((resolve) => setTimeout(resolve, delayMs));
                    lastCallAt = Date.now();
                    continue;
                }

                const data = await res.json();
                const text = data.choices?.[0]?.message?.content ?? '';
                return { response: { text: () => text } };
            } catch (err) {
                if (attempt === retries) throw err;
                const delayMs = 3000 * attempt;
                console.log(`Groq call errored (${err.message}), retrying in ${delayMs}ms (attempt ${attempt}/${retries})`);
                await new Promise((resolve) => setTimeout(resolve, delayMs));
                lastCallAt = Date.now();
            }
        }
    };
}
