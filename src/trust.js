// Trust/risk scoring.
//
// We do NOT ask an LLM "is this legitimate" and take its word for it — that
// claims a certainty no evidence can back up. Instead we gather concrete
// signals (some checked with plain code, one backed by a real web search) and
// turn them into a score with a written rule, so "why is this High Risk" has
// an actual answer beyond "the model said so".
//
// Labels are risk-framed on purpose: "Low Risk" means no red flags were
// found, not "confirmed legitimate" — a real, if unglamorous, distinction to
// keep visible in the UI copy, not just in our own heads.

// Starting weights — a reasonable first pass, not a final answer. Tune these
// once we've seen how they perform against a real evaluation set.
//
// A real production run surfaced a conflation bug: 18/20 real listings
// landed on High Risk, every one of them also reporting Low trustConfidence
// — the score was punishing "we don't have data on this" as if it were
// "this looks like a scam". Root cause was vagueEligibility firing
// identically whether the eligibility text actually said something
// red-flag-shaped ("open to everyone") or the text was simply never fetched
// (enrichLimitPerSource only enriches a handful of listings per run, so
// most never get real eligibility text at all). Those are different
// strengths of evidence, now two separate signals:
//   - missingEligibility (weight 1): "we don't know" — absence of data
//   - vagueEligibility (weight 2): "the text itself is a red flag" —
//     actual red-flag-shaped language was found
// A missing-data-only combo (noIndependentPresence + missingEligibility +
// noSecondaryListing = 1+1+1 = 3) now tops out at Some Concerns, not High
// Risk. A genuinely fabricated listing with real vague-pattern text (see
// the "Phantom Foundation Award" eval case: vagueEligibility +
// noIndependentPresence + noSecondaryListing = 2+1+1 = 4) still reaches
// High Risk, since real evidence of a red flag outweighs mere absence of
// verification. Any actual scam pattern (upfrontPayment=3, or
// extremeUrgency combined with anything) still dominates the score on its
// own regardless.
const SIGNAL_WEIGHTS = {
    upfrontPayment: 3,
    vagueEligibility: 2,
    noIndependentPresence: 1,
    extremeUrgency: 1,
    missingEligibility: 1,
    noSecondaryListing: 1,
};

const SCORE_THRESHOLDS = {
    someConcerns: 2, // score >= this -> Some Concerns
    highRisk: 4, // score >= this -> High Risk
};

const UPFRONT_PAYMENT_PATTERNS = [
    /processing fee/i,
    /application fee/i,
    /refundable deposit/i,
    /registration fee/i,
    /send.{0,20}(payment|money|fee)/i,
    /pay.{0,20}(via|through).{0,20}(gift card|western union|wire transfer|crypto)/i,
];

const URGENCY_PATTERNS = [
    /only \d+ (hours?|slots?|spots?) (left|remaining)/i,
    /apply (immediately|now|today) or (lose|miss)/i,
    /limited (time|slots?|spots?)/i,
    /act now/i,
];

const VAGUE_ELIGIBILITY_PATTERNS = [
    /open to (everyone|anyone|all)/i,
    /no (requirements?|experience) (needed|necessary|required)/i,
    /everyone (qualifies|is eligible)/i,
];

// extraPatterns is optional: learned-patterns.js can supply phrases learned
// from past runs on top of this fixed starting list. Defaults to an empty
// array so every existing caller (including all current tests) behaves
// exactly as before without needing to know this parameter exists.
function checkUpfrontPayment(listing, extraPatterns = []) {
    const text = `${listing.description ?? ''} ${listing.eligibility ?? ''}`;
    const matched = [...UPFRONT_PAYMENT_PATTERNS, ...extraPatterns].find((p) => p.test(text));
    return matched
        ? { triggered: true, evidence: `Requires upfront payment (matched: "${matched.exec(text)[0]}")` }
        : { triggered: false, evidence: null };
}

function checkExtremeUrgency(listing) {
    const text = `${listing.description ?? ''} ${listing.eligibility ?? ''}`;
    const matched = URGENCY_PATTERNS.find((p) => p.test(text));
    return matched
        ? { triggered: true, evidence: `Uses urgency-pressure language ("${matched.exec(text)[0]}")` }
        : { triggered: false, evidence: null };
}

// Split from missingEligibility below: this only fires on real text that
// actually reads as a red flag ("open to everyone"), not on the absence of
// text. Empty eligibility isn't evidence of anything by itself — most
// listings never get their detail page enriched at all (enrichLimitPerSource
// caps that), so "we don't know" was getting scored the same as "the
// listing itself waves a red flag", which is a different strength of
// evidence entirely.
function checkVagueEligibility(listing) {
    const text = listing.eligibility ?? '';
    if (!text) return { triggered: false, evidence: null };
    const matched = VAGUE_ELIGIBILITY_PATTERNS.find((p) => p.test(text));
    return matched
        ? { triggered: true, evidence: `Eligibility criteria are vague ("${matched.exec(text)[0]}")` }
        : { triggered: false, evidence: null };
}

function checkMissingEligibility(listing) {
    const text = listing.eligibility ?? '';
    return !text
        ? { triggered: true, evidence: 'No eligibility criteria available (detail page not yet checked)' }
        : { triggered: false, evidence: null };
}

// These two need real external evidence (Google Custom Search), so they're
// passed in already-resolved rather than computed here — see trustScore below.
function checkNoIndependentPresence(searchEvidence) {
    if (!searchEvidence) return { triggered: false, evidence: null }; // no search run yet, don't penalize
    return searchEvidence.independentResultsFound
        ? { triggered: false, evidence: null }
        : { triggered: true, evidence: 'No independent web presence found for the sponsoring organization' };
}

function checkNoSecondaryListing(searchEvidence) {
    if (!searchEvidence) return { triggered: false, evidence: null };
    return searchEvidence.secondarySourceFound
        ? { triggered: false, evidence: null }
        : { triggered: true, evidence: 'Listing does not appear to be mentioned anywhere else on the web' };
}

/**
 * How much we actually had to go on when scoring this listing. Two listings
 * can both land on "Low Risk" for very different reasons: one because five
 * independent sources confirmed it, another because no search ran at all
 * and nothing in the text tripped a red flag. Those aren't equally
 * trustworthy verdicts, so this is tracked and reported separately rather
 * than folded into trustRisk itself.
 */
function confidenceFor(listing, searchEvidence) {
    const hasEligibilityText = Boolean(listing.eligibility);
    const hasDescription = Boolean(listing.description);

    if (!searchEvidence) {
        // No web search ran at all (listing failed hard requirements, so we
        // skip search entirely, or the search itself failed).
        return hasEligibilityText || hasDescription ? 'Low' : 'Very low';
    }

    const resultCount = searchEvidence.resultCount ?? 0;
    if (resultCount === 0) return 'Low';
    if (resultCount === 1) return 'Medium';
    return 'High';
}

/**
 * Computes a risk score and category from a listing plus optional search
 * evidence. searchEvidence is optional so this can be tested and used before
 * the Google Custom Search integration exists. learnedPatterns is also
 * optional, extra upfront-payment patterns discovered on past runs
 * (see learned-patterns.js); omitting it uses only the fixed static list,
 * so every existing call site keeps working exactly as before.
 */
export function scoreListing(listing, searchEvidence = null, learnedPatterns = []) {
    const signals = {
        upfrontPayment: checkUpfrontPayment(listing, learnedPatterns),
        extremeUrgency: checkExtremeUrgency(listing),
        vagueEligibility: checkVagueEligibility(listing),
        missingEligibility: checkMissingEligibility(listing),
        noIndependentPresence: checkNoIndependentPresence(searchEvidence),
        noSecondaryListing: checkNoSecondaryListing(searchEvidence),
    };

    let score = 0;
    const evidence = [];
    for (const [signal, weight] of Object.entries(SIGNAL_WEIGHTS)) {
        if (signals[signal].triggered) {
            score += weight;
            evidence.push(signals[signal].evidence);
        }
    }

    let trustRisk;
    if (score >= SCORE_THRESHOLDS.highRisk) {
        trustRisk = 'High Risk';
    } else if (score >= SCORE_THRESHOLDS.someConcerns) {
        trustRisk = 'Some Concerns';
    } else {
        trustRisk = 'Low Risk';
    }

    return {
        trustRisk,
        trustScore: score,
        trustEvidence: evidence.length > 0 ? evidence : ['No risk signals detected based on available evidence'],
        trustConfidence: confidenceFor(listing, searchEvidence),
    };
}
