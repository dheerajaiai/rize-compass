# Rize Compass

A statistically honest decision-support demo, built independently after the Razorpay
Rize x Replit Buildathon (Sept 19, 2026). **Not a Razorpay product. No real Rize data.** See `PRD.md` for the full spec.

## What's real vs. synthetic

Real, public: Razorpay Rize's program names and structure (Rize for YC, Global Readiness
Program, Founder-Buddy Program, buildathons), the three founder communities (Tech+, D2C+,
Xport+), and the fact that GRP and Founder-Buddy genuinely just launched.

Synthetic: every founder, every city-level and program-level number. Generated with a fixed
seed (1337) so the whole pipeline is reproducible, with six ground-truth effects deliberately
planted (see `PRD.md` → "Planted findings") so the statistics engine has something real to find
and the Validation screen has something real to check.

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
public/
  index.html, app.js, styles.css    Static SPA, hash-routed, reads /data/*.json.
```

Why no LLM: this build ships with zero runtime LLM calls. Every number and every sentence on
every screen comes from plain, unit-tested code. If an LLM were added in a future version, the
discipline would stay the same as the earlier GTM Compass build: it would only ever extract or
phrase (quoting evidence spans verbatim, writing recommendation copy) — never compute a number.

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
