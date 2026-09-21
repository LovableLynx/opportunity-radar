// Unit tests for deadline urgency ranking. No API calls, deterministic (uses
// a fixed "now" rather than the real clock).
//
// Run with: node --test test/urgency.test.js

import test from 'node:test';
import assert from 'node:assert/strict';
import { urgencyFor, sortByUrgency } from '../src/urgency.js';

const NOW = new Date('2026-09-20T00:00:00Z');

test('a deadline within 14 days is Closing soon', () => {
    const result = urgencyFor('01 Oct 2026', NOW);
    assert.equal(result.urgency, 'Closing soon');
    assert.equal(result.daysRemaining, 11);
});

test('a deadline 15 to 90 days out is Upcoming', () => {
    const result = urgencyFor('01 Nov 2026', NOW);
    assert.equal(result.urgency, 'Upcoming');
});

test('a deadline more than 90 days out is Plenty of time', () => {
    const result = urgencyFor('01 Jun 2027', NOW);
    assert.equal(result.urgency, 'Plenty of time');
});

test('a deadline in the past is Closed', () => {
    const result = urgencyFor('01 Jan 2020', NOW);
    assert.equal(result.urgency, 'Closed');
    assert.ok(result.daysRemaining < 0);
});

test('"Not specified" and unparseable text are Unknown, not a crash', () => {
    assert.equal(urgencyFor('Not specified', NOW).urgency, 'Unknown');
    assert.equal(urgencyFor('Anytime', NOW).urgency, 'Unknown');
    assert.equal(urgencyFor(null, NOW).urgency, 'Unknown');
    assert.equal(urgencyFor(undefined, NOW).urgency, 'Unknown');
});

test('sortByUrgency puts closing-soon listings first, closed listings last', () => {
    const listings = [
        { title: 'Closed one', urgency: 'Closed', daysRemaining: -10 },
        { title: 'Plenty of time one', urgency: 'Plenty of time', daysRemaining: 200 },
        { title: 'Closing soon one', urgency: 'Closing soon', daysRemaining: 5 },
        { title: 'Unknown one', urgency: 'Unknown', daysRemaining: null },
        { title: 'Upcoming one', urgency: 'Upcoming', daysRemaining: 40 },
    ];

    const sorted = sortByUrgency(listings);
    assert.deepEqual(
        sorted.map((l) => l.title),
        ['Closing soon one', 'Upcoming one', 'Plenty of time one', 'Unknown one', 'Closed one'],
    );
});

test('sortByUrgency orders within the same band by days remaining', () => {
    const listings = [
        { title: 'Closing in 10 days', urgency: 'Closing soon', daysRemaining: 10 },
        { title: 'Closing in 2 days', urgency: 'Closing soon', daysRemaining: 2 },
        { title: 'Closing in 7 days', urgency: 'Closing soon', daysRemaining: 7 },
    ];

    const sorted = sortByUrgency(listings);
    assert.deepEqual(
        sorted.map((l) => l.title),
        ['Closing in 2 days', 'Closing in 7 days', 'Closing in 10 days'],
    );
});

test('sortByUrgency does not mutate the original array', () => {
    const listings = [
        { title: 'A', urgency: 'Plenty of time', daysRemaining: 200 },
        { title: 'B', urgency: 'Closing soon', daysRemaining: 5 },
    ];
    const original = [...listings];
    sortByUrgency(listings);
    assert.deepEqual(listings, original);
});
