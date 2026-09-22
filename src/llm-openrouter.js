// OpenRouter as an alternative to Gemini, for when Google Cloud Billing isn't
// available (some countries can't add a billing account at all, which blocks
// paying for higher Gemini quota even when we want to). OpenRouter has real
// free models with no billing requirement, and its own paid tier if we ever
// want a stronger model later. Matches generateContentWithRetry's exact
// interface (a function returning { response: { text: () => string } }) so
// it's a drop-in swap everywhere that interface is already used.
const DEFAULT_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';

export function makeOpenRouterGenerateContent(apiKey, { model = DEFAULT_MODEL, minMsBetweenCalls = 2000 } = {}) {
    let lastCallAt = 0;

    return async function generateContentWithRetry(prompt, retries = 4) {
        const waitFor = lastCallAt + minMsBetweenCalls - Date.now();
        if (waitFor > 0) await new Promise((resolve) => setTimeout(resolve, waitFor));
        lastCallAt = Date.now();

        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${apiKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model,
                        messages: [{ role: 'user', content: prompt }],
                        // This model defaults to reasoning mode on, which mixes
                        // chain-of-thought into the response and would break the
                        // plain-JSON parsing every caller of this function does.
                        // Explicitly disabling it keeps the response clean.
                        reasoning: { enabled: false },
                    }),
                });

                if (!res.ok) {
                    const isRetryable = res.status === 429 || res.status === 503;
                    if (!isRetryable || attempt === retries) {
                        const body = await res.text();
                        throw new Error(`OpenRouter call failed (${res.status}): ${body}`);
                    }
                    const delayMs = 3000 * attempt;
                    console.log(`OpenRouter call failed (${res.status}), retrying in ${delayMs}ms (attempt ${attempt}/${retries})`);
                    await new Promise((resolve) => setTimeout(resolve, delayMs));
                    lastCallAt = Date.now();
                    continue;
                }

                const data = await res.json();
                // Some models return content and reasoning as separate fields
                // even with reasoning disabled — only .content is the actual
                // answer callers expect to parse (often as JSON).
                const text = data.choices?.[0]?.message?.content ?? '';
                return { response: { text: () => text } };
            } catch (err) {
                if (attempt === retries) throw err;
                const delayMs = 3000 * attempt;
                console.log(`OpenRouter call errored (${err.message}), retrying in ${delayMs}ms (attempt ${attempt}/${retries})`);
                await new Promise((resolve) => setTimeout(resolve, delayMs));
                lastCallAt = Date.now();
            }
        }
    };
}
