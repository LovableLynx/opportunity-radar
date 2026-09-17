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

You'll need your own Anthropic API key and Google Custom Search credentials
(API key + Search Engine ID) once we get to Phase 2/3 — ask in the group if
you don't have these yet.

## Running it locally

```bash
apify run
```

Output shows up in `storage/datasets/default/` as one JSON file per scraped
listing.

## Where things stand

- [x] Phase 0 — project scaffold
- [ ] Phase 1 — single scraper (PhDportal), raw output only
  - Heads up: the CSS selectors in `src/main.js` are placeholders, not
    verified against the real page yet. First job here is running it,
    seeing what actually comes back, and fixing them.
- [ ] Phase 2 — eligibility matching (deterministic checks + LLM for the
      ambiguous stuff)
- [ ] Phase 3 — trust/risk scoring, backed by Google Custom Search evidence
- [ ] Phase 4 — second source (Opportunity Desk) + frontend, stretch goals
- [ ] Phase 5 — eval set (real + adversarial listings) and demo script

We're building and testing one phase at a time — don't start the next one
until the current one actually runs and the output looks right.

## Who's doing what

- **Oluwadarasimi** — Actor/backend: scraping, matching logic, trust scoring,
  and QA (testing each phase before we move on)
- **Partner** — frontend: the input form + results view for Phase 4, calling
  the Actor through the Apify API
