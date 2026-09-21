// Eligibility matching.
//
// We do NOT hand the whole eligibility text to an LLM and ask "is this student
// eligible". Facts that can be objectively compared — is the deadline still open,
// does a stated nationality/country requirement match, does a stated education
// level match — are checked with plain code first. Only the leftover, ambiguous
// language (funding amounts, activity requirements, "preference for X") goes to
// the LLM for interpretation. This keeps the reasoning explainable: we can always
// say exactly why something failed a hard check, instead of trusting an LLM's
// word for it.
//
// Category definitions (decided up front, not improvised per-listing):
//   Eligible        - every hard requirement passes, no unresolved ambiguous
//                      criteria the LLM flagged as a likely blocker
//   Partial         - every hard requirement passes, but the LLM found
//                      unresolved optional/preference criteria that may affect
//                      real-world fit
//   Not Eligible    - at least one hard requirement fails

// Exported so other modules (urgency.js) can reuse the same parsing rules
// instead of re-implementing "what counts as a real deadline".
export function parseDeadline(deadlineText) {
    if (!deadlineText || /not specified/i.test(deadlineText)) return null;
    const parsed = new Date(deadlineText);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function checkDeadline(listing) {
    const deadline = parseDeadline(listing.deadline);
    if (!deadline) return { passed: true, reason: null }; // unknown deadline can't be checked, don't penalize
    const now = new Date();
    if (deadline < now) {
        return { passed: false, reason: `Deadline has passed (${listing.deadline})` };
    }
    return { passed: true, reason: null };
}

function checkNationality(listing, profile) {
    const text = listing.eligibility ?? '';
    const match = text.match(/Nationality:\s*([A-Za-z ]+)/i);
    if (!match) return { passed: true, reason: null }; // no stated restriction

    const requiredNationality = match[1].trim().toLowerCase();
    if (requiredNationality === 'any' || requiredNationality === 'worldwide') {
        return { passed: true, reason: null };
    }

    const studentCountry = (profile.country ?? '').trim().toLowerCase();
    if (!studentCountry) return { passed: true, reason: null }; // can't check without profile data

    if (!requiredNationality.includes(studentCountry) && !studentCountry.includes(requiredNationality)) {
        return {
            passed: false,
            reason: `Requires ${match[1].trim()} nationality, profile says ${profile.country}`,
        };
    }
    return { passed: true, reason: null };
}

function checkEducationLevel(listing, profile) {
    const text = listing.eligibility ?? '';
    const match = text.match(/Study experience required:\s*([A-Za-z ]+)/i);
    if (!match) return { passed: true, reason: null };

    const levelOrder = ['high school', 'bachelor', 'bachelors', 'master', 'masters', 'phd'];
    const required = match[1].trim().toLowerCase();
    const studentLevel = (profile.educationLevel ?? '').trim().toLowerCase();

    const requiredIndex = levelOrder.findIndex((l) => required.includes(l));
    const studentIndex = levelOrder.findIndex((l) => studentLevel.includes(l));

    if (requiredIndex === -1 || studentIndex === -1) return { passed: true, reason: null }; // can't compare, don't penalize

    if (studentIndex < requiredIndex) {
        return {
            passed: false,
            reason: `Requires ${match[1].trim()} level or above, profile says ${profile.educationLevel}`,
        };
    }
    return { passed: true, reason: null };
}

const HARD_CHECKS = [checkDeadline, checkNationality, checkEducationLevel];

function runHardChecks(listing, profile) {
    const failures = [];
    for (const check of HARD_CHECKS) {
        const result = check(listing, profile);
        if (!result.passed) failures.push(result.reason);
    }
    return { hardRequirementsMet: failures.length === 0, failures };
}

export async function matchListing(listing, profile, generateContentWithRetry) {
    const { hardRequirementsMet, failures } = runHardChecks(listing, profile);

    if (!hardRequirementsMet) {
        return {
            hardRequirementsMet: false,
            eligibilityMatch: 'Not Eligible',
            missingRequirements: failures,
            llmInterpretation: null,
        };
    }

    // Hard requirements pass. Now ask the LLM only about the leftover ambiguous
    // language — this is the part a rule genuinely can't resolve.
    const eligibilityText = listing.eligibility ?? '';
    if (!eligibilityText) {
        return {
            hardRequirementsMet: true,
            eligibilityMatch: 'Eligible',
            missingRequirements: [],
            llmInterpretation: 'No eligibility text available to check beyond hard requirements.',
        };
    }

    const prompt = `A student has this profile: education level = ${profile.educationLevel}, field of study = ${profile.fieldOfStudy}, country = ${profile.country}, needs funding = ${profile.fundingNeeded}, grade = ${profile.gpaOrGrade ?? 'not provided'}.

This scholarship's eligibility text is:
"""
${eligibilityText}
"""

The student already passes every hard, objectively-checkable requirement (nationality, education level, deadline). Your job is ONLY to look at any remaining ambiguous or preference-based criteria in the text above (e.g. "preference given to X", required activities, field-of-study fit) and decide if anything there would likely block or weaken this student's application.

Return ONLY a JSON object with:
- "hasUnresolvedCriteria": true or false
- "missingOrUnclear": an array of short strings describing anything ambiguous that could affect this student (empty array if none)
- "reasoning": one sentence explaining your call`;

    const extraction = await generateContentWithRetry(prompt);
    const rawText = extraction.response.text() ?? '{}';

    let llmResult;
    try {
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        llmResult = JSON.parse(jsonMatch ? jsonMatch[0] : '{}');
    } catch (err) {
        console.log(`Could not parse match interpretation for "${listing.title}": ${err.message}`);
        llmResult = { hasUnresolvedCriteria: false, missingOrUnclear: [], reasoning: 'Interpretation unavailable.' };
    }

    return {
        hardRequirementsMet: true,
        eligibilityMatch: llmResult.hasUnresolvedCriteria ? 'Partial' : 'Eligible',
        missingRequirements: llmResult.missingOrUnclear ?? [],
        llmInterpretation: llmResult.reasoning ?? null,
    };
}
