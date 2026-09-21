// Real web-search evidence for trust scoring: DuckDuckGo's lite HTML
// endpoint finds candidate results, then Gemini judges whether each result
// is actually about the listing before it counts as evidence.
//
// Why two steps instead of trusting DuckDuckGo alone: a plain keyword search
// can't tell "genuinely discusses this opportunity" from "happens to share
// words with it". Tested directly: searching a completely made-up fake
// scholarship name still returned 10 results — generic "how to spot
// scholarship scams" articles that matched on keywords like "fake" and
// "scholarship", not anything about the fake listing itself. Filtering
// those out for real needs judgment a regex can't do, so each candidate
// result's title+snippet gets checked against the listing by an LLM before
// it counts as "independent presence" or "secondary source" evidence.
//
// Google Custom Search JSON API is closed to new customers, Bing's Search
// API is fully retired, and Gemini's free Google Search grounding only
// works on gemini-2.5-flash/2.5-flash-lite, which are also closed to new
// users (confirmed directly against our key: real 404). DuckDuckGo's lite
// endpoint has no official API or key requirement. It's a soft target for
// automated use (their ToS discourages non-personal automated access, and
// they can rate-limit), so failures here are treated as "no evidence
// available" rather than something to retry aggressively or let crash the
// run.

const SEARCH_URL = 'https://lite.duckduckgo.com/lite/';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function decodeDdgUrl(raw) {
    const uddgMatch = raw.match(/uddg=([^&]+)/);
    return uddgMatch ? decodeURIComponent(uddgMatch[1]) : raw;
}

function extractCandidateResults(html) {
    // Each result is an <a class='result-link'>title</a>, with href and
    // class in no guaranteed order (DuckDuckGo's real markup has href
    // before class), followed later by a <td class='result-snippet'>...</td>.
    // Find every <a ...>...</a> tag first, then filter to the ones whose
    // attributes include class='result-link', regardless of attribute order.
    const allAnchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)];
    const links = allAnchors
        .filter(([, attrs]) => /class=['"]result-link['"]/.test(attrs))
        .map(([, attrs, innerHtml]) => {
            const hrefMatch = attrs.match(/href=["']([^"']+)["']/);
            return {
                url: hrefMatch ? decodeDdgUrl(hrefMatch[1]) : null,
                title: innerHtml.replace(/<[^>]+>/g, '').trim(),
            };
        })
        .filter((link) => link.url);

    const snippetPattern = /class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/g;
    const snippets = [...html.matchAll(snippetPattern)].map((m) => m[1].replace(/<[^>]+>/g, '').trim());

    return links.map((link, i) => ({ ...link, snippet: snippets[i] ?? '' }));
}

function hostnameOf(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        return null;
    }
}

/**
 * Asks the LLM which of the candidate results are genuinely about this
 * listing, not just keyword-adjacent. Returns the filtered, relevant subset.
 */
async function filterRelevantResults(listing, candidates, generateContentWithRetry) {
    if (!generateContentWithRetry || candidates.length === 0) return candidates;

    const listForPrompt = candidates
        .map((c, i) => `${i}. "${c.title}" — ${c.snippet}`)
        .join('\n');

    const prompt = `A search was run for this scholarship/opportunity: "${listing.title}".

Here are the search results found:
${listForPrompt}

Which of these results are genuinely about this specific opportunity (not just pages that happen to share some words with the title, like generic scam-warning articles or unrelated content)? Return ONLY a JSON array of the index numbers that are genuinely relevant, e.g. [0, 2]. If none are relevant, return [].`;

    try {
        const result = await generateContentWithRetry(prompt);
        const rawText = result.response.text() ?? '';
        const jsonMatch = rawText.match(/\[[\s\S]*\]/);
        // No array pattern at all in the response is a malformed/unusable
        // answer, not "zero relevant results" — treat it as a failure so it
        // falls back to unfiltered candidates instead of silently discarding
        // every result.
        if (!jsonMatch) throw new Error(`No JSON array found in response: ${rawText.slice(0, 200)}`);
        const relevantIndexes = JSON.parse(jsonMatch[0]);
        return candidates.filter((_, i) => relevantIndexes.includes(i));
    } catch (err) {
        console.log(`Relevance filtering failed, falling back to unfiltered results: ${err.message}`);
        return candidates; // degrade to the old keyword-only behavior rather than losing all evidence
    }
}

/**
 * Searches DuckDuckGo for the listing's title, filters results for genuine
 * relevance via the LLM, and returns evidence for the two search-dependent
 * trust signals.
 *
 * independentResultsFound: true if any *relevant* result comes from a domain
 * other than the listing's own source site — a real external mention.
 *
 * secondarySourceFound: true if there's more than one distinct domain among
 * the *relevant* results, meaning the opportunity is genuinely discussed in
 * more than one place, not just a single isolated listing.
 */
export async function searchForListingEvidence(listing, { sourceHostname, generateContentWithRetry } = {}) {
    const url = `${SEARCH_URL}?q=${encodeURIComponent(listing.title)}`;

    let response;
    try {
        response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    } catch (err) {
        console.log(`DuckDuckGo search request failed for "${listing.title}": ${err.message}`);
        return null;
    }

    if (!response.ok) {
        console.log(`DuckDuckGo search returned ${response.status} for "${listing.title}" — treating as no evidence available.`);
        return null; // treat as "no evidence available" rather than crashing the run
    }

    const html = await response.text();
    const candidates = extractCandidateResults(html);
    const relevant = await filterRelevantResults(listing, candidates, generateContentWithRetry);

    const domains = new Set(relevant.map((r) => hostnameOf(r.url)).filter(Boolean));

    const independentResultsFound = sourceHostname
        ? [...domains].some((d) => d !== sourceHostname.replace(/^www\./, ''))
        : domains.size > 0;

    const secondarySourceFound = domains.size > 1;

    return {
        independentResultsFound,
        secondarySourceFound,
        resultCount: domains.size,
        candidatesFound: candidates.length,
        relevantAfterFiltering: relevant.length,
        // Raw candidates exposed so other reasoning layers (alumni-signal.js)
        // can reuse this one fetch instead of hitting DuckDuckGo again.
        candidates,
    };
}
