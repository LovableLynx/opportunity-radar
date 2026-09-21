// Plain-English summary of a run's results. Pure function, no API calls, no
// side effects, so it can never break the per-listing output even if this
// file has a bug, main.js just skips calling it.

export function buildDigest(results) {
    const total = results.length;
    const eligible = results.filter((r) => r.eligibilityMatch === 'Eligible').length;
    const partial = results.filter((r) => r.eligibilityMatch === 'Partial').length;
    const notEligible = results.filter((r) => r.eligibilityMatch === 'Not Eligible').length;

    const highRisk = results.filter((r) => r.trustRisk === 'High Risk').length;
    const someConcerns = results.filter((r) => r.trustRisk === 'Some Concerns').length;

    const lines = [];
    lines.push(`Found ${total} opportunit${total === 1 ? 'y' : 'ies'}.`);

    if (eligible > 0) lines.push(`${eligible} you're eligible for.`);
    if (partial > 0) lines.push(`${partial} need a closer look, something about them is unclear.`);
    if (notEligible > 0) lines.push(`${notEligible} you don't qualify for right now.`);

    if (highRisk > 0) {
        lines.push(`${highRisk} flagged High Risk, worth checking the evidence before applying.`);
    }
    if (someConcerns > 0) {
        lines.push(`${someConcerns} flagged Some Concerns, not necessarily a scam, just worth a second look.`);
    }

    return {
        summary: lines.join(' '),
        counts: { total, eligible, partial, notEligible, highRisk, someConcerns },
    };
}
