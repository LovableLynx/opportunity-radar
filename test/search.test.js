// Unit tests for the DuckDuckGo search + LLM relevance-filtering logic in
// search.js. fetch and the LLM call are both mocked, so these never touch
// the real endpoint or spend quota.
//
// Run with: node --test test/search.test.js

import test from 'node:test';
import assert from 'node:assert/strict';
import { searchForListingEvidence } from '../src/search.js';

function ddgResult(targetUrl, title, snippet) {
    const encoded = encodeURIComponent(targetUrl);
    return `
      <a rel="nofollow" href="//duckduckgo.com/l/?uddg=${encoded}&amp;rut=abc123" class='result-link'>${title}</a>
      <td class='result-snippet'>${snippet}</td>
    `;
}

function mockFetchReturningHtml(html) {
    return async () => ({ ok: true, text: async () => html });
}

// Returns exactly the given indexes as "relevant" — simulates the LLM call.
function fakeRelevanceFilter(relevantIndexes) {
    return async () => ({
        response: { text: () => JSON.stringify(relevantIndexes) },
    });
}

test('without a relevance filter, all candidate domains count (fallback behavior)', async () => {
    const originalFetch = global.fetch;
    global.fetch = mockFetchReturningHtml(
        ddgResult('https://www.phdportal.com/scholarships/123/foo.html', 'Foo', 'About foo') +
        ddgResult('https://phdportal.com/scholarships/456/bar.html', 'Bar', 'About bar'),
    );

    const result = await searchForListingEvidence(
        { title: 'Foo Scholarship' },
        { sourceHostname: 'phdportal.com' }, // no generateContentWithRetry passed
    );

    global.fetch = originalFetch;

    assert.equal(result.independentResultsFound, false); // both same domain
});

test('relevance filter correctly excludes keyword-matched but unrelated results', async () => {
    const originalFetch = global.fetch;
    global.fetch = mockFetchReturningHtml(
        ddgResult(
            'https://scholarshipshub.org/how-to-spot-scholarship-scams/',
            'How to spot scholarship scams',
            'Fake scholarships are common, watch out for these signs...',
        ),
    );

    // LLM correctly says index 0 (the scam-warning article) is NOT relevant
    const generateContentWithRetry = fakeRelevanceFilter([]);

    const result = await searchForListingEvidence(
        { title: 'Completely Made Up Fake Scholarship XYZ123' },
        { sourceHostname: 'phdportal.com', generateContentWithRetry },
    );

    global.fetch = originalFetch;

    assert.equal(result.independentResultsFound, false);
    assert.equal(result.candidatesFound, 1);
    assert.equal(result.relevantAfterFiltering, 0);
});

test('a genuinely relevant result from a different domain counts as independent presence', async () => {
    const originalFetch = global.fetch;
    global.fetch = mockFetchReturningHtml(
        ddgResult('https://www.phdportal.com/scholarships/123/foo.html', 'Erasmus+ on PhDportal', 'Listing page') +
        ddgResult('https://erasmus-plus.ec.europa.eu/programme-guide', 'Erasmus+ official guide', 'Official EU programme guide for Erasmus+ mobility grants'),
    );

    // LLM says both results (index 0 and 1) are genuinely relevant
    const generateContentWithRetry = fakeRelevanceFilter([0, 1]);

    const result = await searchForListingEvidence(
        { title: 'Erasmus+ Grants for study mobility' },
        { sourceHostname: 'phdportal.com', generateContentWithRetry },
    );

    global.fetch = originalFetch;

    assert.equal(result.independentResultsFound, true);
    assert.equal(result.secondarySourceFound, true);
});

test('LLM filtering failure falls back to unfiltered results rather than losing all evidence', async () => {
    const originalFetch = global.fetch;
    global.fetch = mockFetchReturningHtml(
        ddgResult('https://example.org/real-page', 'Real Page', 'Genuinely about the topic'),
    );

    const brokenGenerateContent = async () => { throw new Error('quota exceeded'); };

    const result = await searchForListingEvidence(
        { title: 'Some Grant' },
        { sourceHostname: 'phdportal.com', generateContentWithRetry: brokenGenerateContent },
    );

    global.fetch = originalFetch;

    // Falls back to counting the unfiltered candidate rather than returning null
    assert.equal(result.independentResultsFound, true);
});

test('zero candidate results short-circuits without calling the LLM', async () => {
    const originalFetch = global.fetch;
    global.fetch = mockFetchReturningHtml('<html><body>No results found.</body></html>');

    let llmCalled = false;
    const generateContentWithRetry = async () => {
        llmCalled = true;
        return { response: { text: () => '[]' } };
    };

    const result = await searchForListingEvidence(
        { title: 'Completely Unknown Grant' },
        { sourceHostname: 'phdportal.com', generateContentWithRetry },
    );

    global.fetch = originalFetch;

    assert.equal(llmCalled, false);
    assert.equal(result.independentResultsFound, false);
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

test('malformed LLM JSON response falls back to unfiltered results', async () => {
    const originalFetch = global.fetch;
    global.fetch = mockFetchReturningHtml(
        ddgResult('https://example.org/real-page', 'Real Page', 'About the thing'),
    );

    const generateContentWithRetry = async () => ({ response: { text: () => 'not valid json' } });

    const result = await searchForListingEvidence(
        { title: 'Some Grant' },
        { sourceHostname: 'phdportal.com', generateContentWithRetry },
    );

    global.fetch = originalFetch;

    assert.equal(result.independentResultsFound, true);
});
