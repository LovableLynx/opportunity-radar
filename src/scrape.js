// Fetch PhDportal's scholarship search results and extract structured
// listings. PhDportal blocks bare Playwright requests outright (403), even with a
// residential proxy and browser fingerprinting, so instead of fighting that block
// directly we call Apify's own "Website Content Crawler" Actor to fetch pages
// (it has stronger anti-blocking built in) and then use an LLM to read the
// returned text and pull out structured listings, instead of guessing CSS
// selectors against a page we can't reliably render ourselves.
const START_URL = 'https://www.phdportal.com/search/scholarships/phd';
// Kept small: this Gemini key's free tier is 5 requests/minute, and every
// enriched listing costs one enrichment call plus one later matching call.
const ENRICH_LIMIT = 3;

export async function scrapeListings({ client, generateContentWithRetry, actorSetValue, listingLimit }) {
    const contentCrawlerRun = await client.actor('apify/website-content-crawler').call({
        startUrls: [{ url: START_URL }],
        crawlerType: 'playwright:firefox',
        maxCrawlPages: 1,
        // Markdown output keeps [text](url) links, which plain text strips out and
        // we need those links to visit each listing's own detail page.
        saveMarkdown: true,
        proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
    });

    const { items } = await client.dataset(contentCrawlerRun.defaultDatasetId).listItems();

    if (items.length === 0) {
        throw new Error('Website Content Crawler returned no pages — check the sub-run for errors.');
    }

    const pageText = items[0].markdown ?? items[0].text ?? '';

    if (!pageText) {
        throw new Error('Fetched page had no text/markdown content to extract from.');
    }

    if (actorSetValue) {
        await actorSetValue('SEARCH_PAGE_RAW', pageText, { contentType: 'text/plain' });
    }

    const extraction = await generateContentWithRetry(
        `Here is the text/markdown content of a scholarship listing page (PhDportal). Extract every distinct scholarship/opportunity listing you can find as a JSON array. For each one include: title, link (the URL to the listing's own detail page, if one appears in the content, otherwise null), deadline (if stated), description (short summary), and eligibility (any stated requirements, as plain text). If a field isn't present, use null. Return ONLY the JSON array, no other text.\n\nPAGE CONTENT:\n${pageText.slice(0, 15000)}`,
    );

    const rawText = extraction.response.text() ?? '[]';

    let listings;
    try {
        const jsonMatch = rawText.match(/\[[\s\S]*\]/);
        listings = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
    } catch (err) {
        throw new Error(`Could not parse LLM extraction output as JSON: ${err.message}\nRaw output: ${rawText.slice(0, 500)}`);
    }

    console.log(`Extracted ${listings.length} listings from PhDportal via LLM.`);

    // Optionally cap the working set before spending any more LLM calls on it —
    // useful while iterating, to stay under the Gemini free-tier daily quota.
    if (listingLimit) {
        listings = listings.slice(0, listingLimit);
        console.log(`Capped to ${listings.length} listings for this run (listingLimit set).`);
    }

    // The search results page only gives thin summaries ("Merit-based", "various
    // benefits"), which isn't enough for eligibility matching to check against.
    // Visit each listing's own detail page for the real eligibility text. Capped
    // to keep sub-Actor cost and runtime bounded for a hackathon-scale run.
    const toEnrich = listings.filter((l) => l.link).slice(0, ENRICH_LIMIT);

    console.log(`Fetching detail pages for ${toEnrich.length} listings to get richer eligibility text.`);

    const detailPagesText = new Map();
    if (toEnrich.length > 0) {
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
                console.log(`Could not enrich "${listing.title}", keeping summary-page data: ${err.message}`);
            }
        }

        enrichedListings.push({ ...enriched, source: 'phdportal' });
    }

    return enrichedListings;
}
