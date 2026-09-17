import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const { fieldOfStudy = '', country = '' } = input;

// Phase 1: scrape PhDportal's scholarship search results, raw, no matching or trust logic yet.
const startUrl = 'https://www.phdportal.com/search/scholarships/phd';

const crawler = new PlaywrightCrawler({
    maxRequestsPerCrawl: 1,
    async requestHandler({ page, log }) {
        log.info(`Scraping ${startUrl}`);

        await page.waitForSelector('.StudyListItem, .Study', { timeout: 15000 }).catch(() => {
            log.warning('Expected listing selector not found — page structure may differ, inspect manually.');
        });

        const listings = await page.$$eval('.StudyListItem, .Study', (nodes) =>
            nodes.map((node) => ({
                title: node.querySelector('h3, .StudyName')?.textContent?.trim() ?? null,
                link: node.querySelector('a')?.href ?? null,
                deadline: node.querySelector('.Deadline, .deadline')?.textContent?.trim() ?? null,
                description: node.textContent?.trim().slice(0, 500) ?? null,
            })),
        );

        log.info(`Found ${listings.length} raw listings`);

        for (const listing of listings) {
            await Actor.pushData({
                ...listing,
                source: 'phdportal',
                scrapedFor: { fieldOfStudy, country },
            });
        }
    },
});

await crawler.run([startUrl]);

await Actor.exit();
