// Runs eligibility matching against a set of test cases. Cases whose hard
// requirements fail are fully deterministic — no API call happens, matching
// how the real pipeline behaves. Cases that pass hard requirements and need
// LLM interpretation use a stubbed response instead of a live Gemini call,
// so this runs free and fast while still verifying our code correctly turns
// an LLM judgment into the right eligibilityMatch value.
//
// This does NOT test whether Gemini's real judgment calls are good — that
// needs a live run (confirmed separately; see notes in match-cases.json for
// which stubs are verbatim real responses vs. constructed ones). It tests
// that our code handles whatever the LLM says correctly.
//
// Run with: node eval/run-match-eval.js

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { matchListing } from '../src/match.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(readFileSync(join(__dirname, 'match-cases.json'), 'utf-8'));

function stubGenerateContent(stubResponse) {
    return async () => ({
        response: { text: () => JSON.stringify(stubResponse) },
    });
}

let passed = 0;

for (const testCase of cases) {
    const generateContentWithRetry = testCase.stubLlmResponse
        ? stubGenerateContent(testCase.stubLlmResponse)
        : async () => { throw new Error('LLM should not have been called for this case'); };

    const result = await matchListing(testCase.listing, testCase.profile, generateContentWithRetry);

    const checks = [];
    for (const [key, expectedValue] of Object.entries(testCase.expected)) {
        if (key === 'reasonContains') {
            const found = (result.missingRequirements ?? []).some((r) => r.includes(expectedValue));
            checks.push({ key, ok: found, got: result.missingRequirements });
        } else {
            checks.push({ key, ok: result[key] === expectedValue, got: result[key] });
        }
    }

    const allOk = checks.every((c) => c.ok);
    if (allOk) passed++;

    console.log(`${allOk ? '✔' : '✗'}  ${testCase.label}`);
    if (!allOk) {
        for (const c of checks.filter((c) => !c.ok)) {
            console.log(`   ${c.key}: expected match, got ${JSON.stringify(c.got)}`);
        }
    }
}

console.log(`\n${passed}/${cases.length} match cases passed`);
process.exit(passed === cases.length ? 0 : 1);
