// Alumni/success-rate search signal: an additional, optional trust signal
// that looks for public mentions of people who actually received a given
// scholarship. A listing with real past recipients showing up online is a
// stronger positive signal than "no independent presence found" alone, and
// it's a different question than the general relevance check in search.js
// ("is this page about the opportunity" vs "does this page mention someone
// who actually got it").
//
// This does NOT run its own fetch. It's designed to be called with results
// already fetched by search.js's DuckDuckGo query (or a dedicated one), so
// it stays a pure reasoning layer over whatever candidate results exist. If
// nothing is passed in, or the LLM call fails, this returns "unknown"
// rather than penalizing the listing, exactly like the rest of the trust
// signals do when evidence isn't available.

/**
 * Asks the LLM whether any of the given search result candidates look like
 * a genuine mention of someone who received this scholarship (a testimonial,
 * a "past recipients" or "our scholars" page, a news mention naming a
 * winner), as opposed to generic pages about the scholarship in general.
 *
 * Returns { alumniMentionsFound: boolean, evidence: string[] } or null if
 * we don't have enough to make a call (no candidates, no LLM available, or
 * the call failed).
 */
export async function checkAlumniMentions(listing, candidates, generateContentWithRetry) {
    if (!generateContentWithRetry || !candidates || candidates.length === 0) {
        return null;
    }

    const listForPrompt = candidates
        .map((c, i) => `${i}. "${c.title}" — ${c.snippet}`)
        .join('\n');

    const prompt = `A search was run for this scholarship/opportunity: "${listing.title}".

Here are the search results found:
${listForPrompt}

Do any of these results look like a genuine mention of a specific person who actually received this award? This includes things like a "past recipients" or "our scholars" page, a news article naming a winner, or someone's personal testimonial about receiving it. It does NOT include generic pages just describing the scholarship or how to apply.

Return ONLY a JSON object with:
- "alumniMentionsFound": true or false
- "evidence": an array of short strings, one per result that counts as a genuine mention (empty array if none)`;

    try {
        const result = await generateContentWithRetry(prompt);
        const rawText = result.response.text() ?? '';
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error(`No JSON object found in response: ${rawText.slice(0, 200)}`);
        const parsed = JSON.parse(jsonMatch[0]);
        return {
            alumniMentionsFound: Boolean(parsed.alumniMentionsFound),
            evidence: Array.isArray(parsed.evidence) ? parsed.evidence : [],
        };
    } catch (err) {
        console.log(`Alumni mention check failed for "${listing.title}": ${err.message}`);
        return null; // unknown, not a penalty
    }
}
