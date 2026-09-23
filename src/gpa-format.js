// Composes the Actor's flat gpaFormat + gpaOrGrade input into the single
// gpaOrGrade string the rest of the pipeline (match.js) expects, and
// validates it against the scale actually picked.
//
// The website's frontend/app.js does this same composition client-side (its
// GPA format picker), but the Actor's own input form (Apify Console, direct
// API calls, MCP) is a separate entry point that bypasses the website
// entirely — a real production gap: gpaOrGrade previously had zero
// validation when the Actor was run any way other than through the website.
// This gives the Actor its own, independent version of the same logic so
// that gap is closed regardless of how the Actor is invoked.

const GPA_FORMATS_WITH_NUMBER = ['cgpa4', 'cgpa5', 'percentage'];

// Mirrors frontend/app.js's plausibleGpaNumberError: the scale is already
// known from the format picked, so this only needs to check the number is
// in a sane range for that scale — no ambiguity heuristics needed here,
// unlike a bare free-text number with no stated scale.
function plausibleGpaNumberError(value, max) {
    const trimmed = (value ?? '').trim();
    if (!trimmed) return 'gpaOrGrade is required when a numeric gpaFormat is selected.';
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n <= 0 || n > max) {
        return `gpaOrGrade must be a number between 0 and ${max} for the selected gpaFormat.`;
    }
    return null;
}

const GPA_NUMBER_MAX = { cgpa4: 4.0, cgpa5: 5.0, percentage: 100 };

/**
 * Composes and validates the Actor's gpaFormat + gpaOrGrade input fields.
 * Returns { value, error }: value is the final gpaOrGrade string to use
 * (empty string if the format was left blank/skipped), error is a message
 * if the input doesn't make sense for the format picked (null otherwise).
 *
 * gpaFormat missing/blank/unrecognized: gpaOrGrade is passed through as-is,
 * exactly as before this feature existed — this only changes behavior once
 * a format is actually selected, so any existing direct-API caller that
 * only ever sent a bare gpaOrGrade string keeps working unchanged.
 */
export function composeGpaOrGrade(gpaFormat, gpaOrGrade) {
    const format = (gpaFormat ?? '').trim();
    const rawValue = (gpaOrGrade ?? '').trim();

    if (!format) {
        return { value: rawValue, error: null };
    }

    if (GPA_FORMATS_WITH_NUMBER.includes(format)) {
        const error = plausibleGpaNumberError(rawValue, GPA_NUMBER_MAX[format]);
        if (error) return { value: rawValue, error };
        if (format === 'cgpa4') return { value: `${rawValue}/4.0`, error: null };
        if (format === 'cgpa5') return { value: `${rawValue}/5.0`, error: null };
        return { value: `${rawValue}%`, error: null };
    }

    if (format === 'classification' || format === 'waec' || format === 'other') {
        if (!rawValue) return { value: '', error: 'gpaOrGrade is required when a gpaFormat is selected.' };
        return { value: rawValue, error: null };
    }

    // Unrecognized format value (e.g. a typo in a direct API call): don't
    // guess, don't silently drop it — surface it clearly instead.
    return { value: rawValue, error: `Unrecognized gpaFormat "${format}". Expected one of: cgpa4, cgpa5, percentage, classification, waec, other, or leave it blank.` };
}
