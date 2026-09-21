// Unit tests for cross-listing fraud-pattern detection. Pure logic, no API
// calls at all.
//
// Run with: node --test test/cross-listing-patterns.test.js

import test from 'node:test';
import assert from 'node:assert/strict';
import { detectCrossListingPatterns } from '../src/cross-listing-patterns.js';

function listing(title, description) {
    return { title, description, eligibility: '' };
}

test('a batch smaller than the minimum size is a no-op', () => {
    const results = [
        listing('A', 'processing fee of $50'),
        listing('B', 'processing fee of $50'),
        listing('C', 'processing fee of $50'),
    ];
    const { patterns, batchTooSmall } = detectCrossListingPatterns(results);
    assert.equal(batchTooSmall, true);
    assert.deepEqual(patterns, []);
});

test('a repeated suspicious phrase across enough listings is flagged', () => {
    const results = [
        listing('Scholarship A', 'Send a processing fee of $50 to apply.'),
        listing('Scholarship B', 'Normal description, nothing unusual.'),
        listing('Scholarship C', 'Send a processing fee of $50 to apply.'),
        listing('Scholarship D', 'Another normal one.'),
        listing('Scholarship E', 'Send a processing fee of $50 to apply.'),
        listing('Scholarship F', 'Also normal.'),
    ];
    const { patterns, batchTooSmall } = detectCrossListingPatterns(results);
    assert.equal(batchTooSmall, false);
    assert.equal(patterns.length, 1);
    assert.equal(patterns[0].listingTitles.length, 3);
    assert.deepEqual(
        patterns[0].listingTitles.sort(),
        ['Scholarship A', 'Scholarship C', 'Scholarship E'],
    );
});

test('a phrase appearing in fewer than the minimum repeat count is not flagged', () => {
    const results = [
        listing('A', 'processing fee of $50 to apply'),
        listing('B', 'processing fee of $50 to apply'),
        listing('C', 'nothing unusual here'),
        listing('D', 'nothing unusual here either'),
        listing('E', 'also completely normal'),
    ];
    const { patterns } = detectCrossListingPatterns(results);
    assert.deepEqual(patterns, []);
});

test('a large batch with no suspicious phrases at all returns no patterns', () => {
    const results = Array.from({ length: 10 }, (_, i) => listing(`Scholarship ${i}`, 'A perfectly normal description.'));
    const { patterns, batchTooSmall } = detectCrossListingPatterns(results);
    assert.equal(batchTooSmall, false);
    assert.deepEqual(patterns, []);
});

test('the same listing appearing twice in results only counts once toward the repeat count', () => {
    const results = [
        listing('Scholarship A', 'processing fee of $50'),
        listing('Scholarship A', 'processing fee of $50'), // duplicate title, e.g. re-scraped
        listing('Scholarship B', 'nothing'),
        listing('Scholarship C', 'nothing'),
        listing('Scholarship D', 'nothing'),
    ];
    const { patterns } = detectCrossListingPatterns(results);
    // only one distinct title ("Scholarship A") actually has the phrase,
    // even though it appears twice in the array, so this should NOT meet
    // the minimum repeat count of 3 distinct listings
    assert.deepEqual(patterns, []);
});

test('empty or missing description/eligibility fields do not crash', () => {
    const results = [
        { title: 'A' },
        { title: 'B', description: null, eligibility: null },
        { title: 'C', description: '', eligibility: '' },
        { title: 'D', description: 'processing fee of $50' },
        { title: 'E', description: 'processing fee of $50' },
    ];
    assert.doesNotThrow(() => detectCrossListingPatterns(results));
});

test('non-array input does not crash, returns empty patterns', () => {
    assert.deepEqual(detectCrossListingPatterns(null), { patterns: [], batchTooSmall: true });
    assert.deepEqual(detectCrossListingPatterns(undefined), { patterns: [], batchTooSmall: true });
});
