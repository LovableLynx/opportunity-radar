// Real web-search evidence for trust scoring, via DuckDuckGo's lite HTML
// endpoint. This is what lets trust.js say "no independent presence found"
// as an observed fact rather than a guess — a real web search ran.
//
// Google Custom Search JSON API is closed to new customers, Bing's Search
// API is fully retired, and Gemini's free Google Search grounding only
// works on gemini-2.5-flash/2.5-flash-lite, which are also closed to new
// users (confirmed directly against our key: real 404). DuckDuckGo's lite
// endpoint has no official API or key requirement and returned real,
// independent results in testing. It's a soft target for automated use
// (their ToS discourages non-personal automated access, and they can
// rate-limit), so failures here are treated as "no evidence available"
// rather than something to retry aggressively or let crash the run.

const SEARCH_URL = 'https://lite.duckduckgo.com/lite/';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function extractResultDomains(html) {
    const linkPattern = /class=['"]result-link['"][^>]*href=["']([^"']+)["']/g;
    const altPattern = /href=["']([^"']+)["'][^>]*class=['"]result-link['"]/g;

    const domains = new Set();
    for (const pattern of [linkPattern, altPattern]) {
        for (const match of html.matchAll(pattern)) {
            const raw = match[1];
            // DuckDuckGo lite wraps result URLs as //duckduckgo.com/l/?uddg=<encoded-url>&rut=...
            const uddgMatch = raw.match(/uddg=([^&]+)/);
            const targetUrl = uddgMatch ? decodeURIComponent(uddgMatch[1]) : raw;
            try {
                domains.add(new URL(targetUrl).hostname.replace(/^www\./, ''));
            } catch {
                // not a real absolute URL, skip
            }
        }
    }
    return domains;
}

/**
 * Searches DuckDuckGo for the listing's title and returns evidence for the
 * two search-dependent trust signals.
 *
 * independentResultsFound: true if any result comes from a domain other than
 * the listing's own source site — a real external mention.
 *
 * secondarySourceFound: true if there's more than one distinct domain in the
 * results at all, meaning the opportunity is discussed in more than one
 * place on the web, not just a single isolated listing.
 */
export async function searchForListingEvidence(listing, { sourceHostname } = {}) {
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
    const domains = extractResultDomains(html);

    const independentResultsFound = sourceHostname
        ? [...domains].some((d) => d !== sourceHostname.replace(/^www\./, ''))
        : domains.size > 0;

    const secondarySourceFound = domains.size > 1;

    return { independentResultsFound, secondarySourceFound, resultCount: domains.size };
}
