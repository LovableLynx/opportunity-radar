# Opportunity Radar — demo script

Two minutes, four beats. Everything shown here is real output the Actor has
actually produced, not a mockup — see `eval/real-listings.json`,
`eval/synthetic-listings.json`, and the run logs referenced inline.

## Setup before you're on stage

- Have the Apify Console open to the Actor's **Input** tab, ready to hit
  Save & start.
- Pre-fill the input with a Nigerian PhD Computer Science profile (the
  exact one used throughout testing):
  ```json
  {
    "educationLevel": "PhD",
    "fieldOfStudy": "Computer Science",
    "country": "Nigeria",
    "fundingNeeded": true
  }
  ```
- Know today's Gemini quota status before you go on. If it's tight, have a
  **saved dataset from a previous successful run** open in a second tab as
  a fallback, and say so plainly if you switch to it ("here's a run from
  earlier today, since we're rate-limited live right now") — that's an
  honest statement, not a workaround to hide.

## Beat 1 — The pitch (15 seconds)

> "Scholarship sites show you a list and leave you to figure out two
> things yourself: do you actually qualify, and is it even real.
> Opportunity Radar does both automatically."

## Beat 2 — Enter a profile, get real matches (40 seconds)

Click Save & start with the Nigerian PhD profile above. While it runs
(takes a few minutes with full pacing — if time is tight, switch to a
pre-run dataset here and say so), narrate:

> "It's scraping real scholarship listings from PhDportal right now, not a
> canned demo, then checking each one against this profile."

Once results are in, open a genuinely **Eligible** result, e.g.:

```
"$1,500 Annual Video Contest Scholarship"
eligibilityMatch: "Eligible"
llmInterpretation: "The scholarship only requires clear, actionable
social media tasks with no ambiguous preferences or soft evaluation
criteria."
```

> "Every hard fact — deadline, nationality, education level — gets checked
> with plain code first. The LLM only steps in for language a rule can't
> resolve, like this one. That's why we can always say exactly why
> something matched."

## Beat 3 — Show a real rejection, no LLM involved (35 seconds)

Scroll to the **Erasmus+ - Grants for study mobility** result:

```
eligibilityMatch: "Not Eligible"
missingRequirements: ["Requires Austrian nationality, profile says Nigeria"]
llmInterpretation: null
```

> "This one requires Austrian nationality. Our profile is Nigerian. Notice
> the LLM interpretation field is null — the model was never even called
> here, because the hard nationality check already had the answer. That's
> the point: we don't ask an AI to redecide something a plain comparison
> already settled."

## Beat 4 — Catch a scam, labeled honestly (25 seconds)

Switch to the **synthetic test case** (either run it live if quota allows,
or show the pre-recorded eval output — `npm run eval:trust`):

```
"SYNTHETIC TEST CASE: Global Excellence Grant 2026"
trustRisk: "High Risk"
trustEvidence: [
  "Requires upfront payment (matched: \"processing fee\")",
  "Uses urgency-pressure language (\"only 3 slots remaining\")",
  "Eligibility criteria are vague (\"Open to everyone\")"
]
```

> "We labeled this one as a synthetic test case on purpose — we're not
> claiming we caught a live scam, we're showing you the system correctly
> flags known scam patterns when they're present. Three real signals here:
> upfront payment, artificial urgency, vague eligibility. And we're not
> claiming certainty — the label is 'High Risk,' not 'confirmed scam',
> because that's what the evidence actually supports."

## Close — tie to the theme (15 seconds)

> "This whole thing runs as an Apify Actor. That matters for 'Ship and
> Earn Africa' specifically: it's not just a hackathon demo, it's
> publishable to the Apify Store today, so it can keep running and keep
> earning after this weekend ends."

## If a judge pushes back

Answers ready, not improvised:

- **"How do you know your trust score is reliable?"** → point to
  `eval/run-eval.js`: 10 real scholarships, zero false positives; 4
  constructed scam patterns, all caught correctly. `npm run eval:trust`.
- **"Isn't this just keyword search?"** → be honest: DuckDuckGo alone is
  keyword matching, which we proved has real false positives (a made-up
  scholarship name returned generic scam-warning articles). We added an
  LLM relevance-filtering step specifically to fix that — documented in
  the README's search API saga, not hidden.
- **"Why not Google Search API?"** → it's closed to new customers as of
  this year, along with Bing's API and Gemini's own free grounding for new
  accounts. We checked all three, documented why, and built around real
  constraints instead of pretending they don't exist.
- **"What happens after the hackathon?"** → the Actor is real,
  publishable infrastructure on Apify's platform, not a throwaway script.
