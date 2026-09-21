// Compare-two-listings mode: given two already-scored listing records (the
// same shape main.js produces for every result), returns a head-to-head
// comparison across eligibility, urgency, and trust, plus a plain verdict.
// Pure function, no API calls, no scraping, this is a separate way of
// looking at data the pipeline already produces, not a new data source.
// A single-profile run that never calls this is completely unaffected.

const ELIGIBILITY_RANK = { Eligible: 0, Partial: 1, 'Not Eligible': 2 };
const URGENCY_RANK = { 'Closing soon': 0, Upcoming: 1, 'Plenty of time': 2, Unknown: 3, Closed: 4 };
const TRUST_RANK = { 'Low Risk': 0, 'Some Concerns': 1, 'High Risk': 2 };

function betterEligibility(a, b) {
    const aRank = ELIGIBILITY_RANK[a.eligibilityMatch] ?? 3;
    const bRank = ELIGIBILITY_RANK[b.eligibilityMatch] ?? 3;
    if (aRank === bRank) return 'tie';
    return aRank < bRank ? 'a' : 'b';
}

function betterUrgency(a, b) {
    const aRank = URGENCY_RANK[a.urgency] ?? 3;
    const bRank = URGENCY_RANK[b.urgency] ?? 3;
    if (aRank === bRank) return 'tie';
    // Closing soon isn't necessarily "better", it's more time-pressured,
    // so this is framed as "more urgent" rather than "wins", it's up to the
    // caller/UI to decide what to do with that framing.
    return aRank < bRank ? 'a' : 'b';
}

function betterTrust(a, b) {
    const aRank = TRUST_RANK[a.trustRisk] ?? 3;
    const bRank = TRUST_RANK[b.trustRisk] ?? 3;
    if (aRank === bRank) return 'tie';
    return aRank < bRank ? 'a' : 'b';
}

function buildVerdict(comparison) {
    const { eligibility, trust } = comparison;

    // Eligibility and trust matter more than urgency for an overall
    // recommendation, urgency is informational (when to act), not a
    // reason to prefer one opportunity over another on its own merits.
    if (eligibility === 'tie' && trust === 'tie') {
        return 'Both opportunities are comparable on eligibility and trust, the choice may come down to funding amount or personal fit.';
    }
    if (eligibility !== 'tie' && trust !== 'tie' && eligibility === trust) {
        const winner = eligibility === 'a' ? 'the first' : 'the second';
        return `${winner[0].toUpperCase()}${winner.slice(1)} opportunity looks stronger on both eligibility and trust.`;
    }
    if (eligibility !== 'tie') {
        const winner = eligibility === 'a' ? 'the first' : 'the second';
        return `${winner[0].toUpperCase()}${winner.slice(1)} opportunity is the better eligibility match, but check the trust comparison too before deciding.`;
    }
    const winner = trust === 'a' ? 'the first' : 'the second';
    return `${winner[0].toUpperCase()}${winner.slice(1)} opportunity looks more trustworthy, but check the eligibility comparison too before deciding.`;
}

/**
 * Compares two already-scored listing records. Returns null if either
 * input is missing or doesn't look like a scored listing, rather than
 * throwing, callers can check for null and show a plain error instead of
 * crashing.
 */
export function compareListings(listingA, listingB) {
    if (!listingA || !listingB || !listingA.title || !listingB.title) {
        return null;
    }

    const comparison = {
        eligibility: betterEligibility(listingA, listingB),
        urgency: betterUrgency(listingA, listingB),
        trust: betterTrust(listingA, listingB),
    };

    return {
        listingATitle: listingA.title,
        listingBTitle: listingB.title,
        comparison,
        verdict: buildVerdict(comparison),
    };
}
