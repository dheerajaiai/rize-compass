import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wilsonInterval,
  rateWithMinN,
  empiricalBayesShrink,
  twoProportionTest,
  holmCorrection,
  costPerOutcome,
  signalLift,
  shuffleOutcomes,
  MIN_N,
} from './stats.js';

test('wilsonInterval: known case matches hand-calculable bounds', () => {
  // 50/100 should center near 0.5 with a symmetric-ish interval
  const r = wilsonInterval(50, 100);
  assert.ok(Math.abs(r.rate - 0.5) < 1e-9);
  assert.ok(r.low > 0.4 && r.low < 0.5);
  assert.ok(r.high > 0.5 && r.high < 0.6);
});

test('wilsonInterval: n=0 returns insufficientData and nulls, never divides by zero', () => {
  const r = wilsonInterval(0, 0);
  assert.equal(r.insufficientData, true);
  assert.equal(r.rate, null);
});

test('wilsonInterval: stays within [0,1] at extreme proportions', () => {
  const r1 = wilsonInterval(1, 1); // 100%, n=1
  assert.ok(r1.high <= 1 && r1.low >= 0);
  const r0 = wilsonInterval(0, 1); // 0%, n=1
  assert.ok(r0.high <= 1 && r0.low >= 0);
});

test('wilsonInterval: interval narrows as n grows at fixed rate', () => {
  const small = wilsonInterval(5, 10);
  const large = wilsonInterval(500, 1000);
  const widthSmall = small.high - small.low;
  const widthLarge = large.high - large.low;
  assert.ok(widthLarge < widthSmall, 'larger n should give a tighter interval');
});

test('rateWithMinN: flags insufficientData below threshold, not above', () => {
  const below = rateWithMinN(3, MIN_N - 1);
  const above = rateWithMinN(15, MIN_N);
  assert.equal(below.insufficientData, true);
  assert.equal(above.insufficientData, false);
});

test('empiricalBayesShrink: small-sample lucky group gets pulled toward grand mean', () => {
  const groups = [
    { key: 'big-A', successes: 500, n: 1000 }, // 50%
    { key: 'big-B', successes: 480, n: 1000 }, // 48%
    { key: 'tiny-lucky', successes: 2, n: 3 }, // 67% on n=3 — should NOT rank #1 after shrinkage
  ];
  const out = empiricalBayesShrink(groups);
  const tiny = out.find((g) => g.key === 'tiny-lucky');
  const bigA = out.find((g) => g.key === 'big-A');
  assert.ok(tiny.adjustedRate < tiny.rawRate, 'tiny group rate should shrink downward toward the mean');
  assert.ok(
    tiny.adjustedRate < bigA.adjustedRate + 0.1,
    'tiny lucky group should not blow past large stable groups after shrinkage'
  );
});

test('empiricalBayesShrink: large-sample groups barely move', () => {
  const groups = [
    { key: 'A', successes: 5000, n: 10000 }, // 50%
    { key: 'B', successes: 4000, n: 10000 }, // 40%
  ];
  const out = empiricalBayesShrink(groups);
  for (const g of out) {
    assert.ok(Math.abs(g.adjustedRate - g.rawRate) < 0.03, 'large n should shrink very little');
  }
});

test('twoProportionTest: identical rates give p near 1', () => {
  const { p } = twoProportionTest(100, 1000, 100, 1000);
  assert.ok(p > 0.9);
});

test('twoProportionTest: large, clearly different rates give small p', () => {
  const { p } = twoProportionTest(600, 1000, 400, 1000);
  assert.ok(p < 0.001);
});

test('twoProportionTest: handles zero n without throwing', () => {
  const { p } = twoProportionTest(0, 0, 5, 10);
  assert.equal(p, 1);
});

test('holmCorrection: rejects fewer hypotheses than uncorrected alpha would', () => {
  // Three borderline-ish p-values; uncorrected alpha=0.05 would call all three
  // "significant" if tested independently, but Holm should be stricter.
  const tests = [
    { key: 'a', p: 0.01 },
    { key: 'b', p: 0.04 },
    { key: 'c', p: 0.045 },
  ];
  const corrected = holmCorrection(tests, 0.05);
  const naiveSignificantCount = tests.filter((t) => t.p < 0.05).length;
  const holmSignificantCount = corrected.filter((t) => t.significant).length;
  assert.equal(naiveSignificantCount, 3);
  assert.ok(holmSignificantCount < naiveSignificantCount, 'Holm correction must be stricter than uncorrected testing');
});

test('holmCorrection: a very small p-value still survives correction', () => {
  const tests = [
    { key: 'strong', p: 0.0001 },
    { key: 'weak1', p: 0.3 },
    { key: 'weak2', p: 0.5 },
  ];
  const corrected = holmCorrection(tests, 0.05);
  const strong = corrected.find((t) => t.key === 'strong');
  assert.equal(strong.significant, true);
});

test('costPerOutcome: insufficient data below MIN_N', () => {
  const r = costPerOutcome(10000, 2, 10);
  assert.equal(r.insufficientData, true);
});

test('costPerOutcome: returns a sane interval straddling the point estimate', () => {
  const r = costPerOutcome(100000, 50, 500); // 2000/outcome point estimate
  assert.equal(r.insufficientData, false);
  assert.ok(Math.abs(r.costPerOutcome - 2000) < 1e-6);
  assert.ok(r.low <= r.costPerOutcome && r.costPerOutcome <= r.high);
});

test('signalLift: stronger predictor shows lift > 1 with significant test', () => {
  // Genie-active founders apply at 40%, non-active at 10% — Genie usage should show lift
  const records = [];
  for (let i = 0; i < 200; i++) records.push({ signal: true, outcome: i < 80 }); // 40%
  for (let i = 0; i < 200; i++) records.push({ signal: false, outcome: i < 20 }); // 10%
  const result = signalLift(records);
  assert.ok(result.lift > 2, 'lift should clearly exceed 1');
  assert.ok(result.test.p < 0.01, 'difference should be statistically significant');
  assert.equal(result.insufficientData, false);
});

test('signalLift: no real difference gives lift near 1 and a large p-value', () => {
  const records = [];
  for (let i = 0; i < 200; i++) records.push({ signal: true, outcome: i < 40 }); // 20%
  for (let i = 0; i < 200; i++) records.push({ signal: false, outcome: i < 41 }); // 20.5%
  const result = signalLift(records);
  assert.ok(Math.abs(result.lift - 1) < 0.3);
  assert.ok(result.test.p > 0.05);
});

test('shuffleOutcomes: preserves the total count of positive outcomes', () => {
  const records = Array.from({ length: 100 }, (_, i) => ({ outcome: i < 30, id: i }));
  const shuffled = shuffleOutcomes(records, () => 0.5);
  const originalPositives = records.filter((r) => r.outcome).length;
  const shuffledPositives = shuffled.filter((r) => r.outcome).length;
  assert.equal(originalPositives, shuffledPositives);
});

test('shuffleOutcomes: with a fixed non-trivial rng, ordering actually changes', () => {
  const records = Array.from({ length: 20 }, (_, i) => ({ outcome: i < 10 }));
  let seed = 42;
  const rng = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const shuffled = shuffleOutcomes(records, rng);
  const samePositionCount = records.filter((r, i) => r.outcome === shuffled[i].outcome).length;
  assert.ok(samePositionCount < 20, 'shuffle should actually move at least some labels');
});
