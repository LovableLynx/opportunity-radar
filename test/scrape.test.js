// Unit tests for scrapeListings, with a fake Apify client and a fake LLM,
// no real Website Content Crawler runs or API calls.
//
// Run with: node --test test/scrape.test.js

import test from 'node:test';
import assert from 'node:assert/strict';
import { scrapeListings, sourceKeysForEducationLevel } from '../src/scrape.js';

test('sourceKeysForEducationLevel picks bachelorsportal for Bachelors', () => {
    assert.deepEqual(sourceKeysForEducationLevel('Bachelors'), ['bachelorsportal']);
});

test('sourceKeysForEducationLevel picks bachelorsportal for High school too, closest fit', () => {
    assert.deepEqual(sourceKeysForEducationLevel('High school'), ['bachelorsportal']);
});

test('sourceKeysForEducationLevel picks mastersportal for Masters', () => {
    assert.deepEqual(sourceKeysForEducationLevel('Masters'), ['mastersportal']);
});

test('sourceKeysForEducationLevel picks phdportal for PhD', () => {
    assert.deepEqual(sourceKeysForEducationLevel('PhD'), ['phdportal']);
});

test('sourceKeysForEducationLevel is case-insensitive', () => {
    assert.deepEqual(sourceKeysForEducationLevel('masters'), ['mastersportal']);
    assert.deepEqual(sourceKeysForEducationLevel('MASTERS'), ['mastersportal']);
});

test('sourceKeysForEducationLevel falls back to phdportal for unknown/empty level, unchanged default behavior', () => {
    assert.deepEqual(sourceKeysForEducationLevel(''), ['phdportal']);
    assert.deepEqual(sourceKeysForEducationLevel(undefined), ['phdportal']);
    assert.deepEqual(sourceKeysForEducationLevel('Something Else'), ['phdportal']);
});

function fakeClientReturning(pageTextBySource) {
    let callCount = 0;
    return {
        actor: () => ({
            call: async (options) => {
                callCount++;
                return { defaultDatasetId: `dataset-${callCount}`, _startUrls: options.startUrls };
            },
        }),
        dataset: (datasetId) => ({
            listItems: async () => {
                // First call per source is the search page, subsequent calls
                // (if any) are detail-page enrichment fetches.
                const text = pageTextBySource.shift() ?? '';
                return { items: text ? [{ markdown: text }] : [] };
            },
        }),
    };
}

function fakeExtractionResponse(json) {
    return async () => ({ response: { text: () => JSON.stringify(json) } });
}

test('defaults to phdportal only when sourceKeys is not passed, same as before this feature existed', async () => {
    const client = fakeClientReturning([
        '[{"title":"Test Scholarship","link":null,"deadline":null,"description":"d","eligibility":"e"}]',
    ]);
    const generateContentWithRetry = fakeExtractionResponse([
        { title: 'Test Scholarship', link: null, deadline: null, description: 'd', eligibility: 'e' },
    ]);

    const results = await scrapeListings({ client, generateContentWithRetry, actorSetValue: null });

    assert.equal(results.length, 1);
    assert.equal(results[0].source, 'phdportal');
});

test('two sources produce combined results, each tagged with its own source name', async () => {
    const client = fakeClientReturning([
        JSON.stringify([{ title: 'From PhDportal', link: null, deadline: null, description: 'd', eligibility: 'e' }]),
        JSON.stringify([{ title: 'From OpportunityDesk', link: null, deadline: null, description: 'd', eligibility: 'e' }]),
    ]);

    let callIndex = 0;
    const responses = [
        [{ title: 'From PhDportal', link: null, deadline: null, description: 'd', eligibility: 'e' }],
        [{ title: 'From OpportunityDesk', link: null, deadline: null, description: 'd', eligibility: 'e' }],
    ];
    const generateContentWithRetry = async () => {
        const json = responses[callIndex];
        callIndex++;
        return { response: { text: () => JSON.stringify(json) } };
    };

    const results = await scrapeListings({
        client,
        generateContentWithRetry,
        actorSetValue: null,
        sourceKeys: ['phdportal', 'opportunitydesk'],
    });

    assert.equal(results.length, 2);
    assert.deepEqual(results.map((r) => r.source).sort(), ['opportunitydesk', 'phdportal']);
});

test('an unknown source key is silently skipped rather than crashing, as long as at least one valid key remains', async () => {
    const client = fakeClientReturning([
        JSON.stringify([{ title: 'Real One', link: null, deadline: null, description: 'd', eligibility: 'e' }]),
    ]);
    const generateContentWithRetry = fakeExtractionResponse([
        { title: 'Real One', link: null, deadline: null, description: 'd', eligibility: 'e' },
    ]);

    const results = await scrapeListings({
        client,
        generateContentWithRetry,
        actorSetValue: null,
        sourceKeys: ['phdportal', 'not-a-real-source'],
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].source, 'phdportal');
});

test('all source keys being invalid throws a clear error rather than silently returning nothing', async () => {
    const client = fakeClientReturning([]);
    await assert.rejects(
        scrapeListings({ client, generateContentWithRetry: async () => {}, actorSetValue: null, sourceKeys: ['nonsense'] }),
        /No valid sources/,
    );
});

test('a source returning no pages is skipped, not thrown, so other sources still work', async () => {
    const client = fakeClientReturning([
        '', // phdportal returns nothing, so its extraction call is skipped entirely
        JSON.stringify([{ title: 'Still Works', link: null, deadline: null, description: 'd', eligibility: 'e' }]),
    ]);
    // Only one generateContentWithRetry call happens total: phdportal never
    // reaches the LLM step since it has no page text, opportunitydesk does.
    const generateContentWithRetry = fakeExtractionResponse([
        { title: 'Still Works', link: null, deadline: null, description: 'd', eligibility: 'e' },
    ]);

    const results = await scrapeListings({
        client,
        generateContentWithRetry,
        actorSetValue: null,
        sourceKeys: ['phdportal', 'opportunitydesk'],
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].title, 'Still Works');
});

test('malformed LLM extraction JSON for one source does not crash the whole run', async () => {
    const client = fakeClientReturning([
        'some page content',
        JSON.stringify([{ title: 'Good One', link: null, deadline: null, description: 'd', eligibility: 'e' }]),
    ]);
    let callIndex = 0;
    const generateContentWithRetry = async () => {
        callIndex++;
        if (callIndex === 1) return { response: { text: () => 'not valid json' } };
        return { response: { text: () => JSON.stringify([{ title: 'Good One', link: null, deadline: null, description: 'd', eligibility: 'e' }]) } };
    };

    const results = await scrapeListings({
        client,
        generateContentWithRetry,
        actorSetValue: null,
        sourceKeys: ['phdportal', 'opportunitydesk'],
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].title, 'Good One');
});

test('listingLimit caps results per source, not across the whole combined batch', async () => {
    const client = fakeClientReturning([
        JSON.stringify([
            { title: 'A1', link: null, deadline: null, description: 'd', eligibility: 'e' },
            { title: 'A2', link: null, deadline: null, description: 'd', eligibility: 'e' },
        ]),
        JSON.stringify([
            { title: 'B1', link: null, deadline: null, description: 'd', eligibility: 'e' },
            { title: 'B2', link: null, deadline: null, description: 'd', eligibility: 'e' },
        ]),
    ]);
    let callIndex = 0;
    const responses = [
        [{ title: 'A1', link: null, deadline: null, description: 'd', eligibility: 'e' }, { title: 'A2', link: null, deadline: null, description: 'd', eligibility: 'e' }],
        [{ title: 'B1', link: null, deadline: null, description: 'd', eligibility: 'e' }, { title: 'B2', link: null, deadline: null, description: 'd', eligibility: 'e' }],
    ];
    const generateContentWithRetry = async () => {
        const json = responses[callIndex];
        callIndex++;
        return { response: { text: () => JSON.stringify(json) } };
    };

    const results = await scrapeListings({
        client,
        generateContentWithRetry,
        actorSetValue: null,
        sourceKeys: ['phdportal', 'opportunitydesk'],
        listingLimit: 1,
    });

    // 1 per source x 2 sources = 2 total, not 1 total
    assert.equal(results.length, 2);
});
