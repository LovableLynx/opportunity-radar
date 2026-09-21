// Unit tests for the growing scam-pattern library. Apify's key-value store
// is mocked with plain functions, no real Actor storage or API calls.
//
// Run with: node --test test/learned-patterns.test.js

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLearnedPatterns, saveLearnedPatterns, patternsFromPhrases } from '../src/learned-patterns.js';

test('loadLearnedPatterns returns empty array when no getValue function provided', async () => {
    const result = await loadLearnedPatterns(null);
    assert.deepEqual(result, []);
});

test('loadLearnedPatterns returns empty array when the store has nothing saved', async () => {
    const getValue = async () => undefined;
    const result = await loadLearnedPatterns(getValue);
    assert.deepEqual(result, []);
});

test('loadLearnedPatterns returns the saved phrases when present', async () => {
    const getValue = async () => ['scholarship processing fee scam phrase'];
    const result = await loadLearnedPatterns(getValue);
    assert.deepEqual(result, ['scholarship processing fee scam phrase']);
});

test('loadLearnedPatterns ignores non-string entries rather than crashing', async () => {
    const getValue = async () => ['valid phrase', 123, null, { not: 'a string' }, ''];
    const result = await loadLearnedPatterns(getValue);
    assert.deepEqual(result, ['valid phrase']);
});

test('loadLearnedPatterns returns empty array if the stored value is not an array', async () => {
    const getValue = async () => 'not an array at all';
    const result = await loadLearnedPatterns(getValue);
    assert.deepEqual(result, []);
});

test('loadLearnedPatterns returns empty array (not a throw) if the store errors', async () => {
    const getValue = async () => { throw new Error('store unreachable'); };
    const result = await loadLearnedPatterns(getValue);
    assert.deepEqual(result, []);
});

test('saveLearnedPatterns merges new phrases with existing ones, deduplicated', async () => {
    let saved = null;
    const getValue = async () => ['existing phrase'];
    const setValue = async (key, value) => { saved = value; };

    await saveLearnedPatterns(getValue, setValue, ['new phrase', 'existing phrase']);

    assert.deepEqual(saved.sort(), ['existing phrase', 'new phrase'].sort());
});

test('saveLearnedPatterns does nothing if no setValue function is provided', async () => {
    // Should not throw even though there is nowhere to save to.
    await assert.doesNotReject(saveLearnedPatterns(async () => [], null, ['a phrase']));
});

test('saveLearnedPatterns does nothing when there are no new phrases to add', async () => {
    let setValueCalled = false;
    const setValue = async () => { setValueCalled = true; };
    await saveLearnedPatterns(async () => [], setValue, []);
    assert.equal(setValueCalled, false);
});

test('saveLearnedPatterns caps the stored list rather than growing unbounded', async () => {
    let saved = null;
    const existing = Array.from({ length: 99 }, (_, i) => `phrase ${i}`);
    const getValue = async () => existing;
    const setValue = async (key, value) => { saved = value; };

    await saveLearnedPatterns(getValue, setValue, ['new phrase one', 'new phrase two']);

    assert.equal(saved.length, 100); // MAX_LEARNED_PATTERNS
});

test('saveLearnedPatterns failing to write does not throw', async () => {
    const getValue = async () => [];
    const setValue = async () => { throw new Error('write failed'); };
    await assert.doesNotReject(saveLearnedPatterns(getValue, setValue, ['a phrase']));
});

test('patternsFromPhrases builds working case-insensitive regexes', () => {
    const patterns = patternsFromPhrases(['send a Special Handling Fee']);
    assert.equal(patterns.length, 1);
    assert.ok(patterns[0].test('please SEND A SPECIAL HANDLING FEE today'));
    assert.ok(!patterns[0].test('nothing suspicious here'));
});

test('patternsFromPhrases escapes regex special characters in learned phrases', () => {
    const patterns = patternsFromPhrases(['pay $50 (via wire)']);
    assert.equal(patterns.length, 1);
    // should match the literal string, not be interpreted as a broken regex
    assert.ok(patterns[0].test('please pay $50 (via wire) now'));
    assert.doesNotThrow(() => patternsFromPhrases(['some (unbalanced [regex chars']));
});
