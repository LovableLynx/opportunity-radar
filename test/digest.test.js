// Unit tests for the plain-English digest. No API calls, pure function.
//
// Run with: node --test test/digest.test.js

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDigest } from '../src/digest.js';

function result(eligibilityMatch, trustRisk = 'Low Risk') {
    return { eligibilityMatch, trustRisk };
}

test('empty results still produce a valid summary', () => {
    const digest = buildDigest([]);
    assert.equal(digest.counts.total, 0);
    assert.match(digest.summary, /Found 0 opportunities/);
});

test('singular wording for exactly one result', () => {
    const digest = buildDigest([result('Eligible')]);
    assert.match(digest.summary, /Found 1 opportunity\./);
});

test('counts split correctly across eligibility categories', () => {
    const results = [
        result('Eligible'), result('Eligible'),
        result('Partial'),
        result('Not Eligible'),
    ];
    const digest = buildDigest(results);
    assert.equal(digest.counts.eligible, 2);
    assert.equal(digest.counts.partial, 1);
    assert.equal(digest.counts.notEligible, 1);
    assert.equal(digest.counts.total, 4);
});

test('trust risk counts are separate from eligibility counts', () => {
    const results = [
        result('Eligible', 'High Risk'),
        result('Eligible', 'Some Concerns'),
        result('Not Eligible', 'Low Risk'),
    ];
    const digest = buildDigest(results);
    assert.equal(digest.counts.highRisk, 1);
    assert.equal(digest.counts.someConcerns, 1);
    assert.match(digest.summary, /1 flagged High Risk/);
    assert.match(digest.summary, /1 flagged Some Concerns/);
});

test('zero-count categories are omitted from the summary text entirely', () => {
    const digest = buildDigest([result('Eligible')]);
    assert.doesNotMatch(digest.summary, /need a closer look/);
    assert.doesNotMatch(digest.summary, /don't qualify/);
    assert.doesNotMatch(digest.summary, /flagged/);
});

test('a run with only rejections still produces a coherent summary', () => {
    const digest = buildDigest([result('Not Eligible'), result('Not Eligible')]);
    assert.equal(digest.counts.eligible, 0);
    assert.match(digest.summary, /2 you don't qualify for right now/);
});
