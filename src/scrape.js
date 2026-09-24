// Fetch a scholarship listing site's search results and extract structured
// listings. Sites like PhDportal block bare Playwright requests outright
// (403), even with a residential proxy and browser fingerprinting, so
// instead of fighting that block directly we call Apify's own "Website
// Content Crawler" Actor to fetch pages (it has stronger anti-blocking
// built in) and then use an LLM to read the returned text and pull out
// structured listings, instead of guessing CSS selectors against a page we
// can't reliably render ourselves.

// paginationParam: verified live (2026-09-24, Playwright, real rendered
// pages, not guessed) — all three studyportals.com sibling sites use the
// same "?page=N" query param, confirmed by following the actual "Next page"
// link in each site's own markup (bachelorsportal: 372 pages, mastersportal:
// 549, phdportal: 123 — plenty of headroom), and confirmed page 2 returns
// genuinely different listings, not a duplicate or redirect back to page 1.
// opportunitydesk is a different site (WordPress category page), not part of
// that family, and was never checked — left without paginationParam so it's
// untouched by this, one page only, exactly as before.
export const SOURCES = {
    phdportal: {
        name: 'phdportal',
        startUrl: 'https://www.phdportal.com/search/scholarships/phd',
        description: 'PhDportal scholarship listing page',
        paginationParam: 'page',
    },
    bachelorsportal: {
        name: 'bachelorsportal',
        startUrl: 'https://www.bachelorsportal.com/search/scholarships/bachelor',
        description: 'Bachelorsportal scholarship listing page',
        paginationParam: 'page',
    },
    mastersportal: {
        name: 'mastersportal',
        startUrl: 'https://www.mastersportal.com/search/scholarships/master',
        description: 'Mastersportal scholarship listing page',
        paginationParam: 'page',
    },
    opportunitydesk: {
        name: 'opportunitydesk',
        startUrl: 'https://opportunitydesk.org/category/scholarships/',
        description: 'Opportunity Desk scholarships category page',
    },
};

// PhDportal, Bachelorsportal, and Mastersportal are sibling sites in the same
// network (studyportals.com), same structure, one per education level. Only
// scraping PhDportal meant Bachelors/Masters students were matched against a
// pool of exclusively PhD scholarships — technically harmless (the education
// level check correctly rejects them) but useless for that student. This
// picks the right site(s) for the profile's actual level instead.
export function sourceKeysForEducationLevel(educationLevel) {
    const level = (educationLevel || '').toLowerCase();
    if (level === 'high school' || level === 'bachelors') return ['bachelorsportal'];
    if (level === 'masters') return ['mastersportal'];
    if (level === 'phd') return ['phdportal'];
    // Unknown/unset level: fall back to the original default rather than
    // guessing, so behavior for anyone not passing a level stays unchanged.
    return ['phdportal'];
}

// Builds the search-results start URLs to crawl for one source: just the
// base startUrl when pagesPerSource is 1 or the source has no verified
// pagination scheme, otherwise the base URL plus "?<paginationParam>=2",
// "=3", etc. up to pagesPerSource, using the exact param name confirmed live
// against the real rendered page's own "Next page" link (see SOURCES above).
function buildPageUrls(source, pagesPerSource) {
    if (pagesPerSource <= 1 || !source.paginationParam) return [source.startUrl];
    const urls = [source.startUrl];
    const hasQuery = source.startUrl.includes('?');
    for (let page = 2; page <= pagesPerSource; page++) {
        const separator = hasQuery ? '&' : '?';
        urls.push(`${source.startUrl}${separator}${source.paginationParam}=${page}`);
    }
    return urls;
}

// Extracts listings from one already-fetched page's text. Split out of
// fetchAndExtractListings so pagination can call it once per page without
// duplicating the parsing/normalizing logic.
async function extractListingsFromText({ generateContentWithRetry, source, pageText, pageLabel }) {
    try {
        const extraction = await generateContentWithRetry(
            `Here is the text/markdown content of a scholarship listing page (${source.description}). Extract every distinct scholarship/opportunity listing you can find as a JSON array. For each one include: title, link (the URL to the listing's own detail page, if one appears in the content, otherwise null), deadline (if stated), description (short summary), and eligibility (any stated requirements, as plain text). If a field isn't present, use null. Return ONLY the JSON array, no other text.\n\nPAGE CONTENT:\n${pageText.slice(0, 15000)}`,
        );
        const rawText = extraction.response.text() ?? '[]';
        const jsonMatch = rawText.match(/\[[\s\S]*\]/);
        const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
        // The LLM is asked for link: null when none is found, but in practice
        // sometimes omits the key or returns "undefined" as a literal string
        // instead — either of which used to reach the final output record as
        // a bare `undefined`, indistinguishable from a listing that simply
        // has no extra detail text. A listing with no confirmed link can
        // never be enriched or clicked through to verify, which is a real,
        // distinct gap worth flagging, not silently folding into "Eligible,
        // no eligibility text available".
        return parsed.map((l) => ({
            ...l,
            link: (l.link && l.link !== 'undefined') ? l.link : null,
        }));
    } catch (err) {
        // Covers both a parse failure (bad JSON back from the LLM) and the
        // call itself failing (rate limit exhausted, bad model name,
        // network death) — either way this one page contributes nothing
        // instead of taking down the whole run. One page failing already
        // degraded gracefully for a parse error before this; now it does
        // for a call failure too, the gap that let a single dead model name
        // crash a run that had already scraped everything else.
        console.log(`Could not extract listings for ${source.name} (${pageLabel}), skipping this page for this run: ${err.message}`);
        return [];
    }
}

async function fetchAndExtractListings({ client, generateContentWithRetry, actorSetValue, source, pagesPerSource = 1 }) {
    const pageUrls = buildPageUrls(source, pagesPerSource);

    let items;
    try {
        const contentCrawlerRun = await client.actor('apify/website-content-crawler').call({
            startUrls: pageUrls.map((url) => ({ url })),
            crawlerType: 'playwright:firefox',
            maxCrawlPages: pageUrls.length,
            // Markdown output keeps [text](url) links, which plain text strips out and
            // we need those links to visit each listing's own detail page.
            saveMarkdown: true,
            proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
        });
        ({ items } = await client.dataset(contentCrawlerRun.defaultDatasetId).listItems());
    } catch (err) {
        // The sub-actor call itself failing (site fully blocks it, proxy
        // dies, Apify platform hiccup) is the same class of problem as it
        // returning zero items below: this one source contributes nothing,
        // not a reason to crash the whole run.
        console.log(`Website Content Crawler failed for ${source.name}, skipping this source for this run: ${err.message}`);
        return [];
    }

    if (items.length === 0) {
        console.log(`Website Content Crawler returned no pages for ${source.name} — skipping this source for this run.`);
        return [];
    }

    let allListings = [];
    for (let i = 0; i < items.length; i++) {
        const pageText = items[i].markdown ?? items[i].text ?? '';
        const pageLabel = `page ${i + 1} of ${items.length}`;

        if (!pageText) {
            console.log(`Fetched ${pageLabel} for ${source.name} had no text/markdown content — skipping this page for this run.`);
            continue;
        }

        if (actorSetValue) {
            const key = items.length > 1
                ? `SEARCH_PAGE_RAW_${source.name.toUpperCase()}_P${i + 1}`
                : `SEARCH_PAGE_RAW_${source.name.toUpperCase()}`;
            await actorSetValue(key, pageText, { contentType: 'text/plain' });
        }

        const pageListings = await extractListingsFromText({ generateContentWithRetry, source, pageText, pageLabel });
        allListings = allListings.concat(pageListings);
    }

    // Different pages of the same search can occasionally surface the same
    // listing twice (sites re-sorting between requests, a listing pinned to
    // more than one page). De-duplicate by link when we have one — the only
    // reliable unique identifier a listing has — and otherwise by title, so
    // genuine duplicates don't double-count as separate results.
    const seen = new Set();
    const listings = allListings.filter((l) => {
        const key = l.link || l.title;
        if (!key) return true; // nothing to de-dupe against, keep it
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    console.log(`Extracted ${listings.length} listing(s) from ${source.name} across ${items.length} page(s) via LLM.`);
    return listings;
}

async function enrichListings({ client, generateContentWithRetry, listings, enrichLimit, sourceName }) {
    const toEnrich = listings.filter((l) => l.link).slice(0, enrichLimit);

    if (toEnrich.length === 0) return listings.map((l) => ({ ...l, source: sourceName }));

    console.log(`Fetching detail pages for ${toEnrich.length} ${sourceName} listing(s) to get richer eligibility text.`);

    const detailPagesText = new Map();
    try {
        const detailCrawlerRun = await client.actor('apify/website-content-crawler').call({
            startUrls: toEnrich.map((l) => ({ url: l.link })),
            crawlerType: 'playwright:firefox',
            maxCrawlPages: toEnrich.length,
            saveMarkdown: true,
            proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
        });
        const { items: detailItems } = await client.dataset(detailCrawlerRun.defaultDatasetId).listItems();
        for (const item of detailItems) {
            detailPagesText.set(item.url, item.markdown ?? item.text ?? '');
        }
    } catch (err) {
        // Enrichment is additive detail on top of listings we already have
        // from the summary page. If the detail-page crawl itself fails,
        // detailPagesText stays empty and every listing below falls through
        // to "keep summary-page data" (detailText undefined), same as a
        // per-listing enrichment failure already does, instead of losing
        // every listing from this source over an enrichment-only failure.
        console.log(`Website Content Crawler failed while enriching ${sourceName} listings, keeping summary-page data for all of them: ${err.message}`);
    }

    const enrichedListings = [];
    for (const listing of listings) {
        const detailText = detailPagesText.get(listing.link);
        let enriched = listing;

        if (detailText) {
            try {
                const enrichExtraction = await generateContentWithRetry(
                    `Here is the full detail page content for a single scholarship listing titled "${listing.title}". Extract a fuller description and the full eligibility requirements as stated on the page. Return ONLY a JSON object with keys "description" and "eligibility" (both strings, or null if not present).\n\nPAGE CONTENT:\n${detailText.slice(0, 10000)}`,
                );
                const jsonMatch = enrichExtraction.response.text().match(/\{[\s\S]*\}/);
                const enrichedFields = JSON.parse(jsonMatch ? jsonMatch[0] : '{}');
                enriched = { ...listing, ...enrichedFields, enriched: true };
            } catch (err) {
                console.log(`Could not enrich "${listing.title}" (${sourceName}), keeping summary-page data: ${err.message}`);
            }
        }

        enrichedListings.push({ ...enriched, source: sourceName });
    }

    return enrichedListings;
}

/**
 * Scrapes one or more sources and returns a combined, enriched listing
 * array. sourceKeys defaults to just PhDportal, so any existing caller that
 * doesn't pass it behaves exactly as before this feature existed.
 * enrichLimitPerSource is split across however many sources are active, so
 * adding a second source doesn't silently double the total LLM call budget
 * for a run, the same total budget just gets shared.
 */
export async function scrapeListings({
    client,
    generateContentWithRetry,
    actorSetValue,
    listingLimit,
    sourceKeys = ['phdportal'],
    enrichLimitPerSource = 5,
    // Was implicitly 1 (a single summary page, whatever count that page
    // happened to hold — verified live to be ~20 for these sources). Raising
    // this crawls additional real, verified "?page=N" URLs per source (see
    // SOURCES' paginationParam comment) instead of stopping at page 1, for
    // sources where that scheme was actually confirmed. A source without a
    // verified pagination scheme (opportunitydesk) silently stays at 1 page
    // regardless of this value — buildPageUrls only pages sources that have
    // paginationParam set, so this can't send it an unverified URL shape.
    pagesPerSource = 1,
}) {
    const activeSources = sourceKeys.map((key) => SOURCES[key]).filter(Boolean);
    if (activeSources.length === 0) {
        throw new Error(`No valid sources in sourceKeys: ${JSON.stringify(sourceKeys)}. Valid keys: ${Object.keys(SOURCES).join(', ')}`);
    }

    // Splitting the enrich budget across sources keeps the total LLM call
    // count for a run roughly constant whether there's 1 source or several,
    // rather than each additional source adding its own full budget on top.
    const perSourceEnrichLimit = Math.max(1, Math.floor(enrichLimitPerSource / activeSources.length));

    let combined = [];
    for (const source of activeSources) {
        const rawListings = await fetchAndExtractListings({ client, generateContentWithRetry, actorSetValue, source, pagesPerSource });

        let listings = rawListings;
        if (listingLimit) {
            // Cap is applied per-source before enrichment, same reasoning as
            // before this feature existed: keep test runs cheap.
            listings = listings.slice(0, listingLimit);
        }

        const enriched = await enrichListings({
            client,
            generateContentWithRetry,
            listings,
            enrichLimit: perSourceEnrichLimit,
            sourceName: source.name,
        });

        combined = combined.concat(enriched);
    }

    if (listingLimit) {
        console.log(`Capped to ${combined.length} total listings across ${activeSources.length} source(s) for this run (listingLimit set).`);
    }

    return combined;
}
