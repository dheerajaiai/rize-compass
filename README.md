# Rize Compass

**Live: https://dheerajaiai.github.io/rize-compass/**

A statistically careful decision-support tool for the question a startup programme's marketing
team keeps facing: *where should we look for our next founders?* Built independently after the
Razorpay Rize x Replit Buildathon (Sept 19, 2026). **Not a Razorpay product. Contains no Rize data.**

## Two halves

**Real public data** (Brief, Founder Map, YC Pipeline, Decisions, Data Integrity). All sources are free:

| Snapshot (`sources/`) | Source |
|---|---|
| DPIIT-recognised startups by state, 2019–2023 | [PIB 2002100](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2002100), Lok Sabha reply, Feb 2024 |
| Cumulative recognitions by state (Jun 2024) | [PIB 2037579](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2037579) |
| Closed (struck-off) recognised startups by state (Nov 2025) | [PIB 2197662](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2197662) |
| Startups with a woman director/partner, by state × year | [PIB 2241313](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2241313) |
| Y Combinator companies with an Indian region | [yc-oss public API](https://yc-oss.github.io/api/companies/all.json) |

`npm run fetch` re-downloads and re-parses them from the government's HTML tables. The build itself
never touches the network. Every parsed table must add up exactly to the total the government
printed, or the build fails (`data/real_checks.json`).

**Method check** (synthetic: Funnel, Programs, Shrinkage Lab, Decisions, Validation). Real data has
no answer key, so a generated founder funnel with six planted findings proves that the engine
recovers what was planted and finds nothing in shuffled labels (`data/validation_result.json`).

**Try it on your data** runs the same `server/stats.js` in the browser on counts by state that you
paste, and shows where you over- or under-index against the national startup base. Nothing is uploaded.

## Architecture

Plain Node.js, no build step, no framework, no runtime LLM call.

```
server/
  stats.js         Wilson intervals, empirical-Bayes shrinkage, min-n rule,
                    Holm-corrected significance testing, cost-per-outcome,
                    signal-lift analysis. Unit tested (server/stats.test.js).
  rng.js            Seeded PRNG (mulberry32) for reproducible synthetic data.
  dimensions.js     Cities, communities, channels, programs — shared config.
  generate.js       Builds data/founders.json with the planted effects baked in.
  decisions.js      Turns founders.json into funnel.json, programs.json,
                    city_community_lab.json, decisions.json — every number via stats.js.
  validate.js       Checks planted findings are recovered, controls stay quiet,
                    and a shuffled-label negative control finds nothing.
                    Writes data/validation_result.json.
  serve.js          Tiny static file server (no Express needed for 6 JSON files).
  real/fetch.js     Snapshots the public sources into sources/ (manual: npm run fetch).
  real/analyze.js   Runs stats.js over sources/ -> data/real.json, data/real_checks.json.
  real/states.js    State/UT names and YC location codes.
public/
  index.html, app.js, ui.js, real.js, yours.js, styles.css
                    Static SPA, hash-routed, reads /data/*.json; yours.js imports
                    /lib/stats.js (the same file as server/stats.js).
```

Why no LLM: this build ships with zero runtime LLM calls. Every number and every decision card
comes from plain, unit-tested code. The 90-day plan on the Brief is hand-written and labelled as
a proposal. If an LLM is ever added, it may only extract or phrase text, never compute a number.

## Running it

```bash
npm test               # 18 unit tests on the statistics engine
npm run build           # generate -> decisions -> validate, writes everything to data/
npm run serve            # http://localhost:5173
```

`npm run build` is idempotent and deterministic — same seed, same output, every time.

## Acceptance criteria (from PRD.md) — status

- ✅ Every rate on screen carries an interval or "insufficient data" (verified down to
  individual small-n slices, e.g. Kochi's Selected/Outcome stages at n=4).
- ✅ GRP and Founder-Buddy never get a confident outcome verdict anywhere in the app — the
  mechanism is real, not hardcoded: nobody selected into either program has reached the
  180-day outcome-maturity mark yet, so measured outcome n=0 for both.
- ✅ Controls (Bengaluru, Pune, Ahmedabad) produce no decision card.
- ✅ "Looks big, converts badly" (Mumbai) and "underinvested segment" (Xport+) both surface
  with evidence and a Holm-corrected two-proportion significance test.
- ✅ Validation page numbers are read live from `data/validation_result.json`, produced by an
  actual run of `validate.js` — never hardcoded in the frontend.
- ✅ Negative control: a shuffled-label run (outcome labels randomly reassigned) produces
  zero false positives across all four tested comparison families.

## Statistical method summary

- **Wilson score interval** on every proportion — stays bounded in [0,1], behaves sanely at
  small n.
- **Minimum-sample rule** (n < 30): forces "insufficient data" instead of a guess.
- **Empirical-Bayes shrinkage**: method-of-moments Beta-Binomial prior, pulls small-sample
  rates toward the grand mean so a lucky n=3 group can't top a leaderboard.
- **Holm-Bonferroni correction**: applied within each family of comparisons (e.g. "each of
  10 cities vs. the rest of the cohort") — stricter than testing each comparison at
  uncorrected α=0.05.
- **Signal-lift analysis**: compares two candidate engagement signals (Genie usage vs. event
  RSVP) as predictors of the same downstream outcome, on the same cohort.

## Deploy

Pushes to `main` trigger `.github/workflows/deploy.yml`, which runs `npm test` and
`npm run build` from scratch and publishes `public/` + `data/` to GitHub Pages. If the
unit tests fail or `validate.js` reports `overallPass: false`, the build exits non-zero
and nothing is deployed.

## License

Built for a buildathon-adjacent personal project. No affiliation with or endorsement by
Razorpay implied.
