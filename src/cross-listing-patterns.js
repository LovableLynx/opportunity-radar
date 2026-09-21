// Cross-listing fraud-pattern detection: looks across an entire batch of
// scored listings for the same suspicious phrasing repeating across
// multiple, otherwise-unrelated listings. A single listing with an upfront
// payment request is one red flag; the exact same unusual phrase appearing
// in three "different" scholarships from three different organizations is
// a stronger signal, it suggests a template being reused, not three
// independent legitimate offers that happen to phrase things the same way.
//
// This only activates with enough volume to make repetition meaningful
// (below MIN_BATCH_SIZE it's a no-op, since "the same phrase in 2 listings"
// out of 2 total listings isn't informative the way it would be out of 20).
// It never changes any individual listing's own trustRisk or trustScore,
// this is a separate, additive signal returned alongside the results, so a
// single-listing run or a small batch is completely unaffected.

const MIN_BATCH_SIZE = 5;
const MIN_REPEAT_COUNT = 3;

// Phrases specific enough that seeing them repeat is meaningful, deliberately
// narrower than trust.js's own red-flag patterns (which are meant to catch
// any single occurrence). These are for spotting a shared template, so they
// look for slightly more distinctive fragments.
const SUSPICIOUS_PHRASES = [
    /processing fee of \$?\d+/i,
    /refundable deposit of \$?\d+/i,
    /send.{0,20}(payment|money|fee).{0,20}(via|through) western union/i,
    /only \d+ (hours?|slots?|spots?) (left|remaining)/i,
];

function extractMatches(text) {
    if (!text) return [];
    return SUSPICIOUS_PHRASES
        .map((pattern) => pattern.exec(text)?.[0])
        .filter(Boolean)
        .map((match) => match.toLowerCase());
}

/**
 * Looks across all results for suspicious phrases that repeat across
 * multiple listings. Returns { patterns: [{ phrase, listingTitles }] },
 * empty array if nothing repeats often enough to matter, or the batch is
 * too small to draw any conclusion from repetition.
 */
export function detectCrossListingPatterns(results) {
    if (!Array.isArray(results) || results.length < MIN_BATCH_SIZE) {
        return { patterns: [], batchTooSmall: true };
    }

    const phraseToListings = new Map();

    for (const result of results) {
        const text = `${result.description ?? ''} ${result.eligibility ?? ''}`;
        const matches = extractMatches(text);
        for (const phrase of matches) {
            if (!phraseToListings.has(phrase)) phraseToListings.set(phrase, new Set());
            phraseToListings.get(phrase).add(result.title ?? 'Untitled listing');
        }
    }

    const patterns = [];
    for (const [phrase, listingTitles] of phraseToListings.entries()) {
        if (listingTitles.size >= MIN_REPEAT_COUNT) {
            patterns.push({ phrase, listingTitles: [...listingTitles] });
        }
    }

    return { patterns, batchTooSmall: false };
}
