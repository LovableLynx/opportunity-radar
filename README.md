# Opportunity Radar

Built for the She Code Africa x Apify BuildHER Hackathon 2026 (theme: Ship and
Earn Africa).

Most scholarship sites just list opportunities and leave you to figure out
whether you actually qualify, and whether the listing is even real. Opportunity
Radar is an Apify Actor that does both: it checks a student's profile against
real scholarship/grant/admission listings and tells them what they're eligible
for and what's missing, and it separately checks each listing for scam red
flags using real evidence (not just a vibe).

The full phase-by-phase build plan — including why the eligibility and trust
logic are split the way they are — is in `Opportunity-Radar-Build-Plan.pdf`
one folder up. Worth reading before touching Phase 2/3 code.

## Setup

```bash
npm install
cp .env.example .env   # fill in your own keys, never commit .env
```

You'll need your own Gemini API key (Google AI Studio) and, later, Google
Custom Search credentials (API key + Search Engine ID) for phase 3 — ask in
the group if you don't have these yet.

Heads up on the Gemini free tier: it's capped at 5 requests/minute AND 20
requests/day per key. Our pipeline paces calls at least 13 seconds apart to
respect the per-minute limit, but the daily cap is real and does the math for
you whether you like it or not — one run costs roughly `1 + ENRICH_LIMIT +
(number of listings matched)` calls, so a full 20-listing run with
`ENRICH_LIMIT=20` needs ~41 calls, which cannot fit in a single day on this
tier no matter how you space them out. `ENRICH_LIMIT` in `src/scrape.js` is
set to 5 for this reason — comfortably fits one full run per key per day. Set
`OPPORTUNITY_RADAR_TEST_MODE=1` as an env var to cap runs to 3 listings
total for even cheaper iteration while testing logic changes.

## Running it locally

```bash
apify run
```

Output shows up in `storage/datasets/default/` as one JSON file per scraped
listing.

## Running the tests

```bash
npm test
```

These are unit tests for the deterministic matching logic in `src/match.js`
(deadline, nationality, education level checks) — they never call Gemini, so
you can run them freely without touching API quota. Useful for verifying
logic changes before spending a real API call to confirm end to end.

## Where things stand

- [x] Phase 0 — project scaffold
- [x] Phase 1 — scraping PhDportal via Apify's Website Content Crawler
      (needed to get past its bot detection) + Gemini extraction, including
      following each listing's detail page for real eligibility text
- [x] Phase 2 — eligibility matching: deterministic checks (deadline,
      nationality, education level) verified with local unit tests, and
      confirmed end to end against a real Gemini call — a real Nigerian
      profile correctly got rejected from an Austrian-only scholarship with
      no LLM call needed, and passed listings got sensible LLM reasoning
      text back. Also confirmed the matching step holds at full scale (all
      20 scraped listings), not just on a small test batch.
- [x] Phase 3 (scoring rule only) — trust-scoring weights/thresholds written
      and unit tested (`src/trust.js`, 15 tests passing); the Google Custom
      Search integration that feeds it real evidence isn't wired in yet
- [ ] Phase 4 — second source (Opportunity Desk) + frontend, stretch goals
- [ ] Phase 5 — eval set (real + adversarial listings) and demo script

We're building and testing one phase at a time — don't start the next one
until the current one actually runs and the output looks right.

## Who's doing what

- **Oluwadarasimi** — Actor/backend: scraping, matching logic, trust scoring,
  and QA (testing each phase before we move on)
- **Partner** — frontend: the input form + results view for Phase 4, calling
  the Actor through the Apify API
