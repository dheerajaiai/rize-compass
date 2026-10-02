# Rize Compass

**Live: https://dheerajaiai.github.io/rize-compass/**

An independent data brief on Razorpay Rize, built after the Razorpay Rize x Replit Buildathon
(Sept 19, 2026). **Not a Razorpay product. Contains no internal Rize data.**

**The main finding:** of the 20 YC companies named on Rize's public alumni wall, 12 are listed in
Y Combinator's directory as US companies and 7 as Indian. The directory records where a company is
now, so "India's share of YC" understates what Rize for YC has produced.

## What's in it

| Screen | What it shows | Data |
|---|---|---|
| Brief | The finding, what I'd ask Rize, a 90-day plan | Rize public pages, YC directory |
| Rize for YC | Each alumnus matched to the YC directory; India's listed share by year | Same |
| Founder Map | Startup recognitions by state, 2019–2023 | DPIIT tables (Parliament replies via PIB) |
| Decisions | Findings labelled by strength of evidence, plus the calls the engine refused to make | All of the above |
| Landscape | Programmes a founder would compare with Rize | Each programme's public pages |
| Try It on Your Data | Paste counts by state; runs `stats.js` in the browser, nothing uploaded | Yours |
| How It's Tested | A made-up funnel with planted answers the engine must recover | Synthetic |
| Data Integrity | Parsed tables vs the totals the government printed | Build checks |

## Sources (all free, snapshotted in `sources/`)

- [Rize for YC page](https://razorpay.com/rize/ycombinator/) (alumni names) and [Rize homepage](https://razorpay.com/rize/)
- [yc-oss public mirror of the YC directory](https://yc-oss.github.io/api/companies/all.json)
- DPIIT state tables from PIB: [recognitions 2019–2023](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2002100),
  [cumulative Jun 2024](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2037579),
  [closures Nov 2025](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2197662)
- `sources/landscape.json`: compiled by hand from programme pages, with a source and a verification note per row

`npm run fetch` re-downloads and re-parses everything except the landscape file. The build never
touches the network.

## How it handles evidence

- Under 30 observations: counts only, no percentage.
- Where sampling is real (YC company counts): rates carry a Wilson 95% interval.
- The DPIIT tables are complete counts, so a statistical test there only screens out noise. Findings
  from them are labelled by what else could explain the gap.
- A difference that can't be separated from a confounder is withheld, with the reason.
- The build fails if a parsed table doesn't match its published total, if an alumnus can't be found
  in the YC directory, or if the synthetic test doesn't recover its planted answers.

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
