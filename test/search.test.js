// Unit tests for the Google Custom Search evidence logic in search.js.
// fetch is mocked, so these never call the real API or spend quota.
//
// Run with: node --test test/search.test.js

import test from 'node:test';
import assert from 'node:assert/strict';
import { searchForListingEvidence } from '../src/search.js';

function mockFetchReturning(items) {
    return async () => ({
        ok: true,
        json: async () => ({ items }),
    });
}

test('no config (missing key/engine ID) returns null instead of throwing', async () => {
    const result = await searchForListingEvidence(
        { title: 'Some Scholarship' },
        { apiKey: null, searchEngineId: null, sourceHostname: 'phdportal.com' },
    );

    assert.equal(result, null);
});

test('results only from the source site count as no independent presence', async () => {
    const originalFetch = global.fetch;
    global.fetch = mockFetchReturning([
        { link: 'https://www.phdportal.com/scholarships/123/foo.html' },
        { link: 'https://phdportal.com/scholarships/456/bar.html' },
    ]);

    const result = await searchForListingEvidence(
        { title: 'Foo Scholarship' },
        { apiKey: 'fake', searchEngineId: 'fake', sourceHostname: 'phdportal.com' },
    );

    global.fetch = originalFetch;

    assert.equal(result.independentResultsFound, false);
});

test('a result from a different domain counts as independent presence', async () => {
    const originalFetch = global.fetch;
    global.fetch = mockFetchReturning([
        { link: 'https://www.phdportal.com/scholarships/123/foo.html' },
        { link: 'https://ec.europa.eu/erasmus-plus/foo' },
    ]);

    const result = await searchForListingEvidence(
        { title: 'Erasmus+ Grant' },
        { apiKey: 'fake', searchEngineId: 'fake', sourceHostname: 'phdportal.com' },
    );

    global.fetch = originalFetch;

    assert.equal(result.independentResultsFound, true);
    assert.equal(result.secondarySourceFound, true);
});

test('zero results means no independent presence and no secondary source', async () => {
    const originalFetch = global.fetch;
    global.fetch = mockFetchReturning([]);

    const result = await searchForListingEvidence(
        { title: 'Completely Unknown Grant' },
        { apiKey: 'fake', searchEngineId: 'fake', sourceHostname: 'phdportal.com' },
    );

    global.fetch = originalFetch;

    assert.equal(result.independentResultsFound, false);
    assert.equal(result.secondarySourceFound, false);
});

test('a non-ok API response returns null instead of crashing the run', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => ({
        ok: false,
        status: 429,
        text: async () => 'quota exceeded',
    });

    const result = await searchForListingEvidence(
        { title: 'Any Scholarship' },
        { apiKey: 'fake', searchEngineId: 'fake', sourceHostname: 'phdportal.com' },
    );

    global.fetch = originalFetch;

    assert.equal(result, null);
});

test('a network error returns null instead of crashing the run', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => { throw new Error('network down'); };

    const result = await searchForListingEvidence(
        { title: 'Any Scholarship' },
        { apiKey: 'fake', searchEngineId: 'fake', sourceHostname: 'phdportal.com' },
    );

    global.fetch = originalFetch;

    assert.equal(result, null);
});

test('malformed result URLs are ignored rather than crashing', async () => {
    const originalFetch = global.fetch;
    global.fetch = mockFetchReturning([
        { link: 'not-a-valid-url' },
        { link: 'https://example.org/real-page' },
    ]);

    const result = await searchForListingEvidence(
        { title: 'Some Grant' },
        { apiKey: 'fake', searchEngineId: 'fake', sourceHostname: 'phdportal.com' },
    );

    global.fetch = originalFetch;

    assert.equal(result.independentResultsFound, true);
});
