// Unit tests for validateProfile, the input-validation gate on the public
// /api/start-run endpoint. This is the actual public entry point students'
// profile data comes through before Apify ever sees it — the frontend
// form's own validation only stops the UI, not a direct POST to this route,
// so this needs its own independent test coverage.
//
// Run with: node --test api/start-run.test.js

import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProfile } from './start-run.js';

function validProfile(overrides = {}) {
    return {
        educationLevel: 'Bachelors',
        fieldOfStudy: 'Computer Science',
        country: 'Nigeria',
        fundingNeeded: true,
        ...overrides,
    };
}

test('a complete, valid profile passes', () => {
    assert.equal(validateProfile(validProfile()), null);
});

test('optional fields (gpaOrGrade, cvText) can be omitted', () => {
    const { fundingNeeded, ...profile } = validProfile();
    assert.equal(validateProfile(profile), null);
});

test('an empty body is rejected, not silently forwarded to Apify', () => {
    assert.notEqual(validateProfile({}), null);
});

test('null or non-object bodies are rejected', () => {
    assert.notEqual(validateProfile(null), null);
    assert.notEqual(validateProfile(undefined), null);
    assert.notEqual(validateProfile('a string'), null);
    assert.notEqual(validateProfile(42), null);
});

test('missing educationLevel is rejected', () => {
    const { educationLevel, ...profile } = validProfile();
    assert.notEqual(validateProfile(profile), null);
});

test('educationLevel must be one of the four allowed values, matching input_schema.json', () => {
    assert.equal(validateProfile(validProfile({ educationLevel: 'PhD' })), null);
    assert.notEqual(validateProfile(validProfile({ educationLevel: 'Postdoc' })), null);
    assert.notEqual(validateProfile(validProfile({ educationLevel: '' })), null);
    assert.notEqual(validateProfile(validProfile({ educationLevel: 123 })), null);
});

test('missing or blank fieldOfStudy is rejected', () => {
    assert.notEqual(validateProfile(validProfile({ fieldOfStudy: '' })), null);
    assert.notEqual(validateProfile(validProfile({ fieldOfStudy: '   ' })), null);
    const { fieldOfStudy, ...profile } = validProfile();
    assert.notEqual(validateProfile(profile), null);
});

test('missing or blank country is rejected', () => {
    assert.notEqual(validateProfile(validProfile({ country: '' })), null);
    const { country, ...profile } = validProfile();
    assert.notEqual(validateProfile(profile), null);
});

test('fundingNeeded must be a boolean when present', () => {
    assert.equal(validateProfile(validProfile({ fundingNeeded: false })), null);
    assert.notEqual(validateProfile(validProfile({ fundingNeeded: 'yes' })), null);
});

test('gpaOrGrade and cvText accept null (their "not provided" value from the frontend)', () => {
    assert.equal(validateProfile(validProfile({ gpaOrGrade: null, cvText: null })), null);
});

test('gpaOrGrade and cvText reject non-string, non-null values', () => {
    assert.notEqual(validateProfile(validProfile({ gpaOrGrade: 4.0 })), null);
    assert.notEqual(validateProfile(validProfile({ cvText: ['a', 'list'] })), null);
});

test('an overly long fieldOfStudy, country, or gpaOrGrade is rejected', () => {
    assert.notEqual(validateProfile(validProfile({ fieldOfStudy: 'x'.repeat(201) })), null);
    assert.notEqual(validateProfile(validProfile({ country: 'x'.repeat(201) })), null);
    assert.notEqual(validateProfile(validProfile({ gpaOrGrade: 'x'.repeat(101) })), null);
});

test('a cvText right at the extraction limit is fine, one over is rejected', () => {
    assert.equal(validateProfile(validProfile({ cvText: 'x'.repeat(20000) })), null);
    assert.notEqual(validateProfile(validProfile({ cvText: 'x'.repeat(20001) })), null);
});

test('regression: fieldOfStudy="hy" with gpaOrGrade="00" is rejected (a real garbage-input test caught this reaching a live, billed Actor run)', () => {
    assert.notEqual(validateProfile(validProfile({ fieldOfStudy: 'hy', gpaOrGrade: '00' })), null);
});

test('a too-short or vowel-less fieldOfStudy/country is rejected as implausible', () => {
    assert.notEqual(validateProfile(validProfile({ fieldOfStudy: 'hy' })), null);
    assert.notEqual(validateProfile(validProfile({ fieldOfStudy: 'xkcd' })), null);
    assert.notEqual(validateProfile(validProfile({ country: 'zzz' })), null);
    // Short but real values (short names, common abbreviations) still pass.
    assert.equal(validateProfile(validProfile({ fieldOfStudy: 'Art' })), null);
    assert.equal(validateProfile(validProfile({ fieldOfStudy: 'Law' })), null);
    assert.equal(validateProfile(validProfile({ country: 'UAE' })), null);
    assert.equal(validateProfile(validProfile({ country: 'DR Congo' })), null);
});

test('gpaOrGrade must match a real grade shape: fraction, percentage, plain number in range, or a named classification', () => {
    assert.equal(validateProfile(validProfile({ gpaOrGrade: '3.6/4.0' })), null);
    assert.equal(validateProfile(validProfile({ gpaOrGrade: '85%' })), null);
    assert.equal(validateProfile(validProfile({ gpaOrGrade: '3.6' })), null);
    assert.equal(validateProfile(validProfile({ gpaOrGrade: 'First Class' })), null);
    assert.equal(validateProfile(validProfile({ gpaOrGrade: 'Second Class Upper' })), null);
    assert.equal(validateProfile(validProfile({ gpaOrGrade: 'CGPA 4.5' })), null);

    assert.notEqual(validateProfile(validProfile({ gpaOrGrade: '00' })), null);
    assert.notEqual(validateProfile(validProfile({ gpaOrGrade: '0' })), null);
    assert.notEqual(validateProfile(validProfile({ gpaOrGrade: '-5' })), null);
    assert.notEqual(validateProfile(validProfile({ gpaOrGrade: 'asdf' })), null);
    assert.notEqual(validateProfile(validProfile({ gpaOrGrade: '9999' })), null);
});

test('an omitted or blank gpaOrGrade is fine (it is optional; the format check only applies when something was provided)', () => {
    const { gpaOrGrade, ...profile } = validProfile();
    assert.equal(validateProfile(profile), null);
    assert.equal(validateProfile(validProfile({ gpaOrGrade: '' })), null);
    assert.equal(validateProfile(validProfile({ gpaOrGrade: '   ' })), null);
});
