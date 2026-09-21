// Unit tests for compare-two-listings mode. Pure function, no API calls.
//
// Run with: node --test test/compare-listings.test.js

import test from 'node:test';
import assert from 'node:assert/strict';
import { compareListings } from '../src/compare-listings.js';

function scoredListing(overrides) {
    return {
        title: 'Some Scholarship',
        eligibilityMatch: 'Eligible',
        urgency: 'Upcoming',
        trustRisk: 'Low Risk',
        ...overrides,
    };
}

test('null or missing inputs return null instead of throwing', () => {
    assert.equal(compareListings(null, scoredListing({})), null);
    assert.equal(compareListings(scoredListing({}), undefined), null);
    assert.equal(compareListings({}, {}), null); // no title field
});

test('an Eligible listing beats a Partial one on eligibility', () => {
    const a = scoredListing({ title: 'A', eligibilityMatch: 'Eligible' });
    const b = scoredListing({ title: 'B', eligibilityMatch: 'Partial' });
    const result = compareListings(a, b);
    assert.equal(result.comparison.eligibility, 'a');
});

test('a Not Eligible listing loses to anything better on eligibility', () => {
    const a = scoredListing({ title: 'A', eligibilityMatch: 'Not Eligible' });
    const b = scoredListing({ title: 'B', eligibilityMatch: 'Partial' });
    const result = compareListings(a, b);
    assert.equal(result.comparison.eligibility, 'b');
});

test('same eligibility on both sides is a tie', () => {
    const a = scoredListing({ title: 'A', eligibilityMatch: 'Eligible' });
    const b = scoredListing({ title: 'B', eligibilityMatch: 'Eligible' });
    const result = compareListings(a, b);
    assert.equal(result.comparison.eligibility, 'tie');
});

test('Low Risk beats High Risk on trust', () => {
    const a = scoredListing({ title: 'A', trustRisk: 'Low Risk' });
    const b = scoredListing({ title: 'B', trustRisk: 'High Risk' });
    const result = compareListings(a, b);
    assert.equal(result.comparison.trust, 'a');
});

test('Closing soon is ranked more urgent than Plenty of time', () => {
    const a = scoredListing({ title: 'A', urgency: 'Closing soon' });
    const b = scoredListing({ title: 'B', urgency: 'Plenty of time' });
    const result = compareListings(a, b);
    assert.equal(result.comparison.urgency, 'a');
});

test('a listing winning on both eligibility and trust gets a clear verdict', () => {
    const a = scoredListing({ title: 'Strong One', eligibilityMatch: 'Eligible', trustRisk: 'Low Risk' });
    const b = scoredListing({ title: 'Weak One', eligibilityMatch: 'Not Eligible', trustRisk: 'High Risk' });
    const result = compareListings(a, b);
    assert.match(result.verdict, /first opportunity looks stronger on both/i);
});

test('a split result (better eligibility, worse trust) gets a hedged verdict, not a false clear winner', () => {
    const a = scoredListing({ title: 'A', eligibilityMatch: 'Eligible', trustRisk: 'High Risk' });
    const b = scoredListing({ title: 'B', eligibilityMatch: 'Partial', trustRisk: 'Low Risk' });
    const result = compareListings(a, b);
    assert.match(result.verdict, /check the trust comparison too/i);
});

test('two listings tied on everything get an honest "comparable" verdict', () => {
    const a = scoredListing({ title: 'A' });
    const b = scoredListing({ title: 'B' });
    const result = compareListings(a, b);
    assert.equal(result.comparison.eligibility, 'tie');
    assert.equal(result.comparison.trust, 'tie');
    assert.match(result.verdict, /comparable/i);
});

test('unrecognized eligibilityMatch/trustRisk/urgency values do not crash', () => {
    const a = scoredListing({ title: 'A', eligibilityMatch: 'Some Weird Value', trustRisk: 'Unusual', urgency: 'Whenever' });
    const b = scoredListing({ title: 'B' });
    assert.doesNotThrow(() => compareListings(a, b));
});

test('result includes both listing titles for display purposes', () => {
    const a = scoredListing({ title: 'First Scholarship' });
    const b = scoredListing({ title: 'Second Scholarship' });
    const result = compareListings(a, b);
    assert.equal(result.listingATitle, 'First Scholarship');
    assert.equal(result.listingBTitle, 'Second Scholarship');
});
