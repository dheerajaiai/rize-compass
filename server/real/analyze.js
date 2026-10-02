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
import { MIN_N, wilsonInterval, rateWithMinN, empiricalBayesShrink, twoProportionTest, testEntitiesVsRest } from '../stats.js';
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

  // Across ALL of YC (not just India): how many companies list a US or San
  // Francisco location in each era. This is the baseline any one group's
  // location mix has to be read against.
  const locationMix = (from, to) => {
    const acc = { total: 0, usa: 0, sanFrancisco: 0 };
    for (const [batch, b] of Object.entries(yc.batchLocations)) {
      const y = batchYear(batch);
      if (y === null || y < from || y > to) continue;
      acc.total += b.total;
      acc.usa += b.usa;
      acc.sanFrancisco += b.sanFrancisco;
    }
    return { from, to, total: acc.total, usa: wilsonInterval(acc.usa, acc.total), sanFrancisco: wilsonInterval(acc.sanFrancisco, acc.total) };
  };
  const allYcLocations = { early: locationMix(early.from, early.to), late: locationMix(late.from, late.to) };
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
    allYcLocations,
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
// Rize for YC alumni: where does YC's directory list them?
// ---------------------------------------------------------------------------
function buildRize(rize, yc) {
  const alumni = rize.alumni.filter((a) => a.matched).map((a) => ({ ...a, year: batchYear(a.batch), listedInIndia: a.listedCountry === 'India' }));
  const total = alumni.length;
  const inIndia = alumni.filter((a) => a.listedInIndia);
  const inUs = alumni.filter((a) => a.listedCountry === 'USA');
  const late = yc.eraTest.late;
  const lateAlumni = alumni.filter((a) => a.year >= late.from && a.year <= late.to);
  const lateInIndia = lateAlumni.filter((a) => a.listedInIndia);
  const lateElsewhere = lateAlumni.filter((a) => !a.listedInIndia);
  return {
    named: rize.alumni.length,
    total,
    founderConfirmed: alumni.filter((a) => a.founderOnYcPage).length,
    listedInIndia: inIndia.length,
    listedInUs: inUs.length,
    noLocation: total - inIndia.length - inUs.length,
    // n is below the minimum sample, so this comes back flagged and the UI shows counts only.
    shareListedOutsideIndia: rateWithMinN(total - inIndia.length, total),
    active: alumni.filter((a) => a.status === 'Active').length,
    indiaStates: [...new Set(inIndia.map((a) => a.state).filter(Boolean))].map((k) => ({ key: k, label: stateLabel(k) })),
    late: {
      from: late.from,
      to: late.to,
      directoryIndiaListed: late.india,
      rizeAlumniAmongIndiaListed: lateInIndia.length,
      rizeAlumniListedElsewhere: lateElsewhere.length,
      // Directory count plus Rize alumni the directory files under another country.
      lowerBoundIndiaEcosystemCompanies: late.india + lateElsewhere.length,
    },
    alumni: alumni
      .map(({ name, founder, ycName, ycUrl, batch, year, listedCountry, listedInIndia, state, status }) => ({ name, founder, ycName, ycUrl, batch, year, listedCountry, listedInIndia, state, status }))
      .sort((a, b) => a.year - b.year || a.name.localeCompare(b.name)),
  };
}

// ---------------------------------------------------------------------------
// Decision cards (and the calls the engine refuses to make)
//
// Each card carries a `strength`, set by what kind of evidence it rests on, not
// by a p-value. The DPIIT tables are complete counts with thousands of startups
// per state, so almost any gap passes a significance test; the Holm-corrected
// test is only a noise screen there. What limits those findings is confounding,
// and the strength label says so.
// ---------------------------------------------------------------------------
const STRENGTH = {
  direct: 'direct observation',
  clear: 'clear pattern',
  suggestive: 'suggestive',
};

function buildDecisions(market, yc, closure, rize) {
  const decisions = [];
  const withheld = [];
  const stateOf = (k) => market.states.find((x) => x.key === k);

  // 1. Where the YC directory files the companies Rize names as alumni.
  if (rize.total > 0 && rize.listedInUs > 0) {
    const l = rize.late;
    const mix = yc.allYcLocations;
    decisions.push({
      id: 'rize_alumni_listing',
      strength: STRENGTH.direct,
      title: `${rize.listedInUs} of the ${rize.total} YC companies on Rize's alumni wall are listed as US companies`,
      recommendation: `Public counts of "Indian startups in YC" are counts of locations, and most of the companies Rize names as alumni aren't in them. If Rize wants to show what Rize for YC contributes, the directory can't do it, but Rize's own records can. A per-batch count of Rize-supported and Indian-founder YC companies is a number only Rize can publish.`,
      metric: {
        label: 'Rize alumni by where YC lists them',
        value: `${rize.listedInUs} USA · ${rize.listedInIndia} India · ${rize.noLocation} no location`,
        comparison: `${rize.total} companies is below the minimum sample of ${MIN_N}, so no percentage is stated`,
      },
      evidence: [
        `Rize's public Rize for YC page names ${rize.named} YC companies. All ${rize.total} were found in the YC directory, and for ${rize.founderConfirmed} of them the founder Rize names appears on the company's own YC page.`,
        `Directory, ${l.from}–${l.to}: ${l.directoryIndiaListed} companies list India. ${l.rizeAlumniAmongIndiaListed} of those are on Rize's wall.`,
        `Another ${l.rizeAlumniListedElsewhere} companies on the wall from the same batches are listed under another country or none. Counting those, at least ${l.lowerBoundIndiaEcosystemCompanies} YC companies in ${l.from}–${l.to} have a link to India's founder ecosystem, not ${l.directoryIndiaListed}.`,
        `This is a YC-wide shift, not something particular to Rize: across all of YC, the share of companies listing San Francisco rose from ${pct(mix.early.sanFrancisco.rate, 0)} (${mix.early.from}–${mix.early.to}) to ${pct(mix.late.sanFrancisco.rate, 0)} (${mix.late.from}–${mix.late.to}).`,
        `Over the same period the directory's India share fell from ${pct(yc.eraTest.early.rate)} to ${pct(yc.eraTest.late.rate)}. Some of that fall is this change in where companies list themselves; how much can't be measured from outside.`,
      ],
      counterEvidence: `Being on the wall means a company used Rize's application help; it doesn't show that Rize is why it got in. The wall shows companies Rize chose to feature, so it isn't every founder Rize supported. Companies in a current batch may list San Francisco only while the batch runs. The page's headline says 18 founders while it names ${rize.named} companies.`,
      source: 'razorpay.com/rize/ycombinator + yc-oss YC directory + ycombinator.com company pages',
    });
  }

  // 2. Concentration in one state.
  const ycHigh = yc.tests.filter((t) => notableRatio(t) && t.rate > t.poolRate);
  if (ycHigh.length) {
    const c = yc.concentration;
    const alumniStates = rize.indiaStates.map((x) => x.label);
    decisions.push({
      id: 'yc_concentration',
      keys: ycHigh.map((t) => t.key),
      strength: STRENGTH.clear,
      title: `${listLabels(ycHigh)} supplies most of India's listed YC companies`,
      recommendation: `Report Rize for YC admits by the founder's home state, not the company's listed city. Admits from outside ${listLabels(ycHigh)} are the ones Rize can most credibly claim, and only Rize's application data can show them.`,
      metric: {
        label: `${c.label}'s share of India-listed YC admits, 2019–2023`,
        value: `${pct(c.shareOfAdmitsInterval.low, 0)} – ${pct(c.shareOfAdmitsInterval.high, 0)}`,
        comparison: `${c.label} has ${pct(c.shareOfRecognitions, 0)} of recognised startups`,
      },
      evidence: [
        ...ycHigh.map((t) => { const x = yc.states.find((y) => y.key === t.key); return `${x.label}: ${x.admits} admits from ${num(x.recognitions)} recognised startups (${per1000(x.rate)} per 1,000 vs ${per1000(t.poolRate)} elsewhere).`; }),
        alumniStates.length ? `All ${rize.listedInIndia} India-listed Rize alumni are in ${alumniStates.join(', ')}.` : null,
      ].filter(Boolean),
      counterEvidence: 'Much of this is relocation: founders from other states move to Bengaluru and list it as their location. The directory can\'t show where a founder started.',
      source: 'yc-oss YC directory + DPIIT recognitions (PIB, Feb 2024)',
    });
  }

  // 3. Growth, and 4. states that are growing fast but rarely reach YC.
  const fast = market.tests.filter((t) => notableShare(t) && t.effectSize > 0);
  const slow = market.tests.filter((t) => notableShare(t) && t.effectSize < 0);
  const ycLow = yc.tests.filter((t) => notableRatio(t) && t.rate < t.poolRate);
  const fastKeys = new Set(fast.map((t) => t.key));
  const underTapped = ycLow.filter((t) => fastKeys.has(t.key));
  if (underTapped.length) {
    const s = strongest(underTapped);
    const st = yc.states.find((x) => x.key === s.key);
    decisions.push({
      id: 'yc_under_tapped',
      keys: underTapped.map((t) => t.key),
      strength: STRENGTH.suggestive,
      title: `${listLabels(underTapped)}: worth a small Rize for YC pilot, not a conclusion`,
      recommendation: `${listLabels(underTapped)} ${underTapped.length > 1 ? 'are' : 'is'} growing fast in registered startups but almost never appear${underTapped.length > 1 ? '' : 's'} in YC. The likely reason is sector mix, not missed outreach. A cheap test would settle it: one application clinic there, measured on qualified applications.`,
      metric: {
        label: `${st.label}: YC admits per 1,000 recognised startups`,
        value: `${per1000(st.low)} – ${per1000(st.high)}`,
        comparison: `${per1000(s.poolRate)} in the rest of India`,
      },
      evidence: [
        ...underTapped.map((t) => { const x = yc.states.find((y) => y.key === t.key); const g = stateOf(t.key); return `${x.label}: ${x.admits} YC admit(s) from ${num(x.recognitions)} recognised startups in 2019–2023; recognitions grew ${g.growth.multiple.toFixed(1)}× (India ${market.nationalGrowth.toFixed(1)}×).`; }),
        `Gap must be at least ${MIN_RATE_RATIO}× and pass a Holm-corrected noise screen across ${yc.tests.length} states.`,
      ],
      counterEvidence: 'DPIIT recognition covers every kind of new business. A state heavy in manufacturing, trading or services will send few companies to YC whatever Rize does. This compares two different lists of companies, so it is not a conversion rate.',
      source: 'yc-oss YC directory + DPIIT recognitions (PIB, Feb 2024)',
    });
  }
  if (fast.length) {
    const s = strongest(fast);
    decisions.push({
      id: 'growth_shift',
      keys: fast.map((t) => t.key),
      strength: STRENGTH.suggestive,
      title: `Startup registrations are growing fastest outside the big hubs`,
      recommendation: `Registrations grew well above India's ${market.nationalGrowth.toFixed(1)}× in ${listLabels(fast)}${slow.length ? `, and well below it in ${listLabels(slow)}` : ''}. Before moving any events budget, check whether Rize's own sign-ups show the same shift. The "Try it on your data" screen does that comparison.`,
      metric: {
        label: `${stateOf(s.key).label}: growth in recognitions, 2019→2023`,
        value: `${stateOf(s.key).growth.multiple.toFixed(1)}×`,
        comparison: `${market.nationalGrowth.toFixed(1)}× for India overall`,
      },
      evidence: [
        ...fast.map((t) => { const x = stateOf(t.key); return `${x.label}: ${num(x.byYear['2019'])} → ${num(x.byYear['2023'])} (${x.growth.multiple.toFixed(1)}×).`; }),
        ...slow.map((t) => { const x = stateOf(t.key); return `${x.label} (slower): ${num(x.byYear['2019'])} → ${num(x.byYear['2023'])} (${x.growth.multiple.toFixed(1)}×).`; }),
        `These are complete government counts, so sampling error is not the concern. A state is listed only if its gap exceeds ${MIN_SHARE_GAP * 100} percentage points and passes a Holm-corrected noise screen across ${market.tests.length} states.`,
      ],
      counterEvidence: 'DPIIT recognition is opt-in. Several states tie local benefits to it, so a jump can mean a registration drive, not more founders. Company-incorporation counts would be the right cross-check; the free MCA data was not reachable for this build.',
      source: 'DPIIT recognitions by state (PIB, Feb 2024)',
    });
  }

  // A closure gap is only a decision if it survives the cohort-age check.
  const clean = closure.states.filter((s) => s.test.significant && s.notable && !s.confoundedByCohortAge);
  if (clean.length) {
    const s = clean.reduce((a, b) => (a.test.p <= b.test.p ? a : b));
    decisions.push({
      id: 'closure_gap',
      keys: clean.map((x) => x.key),
      strength: STRENGTH.suggestive,
      title: `${listLabels(clean)}: closure rate out of line with the rest of India`,
      recommendation: 'Recognised startups here are closing at a rate that growth alone does not explain. Check whether founder support after incorporation is weaker here.',
      metric: { label: `${s.label}: closed (dissolved/struck-off)`, value: `${pct(s.low)} – ${pct(s.high)}`, comparison: `${pct(s.test.poolRate)} elsewhere` },
      evidence: clean.map((x) => `${x.label}: ${num(x.closed)} of ${num(x.recognised)} recognised startups closed (${pct(x.rate)}).`),
      counterEvidence: `Closures (${closure.numeratorAsOf}) and recognitions (${closure.denominatorAsOf}) come from different dates.`,
      source: 'DPIIT closures (PIB, Dec 2025) + cumulative recognitions (PIB, Jul 2024)',
    });
  }

  // Withheld calls.
  withheld.push({
    id: 'india_share_withheld',
    title: 'India\'s true share of YC: not called',
    reason: [
      `The directory shows India's share falling from ${pct(yc.eraTest.early.rate)} to ${pct(yc.eraTest.late.rate)}, but it records where a company says it is, not where its founders are from. ${rize.listedInUs} of ${rize.total} Rize alumni are filed under the USA, and across all of YC the share listing San Francisco rose from ${pct(yc.allYcLocations.early.sanFrancisco.rate, 0)} to ${pct(yc.allYcLocations.late.sanFrancisco.rate, 0)}. So the fall in Indian-founder companies is smaller than the directory shows, by an amount public data can't measure.`,
    ],
    whatWouldSettleIt: 'A count of Indian-founder companies per YC batch. Rize for YC\'s application records are the closest thing to one.',
  });
  const confounded = closure.states.filter((s) => s.test.significant && s.notable && s.confoundedByCohortAge);
  const tooSmall = closure.states.filter((s) => s.test.significant && !s.notable);
  if (confounded.length || tooSmall.length) {
    withheld.push({
      id: 'closure_withheld',
      title: 'Closure rates by state: not called',
      reason: [
        ...confounded.map((s) => `${s.label}'s closure rate (${pct(s.rate)} vs ${pct(s.test.poolRate)} elsewhere) looks different, but ${s.label} is also one of the ${s.test.effectSize < 0 ? 'fastest' : 'slowest'}-growing states. Younger startups have had less time to close, so state totals can't separate a healthier ecosystem from a younger one.`),
        ...tooSmall.map((s) => `${s.label} (${pct(s.rate)} vs ${pct(s.test.poolRate)}) is under the ${MIN_RATE_RATIO}× size bar, so it isn't worth acting on.`),
      ],
      whatWouldSettleIt: 'Closures broken down by year of recognition for each state, so startups of the same age can be compared.',
    });
  }
  const young = yc.survival.filter((s) => s.tooNewToCall && s.n > 0);
  if (young.length) {
    withheld.push({
      id: 'yc_survival_withheld',
      title: 'Survival of recent YC companies: too new to call',
      reason: [
        `${young.map((s) => `${s.year} (n=${s.n})`).join(', ')}: fewer than ${yc.survivalMaturityYears} years old and below the minimum sample of ${MIN_N}. All ${rize.total} Rize alumni are still active, but ${rize.alumni.filter((a) => a.year >= young[0].year).length} of them are from these batches, so that says little yet.`,
      ],
      whatWouldSettleIt: `Time. These cohorts become readable once they are ${yc.survivalMaturityYears} years old.`,
    });
  }

  return { decisions, withheld, thresholds: { minShareGap: MIN_SHARE_GAP, minRateRatio: MIN_RATE_RATIO, minN: MIN_N } };
}

// ---------------------------------------------------------------------------
// Data-integrity checks
// ---------------------------------------------------------------------------
function buildChecks(sources, yc, rize) {
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
  checks.push({
    id: 'yc_mapping',
    description: 'Indian YC companies in 2019–2023 mapped to a state',
    pass: yc.unmappedInWindow / yc.admitsInWindow < 0.05,
    detail: `${yc.admitsInWindow - yc.unmappedInWindow} of ${yc.admitsInWindow} mapped (${yc.unmappedInWindow} unmapped; must be under 5%)`,
  });
  // The link-preview text in index.html is static HTML, so it can't read the data.
  // Fail the build if it ever disagrees with what the data says.
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const claim = `${rize.listedInUs} of the ${rize.total} YC companies`;
  checks.push({
    id: 'preview_text_matches_data',
    description: 'The link-preview text in index.html states the same alumni count as the data',
    pass: html.split(claim).length - 1 >= 2,
    detail: `expects "${claim}" in the description and og:description tags`,
  });
  checks.push({
    id: 'rize_alumni_founders_confirmed',
    description: 'For every matched company, the founder named by Rize appears on that company\'s YC page',
    pass: rize.founderConfirmed === rize.total,
    detail: `${rize.founderConfirmed} of ${rize.total} confirmed`,
  });
  checks.push({
    id: 'rize_alumni_matched',
    description: 'Every company named on the Rize for YC page was found in the YC directory',
    pass: rize.total === rize.named,
    detail: `${rize.total} of ${rize.named} matched`,
  });
  return { runAt: new Date().toISOString(), checks, overallPass: checks.every((c) => c.pass) };
}

function main() {
  const ids = ['dpiit_recognitions_by_year', 'dpiit_cumulative_jun2024', 'dpiit_closed_nov2025', 'yc_india', 'rize_yc_alumni'];
  const [rec, cum, closed, yc, rizeSrc] = ids.map(load);
  const sources = [rec, cum, closed];
  const landscape = load('landscape');

  const market = buildMarket(rec, cum);
  const ycOut = buildYc(yc, market);
  const closure = buildClosure(cum, closed, market);
  const rize = buildRize(rizeSrc, ycOut);
  const decisions = buildDecisions(market, ycOut, closure, rize);

  const strip = ({ tests, ...rest }) => rest;
  const real = {
    sources: [
      ...[...sources, yc, rizeSrc].map((s) => ({ id: s.id, title: s.title, release: s.release, url: s.url, asOf: s.asOf || null, fetchedAt: s.fetchedAt })),
      { id: landscape.id, title: landscape.title, release: landscape.release, url: null, asOf: null, fetchedAt: landscape.compiledOn },
    ],
    market: strip(market),
    yc: strip(ycOut),
    closure,
    rize,
    landscape,
    ...decisions,
  };
  fs.writeFileSync(path.join(DATA_DIR, 'real.json'), JSON.stringify(real, null, 2));
  const checks = buildChecks(sources, ycOut, rize);
  fs.writeFileSync(path.join(DATA_DIR, 'real_checks.json'), JSON.stringify(checks, null, 2));

  console.log(`Real-data decisions: ${decisions.decisions.map((d) => d.id).join(', ') || 'none'}`);
  console.log(`Withheld: ${decisions.withheld.map((d) => d.id).join(', ') || 'none'}`);
  console.log(`Data integrity: ${checks.checks.filter((c) => c.pass).length}/${checks.checks.length} checks pass`);
  if (!checks.overallPass) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export { buildMarket, buildYc, buildClosure, buildRize, buildDecisions };
