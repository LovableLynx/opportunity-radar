# Opportunity Radar

Most scholarship sites just hand you a list and leave you to figure out two
things on your own: do you actually qualify, and is the listing even real.
Opportunity Radar checks both, against real, live-scraped scholarship and
grant listings.

Most scholarship-related Actors on the Apify Store stop at scraping — they
return a list, sometimes with a raw `eligibility` text field lifted straight
from the page, and leave the actual matching and trust judgment to you.
Opportunity Radar does that work itself: every listing gets checked against
your specific profile and scored for scam risk, with evidence behind both
verdicts, not just a badge.

- **Eligibility.** Deadline, nationality, and education level are checked
  with plain code, not AI guesswork. An AI model only gets involved for
  genuinely ambiguous wording, like "preference given to applicants with
  research experience," and only after the objective checks already pass.
- **Trust.** Every listing is checked for common scam patterns (upfront
  payment requests, artificial urgency, vague eligibility) and cross-checked
  against real web search results. "Low Risk" means no red flags were
  found, not "guaranteed legitimate."

**Live site:** [opportunity-radar-by-edubridge.vercel.app](https://opportunity-radar-by-edubridge.vercel.app)

## How it works

1. A student fills in their profile on the web app: education level, field
   of study, country, and an optional CV.
2. Opportunity Radar scrapes real, current scholarship listings that match
   their education level.
3. Each listing gets checked against the student's profile for eligibility,
   then separately scored for trust risk.
4. Results come back as a plain digest: what you qualify for, what needs a
   closer look, and what to watch out for.

Under the hood, this is an [Apify Actor](https://apify.com), a scraping and
automation program hosted on Apify's platform, paired with a small web
frontend on Vercel that starts a run and shows the results.

## Input

| Field | Required | Example |
| --- | --- | --- |
| `educationLevel` | yes | `Bachelors` (one of High school, Bachelors, Masters, PhD) |
| `fieldOfStudy` | yes | `Computer Science` |
| `country` | yes | `Nigeria` |
| `fundingNeeded` | no | `true` |
| `gpaFormat` + `gpaOrGrade` | no | Pick a scale (`cgpa4`, `cgpa5`, `percentage`, `classification`, `waec`, `other`) so the value below is read correctly instead of guessed |
| `cvFile` | no | Upload a CV as PDF (max 5MB) — text is extracted automatically |
| `cvText` | no | Plain text of your CV, used if no PDF is uploaded |

## Output

One record per listing. The fields that matter most:

- `title`, `link`, `deadline`, `urgency`: what the opportunity is and how
  soon it closes.
- `eligibilityMatch`: `Eligible`, `Partial`, or `Not Eligible`, with
  `missingRequirements` and `actionSteps` explaining why and what to do.
- `trustRisk`: `Low Risk`, `Some Concerns`, or `High Risk`, with
  `trustEvidence` listing the actual reasons and `trustConfidence` saying how
  much evidence the verdict rests on.

## Project structure

- `src/` holds the Actor itself: scraping, eligibility matching, trust
  scoring.
- `frontend/` holds the web app, a static site plus two small API routes
  that talk to the Actor.
- `test/` has automated tests for the backend logic. Run with `npm test`.
- `eval/` has a curated set of real and synthetic listings, used to check
  the trust-scoring and matching rules stay correct as they get tuned.
- `frontend/tests/` has end-to-end tests for the web app, written with
  Playwright.

## Running it locally

```bash
npm install
cp .env.example .env   # fill in your own API key, never commit .env
```

You'll need a [Groq](https://console.groq.com) API key, since that's the
default AI provider. Gemini and OpenRouter also work; see `.env.example`
for how to switch. You'll also need the Apify CLI (`npm install -g
apify-cli`). Then:

```bash
apify run
```

Results are written to `storage/datasets/default/`.

To run the web app locally, run `npm run dev` inside `frontend/`. That uses
the Vercel CLI and needs an `APIFY_API_TOKEN` so it can start real Actor
runs. To just look at the interface without a token, click "See a live
example" on the landing page, which loads saved sample results.

## Running the tests

```bash
npm test              # backend logic, no live API calls, safe to run freely
npm run eval:trust     # trust-scoring accuracy against known real/synthetic cases
npm run eval:match     # eligibility-matching accuracy against known cases
```

Inside `frontend/`:

```bash
npm test               # end-to-end browser tests (Playwright)
npm run test:api       # API route validation tests
```

## Monetization

Opportunity Radar uses Apify's Pay-Per-Event pricing, one billable event per
listing that's been fully matched and trust-scored. The price itself is set
in Apify Console, not in this repo.

Other scholarship Actors on the Store charge per scraped result, typically
$0.35–$6.00 per 1,000 listings, for raw data with no eligibility or trust
logic applied. Charging per fully-analyzed listing instead reflects that
what's being billed is a matching and trust verdict, not a scrape.

## Team

| Name | Role |
| --- | --- |
| Oluwadarasimi (LovableLynx) | Project lead, backend, QA / test automation |
| Peace | Frontend |
| Temilade | Design |

## Further reading

The deeper technical write-ups, architecture decisions, what's been tested
and how, background on specific tradeoffs, live in the PDFs in this repo
and in code comments near the relevant logic, rather than in this README.
