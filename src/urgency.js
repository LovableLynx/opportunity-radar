// Deadline urgency ranking. Pure function, no API calls, reuses the same
// deadline parsing rules match.js already uses for the hard deadline check,
// so "what counts as a real deadline" is defined in exactly one place.

import { parseDeadline } from './match.js';

const DAY_MS = 1000 * 60 * 60 * 24;

export function urgencyFor(deadlineText, now = new Date()) {
    const deadline = parseDeadline(deadlineText);
    if (!deadline) {
        return { urgency: 'Unknown', daysRemaining: null };
    }

    const daysRemaining = Math.ceil((deadline.getTime() - now.getTime()) / DAY_MS);

    if (daysRemaining < 0) return { urgency: 'Closed', daysRemaining };
    if (daysRemaining <= 14) return { urgency: 'Closing soon', daysRemaining };
    if (daysRemaining <= 90) return { urgency: 'Upcoming', daysRemaining };
    return { urgency: 'Plenty of time', daysRemaining };
}

/**
 * Sorts listings by urgency: closing soon first, then upcoming, then plenty
 * of time, then unknown deadlines last (since we can't rank what we can't
 * parse). Closed listings sort to the very end, they shouldn't be acted on.
 */
export function sortByUrgency(listings) {
    const rank = { 'Closing soon': 0, Upcoming: 1, 'Plenty of time': 2, Unknown: 3, Closed: 4 };

    return [...listings].sort((a, b) => {
        const aRank = rank[a.urgency] ?? 3;
        const bRank = rank[b.urgency] ?? 3;
        if (aRank !== bRank) return aRank - bRank;
        // within the same urgency band, fewer days remaining sorts first
        if (a.daysRemaining != null && b.daysRemaining != null) {
            return a.daysRemaining - b.daysRemaining;
        }
        return 0;
    });
}
