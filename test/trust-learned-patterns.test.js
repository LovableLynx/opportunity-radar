// Confirms scoreListing actually uses learned patterns when provided, and
// behaves exactly as before when they're omitted. No API calls.
//
// Run with: node --test test/trust-learned-patterns.test.js

import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreListing } from '../src/trust.js';
import { patternsFromPhrases } from '../src/learned-patterns.js';

test('scoreListing without learnedPatterns behaves exactly as before (no third argument)', () => {
    const listing = { title: 'Clean Scholarship', description: 'A normal scholarship.', eligibility: 'Nationality: Any.' };
    const result = scoreListing(listing);
    assert.equal(result.trustRisk, 'Low Risk');
});

test('a phrase not in the static list is caught once added as a learned pattern', () => {
    const listing = {
        title: 'New Scam Variant',
        description: 'To claim this award, submit a special handling fee of $75.',
        eligibility: 'Nationality: Any.',
    };

    // The static UPFRONT_PAYMENT_PATTERNS list doesn't include "special
    // handling fee", so without learned patterns this should NOT be caught.
    const withoutLearning = scoreListing(listing);
    assert.equal(withoutLearning.trustRisk, 'Low Risk');
    assert.ok(!withoutLearning.trustEvidence.some((e) => e.includes('upfront payment')));

    // With the phrase learned from a past run, it should now be caught.
    const learned = patternsFromPhrases(['special handling fee']);
    const withLearning = scoreListing(listing, null, learned);
    assert.ok(withLearning.trustEvidence.some((e) => e.toLowerCase().includes('special handling fee')));
    assert.ok(withLearning.trustScore > withoutLearning.trustScore);
});

test('an empty learnedPatterns array behaves the same as omitting the argument entirely', () => {
    const listing = { title: 'Clean Scholarship', description: 'A normal scholarship.', eligibility: 'Nationality: Any.' };
    const withDefault = scoreListing(listing);
    const withEmptyArray = scoreListing(listing, null, []);
    assert.deepEqual(withDefault, withEmptyArray);
});

test('learned patterns do not cause false positives on genuinely clean listings', () => {
    const listing = {
        title: 'Clean Scholarship',
        description: 'A perfectly normal scholarship description with no red flags.',
        eligibility: 'Nationality: Any. Study experience required: Bachelor degree.',
    };
    const learned = patternsFromPhrases(['special handling fee', 'processing surcharge']);
    const result = scoreListing(listing, null, learned);
    assert.equal(result.trustRisk, 'Low Risk');
});
