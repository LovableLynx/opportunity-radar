# Opportunity Radar

**[Try it live](https://opportunity-radar-by-edubridge.vercel.app)** ·
**[Source](https://github.com/LovableLynx/opportunity-radar)** ·
Built for the She Code Africa × Apify BuildHER Hackathon

Most scholarship sites just hand you a list and leave you to figure out two
things on your own: do you actually qualify, and is the listing even real.
Opportunity Radar checks both, against real, live-scraped scholarship and
grant listings.

Most scholarship-related Actors on the Apify Store stop at scraping: they
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

The Actor is the entire brain of this product: scraping, eligibility
matching, and trust scoring all happen inside it. The website does not
duplicate or replace any of that logic, it only validates form input before
starting a run, then polls Apify for status and renders whatever the Actor
already computed. Remove the frontend entirely and the Actor still does
everything that matters; it can be run directly from Apify Console or the
API with the same input shape described below.

## Input

| Field | Required | Example |
| --- | --- | --- |
| `groqApiKey` | yes | Free at [console.groq.com/keys](https://console.groq.com/keys). Bring-your-own-key: your AI matching and trust-scoring runs on your own account, not the operator's, so nothing is billed to you beyond your own Groq usage. Not needed with `maintenanceRun`. |
| `educationLevel` | yes | `Bachelors` (one of High school, Bachelors, Masters, PhD) |
| `fieldOfStudy` | yes | `Computer Science` |
| `country` | yes | `Nigeria` |
| `fundingNeeded` | no | `true` |
| `gpaFormat` + `gpaOrGrade` | no | Pick a scale (`cgpa4`, `cgpa5`, `percentage`, `classification`, `waec`, `other`) so the value below is read correctly instead of guessed |
| `cvFile` | no | Upload a CV as PDF (max 5MB), text is extracted automatically |
| `cvText` | no | Plain text of your CV, used if no PDF is uploaded |

## Known Apify Console limitations

Two things worth knowing if you're testing the Actor directly in Apify
Console rather than through the website, both genuine platform constraints,
not gaps in this Actor's own logic:

- **No autocomplete/suggestions on `fieldOfStudy`.** The website's form
  suggests real field names as you type (catching a typo like "Business
  Administartion" before it's submitted); Console's auto-generated Input
  form has no equivalent for a plain text field, so it stays free text
  there. The Actor itself still checks the input isn't obvious gibberish
  (too short or no vowels at all) before starting a real, billed run.
- **`cvFile`'s upload dialog can't be restricted to PDF only.** Apify's
  `fileupload` input editor has no schema-level file-type restriction; any
  file can be selected in Console's upload box regardless of what a field's
  title says. This Actor checks the real file signature (the literal
  `%PDF-` bytes a genuine PDF always starts with, not the filename or
  extension) before trusting it, so a non-PDF upload is safely rejected
  with a clear error rather than silently misread.

## Output

One record per listing. Full field definitions live in
`.actor/output_schema.json`, which also defines the table view Apify Console
renders on the run's Output tab. The fields that matter most:

- `title`, `link`, `deadline`, `urgency`: what the opportunity is and how
  soon it closes.
- `eligibilityMatch`: `Eligible`, `Partial`, or `Not Eligible`, with
  `missingRequirements` and `actionSteps` explaining why and what to do.
- `trustRisk`: `Low Risk`, `Some Concerns`, or `High Risk`, with
  `trustEvidence` listing the actual reasons and `trustConfidence` saying how
  much evidence the verdict rests on.

## Technologies and tools used

- **[Apify](https://apify.com)**: the Actor itself, plus its `apify/website-content-crawler`
  Actor called directly from this Actor's own code for the actual page
  fetches, residential proxy, key-value store, and Pay-Per-Event billing.
- **[Groq](https://groq.com)**: the AI provider for eligibility interpretation
  and trust-scoring reasoning, bring-your-own-key (see Input above); Gemini
  and OpenRouter are supported operator-side alternatives.
- **Node.js** (Apify SDK, `@google/generative-ai`, `pdfjs-dist` for server-side
  CV extraction): the Actor's own runtime.
- **Vercel**: hosts the static frontend and its two serverless API routes
  (start a run, poll its status).
- **Plain HTML/CSS/JS**: the frontend, no framework.
- **Node's built-in test runner** (`node --test`) and **Playwright**: backend
  unit tests and frontend end-to-end tests, respectively.

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
```

A real run needs a [Groq](https://console.groq.com/keys) API key, since
that's the default AI provider (bring-your-own-key, see Input above). Pass
it in `storage/key_value_stores/default/INPUT.json` alongside the rest of
your test profile, or set `GROQ_API_KEY` in `.env` for a quick
`maintenanceRun` (that path is the operator/env-var one, not the
student-facing one). Gemini and OpenRouter also work as the underlying
provider; see `.env.example` for how to switch (an operator-side setting,
`LLM_PROVIDER`, not something a student picks). You'll also need the Apify
CLI (`npm install -g apify-cli`). Then:

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

## Sustainability & future potential

This isn't a one-shot script; the architecture is built to keep getting
better and to grow without a rewrite.

- **It already learns.** Every run that finds a repeating suspicious phrase
  across multiple listings (`cross-listing-patterns.js`) saves it to the
  Actor's key-value store (`learned-patterns.js`), and every future run
  checks new listings against that growing list on top of the fixed
  starting patterns. The trust-scoring model gets sharper with use, without
  anyone retraining anything.
- **Adding a new scholarship source is one object, not a rewrite.**
  `SOURCES` in `src/scrape.js` is a plain map of name, start URL, and
  description; extraction from a scraped page is LLM-driven, not brittle
  CSS selectors tied to one site's markup, so a new source (another
  country's listings, a new provider) is a small, low-risk addition, not a
  new scraper to build from scratch.
- **More education levels and regions are a config change.** The same
  pattern that already splits PhD/Masters/Bachelors listings by source
  (`sourceKeysForEducationLevel`) extends the same way to new
  countries or education systems.
- **A scheduled maintenance mode already exists.** `maintenanceRun` input
  scrapes every source on a schedule with no student attached and no
  billing, catching a source going down before a real student's run would.
  This is the seed of a properly cached, always-warm version of the product.
- **Open source.** The full source lives at
  [github.com/LovableLynx/opportunity-radar](https://github.com/LovableLynx/opportunity-radar),
  so the matching and trust-scoring logic can be reviewed, adapted, or
  built on by anyone, not locked inside a black-box Actor.

## Team

| Name | Role |
| --- | --- |
| Oluwadarasimi (LovableLynx) | Project lead, backend, QA / test automation |
| Peace | Frontend |
| Temilade | Design |

## Further reading

Deeper write-ups live at the repo root rather than in this README:

- `Opportunity-Radar-One-Pager.pdf`, the elevator pitch
- `Opportunity-Radar-Build-Plan.pdf`, architecture and technical decisions
- `Opportunity-Radar-PRD-Monetization-Addendum.pdf`, the PPE pricing rationale
- `Opportunity-Radar-Status-Update.pdf` / `Opportunity-Radar-Team-Brief.pdf`,
  project status and team notes

Specific tradeoffs (why a check works the way it does, a bug that shaped a
fix) are documented as comments next to the relevant code, not repeated here.
