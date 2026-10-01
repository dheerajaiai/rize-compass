// stats.js — plain, unit-tested statistics. No LLM touches a number in this file or
// anywhere downstream of it. Every exported function either returns an interval,
// a labeled "insufficient data" result, or a p-value — never a bare point estimate
// presented as fact.

export const MIN_N = 30; // minimum sample size before we'll state a rate at all
export const Z_95 = 1.959963984540054; // two-sided 95% z-score

/**
 * Wilson score interval for a binomial proportion. Preferred over the naive
 * normal-approximation interval because it stays inside [0,1] and behaves
 * sanely at small n and extreme proportions (p near 0 or 1).
 * @param {number} successes
 * @param {number} n
 * @param {number} z
 * @returns {{rate:number, low:number, high:number, n:number, successes:number, insufficientData:boolean}}
 */
export function wilsonInterval(successes, n, z = Z_95) {
  if (n <= 0) {
    return { rate: null, low: null, high: null, n, successes, insufficientData: true };
  }
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  const low = (center - margin) / denom;
  const high = (center + margin) / denom;
  return {
    rate: p,
    low: Math.max(0, low),
    high: Math.min(1, high),
    n,
    successes,
    insufficientData: n < MIN_N,
  };
}

/**
 * Wraps wilsonInterval but enforces the minimum-sample rule: below MIN_N,
 * the caller gets insufficientData:true and should render "insufficient data"
 * instead of any number. The interval is still computed (so validation/debug
 * tooling can inspect it) but UI code must check insufficientData first.
 */
export function rateWithMinN(successes, n, minN = MIN_N) {
  const result = wilsonInterval(successes, n);
  result.insufficientData = n < minN;
  return result;
}

/**
 * Empirical-Bayes shrinkage of per-group rates toward a grand mean, using the
 * method-of-moments Beta-Binomial estimator. Groups with small n get pulled
 * hard toward the grand mean; groups with large n barely move. This is what
 * stops a 2/3 lucky-small-sample group from topping a leaderboard.
 *
 * @param {{key:string, successes:number, n:number}[]} groups
 * @returns {{key:string, successes:number, n:number, rawRate:number, adjustedRate:number, low:number, high:number}[]}
 */
export function empiricalBayesShrink(groups) {
  const withN = groups.filter((g) => g.n > 0);
  if (withN.length === 0) return groups.map((g) => ({ ...g, rawRate: null, adjustedRate: null }));

  const totalN = withN.reduce((a, g) => a + g.n, 0);
  const totalS = withN.reduce((a, g) => a + g.successes, 0);
  const grandMean = totalS / totalN;

  // Method-of-moments estimate of alpha/beta for the Beta prior across groups,
  // using the variance of observed rates weighted by group size.
  const rates = withN.map((g) => g.successes / g.n);
  const weightedMeanRate = grandMean;
  const weightedVar =
    withN.reduce((a, g, i) => a + g.n * Math.pow(rates[i] - weightedMeanRate, 2), 0) / totalN;

  // Binomial sampling variance component to subtract out, approximated at the
  // average group size, so what's left approximates between-group variance.
  const avgN = totalN / withN.length;
  const samplingVar = (weightedMeanRate * (1 - weightedMeanRate)) / avgN;
  const betweenVar = Math.max(weightedVar - samplingVar, 1e-6);

  const m = weightedMeanRate;
  // alpha+beta (prior "strength") from method of moments; guard against degenerate values.
  let priorStrength = (m * (1 - m)) / betweenVar - 1;
  if (!isFinite(priorStrength) || priorStrength < 1) priorStrength = 1;
  const alpha = m * priorStrength;
  const beta = (1 - m) * priorStrength;

  return groups.map((g) => {
    if (g.n === 0) {
      return { ...g, rawRate: null, adjustedRate: grandMean, low: null, high: null, insufficientData: true };
    }
    const rawRate = g.successes / g.n;
    const adjustedRate = (g.successes + alpha) / (g.n + alpha + beta);
    const interval = wilsonInterval(g.successes, g.n);
    return {
      ...g,
      rawRate,
      adjustedRate,
      low: interval.low,
      high: interval.high,
      insufficientData: g.n < MIN_N,
    };
  });
}

/**
 * Two-proportion z-test (pooled variance under H0: p1 = p2).
 * @returns {{z:number, p:number}}
 */
export function twoProportionTest(s1, n1, s2, n2) {
  if (n1 === 0 || n2 === 0) return { z: null, p: 1 };
  const p1 = s1 / n1;
  const p2 = s2 / n2;
  const pooled = (s1 + s2) / (n1 + n2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (se === 0) return { z: 0, p: 1 };
  const z = (p1 - p2) / se;
  const p = 2 * (1 - normalCdf(Math.abs(z)));
  return { z, p };
}

/** Standard normal CDF via Abramowitz-Stegun approximation (good to ~1e-7). */
function normalCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const poly =
    t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  const cdf = 1 - d * poly;
  return x >= 0 ? cdf : 1 - cdf;
}

/**
 * Holm-Bonferroni step-down correction for multiple comparisons. Controls
 * family-wise error rate less conservatively than plain Bonferroni while
 * still being a valid, simple correction.
 * @param {{key:string, p:number}[]} tests
 * @param {number} alpha family-wise alpha
 * @returns {{key:string, p:number, adjustedAlpha:number, significant:boolean}[]}
 */
export function holmCorrection(tests, alpha = 0.05) {
  const m = tests.length;
  const sorted = [...tests].sort((a, b) => a.p - b.p);
  let stopped = false;
  const results = sorted.map((t, i) => {
    const adjustedAlpha = alpha / (m - i);
    const significant = !stopped && t.p < adjustedAlpha;
    if (!significant) stopped = true; // once one fails, all remaining (larger p) fail too
    return { ...t, adjustedAlpha, significant };
  });
  // return in original order
  const byKey = new Map(results.map((r) => [r.key, r]));
  return tests.map((t) => byKey.get(t.key));
}

/**
 * Cost (or effort) per outcome, with an approximate confidence interval
 * derived from the Wilson interval on the underlying outcome rate.
 * cost/effort is a fixed known quantity (e.g. total spend); outcomes and n
 * define the rate, and cost-per-outcome = cost / (rate * n) = cost / outcomes,
 * but the INTERVAL reflects uncertainty in whether that outcome count would
 * hold up with more data, via the rate's Wilson bounds.
 */
export function costPerOutcome(totalCost, outcomes, n) {
  const interval = wilsonInterval(outcomes, n);
  if (interval.insufficientData || outcomes === 0) {
    return { costPerOutcome: null, low: null, high: null, insufficientData: true };
  }
  // Lower outcome rate => higher cost per outcome, so the rate bounds invert.
  const low = totalCost / (interval.high * n);
  const high = totalCost / (interval.low * n);
  return {
    costPerOutcome: totalCost / outcomes,
    low,
    high,
    insufficientData: false,
  };
}

/**
 * Signal-lift analysis: compares two candidate binary "engagement signals"
 * (e.g. RSVP'd vs did-not, Genie-active vs not) as predictors of a downstream
 * binary outcome (e.g. applied to a program). Lift = P(outcome | signal=1) /
 * P(outcome | signal=0), with a two-proportion test on the same contrast.
 *
 * @param {{outcome:boolean, signal:boolean}[]} records
 * @returns {{lift:number, pSignal:object, pNoSignal:object, test:object, insufficientData:boolean}}
 */
export function signalLift(records) {
  const withSignal = records.filter((r) => r.signal);
  const withoutSignal = records.filter((r) => !r.signal);
  const sYes = withSignal.filter((r) => r.outcome).length;
  const sNo = withoutSignal.filter((r) => r.outcome).length;
  const nYes = withSignal.length;
  const nNo = withoutSignal.length;

  const pSignal = wilsonInterval(sYes, nYes);
  const pNoSignal = wilsonInterval(sNo, nNo);
  const insufficientData = nYes < MIN_N || nNo < MIN_N;
  const test = twoProportionTest(sYes, nYes, sNo, nNo);
  const lift =
    pNoSignal.rate && pNoSignal.rate > 0 ? pSignal.rate / pNoSignal.rate : null;

  return { lift, pSignal, pNoSignal, test, insufficientData };
}

/**
 * Shuffles the `outcome` field across records uniformly at random. Used only
 * by the validation script to build a negative control: statistics run on
 * shuffled labels should find nothing confident.
 */
export function shuffleOutcomes(records, rng = Math.random) {
  const outcomes = records.map((r) => r.outcome);
  for (let i = outcomes.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [outcomes[i], outcomes[j]] = [outcomes[j], outcomes[i]];
  }
  return records.map((r, i) => ({ ...r, outcome: outcomes[i] }));
}

/**
 * Tests each entity (e.g. each state) against the pooled rest of the cohort with a
 * two-proportion test, then Holm-corrects across the whole family.
 */
export function testEntitiesVsRest(entities, getSuccessesAndN) {
  const withTotals = entities.map((e) => {
    const { successes, n } = getSuccessesAndN(e);
    return { key: e.key, label: e.label, successes, n };
  });
  const grandSuccesses = withTotals.reduce((a, e) => a + e.successes, 0);
  const grandN = withTotals.reduce((a, e) => a + e.n, 0);

  const tests = withTotals.map((e) => {
    const poolSuccesses = grandSuccesses - e.successes;
    const poolN = grandN - e.n;
    const { z, p } = twoProportionTest(e.successes, e.n, poolSuccesses, poolN);
    const rate = e.n > 0 ? e.successes / e.n : null;
    const poolRate = poolN > 0 ? poolSuccesses / poolN : null;
    return {
      key: e.key,
      label: e.label,
      n: e.n,
      successes: e.successes,
      rate,
      poolRate,
      effectSize: rate !== null && poolRate !== null ? rate - poolRate : null,
      rateRatio: rate !== null && poolRate ? rate / poolRate : null,
      z,
      p: p === null ? 1 : p,
    };
  });

  const corrected = holmCorrection(
    tests.map((t) => ({ key: t.key, p: t.p })),
    0.05
  );
  const byKey = new Map(corrected.map((c) => [c.key, c]));
  return tests.map((t) => ({ ...t, ...byKey.get(t.key) }));
}
