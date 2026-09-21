// Unit tests for CV-as-evidence matching: when a CV is provided, ambiguous
// criteria get checked against real CV content instead of always being
// "unconfirmed". Profile-only calls (no CV) must behave exactly as before.
// LLM stubbed throughout.
//
// Run with: node --test test/match-cv-evidence.test.js

import test from 'node:test';
import assert from 'node:assert/strict';
import { matchListing } from '../src/match.js';

test('no CV provided behaves exactly like before, usedCvEvidence is false', async () => {
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
                missingOrUnclear: ['Research experience unconfirmed'],
                reasoning: 'No research experience mentioned in profile.',
                actionSteps: ['Mention any research work in your application.'],
            }),
        },
    });

    const result = await matchListing(listing, profile, fakeGenerateContent);

    assert.equal(result.usedCvEvidence, false);
    assert.equal(result.eligibilityMatch, 'Partial');
});

test('a CV that confirms the ambiguous criterion resolves it to Eligible', async () => {
    const listing = {
        title: 'Research Preference Scholarship',
        deadline: null,
        eligibility: 'Nationality: Any. Preference given to applicants with demonstrated research experience.',
    };
    const profile = { educationLevel: 'PhD', country: 'Nigeria', fieldOfStudy: 'Computer Science' };
    const cvText = 'Published two papers on machine learning fairness, supervised undergraduate research project 2023-2024.';

    let capturedPrompt = null;
    const fakeGenerateContent = async (prompt) => {
        capturedPrompt = prompt;
        return {
            response: {
                text: () => JSON.stringify({
                    hasUnresolvedCriteria: false,
                    missingOrUnclear: [],
                    reasoning: 'CV shows two publications and a supervised research project, satisfying the research experience preference.',
                    actionSteps: [],
                }),
            },
        };
    };

    const result = await matchListing(listing, profile, fakeGenerateContent, cvText);

    assert.equal(result.usedCvEvidence, true);
    assert.equal(result.eligibilityMatch, 'Eligible');
    assert.match(result.llmInterpretation, /publications/);
    // the CV content should actually reach the prompt, not be silently dropped
    assert.match(capturedPrompt, /Published two papers/);
});

test('a CV that does not confirm the criterion still leaves it Partial, not silently upgraded', async () => {
    const listing = {
        title: 'Research Preference Scholarship',
        deadline: null,
        eligibility: 'Nationality: Any. Preference given to applicants with demonstrated research experience.',
    };
    const profile = { educationLevel: 'Bachelors', country: 'Nigeria', fieldOfStudy: 'Computer Science' };
    const cvText = 'Coursework in web development, part-time retail job 2022-2023.';

    const fakeGenerateContent = async () => ({
        response: {
            text: () => JSON.stringify({
                hasUnresolvedCriteria: true,
                missingOrUnclear: ['CV shows no research experience'],
                reasoning: 'CV lists coursework and unrelated work experience, no research activity found.',
                actionSteps: ['Consider seeking a research assistantship or independent study project before applying.'],
            }),
        },
    });

    const result = await matchListing(listing, profile, fakeGenerateContent, cvText);

    assert.equal(result.usedCvEvidence, true);
    assert.equal(result.eligibilityMatch, 'Partial');
});

test('a hard-requirement rejection short-circuits before the CV is ever used', async () => {
    const listing = {
        title: 'Expired Scholarship',
        deadline: '01 Jan 2020',
        eligibility: 'Merit-based',
    };
    const profile = { educationLevel: 'PhD', country: 'Nigeria', fieldOfStudy: 'Computer Science' };
    const cvText = 'Extensive research background.';

    const neverCallLlm = () => { throw new Error('should not be called'); };
    const result = await matchListing(listing, profile, neverCallLlm, cvText);

    assert.equal(result.eligibilityMatch, 'Not Eligible');
    assert.equal(result.usedCvEvidence, false);
});

test('empty eligibility text short-circuits before the CV is ever used', async () => {
    const listing = { title: 'Vague Listing', deadline: null, eligibility: '' };
    const profile = { educationLevel: 'PhD', country: 'Nigeria', fieldOfStudy: 'Computer Science' };
    const cvText = 'Extensive research background.';

    const neverCallLlm = () => { throw new Error('should not be called'); };
    const result = await matchListing(listing, profile, neverCallLlm, cvText);

    assert.equal(result.eligibilityMatch, 'Eligible');
    assert.equal(result.usedCvEvidence, false);
});
