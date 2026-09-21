// Unit tests for the alumni/success-rate search signal. LLM call mocked
// throughout, no real search results fetched, no API calls at all.
//
// Run with: node --test test/alumni-signal.test.js

import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAlumniMentions } from '../src/alumni-signal.js';

function fakeGenerateContent(response) {
    return async () => ({ response: { text: () => JSON.stringify(response) } });
}

test('no candidates at all returns null (unknown), not a false negative', async () => {
    const result = await checkAlumniMentions({ title: 'Some Scholarship' }, [], fakeGenerateContent({}));
    assert.equal(result, null);
});

test('no generateContentWithRetry provided returns null', async () => {
    const candidates = [{ title: 'Page', snippet: 'text' }];
    const result = await checkAlumniMentions({ title: 'Some Scholarship' }, candidates, null);
    assert.equal(result, null);
});

test('a genuine recipient testimonial is detected', async () => {
    const candidates = [
        { title: 'I won the Fulbright, here is my story', snippet: 'My experience receiving the Fulbright scholarship in 2023...' },
        { title: 'Fulbright Program Overview', snippet: 'General info about the Fulbright program.' },
    ];
    const generateContentWithRetry = fakeGenerateContent({
        alumniMentionsFound: true,
        evidence: ['A personal testimonial from a 2023 recipient'],
    });

    const result = await checkAlumniMentions({ title: 'Fulbright U.S. Student Program' }, candidates, generateContentWithRetry);

    assert.equal(result.alumniMentionsFound, true);
    assert.equal(result.evidence.length, 1);
});

test('only generic program pages, no recipient mentions, comes back false', async () => {
    const candidates = [
        { title: 'How to apply for the scholarship', snippet: 'Application steps and deadlines.' },
    ];
    const generateContentWithRetry = fakeGenerateContent({ alumniMentionsFound: false, evidence: [] });

    const result = await checkAlumniMentions({ title: 'Some Scholarship' }, candidates, generateContentWithRetry);

    assert.equal(result.alumniMentionsFound, false);
    assert.deepEqual(result.evidence, []);
});

test('a failed LLM call returns null rather than crashing or penalizing', async () => {
    const candidates = [{ title: 'Page', snippet: 'text' }];
    const brokenGenerateContent = async () => { throw new Error('quota exceeded'); };

    const result = await checkAlumniMentions({ title: 'Some Scholarship' }, candidates, brokenGenerateContent);

    assert.equal(result, null);
});

test('malformed LLM response returns null rather than a false positive or crash', async () => {
    const candidates = [{ title: 'Page', snippet: 'text' }];
    const brokenGenerateContent = async () => ({ response: { text: () => 'not valid json' } });

    const result = await checkAlumniMentions({ title: 'Some Scholarship' }, candidates, brokenGenerateContent);

    assert.equal(result, null);
});

test('a non-array evidence field in the response does not crash, defaults to empty array', async () => {
    const candidates = [{ title: 'Page', snippet: 'text' }];
    const generateContentWithRetry = fakeGenerateContent({ alumniMentionsFound: true, evidence: 'not an array' });

    const result = await checkAlumniMentions({ title: 'Some Scholarship' }, candidates, generateContentWithRetry);

    assert.equal(result.alumniMentionsFound, true);
    assert.deepEqual(result.evidence, []);
});
