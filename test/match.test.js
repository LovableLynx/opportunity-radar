// Unit tests for the deterministic hard-requirement checks in match.js.
// These never call Gemini — they exist so we can verify the matching logic
// works correctly without spending API quota, especially useful while a
// free-tier key's daily limit is exhausted.
//
// Run with: node --test test/match.test.js

import test from 'node:test';
import assert from 'node:assert/strict';

// runHardChecks isn't exported (it's an internal detail of matchListing), so
// these tests go through matchListing itself, but stub out the LLM call to
// prove it's never invoked when a hard check already fails.

function unusedGenerateContent() {
    throw new Error('generateContentWithRetry should not be called when hard requirements fail');
}

const { matchListing } = await import('../src/match.js');

test('deadline in the past fails as Not Eligible, no LLM call made', async () => {
    const listing = {
        title: 'Expired Scholarship',
        deadline: '01 Jan 2020',
        eligibility: 'Merit-based',
    };
    const profile = { educationLevel: 'PhD', country: 'Nigeria', fieldOfStudy: 'Computer Science' };

    const result = await matchListing(listing, profile, unusedGenerateContent);

    assert.equal(result.hardRequirementsMet, false);
    assert.equal(result.eligibilityMatch, 'Not Eligible');
    assert.match(result.missingRequirements[0], /Deadline has passed/);
});

test('real Erasmus+ eligibility text: Austrian-only requirement fails for a Nigerian student', async () => {
    // This is the actual eligibility text we scraped for the Erasmus+ listing
    // during enrichment testing.
    const listing = {
        title: 'Erasmus+ - Grants for study mobility',
        deadline: null,
        eligibility: `- Erasmus+ provides grants for full-time studies abroad (funded by EU and national funds of the ministries) or the preparation of bachelor and master thesis or diploma thesis and PhD thesis.
- Placements within the study period abroad (integrated Placement) are possible only in connection with a minimum study period of 2 months (to be done consecutively).
- Mobility after graduation or mobility during leave of absence are not eligible.

Scholarship Requirements:
- Disciplines: Any
- Locations: Worldwide
- Nationality: Austrian
- Study experience required: High school`,
    };
    const profile = { educationLevel: 'PhD', country: 'Nigeria', fieldOfStudy: 'Computer Science' };

    const result = await matchListing(listing, profile, unusedGenerateContent);

    assert.equal(result.hardRequirementsMet, false);
    assert.equal(result.eligibilityMatch, 'Not Eligible');
    assert.ok(result.missingRequirements.some((r) => /Austrian/.test(r)));
});

test('same Erasmus+ text would pass nationality check for an Austrian student', async () => {
    const listing = {
        title: 'Erasmus+ - Grants for study mobility',
        deadline: null,
        eligibility: 'Nationality: Austrian\nStudy experience required: High school',
    };
    const profile = { educationLevel: 'PhD', country: 'Austria', fieldOfStudy: 'Computer Science' };

    // LLM call happens after hard checks pass, so stub a realistic response.
    const fakeGenerateContent = async () => ({
        response: { text: () => JSON.stringify({ hasUnresolvedCriteria: false, missingOrUnclear: [], reasoning: 'No ambiguous criteria found.' }) },
    });

    const result = await matchListing(listing, profile, fakeGenerateContent);

    assert.equal(result.hardRequirementsMet, true);
    assert.equal(result.eligibilityMatch, 'Eligible');
});

test('education level below requirement fails as Not Eligible', async () => {
    const listing = {
        title: 'PhD-only scholarship',
        deadline: null,
        eligibility: 'Study experience required: PhD\nNationality: Any',
    };
    const profile = { educationLevel: 'Bachelors', country: 'Nigeria', fieldOfStudy: 'Computer Science' };

    const result = await matchListing(listing, profile, unusedGenerateContent);

    assert.equal(result.hardRequirementsMet, false);
    assert.equal(result.eligibilityMatch, 'Not Eligible');
    assert.ok(result.missingRequirements.some((r) => /PhD level or above/.test(r)));
});

test('education level above requirement passes the hard check', async () => {
    const listing = {
        title: 'High school scholarship',
        deadline: null,
        eligibility: 'Study experience required: High school\nNationality: Any',
    };
    const profile = { educationLevel: 'PhD', country: 'Nigeria', fieldOfStudy: 'Computer Science' };

    const fakeGenerateContent = async () => ({
        response: { text: () => JSON.stringify({ hasUnresolvedCriteria: false, missingOrUnclear: [], reasoning: 'Fine.' }) },
    });

    const result = await matchListing(listing, profile, fakeGenerateContent);

    assert.equal(result.hardRequirementsMet, true);
});

test('LLM flags unresolved preference criteria as Partial, not Eligible', async () => {
    const listing = {
        title: 'Research scholarship',
        deadline: null,
        eligibility: 'Nationality: Any. Preference given to applicants with demonstrated research experience.',
    };
    const profile = { educationLevel: 'PhD', country: 'Nigeria', fieldOfStudy: 'Computer Science' };

    const fakeGenerateContent = async () => ({
        response: {
            text: () => JSON.stringify({
                hasUnresolvedCriteria: true,
                missingOrUnclear: ['Research experience is preferred but not confirmed in the profile'],
                reasoning: 'The listing prefers research experience, which the profile does not confirm.',
            }),
        },
    });

    const result = await matchListing(listing, profile, fakeGenerateContent);

    assert.equal(result.hardRequirementsMet, true);
    assert.equal(result.eligibilityMatch, 'Partial');
    assert.equal(result.missingRequirements.length, 1);
});

test('no eligibility text at all short-circuits to Eligible without calling the LLM', async () => {
    const listing = { title: 'Vague listing', deadline: null, eligibility: null };
    const profile = { educationLevel: 'PhD', country: 'Nigeria', fieldOfStudy: 'Computer Science' };

    const result = await matchListing(listing, profile, unusedGenerateContent);

    assert.equal(result.eligibilityMatch, 'Eligible');
});

test('malformed LLM JSON response falls back gracefully instead of crashing', async () => {
    const listing = {
        title: 'Some scholarship',
        deadline: null,
        eligibility: 'Nationality: Any. Some ambiguous preference text.',
    };
    const profile = { educationLevel: 'PhD', country: 'Nigeria', fieldOfStudy: 'Computer Science' };

    const brokenGenerateContent = async () => ({
        response: { text: () => 'not valid json at all' },
    });

    const result = await matchListing(listing, profile, brokenGenerateContent);

    assert.equal(result.hardRequirementsMet, true);
    assert.equal(result.eligibilityMatch, 'Eligible'); // fallback default
});

test('LLM call throwing (e.g. rate limit exhausted after retries) degrades gracefully instead of crashing the run', async () => {
    const listing = {
        title: 'Some scholarship',
        deadline: null,
        eligibility: 'Nationality: Any. Some ambiguous preference text.',
    };
    const profile = { educationLevel: 'PhD', country: 'Nigeria', fieldOfStudy: 'Computer Science' };

    const throwingGenerateContent = async () => {
        throw new Error('Groq call failed (429): rate limit exceeded');
    };

    const result = await matchListing(listing, profile, throwingGenerateContent);

    assert.equal(result.hardRequirementsMet, true);
    assert.equal(result.eligibilityMatch, 'Eligible'); // fallback default, run keeps going
    assert.equal(result.llmInterpretation, 'Interpretation unavailable.');
});
