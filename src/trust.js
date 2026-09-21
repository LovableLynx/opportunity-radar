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
const SIGNAL_WEIGHTS = {
    upfrontPayment: 3,
    noIndependentPresence: 2,
    extremeUrgency: 1,
    vagueEligibility: 1,
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

function checkUpfrontPayment(listing) {
    const text = `${listing.description ?? ''} ${listing.eligibility ?? ''}`;
    const matched = UPFRONT_PAYMENT_PATTERNS.find((p) => p.test(text));
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

function checkVagueEligibility(listing) {
    const text = listing.eligibility ?? '';
    if (!text) {
        return { triggered: true, evidence: 'No eligibility criteria stated at all' };
    }
    const matched = VAGUE_ELIGIBILITY_PATTERNS.find((p) => p.test(text));
    return matched
        ? { triggered: true, evidence: `Eligibility criteria are vague ("${matched.exec(text)[0]}")` }
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
 * the Google Custom Search integration exists.
 */
export function scoreListing(listing, searchEvidence = null) {
    const signals = {
        upfrontPayment: checkUpfrontPayment(listing),
        extremeUrgency: checkExtremeUrgency(listing),
        vagueEligibility: checkVagueEligibility(listing),
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
