// Real web-search evidence for trust scoring, via the Google Custom Search
// JSON API. This is what lets trust.js say "no independent presence found"
// as an observed fact rather than a guess — the search actually ran.

const SEARCH_ENDPOINT = 'https://www.googleapis.com/customsearch/v1';

/**
 * Runs a Google Custom Search for the listing's organization/title and
 * returns evidence for the two search-dependent trust signals.
 *
 * independentResultsFound: true if any result comes from a domain other than
 * the listing's own source site (phdportal.com) — a real external mention.
 *
 * secondarySourceFound: true if there's more than one distinct domain in the
 * results at all, meaning the opportunity is discussed in more than one
 * place on the web, not just a single isolated listing.
 */
export async function searchForListingEvidence(listing, { apiKey, searchEngineId, sourceHostname }) {
    if (!apiKey || !searchEngineId) {
        console.log('Google Custom Search not configured (missing key/engine ID) — skipping search evidence.');
        return null;
    }

    const query = listing.title;
    const url = new URL(SEARCH_ENDPOINT);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('cx', searchEngineId);
    url.searchParams.set('q', query);
    url.searchParams.set('num', '10');

    let response;
    try {
        response = await fetch(url.toString());
    } catch (err) {
        console.log(`Google Custom Search request failed for "${listing.title}": ${err.message}`);
        return null;
    }

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        console.log(`Google Custom Search returned ${response.status} for "${listing.title}": ${body.slice(0, 300)}`);
        return null; // treat as "no evidence available" rather than crashing the run
    }

    const data = await response.json();
    const items = data.items ?? [];

    const domains = new Set(
        items
            .map((item) => {
                try {
                    return new URL(item.link).hostname.replace(/^www\./, '');
                } catch {
                    return null;
                }
            })
            .filter(Boolean),
    );

    const independentResultsFound = sourceHostname
        ? [...domains].some((d) => d !== sourceHostname.replace(/^www\./, ''))
        : domains.size > 0;

    const secondarySourceFound = domains.size > 1;

    return { independentResultsFound, secondarySourceFound, resultCount: items.length };
}
