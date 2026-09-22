# Opportunity Radar

Built for the She Code Africa x Apify BuildHER Hackathon 2026 (theme: Ship and
Earn Africa).

Most scholarship sites just list opportunities and leave you to figure out
whether you actually qualify, and whether the listing is even real. Opportunity
Radar is an Apify Actor that does both. It checks a student's profile against
real scholarship, grant and admission listings and tells them what they're
eligible for and what's missing, and it separately checks each listing for
scam red flags using real evidence, not just a vibe.

**Live site:** [opportunity-radar-by-edubridge.vercel.app](https://opportunity-radar-by-edubridge.vercel.app)

## Monetization (Pay-Per-Event)

The Actor charges one `listing-processed` event per listing that's been fully
matched against the profile *and* trust-scored. That pairing is the whole
point of this Actor, so it's what gets billed, not just scraping. Compare
mode (`compareListingA`/`compareListingB`) does no scraping or scoring and
never charges anything.

The event name is wired into `src/main.js` via `Actor.charge()`. The actual
USD price per event is set separately in Apify Console under the Actor's
Monetization settings, not in this repo.

Three PDFs live in this repo, each for a different purpose:

- `Opportunity-Radar-Status-Update.pdf`, **start here.** Where the build
  actually stands right now, what's confirmed working vs. still untested.
- `Opportunity-Radar-Build-Plan.pdf`, the original phase-by-phase plan,
  including why the eligibility and trust logic are split the way they are.
  Worth reading before touching Phase 2/3 code.
- `Opportunity-Radar-Team-Brief.pdf`, the original team/role brief.

## Setup

```bash
npm install
cp .env.example .env   # fill in your own keys, never commit .env
```

You'll need your own Groq API key (console.groq.com), that's the default
provider. Ask in the group if you don't have one yet. Trust scoring's
web-search evidence doesn't need any credentials at all (see below).

Groq was made the default after two earlier providers both broke a live run.
Gemini's free tier is capped at 5 requests per minute and 20 requests per day
per key, too small to survive a real run once search-evidence relevance
filtering and matching are both drawing from it, one run costs roughly
`1 + ENRICH_LIMIT + (number of listings matched)` calls, so a full
20-listing run needs around 41, which can't fit in a single day on that tier
no matter how you space them out. OpenRouter's free tier is a single
50-requests/day cap shared across every free model on the account, and it
ran out mid-run in production once, crashing the Actor before
`src/match.js` was hardened to degrade instead of crash on a failed LLM
call. Groq's free tier is rate-limited per-model per-minute instead of one
shared daily cap, and has held up across full runs so far.

If you want to use Gemini or OpenRouter instead, see `.env.example`, set
`LLM_PROVIDER=gemini` plus `GOOGLE_API_KEY`, or `LLM_PROVIDER=openrouter`
plus `OPENROUTER_API_KEY`. `ENRICH_LIMIT` in `src/scrape.js` is set to 5
specifically for Gemini's daily cap, comfortably fits one full run per key
per day on that tier. Set `OPPORTUNITY_RADAR_TEST_MODE=1` as an env var to
cap runs to 3 listings total for even cheaper iteration while testing logic
changes, regardless of provider.

Prefer Groq over OpenRouter if you have a choice. OpenRouter's free tier is
a single 50-requests/day cap shared across every free model on the account,
and it ran out mid-run in production once, which crashed the Actor before
`src/match.js` was hardened to degrade instead of crash on a failed LLM
call. Groq's free tier is rate-limited per-model per-minute instead of one
shared daily cap, and holds up better across a full run.

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

132 tests across the `test/` directory, covering matching, trust scoring,
search evidence parsing, digest, urgency, cross-listing pattern detection,
learned patterns, CV evidence, action steps, compare mode, and the
OpenRouter/Groq provider wrappers. None of them call a real API, so run them
freely without touching quota. Useful for
verifying logic changes before spending a real call to confirm end to end.

## Where things stand

- [x] Phase 0, project scaffold
- [x] Phase 1, scraping via Apify's Website Content Crawler (needed to get
      past bot detection on these sites) plus LLM extraction, including
      following each listing's detail page for real eligibility text. Picks
      the right studyportals.com site for the student's own education level
      (Bachelorsportal, Mastersportal, or PhDportal) instead of always
      scraping PhD listings regardless of who's asking, added after
      noticing Bachelors/Masters profiles were being matched against an
      entirely PhD-only pool. Bachelorsportal/Mastersportal not yet
      confirmed against a real live run, same caveat as Opportunity Desk
      below.
- [x] Phase 2, eligibility matching: deterministic checks (deadline,
      nationality, education level) verified with local unit tests, and
      confirmed end to end against a real Gemini call. A real Nigerian
      profile correctly got rejected from an Austrian-only scholarship with
      no LLM call needed, and passed listings got sensible LLM reasoning
      text back. Also confirmed the matching step holds at full scale (all
      20 scraped listings), not just on a small test batch.
- [x] Phase 3, trust-scoring weights and thresholds written and unit tested
      (`src/trust.js`), plus a real search-evidence integration
      (`src/search.js`) wired into the pipeline. See "The trust scoring
      search API saga" below for why this isn't Google Custom Search, which
      was the original plan.
- [x] Phase 4 (second source only, frontend still to do), Opportunity Desk
      wired in as a second scraping source, code done and unit tested
      (`test/scrape.test.js`), but off by default (`ENABLE_OPPORTUNITY_DESK=1`
      to turn it on). Unlike PhDportal, it's never been confirmed working
      against our live pipeline, and it's Cloudflare-protected, so treat it
      as untested until run for real.
- [x] Phase 5 (eval set only, demo script still to do), trust scoring:
      `npm run eval:trust`, 10 real scholarships (Fulbright, Erasmus+, etc.)
      plus 4 labeled synthetic adversarial cases, 14/14 passing. Eligibility
      matching: `npm run eval:match`, 7 cases covering hard-requirement
      rejections, empty-eligibility-text handling, and stubbed
      LLM-interpretation responses, 7/7 passing.

We're building and testing one phase at a time, and we don't start the next
one until the current one actually runs and the output looks right.

## The eval set (`eval/`)

`eval/real-listings.json` holds 10 real scholarships pulled from an actual
PhDportal scrape (not invented), each with a short `expectedNote` explaining
why it's a useful test case (hard nationality restriction, missing
eligibility text, non-date deadline text, and so on).

`eval/synthetic-listings.json` holds 4 constructed test cases, each clearly
titled `SYNTHETIC TEST CASE:` so they're never mistaken for something
actually discovered live. They isolate specific things: all three
text-pattern red flags at once, a deliberately clean listing (checks for
false positives), a single weak signal alone (checks the Some-Concerns
threshold doesn't over-trigger), and one that only the search-evidence
signals should catch.

`eval/run-eval.js` (`npm run eval:trust`) runs `scoreListing` from
`src/trust.js` against all 14 and reports pass/fail against the documented
expectations. This only exercises the deterministic trust-scoring logic, not
the full pipeline (scraping, LLM matching, relevance filtering), since those
need live API access to test. That's exactly why this eval set is useful on
its own: it verifies the scoring rule stays correct without touching Gemini's
quota.

`eval/match-cases.json` and `eval/run-match-eval.js` (`npm run eval:match`)
do the same for eligibility matching. Cases where hard requirements fail run
fully deterministically, same as the real pipeline (the LLM genuinely isn't
called, one case is a fixture of an actual confirmed run from 2026-09-19
where `llmInterpretation` came back `null`). Cases that need LLM
interpretation use a stubbed response instead of a live call, some of them
verbatim real responses Gemini returned during testing, so this checks that
our code correctly turns an LLM judgment into the right `eligibilityMatch`
value without needing to spend a real call on every eval run. 7/7 currently
pass.

## The trust-scoring search API saga

Worth reading if you're touching `src/search.js`, since the current approach
isn't the one in the original build plan and the reasons matter.

The plan called for Google Custom Search JSON API. Turns out it's now closed
to new customers entirely, Google stopped accepting new sign-ups for it.
Bing's Search API is fully retired as of mid-2025. Gemini's own free
Google Search grounding only works on `gemini-2.5-flash` and
`gemini-2.5-flash-lite`, and both of those are also closed to new users,
confirmed directly against our own key with a real 404 ("no longer available
to new users").

What's actually wired in now: `src/search.js` queries DuckDuckGo's `lite`
HTML endpoint directly, no key, no signup, no card. It works, but it's a
soft target. DuckDuckGo's ToS discourages non-personal automated access,
and a plain `fetch` call got tagged as bot traffic (`cc=botnet` in their own
tracking pixel) during testing, though it still returned valid results. If
this gets flaggier under real hackathon-day load, the fallback plan is
routing the same request through Apify's Website Content Crawler (the same
tool phase 1 uses to get past PhDportal's blocking), since that already has
working anti-detection infrastructure.

One more thing worth knowing: DuckDuckGo does keyword matching, not
relevance-to-a-specific-listing matching. Searching for a completely made-up
fake scholarship name still returned 10 results, generic "how to spot
scholarship scams" articles that matched on keywords, not anything about the
fake listing specifically. `independentResultsFound` and `secondarySourceFound`
are honest about *domains found*, not proof that those domains are actually
about the listing in question. Worth being upfront about this limitation if
it comes up in the demo, it's a real gap, not a solved problem.

### The Claude alternative (`src/search-claude.js`)

Claude's API has its own web_search tool ($10 per 1,000 searches), and it
isn't gated behind a "new users" restriction the way Gemini's grounding or
Google Custom Search are. It's also a real upgrade over DuckDuckGo's raw
keyword matching, since Claude reasons over the search results before
answering rather than us guessing relevance from bare domain names, closer
to what we originally wanted from search grounding.

It's written, unit tested (7 tests, `test/search-claude.test.js`, client
mocked throughout), and matches `search.js`'s exact interface, so swapping
`main.js`'s import from `./search.js` to `./search-claude.js` is the whole
migration. Not yet confirmed against a real key end to end; needs an
`ANTHROPIC_API_KEY` with billing enabled to test. If it works cleanly, it's
probably the better long-term choice over DuckDuckGo scraping.

## Who's doing what

- **Oluwadarasimi**, Actor/backend: scraping, matching logic, trust scoring,
  and QA (testing each phase before we move on)
- **Temilade**, UX/UI: designs the input form and results view (mockups and
  wireframes) that the frontend is built from
- **Frontend partner**, builds the designed UI in code, calling the Actor
  through the Apify API
