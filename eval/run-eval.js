// Runs the trust-scoring logic (deterministic, no API calls needed) against
// the eval set and reports whether each listing scored the way we expect.
// This only exercises trust.js directly — it does NOT run the full pipeline
// (scraping, matching, LLM relevance filtering), since those need live API
// access. Use this to check the scoring rule itself stays correct as
// weights/thresholds get tuned.
//
// Run with: node eval/run-eval.js

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { scoreListing } from '../src/trust.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const realListings = JSON.parse(readFileSync(join(__dirname, 'real-listings.json'), 'utf-8'));
const syntheticListings = JSON.parse(readFileSync(join(__dirname, 'synthetic-listings.json'), 'utf-8'));

console.log('=== Real listings (expect mostly Low Risk, no false positives) ===\n');

let realPass = 0;
for (const listing of realListings) {
    const result = scoreListing(listing);
    const flagged = result.trustRisk !== 'Low Risk';
    const status = flagged ? '⚠ FLAGGED' : '✔ Low Risk';
    if (!flagged) realPass++;
    console.log(`${status}  ${listing.title}`);
    if (flagged) {
        console.log(`   Risk: ${result.trustRisk} (score ${result.trustScore})`);
        console.log(`   Evidence: ${result.trustEvidence.join('; ')}`);
    }
}
console.log(`\n${realPass}/${realListings.length} real listings correctly scored Low Risk (no false positives on genuine opportunities)\n`);

console.log('=== Real listings with empty search evidence (real-world condition, obscure orgs or a blocked/rate-limited search) ===\n');

// The pass above never exercises the search-based signals at all
// (searchEvidence defaults to null), which is exactly how a real bug
// shipped once: a production run where DuckDuckGo/enrichment came back
// empty for most listings sent 18/20 real, legitimate listings to High
// Risk, and this eval set didn't catch it because it never simulated that
// condition. This pass does: every real listing gets scored again as if
// search found nothing (searchEvidence present but empty), which is exactly
// what happens for a real but obscure/small-web-presence organization, or
// any time search itself is degraded. None of these should reach High
// Risk on missing data alone — only a listing with an actual red-flag
// pattern (payment, urgency, vague language) should.
const emptySearchEvidence = { independentResultsFound: false, secondarySourceFound: false, resultCount: 0 };

let noFalseHighRisk = 0;
for (const listing of realListings) {
    const result = scoreListing(listing, emptySearchEvidence);
    const ok = result.trustRisk !== 'High Risk';
    if (ok) noFalseHighRisk++;
    const status = ok ? '✔' : '✗ FALSE HIGH RISK';
    console.log(`${status}  ${listing.title} — ${result.trustRisk} (score ${result.trustScore}, confidence ${result.trustConfidence})`);
    if (!ok) console.log(`   Evidence: ${result.trustEvidence.join('; ')}`);
}
console.log(`\n${noFalseHighRisk}/${realListings.length} real listings correctly avoided High Risk purely from missing search evidence\n`);

console.log('=== Synthetic listings (expect risk to match documented expectedRisk) ===\n');

let synPass = 0;
for (const listing of syntheticListings) {
    // Synthetic listings that test search-evidence signals need fake evidence
    // passed in, since we're not calling DuckDuckGo/Gemini here.
    const searchEvidence = listing.expectedSignals.includes('noIndependentPresence')
        ? { independentResultsFound: false, secondarySourceFound: false }
        : null;

    const result = scoreListing(listing, searchEvidence);
    const correct = result.trustRisk === listing.expectedRisk;
    if (correct) synPass++;
    const status = correct ? '✔' : '✗';
    console.log(`${status}  ${listing.title}`);
    console.log(`   Expected: ${listing.expectedRisk} | Got: ${result.trustRisk} (score ${result.trustScore})`);
    console.log(`   Evidence: ${result.trustEvidence.join('; ')}`);
    console.log('');
}
console.log(`${synPass}/${syntheticListings.length} synthetic listings scored as expected\n`);

const allPass = realPass === realListings.length && noFalseHighRisk === realListings.length && synPass === syntheticListings.length;
console.log(allPass ? '✅ Eval set passes.' : '❌ Eval set has mismatches — review above.');
process.exit(allPass ? 0 : 1);
