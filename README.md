# Opportunity Radar

Opportunity Radar helps students figure out two things scholarship sites
never tell them: **do I actually qualify**, and **is this even real**.

Most scholarship sites just hand you a list and leave you to work out
whether you meet the requirements, or whether the listing itself is
trustworthy. Opportunity Radar checks both, against real, live-scraped
scholarship and grant listings:

- **Eligibility** — deadline, nationality, and education level are checked
  with plain code, not AI guesswork. An AI model only steps in for genuinely
  ambiguous wording (like "preference given to applicants with research
  experience"), and only after the objective checks already pass.
- **Trust** — every listing is checked for common scam patterns (upfront
  payment requests, artificial urgency, vague eligibility) and cross-checked
  against real web search results, so "Low Risk" means no red flags were
  found, not "guaranteed legitimate."

**Live site:** [opportunity-radar-by-edubridge.vercel.app](https://opportunity-radar-by-edubridge.vercel.app)

## How it works

1. A student fills in their profile (education level, field of study,
   country, optional CV) on the web app.
2. Opportunity Radar scrapes real, current scholarship listings matching
   their education level.
3. Each listing is checked against the student's profile for eligibility,
   and separately scored for trust risk.
4. Results come back as a plain digest: what you qualify for, what needs a
   closer look, and what to watch out for.

Under the hood, this is an [Apify Actor](https://apify.com) (a scraping/
automation program hosted on Apify's platform) with a small web frontend on
Vercel that starts a run and shows the results.

## Project structure

- `src/` — the Actor itself: scraping, eligibility matching, trust scoring
- `frontend/` — the web app (static site + two small API routes that talk to
  the Actor)
- `test/` — automated tests for the backend logic (`npm test`)
- `eval/` — a curated set of real and synthetic listings used to check the
  trust-scoring and matching rules stay correct as they're tuned
- `frontend/tests/` — end-to-end tests for the web app (Playwright)

## Running it locally

```bash
npm install
cp .env.example .env   # fill in your own API key, never commit .env
```

You'll need a [Groq](https://console.groq.com) API key, that's the default
AI provider (Gemini and OpenRouter also work, see `.env.example` for how to
switch). Then:

```bash
apify run
```

Results are written to `storage/datasets/default/`.

To run the frontend locally, see `frontend/package.json` (`npm run dev`
inside `frontend/`).

## Running the tests

```bash
npm test              # backend logic (no live API calls, safe to run freely)
npm run eval:trust     # trust-scoring accuracy against known real/synthetic cases
npm run eval:match     # eligibility-matching accuracy against known cases
```

Inside `frontend/`:

```bash
npm test               # end-to-end browser tests (Playwright)
npm run test:api       # API route validation tests
```

## Monetization

Opportunity Radar uses Apify's Pay-Per-Event pricing: one billable event per
listing that's been fully matched and trust-scored. Pricing itself is set in
Apify Console, not in this repo.

## Further reading

Deeper technical write-ups (architecture decisions, what's been tested and
how, background on specific tradeoffs) live in the PDFs in this repo and in
code comments near the relevant logic, rather than in this README.
