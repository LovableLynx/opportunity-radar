// Unit tests for actionSteps: the concrete next steps returned for Partial
// matches, generated in the same LLM call that already produces
// missingOrUnclear (no extra API cost). LLM stubbed throughout.
//
// Run with: node --test test/match-action-steps.test.js

import test from 'node:test';
import assert from 'node:assert/strict';
import { matchListing } from '../src/match.js';

test('a Partial match includes concrete action steps from the LLM', async () => {
    const listing = {
        title: 'Research Preference Scholarship',
        deadline: null,
        eligibility: 'Nationality: Any. Preference given to applicants with demonstrated research experience.',
    };
    const profile = { educationLevel: 'PhD', country: 'Nigeria', fieldOfStudy: 'Computer Science' };

    const fakeGenerateContent = async () => ({
        response: {
            text: () => JSON.stringify({
                hasUnresolvedCriteria: true,
                missingOrUnclear: ['Research experience is preferred but not confirmed'],
                reasoning: 'The listing prefers research experience.',
                actionSteps: ['Add any research-adjacent coursework or supervised project to your application.'],
            }),
        },
    });

    const result = await matchListing(listing, profile, fakeGenerateContent);

    assert.equal(result.eligibilityMatch, 'Partial');
    assert.equal(result.actionSteps.length, 1);
    assert.match(result.actionSteps[0], /research-adjacent coursework/);
});

test('an Eligible match has an empty actionSteps array, not missing entirely', async () => {
    const listing = {
        title: 'Clear Scholarship',
        deadline: null,
        eligibility: 'Nationality: Any. Study experience required: Bachelor degree.',
    };
    const profile = { educationLevel: 'PhD', country: 'Nigeria', fieldOfStudy: 'Computer Science' };

    const fakeGenerateContent = async () => ({
        response: {
            text: () => JSON.stringify({
                hasUnresolvedCriteria: false,
                missingOrUnclear: [],
                reasoning: 'No ambiguous criteria.',
                actionSteps: [],
            }),
        },
    });

    const result = await matchListing(listing, profile, fakeGenerateContent);

    assert.equal(result.eligibilityMatch, 'Eligible');
    assert.deepEqual(result.actionSteps, []);
});

test('a Not Eligible match (hard requirement failure) has no action steps, no LLM call happens', async () => {
    const listing = {
        title: 'Expired Scholarship',
        deadline: '01 Jan 2020',
        eligibility: 'Merit-based',
    };
    const profile = { educationLevel: 'PhD', country: 'Nigeria', fieldOfStudy: 'Computer Science' };

    const neverCallLlm = () => { throw new Error('should not be called'); };
    const result = await matchListing(listing, profile, neverCallLlm);

    assert.equal(result.eligibilityMatch, 'Not Eligible');
    assert.deepEqual(result.actionSteps, []);
});

test('an old stub response with no actionSteps field does not crash, defaults to empty array', async () => {
    const listing = {
        title: 'Some Scholarship',
        deadline: null,
        eligibility: 'Nationality: Any. Preference given to applicants with strong extracurriculars.',
    };
    const profile = { educationLevel: 'PhD', country: 'Nigeria', fieldOfStudy: 'Computer Science' };

    // Simulates a response from before actionSteps existed in the prompt.
    const oldStyleResponse = async () => ({
        response: {
            text: () => JSON.stringify({
                hasUnresolvedCriteria: true,
                missingOrUnclear: ['Extracurriculars unclear'],
                reasoning: 'Some ambiguity found.',
            }),
        },
    });

    const result = await matchListing(listing, profile, oldStyleResponse);

    assert.equal(result.eligibilityMatch, 'Partial');
    assert.deepEqual(result.actionSteps, []);
});

test('malformed LLM JSON falls back gracefully with empty actionSteps, not a crash', async () => {
    const listing = {
        title: 'Some Scholarship',
        deadline: null,
        eligibility: 'Nationality: Any. Some ambiguous preference text.',
    };
    const profile = { educationLevel: 'PhD', country: 'Nigeria', fieldOfStudy: 'Computer Science' };

    const brokenResponse = async () => ({ response: { text: () => 'not valid json' } });
    const result = await matchListing(listing, profile, brokenResponse);

    assert.deepEqual(result.actionSteps, []);
});
