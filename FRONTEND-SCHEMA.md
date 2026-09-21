# Input and output schema, for the frontend and UI/UX design

This is the contract between the Actor and whatever calls it. Everything
here is taken directly from the real, running code, not a plan.

## Input (what the form should collect)

Source of truth: `.actor/input_schema.json`

| Field | Type | Required | Notes |
|---|---|---|---|
| `educationLevel` | string, one of `Bachelors`, `Masters`, `PhD` | yes | Dropdown/select in the Apify UI. **Known gap:** the matching logic also supports `High school`, but it's not in this enum yet. If the design wants to include high schoolers, flag it and we'll add it to the schema, it's a one-line change. |
| `fieldOfStudy` | string, free text | yes | e.g. "Computer Science", "Public Health" |
| `country` | string, free text | yes | Used for nationality-based eligibility checks |
| `fundingNeeded` | boolean | no (defaults to `true`) | Checkbox |
| `gpaOrGrade` | string, free text | no | e.g. "3.6/4.0" or "Second Class Upper". Currently collected but not yet used by any matching check, that's a possible future feature, not a bug. |

Example valid input:

```json
{
  "educationLevel": "PhD",
  "fieldOfStudy": "Computer Science",
  "country": "Nigeria",
  "fundingNeeded": true,
  "gpaOrGrade": "3.85"
}
```

## Output (what the results view should render)

The Actor returns an array of listing objects, one per scholarship/grant
found. This is a real example pulled from an actual run, not invented:

```json
{
  "title": "$1,500 Annual Video Contest Scholarship",
  "link": "https://www.phdportal.com/scholarships/8210/1500-annual-video-contest-scholarship.html",
  "deadline": "31 Oct 2026",
  "description": "Record an original video on one of the following topics...",
  "eligibility": null,
  "hardRequirementsMet": true,
  "eligibilityMatch": "Eligible",
  "missingRequirements": [],
  "llmInterpretation": "No eligibility text available to check beyond hard requirements.",
  "trustRisk": "Low Risk",
  "trustScore": 1,
  "trustEvidence": ["No eligibility criteria stated at all"]
}
```

### Field meanings, for design purposes

- **`eligibilityMatch`** is one of three values: `"Eligible"`, `"Partial"`,
  `"Not Eligible"`. This is probably the single most important thing to
  make visually obvious, a colored badge or similar.
- **`missingRequirements`** is an array of short strings explaining what's
  wrong or unclear. Empty array if there's nothing missing. Show this as a
  list under the eligibility badge when it's non-empty.
- **`llmInterpretation`** is a one-line explanation of the eligibility
  reasoning. Can be `null` when the listing was rejected on a hard
  requirement before the LLM was ever called, that's not a bug or missing
  data, it's the point (see the README's phase 2 notes on why).
- **`trustRisk`** is one of `"Low Risk"`, `"Some Concerns"`, `"High Risk"`.
  This needs its own distinct visual treatment from `eligibilityMatch`,
  they're answering two different questions ("do I qualify" vs "can I
  trust this") and shouldn't be visually merged into one badge.
- **`trustEvidence`** is an array of short strings explaining the trust
  score. Always show at least one item, even for Low Risk (it'll say
  something like "No risk signals detected based on available evidence",
  never claim "verified" or "confirmed legitimate", the wording is
  deliberately hedged and the UI copy should match that tone rather than
  overstate certainty).
- **`deadline`** is a string, not always a clean date, it can be
  "Not specified" or "Anytime" as scraped from the source site. Don't
  assume it always parses as a real date.
- **`urgency`** is one of `"Closing soon"` (within 14 days), `"Upcoming"`
  (15-90 days), `"Plenty of time"` (90+ days), `"Closed"` (deadline passed),
  or `"Unknown"` (deadline couldn't be parsed, e.g. "Not specified").
  `daysRemaining` is the number backing it, or `null` for Unknown. Good for
  sorting the list or a small badge, "Unknown" and "Closed" listings
  probably shouldn't sort to the top regardless of anything else.
- **`description`** can be a few paragraphs long. Needs truncation or a
  "read more" pattern in the results view, not a fixed-height card that
  clips it silently.

## Digest (optional summary)

The Actor also saves a plain-English summary to its key-value store under
the key `DIGEST`, something like:

```json
{
  "summary": "Found 20 opportunities. 9 you're eligible for. 10 need a closer look, something about them is unclear. 1 you don't qualify for right now.",
  "counts": { "total": 20, "eligible": 9, "partial": 10, "notEligible": 1, "highRisk": 0, "someConcerns": 0 }
}
```

Good for a headline summary at the top of the results page, before the
per-listing list.

## How to call it

The Actor is deployed at `lovablelynx/opportunity-radar` on Apify. Calling
it from a frontend means using the Apify API with your own Apify API token,
something like:

```
POST https://api.apify.com/v2/acts/lovablelynx~opportunity-radar/run-sync-get-dataset-items?token=YOUR_TOKEN
Body: { "educationLevel": "PhD", "fieldOfStudy": "...", "country": "...", "fundingNeeded": true }
```

Heads up on timing: a full run currently takes several minutes (scraping +
enrichment + matching + trust scoring, each step pacing its own API calls).
The frontend needs a loading state that accounts for this, not something
built for an instant response.
