// Growing scam-pattern library: lets the Actor remember new suspicious
// phrasing it encounters and reuse it on future runs, on top of the fixed
// starting patterns already in trust.js. Persisted via Apify's key-value
// store so it survives between runs, the same store urgency.js and the
// digest already use for their own outputs.
//
// If the store can't be reached or the saved data is malformed, this fails
// open by returning an empty list, trust.js's own static patterns are the
// real fallback and always work regardless of what happens here. Nothing
// about this file is required for the core trust-scoring to function.

const STORE_KEY = 'LEARNED_SCAM_PATTERNS';
const MAX_LEARNED_PATTERNS = 100; // keep this bounded, not an unlimited growing list

/**
 * Loads previously learned patterns from the key-value store. Returns an
 * empty array if the store is empty, unreachable, or contains something
 * unexpected, never throws.
 */
export async function loadLearnedPatterns(actorGetValue) {
    if (!actorGetValue) return [];

    try {
        const stored = await actorGetValue(STORE_KEY);
        if (!Array.isArray(stored)) return [];
        // Only trust plain strings, anything else in the stored data is
        // ignored rather than risking a bad regex or object crashing later
        // pattern matching.
        return stored.filter((p) => typeof p === 'string' && p.length > 0);
    } catch (err) {
        console.log(`Could not load learned scam patterns, continuing without them: ${err.message}`);
        return [];
    }
}

/**
 * Adds newly identified suspicious phrases to the stored list, deduplicated,
 * capped at MAX_LEARNED_PATTERNS (oldest dropped first). A failure to save
 * is logged, not thrown, this is a nice-to-have, not something that should
 * ever fail a run.
 */
export async function saveLearnedPatterns(actorGetValue, actorSetValue, newPhrases) {
    if (!actorSetValue || !newPhrases || newPhrases.length === 0) return;

    try {
        const existing = await loadLearnedPatterns(actorGetValue);
        const combined = [...new Set([...existing, ...newPhrases])];
        const trimmed = combined.slice(-MAX_LEARNED_PATTERNS);
        await actorSetValue(STORE_KEY, trimmed);
    } catch (err) {
        console.log(`Could not save learned scam patterns: ${err.message}`);
    }
}

/**
 * Builds regex patterns from learned phrases, for use alongside trust.js's
 * static patterns. Phrases are escaped and matched case-insensitively as
 * literal substrings, learned phrases are exact strings we've seen before,
 * not hand-written patterns like the static list, so there's no need for
 * regex syntax in them and no reason to risk a malformed one.
 */
export function patternsFromPhrases(phrases) {
    return phrases.map((phrase) => {
        const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(escaped, 'i');
    });
}
