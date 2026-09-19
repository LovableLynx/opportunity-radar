// Alternative to search.js: real web-search evidence via Claude's web_search
// tool ($10/1,000 searches, no new-account restriction the way Gemini's free
// grounding or Google Custom Search have). Same interface as search.js
// (searchForListingEvidence(listing, { sourceHostname })), so main.js can
// swap between them by changing one import if DuckDuckGo gets unreliable or
// this becomes the preferred path once billing/API access is confirmed.
//
// Unlike the DuckDuckGo version, this asks Claude to reason about the search
// results before answering, rather than us guessing relevance from raw
// domain names — closer to what we wanted from Gemini grounding originally.

import Anthropic from '@anthropic-ai/sdk';

let cachedClient = null;
function getClient() {
    if (!cachedClient) cachedClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    return cachedClient;
}

export async function searchForListingEvidence(listing, { sourceHostname, client } = {}) {
    if (!client && !process.env.ANTHROPIC_API_KEY) {
        console.log('No ANTHROPIC_API_KEY set — skipping Claude search evidence.');
        return null;
    }

    const anthropic = client ?? getClient();

    let response;
    try {
        response = await anthropic.messages.create({
            model: 'claude-sonnet-4-5',
            max_tokens: 1024,
            tools: [{ type: 'web_search_20250305', name: 'web_search' }],
            messages: [
                {
                    role: 'user',
                    content: `Search for this scholarship/grant opportunity: "${listing.title}". Is it discussed anywhere on the web beyond a single listing site? List the distinct domains where you found real information about it.`,
                },
            ],
        });
    } catch (err) {
        console.log(`Claude web search failed for "${listing.title}": ${err.message}`);
        return null; // treat as "no evidence available" rather than crashing the run
    }

    // Web search results come back as tool_result content blocks containing
    // the URLs Claude actually retrieved, separate from its final text answer.
    const domains = new Set();
    for (const block of response.content) {
        if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
            for (const result of block.content) {
                if (result.url) {
                    try {
                        domains.add(new URL(result.url).hostname.replace(/^www\./, ''));
                    } catch {
                        // not a valid absolute URL, skip
                    }
                }
            }
        }
    }

    const independentResultsFound = sourceHostname
        ? [...domains].some((d) => d !== sourceHostname.replace(/^www\./, ''))
        : domains.size > 0;

    const secondarySourceFound = domains.size > 1;

    return { independentResultsFound, secondarySourceFound, resultCount: domains.size };
}
