// Fetch a scholarship listing site's search results and extract structured
// listings. Sites like PhDportal block bare Playwright requests outright
// (403), even with a residential proxy and browser fingerprinting, so
// instead of fighting that block directly we call Apify's own "Website
// Content Crawler" Actor to fetch pages (it has stronger anti-blocking
// built in) and then use an LLM to read the returned text and pull out
// structured listings, instead of guessing CSS selectors against a page we
// can't reliably render ourselves.

export const SOURCES = {
    phdportal: {
        name: 'phdportal',
        startUrl: 'https://www.phdportal.com/search/scholarships/phd',
        description: 'PhDportal scholarship listing page',
    },
    bachelorsportal: {
        name: 'bachelorsportal',
        startUrl: 'https://www.bachelorsportal.com/search/scholarships/bachelor',
        description: 'Bachelorsportal scholarship listing page',
    },
    mastersportal: {
        name: 'mastersportal',
        startUrl: 'https://www.mastersportal.com/search/scholarships/master',
        description: 'Mastersportal scholarship listing page',
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

async function fetchAndExtractListings({ client, generateContentWithRetry, actorSetValue, source }) {
    const contentCrawlerRun = await client.actor('apify/website-content-crawler').call({
        startUrls: [{ url: source.startUrl }],
        crawlerType: 'playwright:firefox',
        maxCrawlPages: 1,
        // Markdown output keeps [text](url) links, which plain text strips out and
        // we need those links to visit each listing's own detail page.
        saveMarkdown: true,
        proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
    });

    const { items } = await client.dataset(contentCrawlerRun.defaultDatasetId).listItems();

    if (items.length === 0) {
        console.log(`Website Content Crawler returned no pages for ${source.name} — skipping this source for this run.`);
        return [];
    }

    const pageText = items[0].markdown ?? items[0].text ?? '';

    if (!pageText) {
        console.log(`Fetched page for ${source.name} had no text/markdown content — skipping this source for this run.`);
        return [];
    }

    if (actorSetValue) {
        await actorSetValue(`SEARCH_PAGE_RAW_${source.name.toUpperCase()}`, pageText, { contentType: 'text/plain' });
    }

    const extraction = await generateContentWithRetry(
        `Here is the text/markdown content of a scholarship listing page (${source.description}). Extract every distinct scholarship/opportunity listing you can find as a JSON array. For each one include: title, link (the URL to the listing's own detail page, if one appears in the content, otherwise null), deadline (if stated), description (short summary), and eligibility (any stated requirements, as plain text). If a field isn't present, use null. Return ONLY the JSON array, no other text.\n\nPAGE CONTENT:\n${pageText.slice(0, 15000)}`,
    );

    const rawText = extraction.response.text() ?? '[]';

    let listings;
    try {
        const jsonMatch = rawText.match(/\[[\s\S]*\]/);
        listings = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
    } catch (err) {
        console.log(`Could not parse LLM extraction output as JSON for ${source.name}, skipping this source for this run: ${err.message}`);
        return [];
    }

    console.log(`Extracted ${listings.length} listings from ${source.name} via LLM.`);
    return listings;
}

async function enrichListings({ client, generateContentWithRetry, listings, enrichLimit, sourceName }) {
    const toEnrich = listings.filter((l) => l.link).slice(0, enrichLimit);

    if (toEnrich.length === 0) return listings.map((l) => ({ ...l, source: sourceName }));

    console.log(`Fetching detail pages for ${toEnrich.length} ${sourceName} listing(s) to get richer eligibility text.`);

    const detailPagesText = new Map();
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
        const rawListings = await fetchAndExtractListings({ client, generateContentWithRetry, actorSetValue, source });

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
