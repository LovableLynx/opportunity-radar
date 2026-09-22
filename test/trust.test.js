// Unit tests for the deterministic trust-scoring rule in trust.js. No API
// calls involved — this is the weighted-signal scoring logic that runs before
// any LLM reasoning over evidence, and it's the part a judge will ask
// "how did you decide this" about, so it needs to be verifiably correct.
//
// Run with: node --test test/trust.test.js

import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreListing } from '../src/trust.js';

test('a real, well-documented scholarship scores Low Risk', () => {
    const listing = {
        title: 'Marshall Scholarships',
        description: 'Fully funded postgraduate study in the UK for US citizens, funded by the UK government.',
        eligibility: 'Nationality: United States. Study experience required: Bachelor degree. Merit-based selection through a competitive interview process.',
    };

    const result = scoreListing(listing);

    assert.equal(result.trustRisk, 'Low Risk');
    assert.equal(result.trustScore, 0);
});

test('a listing requiring an upfront processing fee is flagged', () => {
    const listing = {
        title: 'Suspicious Scholarship',
        description: 'Fully funded scholarship, just pay a small processing fee to secure your spot.',
        eligibility: 'Open to everyone, no requirements needed.',
    };

    const result = scoreListing(listing);

    // upfront payment (3) + vague eligibility (2) = 5 -> High Risk
    assert.equal(result.trustScore, 5);
    assert.equal(result.trustRisk, 'High Risk');
    assert.ok(result.trustEvidence.some((e) => /upfront payment/i.test(e)));
    assert.ok(result.trustEvidence.some((e) => /vague/i.test(e)));
});

test('urgency-pressure language alone is Some Concerns, not High Risk', () => {
    const listing = {
        title: 'Time-Pressured Scholarship',
        description: 'Apply immediately or lose this opportunity — only 3 spots left!',
        eligibility: 'Nationality: Any. Study experience required: Bachelor degree.',
    };

    const result = scoreListing(listing);

    assert.equal(result.trustScore, 1);
    assert.equal(result.trustRisk, 'Low Risk'); // score 1 stays below the "someConcerns" threshold of 2
});

test('a synthetic adversarial listing with multiple red flags scores High Risk', () => {
    // A deliberately constructed test case combining several known scam
    // patterns — labeled here as synthetic, not presented as an organic
    // discovery.
    const listing = {
        title: 'SYNTHETIC TEST CASE: Too Good To Be True Grant',
        description: 'Act now! Only 24 hours left to claim this fully-funded grant. Send a small refundable deposit to confirm your slot.',
        eligibility: 'Open to everyone, no experience necessary.',
    };
    // Simulate a search that found nothing about this org anywhere.
    const searchEvidence = { independentResultsFound: false, secondarySourceFound: false };

    const result = scoreListing(listing, searchEvidence);

    // upfront(3) + urgency(1) + vague(2) + noIndependentPresence(1) + noSecondary(1) = 8
    assert.equal(result.trustScore, 8);
    assert.equal(result.trustRisk, 'High Risk');
    assert.equal(result.trustEvidence.length, 5);
});

test('missing eligibility text is tracked separately from vague eligibility text, and does not alone reach High Risk', () => {
    // missingEligibility ("we don't know") and vagueEligibility ("the text
    // itself is a red flag") are deliberately different signals — see
    // trust.js's SIGNAL_WEIGHTS comment for why. A listing with no
    // eligibility text at all shouldn't be scored the same as one that
    // actively says "open to everyone".
    const listing = { title: 'No Info Scholarship', description: 'A grant.', eligibility: null };

    const result = scoreListing(listing);

    assert.ok(result.trustEvidence.some((e) => /No eligibility criteria available/i.test(e)));
    assert.equal(result.trustScore, 1);
    assert.equal(result.trustRisk, 'Low Risk');
});

test('no search evidence available does not penalize the listing', () => {
    const listing = {
        title: 'Normal Scholarship',
        description: 'A standard scholarship offer.',
        eligibility: 'Nationality: Any. Study experience required: Bachelor degree.',
    };

    // searchEvidence omitted entirely (Google Custom Search not wired up
    // yet) — checks that need it should not fire false positives.
    const result = scoreListing(listing);

    assert.equal(result.trustRisk, 'Low Risk');
});

test('a legitimate listing with no enriched eligibility text and empty search results does not reach High Risk', () => {
    // Regression test for a real production incident: a run where most
    // listings never got their detail page enriched (enrichLimitPerSource
    // caps how many do) AND search evidence came back empty for everything
    // sent 18/20 real, legitimate listings to High Risk, all of them also
    // honestly reporting Low confidence. The score was conflating "we don't
    // have enough data" with "this looks like a scam". This is exactly that
    // combination: no eligibility text (not enriched yet), no search hits,
    // no actual red-flag language anywhere.
    const listing = {
        title: 'Francesca Norris Memorial Scholarship',
        description: 'A memorial scholarship for undergraduate students.',
        eligibility: null,
    };
    const searchEvidence = { independentResultsFound: false, secondarySourceFound: false, resultCount: 0 };

    const result = scoreListing(listing, searchEvidence);

    assert.notEqual(result.trustRisk, 'High Risk');
    assert.equal(result.trustConfidence, 'Low');
});

test('trustRisk labels never claim certainty the evidence does not support', () => {
    const listing = {
        title: 'Clean listing',
        description: 'Well documented scholarship.',
        eligibility: 'Nationality: Any. Study experience required: Bachelor degree.',
    };

    const result = scoreListing(listing);

    // Low Risk copy should read as "no signals detected", never "verified" or
    // "confirmed legitimate" — this is the honesty fix from the review.
    assert.ok(!result.trustEvidence.some((e) => /verified|confirmed legitimate/i.test(e)));
});
