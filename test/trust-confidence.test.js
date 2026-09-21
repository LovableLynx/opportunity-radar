// Unit tests for the trustConfidence field: how much evidence actually
// backed a trust verdict, tracked separately from the risk category itself.
// No API calls.
//
// Run with: node --test test/trust-confidence.test.js

import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreListing } from '../src/trust.js';

test('no search evidence at all, but real listing text present, is Low confidence', () => {
    const listing = {
        title: 'Some Scholarship',
        description: 'A real description of the scholarship.',
        eligibility: 'Nationality: Any.',
    };
    const result = scoreListing(listing, null);
    assert.equal(result.trustConfidence, 'Low');
});

test('no search evidence and no text at all is Very low confidence', () => {
    const listing = { title: 'Bare Listing', description: null, eligibility: null };
    const result = scoreListing(listing, null);
    assert.equal(result.trustConfidence, 'Very low');
});

test('search ran but found zero results is Low confidence', () => {
    const listing = { title: 'Obscure Listing', description: 'text', eligibility: 'text' };
    const searchEvidence = { independentResultsFound: false, secondarySourceFound: false, resultCount: 0 };
    const result = scoreListing(listing, searchEvidence);
    assert.equal(result.trustConfidence, 'Low');
});

test('search found exactly one result is Medium confidence', () => {
    const listing = { title: 'Somewhat Known Listing', description: 'text', eligibility: 'text' };
    const searchEvidence = { independentResultsFound: true, secondarySourceFound: false, resultCount: 1 };
    const result = scoreListing(listing, searchEvidence);
    assert.equal(result.trustConfidence, 'Medium');
});

test('search found multiple results is High confidence', () => {
    const listing = { title: 'Well Known Listing', description: 'text', eligibility: 'text' };
    const searchEvidence = { independentResultsFound: true, secondarySourceFound: true, resultCount: 5 };
    const result = scoreListing(listing, searchEvidence);
    assert.equal(result.trustConfidence, 'High');
});

test('two Low Risk listings can have different confidence, the whole point of this field', () => {
    const wellEvidenced = scoreListing(
        { title: 'A', description: 'text', eligibility: 'text' },
        { independentResultsFound: true, secondarySourceFound: true, resultCount: 5 },
    );
    const noEvidenceAtAll = scoreListing(
        { title: 'B', description: null, eligibility: null },
        null,
    );

    assert.equal(wellEvidenced.trustRisk, 'Low Risk');
    assert.equal(noEvidenceAtAll.trustRisk, 'Low Risk');
    assert.equal(wellEvidenced.trustConfidence, 'High');
    assert.equal(noEvidenceAtAll.trustConfidence, 'Very low');
    assert.notEqual(wellEvidenced.trustConfidence, noEvidenceAtAll.trustConfidence);
});
