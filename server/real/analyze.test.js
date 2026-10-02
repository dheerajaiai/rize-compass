import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stateKeyFromName, stateKeyFromYcLocation } from './states.js';
import { buildMarket, buildClosure, buildRize, buildDecisions } from './analyze.js';
import { testEntitiesVsRest } from '../stats.js';

const YEARS = ['2019', '2020', '2021', '2022', '2023'];

function recRow(key, v2019, v2023) {
  return { key, '2019': v2019, '2020': 0, '2021': 0, '2022': 0, '2023': v2023 };
}

function recSource(rows) {
  const publishedTotal = Object.fromEntries(YEARS.map((y) => [y, rows.reduce((a, r) => a + r[y], 0)]));
  return { rows, publishedTotal };
}

test('state names: PIB spellings and aliases map to one key', () => {
  assert.equal(stateKeyFromName('Jammu & Kashmir'), 'JK');
  assert.equal(stateKeyFromName('Jammu and Kashmir'), 'JK');
  assert.equal(stateKeyFromName('Dadra and Nagar Haveli and Daman and Diu'), 'DN');
  assert.equal(stateKeyFromName('Grand Total'), null);
});

test('YC locations: codes, alternate codes and non-Indian locations', () => {
  assert.equal(stateKeyFromYcLocation('Bengaluru, KA, India'), 'KA');
  assert.equal(stateKeyFromYcLocation('Hyderabad, Telangana, India'), 'TG');
  assert.equal(stateKeyFromYcLocation('Hyderabad, TS, India'), 'TG');
  assert.equal(stateKeyFromYcLocation('India'), null);
  assert.equal(stateKeyFromYcLocation('San Francisco, CA, USA'), null);
});

test('testEntitiesVsRest: a planted outlier is significant; a family without one stays quiet', () => {
  const entities = [
    { key: 'a', label: 'A', s: 300, n: 1000 },
    { key: 'b', label: 'B', s: 100, n: 1000 },
    { key: 'c', label: 'C', s: 102, n: 1000 },
    { key: 'd', label: 'D', s: 98, n: 1000 },
  ];
  const tests = testEntitiesVsRest(entities, (e) => ({ successes: e.s, n: e.n }));
  assert.equal(tests.find((t) => t.key === 'a').significant, true);

  // Without the outlier, near-identical groups produce nothing.
  const quiet = testEntitiesVsRest(entities.slice(1), (e) => ({ successes: e.s, n: e.n }));
  assert.equal(quiet.some((t) => t.significant), false);
});

test('market: states below the minimum sample are not tested', () => {
  const market = buildMarket(
    recSource([recRow('MH', 1000, 3000), recRow('GJ', 500, 3000), recRow('LA', 1, 4)]),
    { rows: [] }
  );
  const ladakh = market.states.find((s) => s.key === 'LA');
  assert.equal(ladakh.insufficientData, true);
  assert.equal(ladakh.growth, null);
  assert.equal(market.tests.some((t) => t.key === 'LA'), false);
});

test('closure: a low closure rate in a fast-growing state is flagged as confounded, not called', () => {
  // GJ grows 6x vs MH/KA ~2x, and has a low closure rate — exactly the pattern
  // cohort age alone would produce.
  const rec = recSource([recRow('MH', 2000, 4000), recRow('KA', 1500, 3000), recRow('GJ', 500, 3000)]);
  const market = buildMarket(rec, { rows: [] });
  const cum = { asOf: 'x', rows: [{ key: 'MH', total: 20000 }, { key: 'KA', total: 15000 }, { key: 'GJ', total: 10000 }], publishedTotal: { total: 45000 } };
  const closed = { asOf: 'y', rows: [{ key: 'MH', closed: 1000 }, { key: 'KA', closed: 750 }, { key: 'GJ', closed: 200 }], publishedTotal: { closed: 1950 } };
  const closure = buildClosure(cum, closed, market);
  const gj = closure.states.find((s) => s.key === 'GJ');
  assert.equal(gj.test.significant, true);
  assert.equal(gj.confoundedByCohortAge, true);

  const yc = { tests: [], states: [], survival: [], eraTest: { early: { rate: 0 }, late: { rate: 0 } } };
  const rize = { total: 0, listedInUs: 0, indiaStates: [], alumni: [] };
  const { decisions, withheld } = buildDecisions(market, yc, closure, rize);
  assert.equal(decisions.some((d) => d.id === 'closure_gap'), false);
  assert.equal(withheld.some((w) => w.id === 'closure_withheld'), true);
});

test('rize alumni: counts are reported, but a rate is withheld below the minimum sample', () => {
  const alumni = [
    { name: 'A', matched: true, batch: 'Winter 2024', listedCountry: 'USA', state: null, status: 'Active' },
    { name: 'B', matched: true, batch: 'Winter 2023', listedCountry: 'India', state: 'KA', status: 'Active' },
    { name: 'C', matched: true, batch: 'Fall 2025', listedCountry: null, state: null, status: 'Active' },
    { name: 'D', matched: false, batch: null },
  ];
  const yc = { eraTest: { late: { from: 2023, to: 2026, india: 10 } } };
  const rize = buildRize({ alumni }, yc);
  assert.equal(rize.named, 4);
  assert.equal(rize.total, 3);
  assert.equal(rize.listedInUs, 1);
  assert.equal(rize.listedInIndia, 1);
  assert.equal(rize.noLocation, 1);
  assert.equal(rize.shareListedOutsideIndia.insufficientData, true);
  // 10 India-listed in the directory + 2 alumni it files elsewhere.
  assert.equal(rize.late.lowerBoundIndiaEcosystemCompanies, 12);
});
