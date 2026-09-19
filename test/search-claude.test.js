// Unit tests for the Claude web-search evidence logic in search-claude.js.
// The Anthropic client is mocked throughout, so these never call the real
// API or spend money.
//
// Run with: node --test test/search-claude.test.js

import test from 'node:test';
import assert from 'node:assert/strict';
import { searchForListingEvidence } from '../src/search-claude.js';

function fakeClient(webSearchResults) {
    return {
        messages: {
            create: async () => ({
                content: [
                    { type: 'text', text: 'Some answer text.' },
                    { type: 'web_search_tool_result', content: webSearchResults },
                ],
            }),
        },
    };
}

test('no API key and no client provided returns null instead of throwing', async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const result = await searchForListingEvidence(
        { title: 'Some Scholarship' },
        { sourceHostname: 'phdportal.com' },
    );

    if (originalKey) process.env.ANTHROPIC_API_KEY = originalKey;

    assert.equal(result, null);
});

test('results only from the source site count as no independent presence', async () => {
    const client = fakeClient([
        { url: 'https://www.phdportal.com/scholarships/123/foo.html' },
        { url: 'https://phdportal.com/scholarships/456/bar.html' },
    ]);

    const result = await searchForListingEvidence(
        { title: 'Foo Scholarship' },
        { sourceHostname: 'phdportal.com', client },
    );

    assert.equal(result.independentResultsFound, false);
});

test('a result from a different domain counts as independent presence', async () => {
    const client = fakeClient([
        { url: 'https://www.phdportal.com/scholarships/123/foo.html' },
        { url: 'https://ec.europa.eu/erasmus-plus/foo' },
    ]);

    const result = await searchForListingEvidence(
        { title: 'Erasmus+ Grant' },
        { sourceHostname: 'phdportal.com', client },
    );

    assert.equal(result.independentResultsFound, true);
    assert.equal(result.secondarySourceFound, true);
});

test('no web_search_tool_result blocks at all means zero domains found', async () => {
    const client = {
        messages: {
            create: async () => ({ content: [{ type: 'text', text: 'No search performed.' }] }),
        },
    };

    const result = await searchForListingEvidence(
        { title: 'Some Grant' },
        { sourceHostname: 'phdportal.com', client },
    );

    assert.equal(result.independentResultsFound, false);
    assert.equal(result.secondarySourceFound, false);
});

test('a failed API call returns null instead of crashing the run', async () => {
    const client = {
        messages: {
            create: async () => { throw new Error('rate limited'); },
        },
    };

    const result = await searchForListingEvidence(
        { title: 'Any Scholarship' },
        { sourceHostname: 'phdportal.com', client },
    );

    assert.equal(result, null);
});

test('malformed result URLs are ignored rather than crashing', async () => {
    const client = fakeClient([
        { url: 'not-a-valid-url' },
        { url: 'https://example.org/real-page' },
    ]);

    const result = await searchForListingEvidence(
        { title: 'Some Grant' },
        { sourceHostname: 'phdportal.com', client },
    );

    assert.equal(result.independentResultsFound, true);
});

test('multiple results from the same domain count as one, not two', async () => {
    const client = fakeClient([
        { url: 'https://example.org/page-one' },
        { url: 'https://example.org/page-two' },
    ]);

    const result = await searchForListingEvidence(
        { title: 'Some Grant' },
        { sourceHostname: 'phdportal.com', client },
    );

    assert.equal(result.resultCount, 1);
    assert.equal(result.secondarySourceFound, false);
});
