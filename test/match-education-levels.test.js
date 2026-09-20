// Confirms the education-level check handles the full Bachelors/Masters/PhD
// hierarchy correctly, in both directions (higher qualifies for lower
// requirements, lower correctly gets rejected for higher requirements).
// This is the gate before building anything on top of the matching logic —
// if this breaks, nothing else matters. No API calls needed.
//
// Run with: node --test test/match-education-levels.test.js

import test from 'node:test';
import assert from 'node:assert/strict';
import { matchListing } from '../src/match.js';

function neverCallLlm() {
    throw new Error('generateContentWithRetry should not be called when hard requirements fail');
}

function listingRequiring(level) {
    return {
        title: `Synthetic: ${level}-level scholarship`,
        deadline: null,
        eligibility: `Study experience required: ${level}\nNationality: Any`,
    };
}

const LEVELS_IN_ORDER = ['High school', 'Bachelors', 'Masters', 'PhD'];

test('a PhD profile qualifies for every requirement level', async () => {
    for (const requiredLevel of LEVELS_IN_ORDER) {
        const profile = { educationLevel: 'PhD', country: 'Nigeria', fieldOfStudy: 'Computer Science' };
        const result = await matchListing(listingRequiring(requiredLevel), profile, () => ({
            response: { text: () => JSON.stringify({ hasUnresolvedCriteria: false, missingOrUnclear: [], reasoning: 'Fine.' }) },
        }));
        assert.equal(result.hardRequirementsMet, true, `PhD should qualify for ${requiredLevel}-level requirement`);
    }
});

test('a Masters profile qualifies for Bachelors and High school, rejected for PhD', async () => {
    const fakeGenerateContent = () => ({
        response: { text: () => JSON.stringify({ hasUnresolvedCriteria: false, missingOrUnclear: [], reasoning: 'Fine.' }) },
    });
    const profile = { educationLevel: 'Masters', country: 'Nigeria', fieldOfStudy: 'Computer Science' };

    const belowResult = await matchListing(listingRequiring('Bachelors'), profile, fakeGenerateContent);
    assert.equal(belowResult.hardRequirementsMet, true);

    const aboveResult = await matchListing(listingRequiring('PhD'), profile, neverCallLlm);
    assert.equal(aboveResult.hardRequirementsMet, false);
    assert.equal(aboveResult.eligibilityMatch, 'Not Eligible');
    assert.match(aboveResult.missingRequirements[0], /PhD level or above/);
});

test('a Bachelors profile qualifies for High school, rejected for Masters and PhD', async () => {
    const profile = { educationLevel: 'Bachelors', country: 'Nigeria', fieldOfStudy: 'Computer Science' };

    const belowResult = await matchListing(listingRequiring('High school'), profile, () => ({
        response: { text: () => JSON.stringify({ hasUnresolvedCriteria: false, missingOrUnclear: [], reasoning: 'Fine.' }) },
    }));
    assert.equal(belowResult.hardRequirementsMet, true);

    const mastersResult = await matchListing(listingRequiring('Masters'), profile, neverCallLlm);
    assert.equal(mastersResult.hardRequirementsMet, false);
    assert.match(mastersResult.missingRequirements[0], /Masters level or above/);

    const phdResult = await matchListing(listingRequiring('PhD'), profile, neverCallLlm);
    assert.equal(phdResult.hardRequirementsMet, false);
    assert.match(phdResult.missingRequirements[0], /PhD level or above/);
});

test('a High school profile only qualifies for High school requirements', async () => {
    const profile = { educationLevel: 'High school', country: 'Nigeria', fieldOfStudy: 'Computer Science' };

    const exactResult = await matchListing(listingRequiring('High school'), profile, () => ({
        response: { text: () => JSON.stringify({ hasUnresolvedCriteria: false, missingOrUnclear: [], reasoning: 'Fine.' }) },
    }));
    assert.equal(exactResult.hardRequirementsMet, true);

    for (const higherLevel of ['Bachelors', 'Masters', 'PhD']) {
        const result = await matchListing(listingRequiring(higherLevel), profile, neverCallLlm);
        assert.equal(result.hardRequirementsMet, false, `High school profile should not qualify for ${higherLevel}`);
    }
});

test('a listing with no stated education requirement never blocks any profile', async () => {
    const listing = { title: 'No requirement stated', deadline: null, eligibility: 'Nationality: Any' };
    const fakeGenerateContent = () => ({
        response: { text: () => JSON.stringify({ hasUnresolvedCriteria: false, missingOrUnclear: [], reasoning: 'Fine.' }) },
    });

    for (const level of ['High school', 'Bachelors', 'Masters', 'PhD']) {
        const profile = { educationLevel: level, country: 'Nigeria', fieldOfStudy: 'Computer Science' };
        const result = await matchListing(listing, profile, fakeGenerateContent);
        assert.equal(result.hardRequirementsMet, true, `${level} profile should pass when no requirement is stated`);
    }
});

test('an unrecognized education level string does not crash and does not penalize', async () => {
    // Profiles or listings with unexpected wording (typos, unusual phrasing)
    // should fail open, not throw or silently reject.
    const profile = { educationLevel: 'Undergraduate diploma', country: 'Nigeria', fieldOfStudy: 'Computer Science' };
    const result = await matchListing(listingRequiring('Masters'), profile, () => ({
        response: { text: () => JSON.stringify({ hasUnresolvedCriteria: false, missingOrUnclear: [], reasoning: 'Fine.' }) },
    }));
    // Can't compare "undergraduate diploma" against the known level order, so
    // this should not be treated as a hard-requirement failure.
    assert.equal(result.hardRequirementsMet, true);
});
