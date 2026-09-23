// Unit tests for composeGpaOrGrade: the Actor input schema's flat
// gpaFormat + gpaOrGrade fields, composed into the single string match.js
// expects. No API calls.
//
// Run with: node --test test/gpa-format.test.js

import test from 'node:test';
import assert from 'node:assert/strict';
import { composeGpaOrGrade } from '../src/gpa-format.js';

test('no gpaFormat at all passes gpaOrGrade through unchanged, same as before this feature existed', () => {
    const result = composeGpaOrGrade('', '3.6/4.0');
    assert.deepEqual(result, { value: '3.6/4.0', error: null });
});

test('gpaFormat and gpaOrGrade both blank is fine, GPA is optional', () => {
    const result = composeGpaOrGrade('', '');
    assert.deepEqual(result, { value: '', error: null });
});

test('cgpa4 composes the number with a /4.0 suffix', () => {
    const result = composeGpaOrGrade('cgpa4', '3.6');
    assert.deepEqual(result, { value: '3.6/4.0', error: null });
});

test('cgpa5 composes the number with a /5.0 suffix', () => {
    const result = composeGpaOrGrade('cgpa5', '4.5');
    assert.deepEqual(result, { value: '4.5/5.0', error: null });
});

test('percentage composes the number with a % suffix', () => {
    const result = composeGpaOrGrade('percentage', '72');
    assert.deepEqual(result, { value: '72%', error: null });
});

test('cgpa4 rejects a number above 4.0', () => {
    const result = composeGpaOrGrade('cgpa4', '9');
    assert.equal(result.error, 'gpaOrGrade must be a number between 0 and 4 for the selected gpaFormat.');
});

test('cgpa5 rejects a number above 5.0', () => {
    const result = composeGpaOrGrade('cgpa5', '9');
    assert.ok(result.error);
});

test('percentage rejects a number above 100', () => {
    const result = composeGpaOrGrade('percentage', '150');
    assert.ok(result.error);
});

test('a numeric format rejects zero, negative, and non-numeric values', () => {
    assert.ok(composeGpaOrGrade('cgpa4', '0').error);
    assert.ok(composeGpaOrGrade('cgpa4', '-1').error);
    assert.ok(composeGpaOrGrade('cgpa4', 'banana').error);
});

test('a numeric format with no value at all is an error, not silently blank', () => {
    const result = composeGpaOrGrade('cgpa4', '');
    assert.ok(result.error);
});

test('classification passes the value through as-is', () => {
    const result = composeGpaOrGrade('classification', 'First Class');
    assert.deepEqual(result, { value: 'First Class', error: null });
});

test('waec passes the value through as-is, matching the website\'s composed subject:grade format', () => {
    const result = composeGpaOrGrade('waec', 'English: B3, Mathematics: B2');
    assert.deepEqual(result, { value: 'English: B3, Mathematics: B2', error: null });
});

test('other passes the value through as-is', () => {
    const result = composeGpaOrGrade('other', '8/10');
    assert.deepEqual(result, { value: '8/10', error: null });
});

test('classification/waec/other with no value at all is an error', () => {
    assert.ok(composeGpaOrGrade('classification', '').error);
    assert.ok(composeGpaOrGrade('waec', '').error);
    assert.ok(composeGpaOrGrade('other', '').error);
});

test('an unrecognized gpaFormat value is a clear error, not a silent guess', () => {
    const result = composeGpaOrGrade('not-a-real-format', '4.5');
    assert.ok(result.error);
    assert.match(result.error, /Unrecognized gpaFormat/);
});

test('gpaOrGrade being null (its "not provided" value from the frontend) does not crash', () => {
    const result = composeGpaOrGrade('cgpa5', null);
    assert.ok(result.error); // required but missing
});

test('gpaFormat being null does not crash, behaves like blank', () => {
    const result = composeGpaOrGrade(null, '3.6/4.0');
    assert.deepEqual(result, { value: '3.6/4.0', error: null });
});
