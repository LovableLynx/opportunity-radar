// Unit tests for the DuckDuckGo search evidence logic in search.js.
// fetch is mocked throughout, so these never call the real endpoint.
//
// Run with: node --test test/search.test.js

import test from 'node:test';
import assert from 'node:assert/strict';
import { searchForListingEvidence } from '../src/search.js';

function ddgResultLink(targetUrl) {
    const encoded = encodeURIComponent(targetUrl);
    return `<a rel="nofollow" href="//duckduckgo.com/l/?uddg=${encoded}&amp;rut=abc123" class='result-link'>`;
}

function mockFetchReturningHtml(html) {
    return async () => ({ ok: true, text: async () => html });
}

test('results only from the source site count as no independent presence', async () => {
    const originalFetch = global.fetch;
    global.fetch = mockFetchReturningHtml(
        ddgResultLink('https://www.phdportal.com/scholarships/123/foo.html') +
        ddgResultLink('https://phdportal.com/scholarships/456/bar.html'),
    );

    const result = await searchForListingEvidence(
        { title: 'Foo Scholarship' },
        { sourceHostname: 'phdportal.com' },
    );

    global.fetch = originalFetch;

    assert.equal(result.independentResultsFound, false);
});

test('a result from a different domain counts as independent presence', async () => {
    const originalFetch = global.fetch;
    global.fetch = mockFetchReturningHtml(
        ddgResultLink('https://www.phdportal.com/scholarships/123/foo.html') +
        ddgResultLink('https://erasmus-plus.ec.europa.eu/programme-guide'),
    );

    const result = await searchForListingEvidence(
        { title: 'Erasmus+ Grant' },
        { sourceHostname: 'phdportal.com' },
    );

    global.fetch = originalFetch;

    assert.equal(result.independentResultsFound, true);
    assert.equal(result.secondarySourceFound, true);
});

test('zero results means no independent presence and no secondary source', async () => {
    const originalFetch = global.fetch;
    global.fetch = mockFetchReturningHtml('<html><body>No results found.</body></html>');

    const result = await searchForListingEvidence(
        { title: 'Completely Unknown Grant' },
        { sourceHostname: 'phdportal.com' },
    );

    global.fetch = originalFetch;

    assert.equal(result.independentResultsFound, false);
    assert.equal(result.secondarySourceFound, false);
});

test('a non-ok response returns null instead of crashing the run', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => ({ ok: false, status: 429 });

    const result = await searchForListingEvidence(
        { title: 'Any Scholarship' },
        { sourceHostname: 'phdportal.com' },
    );

    global.fetch = originalFetch;

    assert.equal(result, null);
});

test('a network error returns null instead of crashing the run', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => { throw new Error('network down'); };

    const result = await searchForListingEvidence(
        { title: 'Any Scholarship' },
        { sourceHostname: 'phdportal.com' },
    );

    global.fetch = originalFetch;

    assert.equal(result, null);
});

test('malformed or relative hrefs are ignored rather than crashing', async () => {
    const originalFetch = global.fetch;
    global.fetch = mockFetchReturningHtml(
        `<a href="/relative/path" class='result-link'>` +
        ddgResultLink('https://example.org/real-page'),
    );

    const result = await searchForListingEvidence(
        { title: 'Some Grant' },
        { sourceHostname: 'phdportal.com' },
    );

    global.fetch = originalFetch;

    assert.equal(result.independentResultsFound, true);
});

test('multiple results from the same external domain still count as one domain, not two', async () => {
    const originalFetch = global.fetch;
    global.fetch = mockFetchReturningHtml(
        ddgResultLink('https://example.org/page-one') +
        ddgResultLink('https://example.org/page-two'),
    );

    const result = await searchForListingEvidence(
        { title: 'Some Grant' },
        { sourceHostname: 'phdportal.com' },
    );

    global.fetch = originalFetch;

    assert.equal(result.resultCount, 1);
    assert.equal(result.secondarySourceFound, false); // only one distinct domain, even with two pages
});
