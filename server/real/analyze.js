// analyze.js — runs the stats engine over the committed public-data snapshots in
// sources/ and writes data/real.json (every number the "Real data" screens show)
// and data/real_checks.json (data-integrity checks the Data Integrity screen reads).
//
// Same rules as the synthetic pipeline: every rate carries a Wilson interval or
// an explicit insufficient-data flag, every family of state-vs-rest comparisons
// is Holm-corrected, and a decision only fires when it is both significant and
// big enough to matter. Nothing here reads from the network.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MIN_N, wilsonInterval, empiricalBayesShrink, twoProportionTest, testEntitiesVsRest } from '../stats.js';
import { stateLabel } from './states.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const SOURCES_DIR = path.join(ROOT, 'sources');
const DATA_DIR = path.join(ROOT, 'data');

const WINDOW = ['2019', '2020', '2021', '2022', '2023'];

// "Big enough to matter" thresholds. Share-type rates (tens of percent) use an
// absolute gap; rare-event rates (YC admits, closures — a few percent or less)
// use a rate ratio, because a 5-point gap is impossible when the base is 0.2%.
const MIN_SHARE_GAP = 0.05;
const MIN_RATE_RATIO = 1.5;

// A YC company needs time before "Inactive" means anything.
const SURVIVAL_MATURITY_YEARS = 3;

function load(id) {
  return JSON.parse(fs.readFileSync(path.join(SOURCES_DIR, `${id}.json`), 'utf8'));
}

function sum(xs) {
  return xs.reduce((a, b) => a + b, 0);
}

function formatP(p) {
  return p < 1e-15 ? 'p < 1e-15' : `p = ${p.toExponential(2)}`;
}

function confidenceLabel(p, adjustedAlpha) {
  if (p >= adjustedAlpha) return 'not significant';
  if (p < adjustedAlpha / 10) return 'high';
  if (p < adjustedAlpha / 2) return 'medium';
  return 'low (exploratory)';
}

function notableShare(t) {
  return t.significant && Math.abs(t.effectSize) >= MIN_SHARE_GAP;
}

function notableRatio(t) {
  if (!t.significant || t.rateRatio === null) return false;
  const ratio = t.rateRatio;
  return ratio >= MIN_RATE_RATIO || ratio <= 1 / MIN_RATE_RATIO;
}

function listLabels(items) {
  const labels = items.map((i) => i.label);
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

function strongest(tests) {
  return tests.reduce((a, b) => (a.p <= b.p ? a : b));
}

function per1000(x) {
  return x === null || x === undefined ? '—' : (x * 1000).toFixed(2);
}

function pct(x, d = 1) {
  return x === null || x === undefined ? '—' : `${(x * 100).toFixed(d)}%`;
}

function num(x) {
  return x.toLocaleString('en-IN');
}

// ---------------------------------------------------------------------------
// Where founders are, and where they are growing
// ---------------------------------------------------------------------------
function buildMarket(rec, cum) {
  const cumByKey = new Map(cum.rows.map((r) => [r.key, r.total]));
  const national = Object.fromEntries(WINDOW.map((y) => [y, rec.publishedTotal[y]]));
  const nationalGrowth = national['2023'] / national['2019'];

  const rows = rec.rows.map((r) => ({
    key: r.key,
    label: stateLabel(r.key),
    byYear: Object.fromEntries(WINDOW.map((y) => [y, r[y]])),
    total: sum(WINDOW.map((y) => r[y])),
    cumulativeJun2024: cumByKey.get(r.key) ?? null,
  }));

  // Growth test: of a state's 2019 + 2023 recognitions, what share came in 2023?
  // A higher share than the rest of India means faster growth. Only states with
  // enough volume to say anything are tested; the rest are listed as excluded.
  const testable = rows.filter((r) => r.byYear['2019'] + r.byYear['2023'] >= MIN_N && r.byYear['2019'] >= MIN_N);
  const tests = testEntitiesVsRest(testable, (r) => ({ successes: r.byYear['2023'], n: r.byYear['2019'] + r.byYear['2023'] }));
  const testByKey = new Map(tests.map((t) => [t.key, t]));

  const states = rows
    .map((r) => {
      const t = testByKey.get(r.key) || null;
      let growth = null;
      if (t) {
        // Wilson bounds on the 2023 share, mapped monotonically to a growth multiple.
        const w = wilsonInterval(t.successes, t.n);
        const toMultiple = (s) => s / (1 - s);
        growth = { multiple: r.byYear['2023'] / r.byYear['2019'], low: toMultiple(w.low), high: toMultiple(w.high) };
      }
      return {
        ...r,
        shareOfNational2019: r.byYear['2019'] / national['2019'],
        shareOfNational2023: r.byYear['2023'] / national['2023'],
        growth,
        insufficientData: !t,
        test: t && { rate: t.rate, poolRate: t.poolRate, effectSize: t.effectSize, p: t.p, adjustedAlpha: t.adjustedAlpha, significant: t.significant },
      };
    })
    .sort((a, b) => b.total - a.total);

  return { window: WINDOW, national, nationalGrowth, states, tests };
}

// ---------------------------------------------------------------------------
// YC: who gets in, from where, and how that has changed
// ---------------------------------------------------------------------------
function batchYear(batch) {
  const m = /(\d{4})/.exec(batch || '');
  return m ? Number(m[1]) : null;
}

function buildYc(yc, market) {
  const inWindow = yc.companies.filter((c) => {
    const y = batchYear(c.batch);
    return y !== null && y >= Number(WINDOW[0]) && y <= Number(WINDOW[WINDOW.length - 1]);
  });
  const mapped = inWindow.filter((c) => c.state);
  const admitsByState = new Map();
  for (const c of mapped) admitsByState.set(c.state, (admitsByState.get(c.state) || 0) + 1);

  // Ratio of YC admits (batches 2019–2023) to DPIIT recognitions (2019–2023) by
  // state. Different populations, so this is an index of YC pull, not a
  // tracked conversion rate — the UI says so wherever it is shown.
  const entities = market.states.map((s) => ({ key: s.key, label: s.label, successes: admitsByState.get(s.key) || 0, n: s.total }));
  const testable = entities.filter((e) => e.n >= MIN_N);
  const tests = testEntitiesVsRest(testable, (e) => ({ successes: e.successes, n: e.n }));
  const testByKey = new Map(tests.map((t) => [t.key, t]));
  const shrunk = new Map(empiricalBayesShrink(testable).map((g) => [g.key, g]));

  const states = testable
    .map((e) => {
      const w = wilsonInterval(e.successes, e.n);
      const t = testByKey.get(e.key);
      return {
        key: e.key,
        label: e.label,
        admits: e.successes,
        recognitions: e.n,
        rate: w.rate,
        low: w.low,
        high: w.high,
        adjustedRate: shrunk.get(e.key).adjustedRate,
        test: { rate: t.rate, poolRate: t.poolRate, effectSize: t.effectSize, p: t.p, adjustedAlpha: t.adjustedAlpha, significant: t.significant },
      };
    })
    .sort((a, b) => b.admits - a.admits || b.recognitions - a.recognitions);

  const totalAdmits = sum(states.map((s) => s.admits));
  const totalRecognitions = sum(states.map((s) => s.recognitions));
  const top = states[0];
  const concentration = {
    key: top.key,
    label: top.label,
    shareOfAdmits: top.admits / totalAdmits,
    shareOfRecognitions: top.recognitions / totalRecognitions,
    shareOfAdmitsInterval: wilsonInterval(top.admits, totalAdmits),
  };

  // India's share of each YC year's companies.
  const totalByYear = new Map();
  for (const [batch, n] of Object.entries(yc.batchTotals)) {
    const y = batchYear(batch);
    if (y !== null) totalByYear.set(y, (totalByYear.get(y) || 0) + n);
  }
  const indiaByYear = new Map();
  for (const c of yc.companies) {
    const y = batchYear(c.batch);
    if (y !== null) indiaByYear.set(y, (indiaByYear.get(y) || 0) + 1);
  }
  const fetchedYear = new Date(yc.fetchedAt).getUTCFullYear();
  const shareByYear = [...totalByYear.keys()]
    .filter((y) => y >= 2015 && y <= fetchedYear)
    .sort((a, b) => a - b)
    .map((year) => {
      const india = indiaByYear.get(year) || 0;
      const total = totalByYear.get(year);
      return { year, india, total, ...wilsonInterval(india, total), n: total };
    });

  // Era comparison. The 2022/2023 split was chosen after looking at the series,
  // so this p-value is descriptive, not a pre-registered test — the UI says so.
  const era = (from, to) => {
    const rows = shareByYear.filter((r) => r.year >= from && r.year <= to);
    const india = sum(rows.map((r) => r.india));
    const total = sum(rows.map((r) => r.total));
    return { from, to, india, total, ...wilsonInterval(india, total), n: total };
  };
  const early = era(2019, 2022);
  const late = era(2023, fetchedYear);
  const eraTest = { early, late, ...twoProportionTest(early.india, early.total, late.india, late.total), splitChosenAfterLooking: true };

  // Survival by cohort: share of Indian YC companies now marked Inactive.
  const survival = [...indiaByYear.keys()]
    .filter((y) => y >= 2015 && y <= fetchedYear)
    .sort((a, b) => a - b)
    .map((year) => {
      const cohort = yc.companies.filter((c) => batchYear(c.batch) === year);
      const inactive = cohort.filter((c) => c.status === 'Inactive').length;
      const ageYears = fetchedYear - year;
      const w = wilsonInterval(inactive, cohort.length);
      const tooNewToCall = ageYears < SURVIVAL_MATURITY_YEARS;
      return { year, n: cohort.length, inactive, ...w, n: cohort.length, ageYears, tooNewToCall, insufficientData: w.insufficientData || tooNewToCall };
    });

  return {
    window: WINDOW,
    totalIndiaCompanies: yc.companies.length,
    admitsInWindow: inWindow.length,
    unmappedInWindow: inWindow.length - mapped.length,
    totalAdmits,
    totalRecognitions,
    states,
    tests,
    concentration,
    shareByYear,
    eraTest,
    survival,
    survivalMaturityYears: SURVIVAL_MATURITY_YEARS,
  };
}

// ---------------------------------------------------------------------------
// Closures — tested, but checked for a cohort-age confound before any call
// ---------------------------------------------------------------------------
function buildClosure(cum, closed, market) {
  const closedByKey = new Map(closed.rows.map((r) => [r.key, r.closed]));
  const growthByKey = new Map(market.tests.map((t) => [t.key, t]));
  const entities = cum.rows
    .filter((r) => r.total >= MIN_N)
    .map((r) => ({ key: r.key, label: stateLabel(r.key), successes: closedByKey.get(r.key) || 0, n: r.total }));
  const tests = testEntitiesVsRest(entities, (e) => ({ successes: e.successes, n: e.n }));

  const states = tests
    .map((t) => {
      const w = wilsonInterval(t.successes, t.n);
      const g = growthByKey.get(t.key);
      // Fast-growing states hold more young startups, which have had less time
      // to close. If a state's closure gap points the way its growth predicts,
      // the gap can't be separated from cohort age with state-level totals.
      const confounded = !!(g && g.significant && Math.sign(t.effectSize) === -Math.sign(g.effectSize));
      return {
        key: t.key,
        label: t.label,
        closed: t.successes,
        recognised: t.n,
        rate: w.rate,
        low: w.low,
        high: w.high,
        test: { rate: t.rate, poolRate: t.poolRate, effectSize: t.effectSize, p: t.p, adjustedAlpha: t.adjustedAlpha, significant: t.significant },
        notable: notableRatio(t),
        confoundedByCohortAge: confounded,
      };
    })
    .sort((a, b) => b.recognised - a.recognised);

  return {
    numeratorAsOf: closed.asOf,
    denominatorAsOf: cum.asOf,
    national: wilsonInterval(closed.publishedTotal.closed, cum.publishedTotal.total),
    states,
  };
}

// ---------------------------------------------------------------------------
// Women-led share (startups with at least one woman director/partner)
// ---------------------------------------------------------------------------
function buildWomen(women, market) {
  const womenByKey = new Map(women.rows.map((r) => [r.key, r]));
  const entities = market.states
    .filter((s) => s.total >= MIN_N)
    .map((s) => {
      const w = womenByKey.get(s.key);
      return { key: s.key, label: s.label, successes: w ? sum(WINDOW.map((y) => w[y])) : 0, n: s.total };
    });
  const tests = testEntitiesVsRest(entities, (e) => ({ successes: e.successes, n: e.n }));
  const states = tests
    .map((t) => ({
      key: t.key,
      label: t.label,
      womenLed: t.successes,
      recognised: t.n,
      ...wilsonInterval(t.successes, t.n),
      test: { rate: t.rate, poolRate: t.poolRate, effectSize: t.effectSize, p: t.p, adjustedAlpha: t.adjustedAlpha, significant: t.significant },
    }))
    .sort((a, b) => b.recognised - a.recognised);
  const nationalWomen = sum(entities.map((e) => e.successes));
  const nationalAll = sum(entities.map((e) => e.n));
  return { window: WINDOW, national: wilsonInterval(nationalWomen, nationalAll), states, tests };
}

// ---------------------------------------------------------------------------
// Decision cards (and the calls the engine refuses to make)
// ---------------------------------------------------------------------------
function buildDecisions(market, yc, closure, women) {
  const decisions = [];
  const withheld = [];

  // 1. Where founder growth is moving.
  const fast = market.tests.filter((t) => notableShare(t) && t.effectSize > 0);
  const slow = market.tests.filter((t) => notableShare(t) && t.effectSize < 0);
  if (fast.length) {
    const s = strongest(fast);
    const stateOf = (k) => market.states.find((x) => x.key === k);
    decisions.push({
      id: 'growth_shift',
      keys: fast.map((t) => t.key),
      title: `Founder growth is shifting: ${fast.length} state${fast.length > 1 ? 's' : ''} growing well above India's ${market.nationalGrowth.toFixed(1)}×`,
      recommendation: `New startup recognitions grew fastest in ${listLabels(fast)}${slow.length ? `, and slowest in ${listLabels(slow)}` : ''}. If Rize's buildathon and community-event calendar still follows the 2019 map of where founders were, re-weight it toward where they are arriving now.`,
      impactRange: {
        label: `${stateOf(s.key).label} growth, 2019→2023`,
        low: `${stateOf(s.key).growth.low.toFixed(1)}×`,
        high: `${stateOf(s.key).growth.high.toFixed(1)}×`,
        vsPool: `${market.nationalGrowth.toFixed(1)}× for India overall`,
      },
      evidence: [
        ...fast.map((t) => { const x = stateOf(t.key); return `${x.label}: ${num(x.byYear['2019'])} → ${num(x.byYear['2023'])} recognitions (${x.growth.multiple.toFixed(1)}×).`; }),
        ...slow.map((t) => { const x = stateOf(t.key); return `${x.label} (slower): ${num(x.byYear['2019'])} → ${num(x.byYear['2023'])} (${x.growth.multiple.toFixed(1)}×).`; }),
        `Each state's 2023 share of its own 2019+2023 recognitions tested against the rest of India, Holm-corrected across ${market.tests.length} states; strongest result ${formatP(s.p)}. Effect must also exceed ${MIN_SHARE_GAP * 100} percentage points.`,
      ],
      confidence: confidenceLabel(s.p, s.adjustedAlpha),
      counterEvidence: 'DPIIT recognition is opt-in, and some state startup policies require it for local benefits — part of a state\'s growth can be a policy push to register, not new founders. Check against company-incorporation counts (MCA) for the same states before moving budget.',
      source: 'DPIIT recognitions by state, PIB Feb 2024',
    });
  }

  // 2. YC pull: the under-tapped states are those growing fast but sending
  //    significantly fewer companies to YC than the rest of India.
  const ycLow = yc.tests.filter((t) => notableRatio(t) && t.rate < t.poolRate);
  const ycHigh = yc.tests.filter((t) => notableRatio(t) && t.rate > t.poolRate);
  const fastKeys = new Set(fast.map((t) => t.key));
  const underTapped = ycLow.filter((t) => fastKeys.has(t.key));
  if (underTapped.length) {
    const s = strongest(underTapped);
    const st = yc.states.find((x) => x.key === s.key);
    decisions.push({
      id: 'yc_under_tapped',
      keys: underTapped.map((t) => t.key),
      title: underTapped.length > 1
        ? `${listLabels(underTapped)}: fast-growing founder bases that almost never reach YC`
        : `${listLabels(underTapped)}: a fast-growing founder base that almost never reaches YC`,
      recommendation: `${underTapped.length > 1 ? 'These are among' : `${listLabels(underTapped)} is one of`} India's fastest-growing startup states, but ${underTapped.length > 1 ? 'they send' : 'it sends'} far fewer companies to YC per recognised startup than the rest of the country. That's where Rize for YC adds the most: run targeted application clinics and founder office hours there, rather than in Bengaluru, where founders already find their way to YC.`,
      impactRange: {
        label: `${st.label}: YC admits per 1,000 recognised startups`,
        low: per1000(st.low),
        high: per1000(st.high),
        vsPool: `${per1000(s.poolRate)} in the rest of India`,
      },
      evidence: [
        ...underTapped.map((t) => { const x = yc.states.find((y) => y.key === t.key); return `${x.label}: ${x.admits} YC admit(s) from ${num(x.recognitions)} recognised startups, 2019–2023.`; }),
        `YC admits ÷ DPIIT recognitions by state, Holm-corrected across ${yc.tests.length} states; strongest ${formatP(s.p)}. Rate ratio must be at least ${MIN_RATE_RATIO}× either way.`,
        `${yc.unmappedInWindow} of ${yc.admitsInWindow} Indian YC companies in the window had no mappable state and are excluded.`,
      ],
      confidence: confidenceLabel(s.p, s.adjustedAlpha),
      counterEvidence: 'This is a ratio of two different populations, not a tracked conversion: a YC company need not be DPIIT-recognised, and founders often relocate to Bengaluru before applying, so YC lists them there. Sector mix matters too — a state heavy in services or trading startups will send fewer to YC regardless of outreach.',
      source: 'yc-oss YC directory + DPIIT recognitions, PIB Feb 2024',
    });
  }
  if (ycHigh.length) {
    const s = strongest(ycHigh);
    const c = yc.concentration;
    decisions.push({
      id: 'yc_concentration',
      keys: ycHigh.map((t) => t.key),
      title: `${listLabels(ycHigh)} supplies most of India's YC companies`,
      recommendation: `Measure Rize for YC on admits from outside ${listLabels(ycHigh)}. Admits from there would mostly happen anyway; admits from elsewhere are the ones Rize can credibly claim.`,
      impactRange: {
        label: `${c.label}'s share of Indian YC admits, 2019–2023`,
        low: pct(c.shareOfAdmitsInterval.low),
        high: pct(c.shareOfAdmitsInterval.high),
        vsPool: `${pct(c.shareOfRecognitions)} of recognised startups`,
      },
      evidence: [
        ...ycHigh.map((t) => { const x = yc.states.find((y) => y.key === t.key); return `${x.label}: ${x.admits} admits from ${num(x.recognitions)} recognitions (${per1000(x.rate)} per 1,000 vs ${per1000(t.poolRate)} elsewhere).`; }),
        `Holm-corrected across ${yc.tests.length} states; ${formatP(s.p)}.`,
      ],
      confidence: confidenceLabel(s.p, s.adjustedAlpha),
      counterEvidence: 'Some of this is relocation: founders from other states move to Bengaluru and list it as their location. The real gap between states is probably smaller than the location field suggests.',
      source: 'yc-oss YC directory + DPIIT recognitions, PIB Feb 2024',
    });
  }

  // 3. India's share of YC, before and after.
  const e = yc.eraTest;
  if (e.p < 0.05 && e.early.rate > 0 && (e.early.rate / e.late.rate >= MIN_RATE_RATIO || e.late.rate / e.early.rate >= MIN_RATE_RATIO)) {
    const down = e.late.rate < e.early.rate;
    decisions.push({
      id: 'yc_india_share',
      title: `India's share of YC ${down ? 'fell' : 'rose'} from ${pct(e.early.rate)} to ${pct(e.late.rate)}`,
      recommendation: down
        ? `Getting Indian founders into YC is much harder now than in 2019–2022. Set Rize for YC's targets against this smaller base, and put the effort into application quality rather than application volume.`
        : `YC is taking more Indian companies than before; Rize for YC can push application volume.`,
      impactRange: {
        label: `Indian share of YC companies, ${e.late.from}–${e.late.to}`,
        low: pct(e.late.low),
        high: pct(e.late.high),
        vsPool: `${pct(e.early.rate)} in ${e.early.from}–${e.early.to}`,
      },
      evidence: [
        `${e.early.from}–${e.early.to}: ${e.early.india} of ${num(e.early.total)} YC companies were Indian.`,
        `${e.late.from}–${e.late.to}: ${e.late.india} of ${num(e.late.total)}.`,
        `Two-proportion test: ${formatP(e.p)}. The 2022/2023 split was chosen after looking at the yearly series, so treat this p-value as descriptive.`,
      ],
      confidence: 'medium',
      counterEvidence: 'YC\'s location field reflects where companies say they are now. Indian-founded companies that moved their headquarters to the US are counted as US companies, which may understate India\'s share, especially in recent batches.',
      source: 'yc-oss YC directory',
    });
  }

  // 4. Women-led share gaps.
  const womenLow = women.tests.filter((t) => notableShare(t) && t.effectSize < 0);
  if (womenLow.length) {
    const s = strongest(womenLow);
    const st = women.states.find((x) => x.key === s.key);
    decisions.push({
      id: 'women_led_gap',
      keys: womenLow.map((t) => t.key),
      title: `${listLabels(womenLow)}: fewer startups with a woman director`,
      recommendation: `About ${pct(women.national.rate, 0)} of India's recognised startups have at least one woman director or partner, but ${listLabels(womenLow)} sit well below that. If Rize runs women-founder or D2C+ programmes, these states are the gap to close.`,
      impactRange: {
        label: `${st.label}: share with a woman director/partner`,
        low: pct(st.low),
        high: pct(st.high),
        vsPool: `${pct(s.poolRate)} in the rest of India`,
      },
      evidence: [
        ...womenLow.map((t) => { const x = women.states.find((y) => y.key === t.key); return `${x.label}: ${num(x.womenLed)} of ${num(x.recognised)} recognitions in 2019–2023 (${pct(x.rate)}).`; }),
        `Holm-corrected across ${women.tests.length} states; strongest ${formatP(s.p)}. Gap must exceed ${MIN_SHARE_GAP * 100} percentage points.`,
      ],
      confidence: confidenceLabel(s.p, s.adjustedAlpha),
      counterEvidence: '"At least one woman director or partner" is not the same as woman-founded or woman-led: family-run companies often add a woman director for compliance. The two tables also come from releases two years apart, so a few recognitions may have been revised in between.',
      source: 'DPIIT women-director table, PIB Feb 2026 + recognitions, PIB Feb 2024',
    });
  }

  // 5. Closure gaps that survive the cohort-age check (if any).
  const clean = closure.states.filter((s) => s.test.significant && s.notable && !s.confoundedByCohortAge);
  if (clean.length) {
    const s = clean.reduce((a, b) => (a.test.p <= b.test.p ? a : b));
    decisions.push({
      id: 'closure_gap',
      keys: clean.map((x) => x.key),
      title: `${listLabels(clean)}: closure rate out of line with the rest of India`,
      recommendation: 'Recognised startups here are closing at a rate that growth alone does not explain. Check whether founder support after incorporation (compliance, banking, first customers) is weaker here.',
      impactRange: { label: `${s.label}: closed (dissolved/struck-off)`, low: pct(s.low), high: pct(s.high), vsPool: `${pct(s.test.poolRate)} elsewhere` },
      evidence: clean.map((x) => `${x.label}: ${num(x.closed)} of ${num(x.recognised)} recognised startups closed (${pct(x.rate)}).`),
      confidence: confidenceLabel(s.test.p, s.test.adjustedAlpha),
      counterEvidence: `The numerator (closures, ${closure.numeratorAsOf}) and denominator (recognitions, ${closure.denominatorAsOf}) come from different dates.`,
      source: 'DPIIT closures, PIB Dec 2025 + cumulative recognitions, PIB Jul 2024',
    });
  }

  // Withheld calls: significant-looking differences the engine refuses to act on.
  const confounded = closure.states.filter((s) => s.test.significant && s.notable && s.confoundedByCohortAge);
  const tooSmall = closure.states.filter((s) => s.test.significant && !s.notable);
  if (confounded.length || tooSmall.length) {
    withheld.push({
      id: 'closure_withheld',
      title: 'Closure rates by state: not called',
      reason: [
        ...confounded.map((s) => `${s.label}'s closure rate (${pct(s.rate)} vs ${pct(s.test.poolRate)} elsewhere) is statistically significant, but ${s.label} is also one of the ${s.test.effectSize < 0 ? 'fastest' : 'slowest'}-growing states. A younger set of startups has had less time to close, so state-level totals can't separate "healthier ecosystem" from "younger startups".`),
        ...tooSmall.map((s) => `${s.label} (${pct(s.rate)} vs ${pct(s.test.poolRate)}) is statistically significant but under the ${MIN_RATE_RATIO}× size bar, so it isn't worth acting on.`),
      ],
      whatWouldSettleIt: 'Closures broken down by recognition year (the cohort) for each state. That would let the engine compare startups of the same age.',
    });
  }
  const young = yc.survival.filter((s) => s.tooNewToCall && s.n > 0);
  if (young.length) {
    withheld.push({
      id: 'yc_survival_withheld',
      title: 'Survival of recent Indian YC companies: too new to call',
      reason: [
        `${young.map((s) => `${s.year} (n=${s.n})`).join(', ')}: fewer than ${yc.survivalMaturityYears} years old. "Still active" doesn't mean much yet, and every one of these cohorts is also below the minimum sample of ${MIN_N}.`,
      ],
      whatWouldSettleIt: `Time. These cohorts become readable once they are ${yc.survivalMaturityYears} years old.`,
    });
  }

  return { decisions, withheld, thresholds: { minShareGap: MIN_SHARE_GAP, minRateRatio: MIN_RATE_RATIO, minN: MIN_N } };
}

// ---------------------------------------------------------------------------
// Data-integrity checks
// ---------------------------------------------------------------------------
function buildChecks(sources, yc, women) {
  const checks = [];
  for (const src of sources.filter((s) => s.publishedTotal)) {
    for (const col of src.columns) {
      const parsed = sum(src.rows.map((r) => r[col]));
      const published = src.publishedTotal[col];
      checks.push({
        id: `${src.id}:${col}`,
        description: `${src.title} — ${col}: sum of parsed state rows equals the published total`,
        pass: parsed === published,
        detail: `parsed ${num(parsed)} vs published ${num(published)}`,
      });
    }
  }
  const rec = sources.find((s) => s.id === 'dpiit_recognitions_by_year');
  const wom = sources.find((s) => s.id === 'dpiit_women_by_year');
  const recByKey = new Map(rec.rows.map((r) => [r.key, r]));
  const violations = [];
  for (const w of wom.rows) {
    const r = recByKey.get(w.key);
    for (const y of WINDOW) if (r && w[y] > r[y]) violations.push(`${w.key} ${y}: ${w[y]} > ${r[y]}`);
  }
  checks.push({
    id: 'women_le_total',
    description: 'Startups with a woman director never exceed total recognitions for the same state and year',
    pass: violations.length === 0,
    detail: violations.length ? violations.join('; ') : `checked ${wom.rows.length} states × ${WINDOW.length} years`,
  });
  checks.push({
    id: 'yc_mapping',
    description: 'Indian YC companies in 2019–2023 mapped to a state',
    pass: yc.unmappedInWindow / yc.admitsInWindow < 0.05,
    detail: `${yc.admitsInWindow - yc.unmappedInWindow} of ${yc.admitsInWindow} mapped (${yc.unmappedInWindow} unmapped; must be under 5%)`,
  });
  return { runAt: new Date().toISOString(), checks, overallPass: checks.every((c) => c.pass) };
}

function main() {
  const ids = ['dpiit_recognitions_by_year', 'dpiit_cumulative_jun2024', 'dpiit_closed_nov2025', 'dpiit_women_by_year', 'dpiit_women_closed', 'yc_india'];
  const [rec, cum, closed, women, womenClosed, yc] = ids.map(load);
  const sources = [rec, cum, closed, women, womenClosed];

  const market = buildMarket(rec, cum);
  const ycOut = buildYc(yc, market);
  const closure = buildClosure(cum, closed, market);
  const womenOut = buildWomen(women, market);
  const decisions = buildDecisions(market, ycOut, closure, womenOut);

  const strip = ({ tests, ...rest }) => rest;
  const real = {
    sources: [...sources, yc].map((s) => ({ id: s.id, title: s.title, release: s.release, url: s.url, asOf: s.asOf || null, fetchedAt: s.fetchedAt })),
    market: strip(market),
    yc: strip(ycOut),
    closure,
    women: strip(womenOut),
    ...decisions,
  };
  fs.writeFileSync(path.join(DATA_DIR, 'real.json'), JSON.stringify(real, null, 2));
  const checks = buildChecks(sources, ycOut, womenOut);
  fs.writeFileSync(path.join(DATA_DIR, 'real_checks.json'), JSON.stringify(checks, null, 2));

  console.log(`Real-data decisions: ${decisions.decisions.map((d) => d.id).join(', ') || 'none'}`);
  console.log(`Withheld: ${decisions.withheld.map((d) => d.id).join(', ') || 'none'}`);
  console.log(`Data integrity: ${checks.checks.filter((c) => c.pass).length}/${checks.checks.length} checks pass`);
  if (!checks.overallPass) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export { buildMarket, buildYc, buildClosure, buildWomen, buildDecisions };
