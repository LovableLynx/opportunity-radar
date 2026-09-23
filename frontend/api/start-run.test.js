// Unit tests for validateProfile, the input-validation gate on the public
// /api/start-run endpoint. This is the actual public entry point students'
// profile data comes through before Apify ever sees it, the frontend
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

function assertValid(profile) {
    const result = validateProfile(profile);
    assert.equal(result.valid, true, `expected valid, got errors: ${JSON.stringify(result.fieldErrors)}`);
}

function assertInvalid(profile, field) {
    const result = validateProfile(profile);
    assert.equal(result.valid, false);
    if (field) assert.ok(result.fieldErrors[field], `expected an error on "${field}", got: ${JSON.stringify(result.fieldErrors)}`);
}

test('a complete, valid profile passes', () => {
    assertValid(validProfile());
});

test('optional fields (gpaOrGrade, cvText) can be omitted', () => {
    const { fundingNeeded, ...profile } = validProfile();
    assertValid(profile);
});

test('an empty body is rejected, not silently forwarded to Apify', () => {
    assertInvalid({});
});

test('null or non-object bodies are rejected', () => {
    assertInvalid(null);
    assertInvalid(undefined);
    assertInvalid('a string');
    assertInvalid(42);
});

test('missing educationLevel is rejected', () => {
    const { educationLevel, ...profile } = validProfile();
    assertInvalid(profile, 'educationLevel');
});

test('educationLevel must be one of the four allowed values, matching input_schema.json', () => {
    assertValid(validProfile({ educationLevel: 'PhD' }));
    assertInvalid(validProfile({ educationLevel: 'Postdoc' }), 'educationLevel');
    assertInvalid(validProfile({ educationLevel: '' }), 'educationLevel');
    assertInvalid(validProfile({ educationLevel: 123 }), 'educationLevel');
});

test('missing or blank fieldOfStudy is rejected', () => {
    assertInvalid(validProfile({ fieldOfStudy: '' }), 'fieldOfStudy');
    assertInvalid(validProfile({ fieldOfStudy: '   ' }), 'fieldOfStudy');
    const { fieldOfStudy, ...profile } = validProfile();
    assertInvalid(profile, 'fieldOfStudy');
});

test('missing or blank country is rejected', () => {
    assertInvalid(validProfile({ country: '' }), 'country');
    const { country, ...profile } = validProfile();
    assertInvalid(profile, 'country');
});

test('fundingNeeded must be a boolean when present', () => {
    assertValid(validProfile({ fundingNeeded: false }));
    assertInvalid(validProfile({ fundingNeeded: 'yes' }), 'fundingNeeded');
});

test('gpaOrGrade and cvText accept null (their "not provided" value from the frontend)', () => {
    assertValid(validProfile({ gpaOrGrade: null, cvText: null }));
});

test('gpaOrGrade and cvText reject non-string, non-null values', () => {
    assertInvalid(validProfile({ gpaOrGrade: 4.0 }), 'gpaOrGrade');
    assertInvalid(validProfile({ cvText: ['a', 'list'] }), 'cvText');
});

test('an overly long fieldOfStudy, country, or gpaOrGrade is rejected', () => {
    assertInvalid(validProfile({ fieldOfStudy: 'x'.repeat(201) }), 'fieldOfStudy');
    assertInvalid(validProfile({ country: 'x'.repeat(201) }), 'country');
    assertInvalid(validProfile({ gpaOrGrade: 'x'.repeat(101) }), 'gpaOrGrade');
});

test('a cvText right at the extraction limit is fine, one over is rejected', () => {
    assertValid(validProfile({ cvText: 'x'.repeat(20000) }));
    assertInvalid(validProfile({ cvText: 'x'.repeat(20001) }), 'cvText');
});

test('regression: fieldOfStudy="hy" with gpaOrGrade="00" is rejected (a real garbage-input test caught this reaching a live, billed Actor run)', () => {
    assertInvalid(validProfile({ fieldOfStudy: 'hy', gpaOrGrade: '00' }));
});

test('regression: fieldOfStudy="hy" AND country="7" together are BOTH reported, not just the first one found', () => {
    // A real user hit this: fixing fieldOfStudy and resubmitting only then
    // revealed the country error, one frustrating round-trip at a time.
    const result = validateProfile(validProfile({ fieldOfStudy: 'hy', country: '7' }));
    assert.equal(result.valid, false);
    assert.ok(result.fieldErrors.fieldOfStudy);
    assert.ok(result.fieldErrors.country);
});

test('a too-short or vowel-less fieldOfStudy/country is rejected as implausible', () => {
    assertInvalid(validProfile({ fieldOfStudy: 'hy' }), 'fieldOfStudy');
    assertInvalid(validProfile({ fieldOfStudy: 'xkcd' }), 'fieldOfStudy');
    assertInvalid(validProfile({ country: 'zzz' }), 'country');
    assertInvalid(validProfile({ country: '7' }), 'country');
    // Short but real values (short names, common abbreviations) still pass.
    assertValid(validProfile({ fieldOfStudy: 'Art' }));
    assertValid(validProfile({ fieldOfStudy: 'Law' }));
    assertValid(validProfile({ country: 'UAE' }));
    assertValid(validProfile({ country: 'DR Congo' }));
});

test('gpaOrGrade accepts a fraction, a percentage, or a named classification', () => {
    assertValid(validProfile({ gpaOrGrade: '3.6/4.0' }));
    assertValid(validProfile({ gpaOrGrade: '85%' }));
    assertValid(validProfile({ gpaOrGrade: 'First Class' }));
    assertValid(validProfile({ gpaOrGrade: 'Second Class Upper' }));
    assertValid(validProfile({ gpaOrGrade: 'CGPA 4.5' }));
});

test('a bare gpaOrGrade number above 30 is accepted as an unambiguous percentage', () => {
    assertValid(validProfile({ gpaOrGrade: '85' }));
    assertValid(validProfile({ gpaOrGrade: '72.5' }));
});

test('a bare gpaOrGrade number at or below 30 is rejected as ambiguous, needs an explicit scale', () => {
    // Regression: "8" alone previously passed as "valid" even though it
    // could mean 8/10, a typo, or something else entirely — a real GPA
    // scale (4.0, 5.0, 10.0) never reaches 30, so nobody means a bare "8"
    // or "3.6" as a percentage, and it's ambiguous without a stated scale.
    assertInvalid(validProfile({ gpaOrGrade: '8' }), 'gpaOrGrade');
    assertInvalid(validProfile({ gpaOrGrade: '3.6' }), 'gpaOrGrade');
    assertInvalid(validProfile({ gpaOrGrade: '30' }), 'gpaOrGrade');
    // Made explicit with a scale, the same numbers are fine.
    assertValid(validProfile({ gpaOrGrade: '8/10' }));
    assertValid(validProfile({ gpaOrGrade: '3.6/4.0' }));
    assertValid(validProfile({ gpaOrGrade: '8%' }));
});

test('gpaOrGrade rejects zero, negative, over-100, and nonsense values', () => {
    assertInvalid(validProfile({ gpaOrGrade: '00' }), 'gpaOrGrade');
    assertInvalid(validProfile({ gpaOrGrade: '0' }), 'gpaOrGrade');
    assertInvalid(validProfile({ gpaOrGrade: '-5' }), 'gpaOrGrade');
    assertInvalid(validProfile({ gpaOrGrade: 'asdf' }), 'gpaOrGrade');
    assertInvalid(validProfile({ gpaOrGrade: '9999' }), 'gpaOrGrade');
});

test('an omitted or blank gpaOrGrade is fine (it is optional; the format check only applies when something was provided)', () => {
    const { gpaOrGrade, ...profile } = validProfile();
    assertValid(profile);
    assertValid(validProfile({ gpaOrGrade: '' }));
    assertValid(validProfile({ gpaOrGrade: '   ' }));
});
