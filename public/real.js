// real.js — the screens built on real, free, public data (data/real.json and
// data/real_checks.json, produced by server/real/analyze.js). Rendering only:
// every number shown here was computed server-side by stats.js.
import { pct, num, confidenceClass, el } from './ui.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function per1000(x) {
  return x === null || x === undefined ? '—' : (x * 1000).toFixed(2);
}

function sigTag(test) {
  if (!test) return el('span', { class: 'pill pill-muted' }, 'not tested');
  return test.significant
    ? el('span', { class: 'pill pill-blue' }, test.effectSize > 0 ? 'above rest ↑' : 'below rest ↓')
    : el('span', { class: 'pill pill-muted' }, 'no clear difference');
}

function table(headers, rows) {
  const t = el('table');
  const thead = el('thead');
  const hr = el('tr');
  for (const h of headers) hr.appendChild(el('th', {}, h));
  thead.appendChild(hr);
  t.appendChild(thead);
  const tbody = el('tbody');
  for (const r of rows) {
    const tr = el('tr');
    for (const c of r) tr.appendChild(el('td', {}, c));
    tbody.appendChild(tr);
  }
  t.appendChild(tbody);
  return el('div', { class: 'table-wrap' }, t);
}

function sourceNote(real, ids) {
  const srcs = real.sources.filter((s) => ids.includes(s.id));
  const p = el('p', { class: 'source-note' }, 'Source: ');
  srcs.forEach((s, i) => {
    if (i) p.appendChild(document.createTextNode(' · '));
    p.appendChild(el('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.release));
    if (s.asOf) p.appendChild(document.createTextNode(` (data as of ${s.asOf})`));
  });
  return p;
}

// Floating tooltip shared by all charts.
let tooltip;
function showTip(evt, html) {
  if (!tooltip) {
    tooltip = el('div', { class: 'chart-tip', role: 'tooltip' });
    document.body.appendChild(tooltip);
  }
  tooltip.innerHTML = html;
  tooltip.style.display = 'block';
  const x = Math.min(evt.clientX + 14, window.innerWidth - tooltip.offsetWidth - 8);
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${evt.clientY + 14}px`;
}
function hideTip() {
  if (tooltip) tooltip.style.display = 'none';
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

// Horizontal bars with interval whiskers and an optional reference line.
function intervalBarChart({ rows, valueOf, lowOf, highOf, labelOf, reference, referenceLabel, format, tipOf, mutedOf }) {
  const rowH = 26;
  const left = 150;
  const right = 60;
  const width = 640;
  const top = 18;
  const height = top + rows.length * rowH + 22;
  const max = Math.max(...rows.map(highOf).filter((v) => v !== null), reference || 0) * 1.05;
  const x = (v) => left + (v / max) * (width - left - right);

  const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart', role: 'img' });
  // recessive gridlines
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = (max / ticks) * i;
    root.appendChild(svg('line', { x1: x(v), x2: x(v), y1: top - 6, y2: height - 20, class: 'grid' }));
    root.appendChild(svg('text', { x: x(v), y: height - 6, class: 'axis', 'text-anchor': 'middle' }, format(v)));
  }
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    const v = valueOf(r);
    const muted = mutedOf ? mutedOf(r) : false;
    const g = svg('g', { class: muted ? 'mark muted' : 'mark' });
    g.appendChild(svg('text', { x: left - 10, y: y + rowH / 2 + 4, class: 'label', 'text-anchor': 'end' }, labelOf(r)));
    g.appendChild(svg('rect', { x: left, y: y + 6, width: Math.max(x(v) - left, 2), height: rowH - 12, rx: 4, class: 'bar' }));
    const lo = lowOf(r);
    const hi = highOf(r);
    if (lo !== null && hi !== null) {
      g.appendChild(svg('line', { x1: x(lo), x2: x(hi), y1: y + rowH / 2, y2: y + rowH / 2, class: 'whisker' }));
      g.appendChild(svg('line', { x1: x(lo), x2: x(lo), y1: y + 8, y2: y + rowH - 8, class: 'whisker' }));
      g.appendChild(svg('line', { x1: x(hi), x2: x(hi), y1: y + 8, y2: y + rowH - 8, class: 'whisker' }));
    }
    g.appendChild(svg('text', { x: Math.max(x(hi ?? v), x(v)) + 6, y: y + rowH / 2 + 4, class: 'value' }, format(v)));
    // generous hit target
    const hit = svg('rect', { x: 0, y, width, height: rowH, class: 'hit' });
    hit.addEventListener('mousemove', (e) => showTip(e, tipOf(r)));
    hit.addEventListener('mouseleave', hideTip);
    g.appendChild(hit);
    root.appendChild(g);
  });
  if (reference !== undefined) {
    root.appendChild(svg('line', { x1: x(reference), x2: x(reference), y1: top - 10, y2: height - 20, class: 'reference' }));
    root.appendChild(svg('text', { x: x(reference) + 4, y: top - 6, class: 'axis' }, referenceLabel));
  }
  return el('div', { class: 'chart-wrap' }, root);
}

// Vertical columns over time with interval whiskers.
function intervalColumnChart({ rows, format, tipOf }) {
  const width = 640;
  const height = 240;
  const left = 44;
  const bottom = 28;
  const top = 12;
  const max = Math.max(...rows.map((r) => r.high ?? r.rate)) * 1.1;
  const colW = (width - left - 10) / rows.length;
  const y = (v) => height - bottom - (v / max) * (height - bottom - top);

  const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart', role: 'img' });
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    root.appendChild(svg('line', { x1: left, x2: width - 10, y1: y(v), y2: y(v), class: 'grid' }));
    root.appendChild(svg('text', { x: left - 6, y: y(v) + 4, class: 'axis', 'text-anchor': 'end' }, format(v)));
  }
  rows.forEach((r, i) => {
    const cx = left + i * colW + colW / 2;
    const g = svg('g', { class: r.insufficientData ? 'mark muted' : 'mark' });
    const bw = Math.min(colW - 6, 30);
    g.appendChild(svg('rect', { x: cx - bw / 2, y: y(r.rate), width: bw, height: Math.max(y(0) - y(r.rate), 2), rx: 4, class: 'bar' }));
    if (r.low !== null && r.high !== null) {
      g.appendChild(svg('line', { x1: cx, x2: cx, y1: y(r.low), y2: y(r.high), class: 'whisker' }));
      g.appendChild(svg('line', { x1: cx - 5, x2: cx + 5, y1: y(r.high), y2: y(r.high), class: 'whisker' }));
      g.appendChild(svg('line', { x1: cx - 5, x2: cx + 5, y1: y(r.low), y2: y(r.low), class: 'whisker' }));
    }
    g.appendChild(svg('text', { x: cx, y: height - 10, class: 'axis', 'text-anchor': 'middle' }, String(r.year).slice(2).padStart(3, "'")));
    const hit = svg('rect', { x: cx - colW / 2, y: top, width: colW, height: height - top - bottom, class: 'hit' });
    hit.addEventListener('mousemove', (e) => showTip(e, tipOf(r)));
    hit.addEventListener('mouseleave', hideTip);
    g.appendChild(hit);
    root.appendChild(g);
  });
  return el('div', { class: 'chart-wrap' }, root);
}

// ---------------------------------------------------------------------------
// Screen: Brief
// ---------------------------------------------------------------------------
export function renderBrief(state) {
  const real = state.real;
  const c = el('div', { class: 'brief' });
  const byId = Object.fromEntries(real.decisions.map((d) => [d.id, d]));
  const conc = real.yc.concentration;
  const era = real.yc.eraTest;
  const under = byId.yc_under_tapped;
  const underState = under && real.yc.states.find((s) => s.key === under.keys[0]);
  const underGrowth = under && real.market.states.find((s) => s.key === under.keys[0]);

  c.appendChild(el('div', { class: 'brief-head' }, [
    el('div', { class: 'brief-kicker' }, 'Brief · Razorpay Rize marketing'),
    el('h1', {}, 'Where Rize should look for its next founders'),
    el('p', { class: 'lede' }, `A data brief built only on free, public sources: the government's own state-wise startup tables (DPIIT, via written replies in Parliament) and Y Combinator's public company directory. Every number on this page comes with its uncertainty, and the engine says so when it can't make a call.`),
  ]));

  const heroes = el('div', { class: 'hero-grid' });
  const hero = (value, label, sub, href) => {
    const h = el('a', { class: 'hero card', href }, [el('div', { class: 'hero-value' }, value), el('div', { class: 'hero-label' }, label), el('div', { class: 'hero-sub' }, sub)]);
    heroes.appendChild(h);
  };
  hero(pct(conc.shareOfAdmits, 0), `of India's YC companies (2019–23) are in ${conc.label}`, `${conc.label} has only ${pct(conc.shareOfRecognitions, 0)} of India's recognised startups. 95% range ${pct(conc.shareOfAdmitsInterval.low, 0)}–${pct(conc.shareOfAdmitsInterval.high, 0)}.`, '#yc');
  hero(pct(era.late.rate), `India's share of YC, ${era.late.from}–${era.late.to}`, `Down from ${pct(era.early.rate)} in ${era.early.from}–${era.early.to}. Getting Indian founders into YC is much harder than it was.`, '#yc');
  if (underState && underGrowth) {
    hero(`${underGrowth.growth.multiple.toFixed(1)}×`, `${underState.label}'s growth in recognised startups, 2019→2023`, `India grew ${real.market.nationalGrowth.toFixed(1)}×. Yet ${underState.label} produced ${underState.admits} YC admit${underState.admits === 1 ? '' : 's'} from ${num(underState.recognitions)} recognised startups.`, '#market');
  }
  c.appendChild(heroes);

  c.appendChild(el('h2', {}, 'What I would do with this at Rize'));
  const actions = el('ol', { class: 'action-list' });
  for (const id of ['yc_under_tapped', 'yc_concentration', 'growth_shift', 'yc_india_share', 'women_led_gap']) {
    const d = byId[id];
    if (!d) continue;
    actions.appendChild(el('li', {}, [el('strong', {}, d.title + '. '), d.recommendation, ' ', el('a', { href: '#real-decisions' }, 'Evidence →')]));
  }
  c.appendChild(actions);

  c.appendChild(el('h2', {}, 'What the engine refused to call'));
  const refused = el('ul', { class: 'action-list' });
  for (const w of real.withheld) refused.appendChild(el('li', {}, [el('strong', {}, w.title + '. '), w.reason[0]]));
  c.appendChild(refused);

  c.appendChild(el('h2', {}, 'What public data cannot see, and a 90-day plan for what Rize\'s own data would add'));
  const plan = el('div', { class: 'plan-grid' });
  const step = (when, title, body) => plan.appendChild(el('div', { class: 'card plan-step' }, [el('div', { class: 'plan-when' }, when), el('div', { class: 'plan-title' }, title), el('p', {}, body)]));
  step('Days 1–30', 'Rize coverage by state', 'Divide Rize incorporations and community sign-ups by each state\'s startup base to see where Rize over- or under-indexes. The "Try it on your data" screen already does this in the browser, and nothing leaves the page.');
  step('Days 31–60', 'Rize for YC: credit the marginal admit', 'Join Rize for YC applications to YC outcomes by state, and report admits from outside Karnataka as the headline number, because those are the ones Rize can most credibly claim.');
  step('Days 61–90', 'Make GRP and Founder-Buddy readable on a schedule', 'Fix the outcome definition and the window before results arrive, so the first readout is decided in advance and not chosen after the fact. Until then, report them as "too new to call".');
  c.appendChild(plan);

  c.appendChild(el('p', { class: 'source-note' }, [
    'Not a Razorpay product, and contains no Rize data. Method check (synthetic data with planted answers): ',
    el('a', { href: '#validation' }, 'Validation'),
    '. Data checks on the public sources: ',
    el('a', { href: '#integrity' }, 'Data integrity'),
    '.',
  ]));
  return c;
}

// ---------------------------------------------------------------------------
// Screen: Founder map (where India's startups are, and where they're growing)
// ---------------------------------------------------------------------------
export function renderMarket(state) {
  const { market, women, closure } = state.real;
  const c = el('div');
  c.appendChild(el('p', { class: 'lede' }, `New DPIIT-recognised startups by state. Growth is 2023 recognitions ÷ 2019 recognitions; the bar is the measured multiple and the whisker is its 95% range. Each state is tested against the rest of India, Holm-corrected across ${market.states.filter((s) => s.test).length} states. States with fewer than 30 recognitions in 2019 aren't tested.`));

  const tested = market.states.filter((s) => s.growth).sort((a, b) => b.growth.multiple - a.growth.multiple);
  const card = el('div', { class: 'card' }, [el('h3', {}, 'Growth in recognised startups, 2019 → 2023')]);
  card.appendChild(intervalBarChart({
    rows: tested,
    valueOf: (s) => s.growth.multiple,
    lowOf: (s) => s.growth.low,
    highOf: (s) => s.growth.high,
    labelOf: (s) => s.label,
    reference: market.nationalGrowth,
    referenceLabel: `India ${market.nationalGrowth.toFixed(1)}×`,
    format: (v) => `${v.toFixed(1)}×`,
    mutedOf: (s) => !s.test.significant,
    tipOf: (s) => `<strong>${s.label}</strong><br>${num(s.byYear['2019'])} → ${num(s.byYear['2023'])} recognitions<br>${s.growth.multiple.toFixed(1)}× (95%: ${s.growth.low.toFixed(1)}–${s.growth.high.toFixed(1)}×)<br>${s.test.significant ? 'Differs from rest of India after Holm correction' : 'Not distinguishable from rest of India'}`,
  }));
  card.appendChild(el('p', { class: 'chart-note' }, 'Faded bars: not statistically different from the rest of India.'));
  c.appendChild(card);

  c.appendChild(el('div', { class: 'card' }, [
    el('h3', {}, 'All states'),
    table(['State', '2019', '2023', 'Growth (95%)', 'Share of India 2019 → 2023', 'vs rest'], market.states.map((s) => [
      s.label,
      num(s.byYear['2019']),
      num(s.byYear['2023']),
      s.growth ? `${s.growth.multiple.toFixed(1)}× (${s.growth.low.toFixed(1)}–${s.growth.high.toFixed(1)})` : 'insufficient data',
      `${pct(s.shareOfNational2019)} → ${pct(s.shareOfNational2023)}`,
      sigTag(s.test),
    ])),
    sourceNote(state.real, ['dpiit_recognitions_by_year']),
  ]));

  c.appendChild(el('div', { class: 'card' }, [
    el('h3', {}, 'Startups with at least one woman director or partner, 2019–2023'),
    el('p', { class: 'chart-note' }, `About ${pct(women.national.rate, 0)} nationally. This counts companies with a woman director, which is not the same as woman-founded.`),
    table(['State', 'With a woman director', 'Recognised', 'Share (95%)', 'vs rest'], women.states.map((s) => [
      s.label, num(s.womenLed), num(s.recognised), `${pct(s.rate)} (${pct(s.low)}–${pct(s.high)})`, sigTag(s.test),
    ])),
    sourceNote(state.real, ['dpiit_women_by_year', 'dpiit_recognitions_by_year']),
  ]));

  c.appendChild(el('div', { class: 'card' }, [
    el('h3', {}, 'Closed (dissolved/struck-off) recognised startups: descriptive only'),
    el('p', { class: 'chart-note' }, `Not used for decisions. Fast-growing states have younger startups that have had less time to close, so a low closure rate there may only reflect age. See "Not called" on the Decisions screen. Closures are as of ${closure.numeratorAsOf}; recognitions are as of ${closure.denominatorAsOf}.`),
    table(['State', 'Closed', 'Recognised', 'Rate (95%)', 'Confounded by age?'], closure.states.map((s) => [
      s.label, num(s.closed), num(s.recognised), `${pct(s.rate)} (${pct(s.low)}–${pct(s.high)})`, s.confoundedByCohortAge ? 'yes' : '—',
    ])),
    sourceNote(state.real, ['dpiit_closed_nov2025', 'dpiit_cumulative_jun2024']),
  ]));
  return c;
}

// ---------------------------------------------------------------------------
// Screen: YC pipeline
// ---------------------------------------------------------------------------
export function renderYc(state) {
  const { yc } = state.real;
  const c = el('div');
  c.appendChild(el('p', { class: 'lede' }, `${yc.totalIndiaCompanies} YC companies list India as a region. These are matched to the government's startup counts by state. That gives an index of how strongly each state's founders reach YC, not a tracked conversion rate: the two lists are different populations, and founders often move to Bengaluru before they apply.`));

  const share = el('div', { class: 'card' }, [el('h3', {}, 'India\'s share of each year\'s YC companies')]);
  share.appendChild(intervalColumnChart({
    rows: yc.shareByYear,
    format: (v) => pct(v, 0),
    tipOf: (r) => `<strong>${r.year}</strong><br>${r.india} of ${num(r.total)} YC companies were Indian<br>${pct(r.rate)} (95%: ${pct(r.low)}–${pct(r.high)})`,
  }));
  share.appendChild(el('p', { class: 'chart-note' }, `Whiskers show the 95% range. ${yc.eraTest.early.from}–${yc.eraTest.early.to}: ${pct(yc.eraTest.early.rate)}; ${yc.eraTest.late.from}–${yc.eraTest.late.to}: ${pct(yc.eraTest.late.rate)}. The split year was chosen after looking at the series, so the significance test is descriptive.`));
  share.appendChild(table(['Year', 'Indian', 'All YC', 'Share (95%)'], yc.shareByYear.map((r) => [String(r.year), String(r.india), num(r.total), r.insufficientData ? 'insufficient data' : `${pct(r.rate)} (${pct(r.low)}–${pct(r.high)})`])));
  c.appendChild(share);

  const ranked = [...yc.states].sort((a, b) => b.adjustedRate - a.adjustedRate);
  const states = el('div', { class: 'card' }, [
    el('h3', {}, 'YC admits per 1,000 recognised startups, by state (2019–2023)'),
    el('p', { class: 'chart-note' }, `"Adjusted" applies empirical-Bayes shrinkage, so a state with few startups can't rank high on one lucky admit. ${yc.unmappedInWindow} of ${yc.admitsInWindow} companies had no mappable state.`),
    table(['State', 'YC admits', 'Recognised', 'Per 1,000 (95%)', 'Adjusted', 'vs rest'], ranked.map((s) => [
      s.label, String(s.admits), num(s.recognitions), `${per1000(s.rate)} (${per1000(s.low)}–${per1000(s.high)})`, per1000(s.adjustedRate), sigTag(s.test),
    ])),
    sourceNote(state.real, ['yc_india', 'dpiit_recognitions_by_year']),
  ]);
  c.appendChild(states);

  c.appendChild(el('div', { class: 'card' }, [
    el('h3', {}, 'How many Indian YC companies are now inactive, by batch year'),
    el('p', { class: 'chart-note' }, `A cohort is reported only if it has at least 30 companies and is at least ${yc.survivalMaturityYears} years old.`),
    table(['Batch year', 'Companies', 'Inactive', 'Inactive rate (95%)'], yc.survival.map((s) => [
      String(s.year), String(s.n), String(s.inactive),
      s.tooNewToCall ? el('span', { class: 'too-new-badge', style: 'margin:0' }, 'Too new to call') : s.insufficientData ? el('span', { class: 'pill pill-muted' }, 'Sample too small') : `${pct(s.rate)} (${pct(s.low)}–${pct(s.high)})`,
    ])),
  ]));
  return c;
}

// ---------------------------------------------------------------------------
// Screen: Decisions (real data)
// ---------------------------------------------------------------------------
export function renderRealDecisions(state) {
  const { decisions, withheld, thresholds } = state.real;
  const c = el('div');
  c.appendChild(el('p', { class: 'lede' }, `Each card passed a Holm-corrected significance test across its whole comparison family and cleared a minimum size bar: ${thresholds.minShareGap * 100} percentage points for shares, or ${thresholds.minRateRatio}× for rare events. The calls the engine refused to make are listed below the cards, with the reason.`));
  for (const card of decisions) {
    const dc = el('div', { class: 'card decision-card' });
    dc.appendChild(el('div', { style: 'display:flex;justify-content:space-between;align-items:flex-start;gap:12px' }, [
      el('div', { class: 'dc-title' }, card.title),
      el('span', { class: `confidence-tag ${confidenceClass(card.confidence)}` }, card.confidence),
    ]));
    dc.appendChild(el('div', { class: 'dc-rec' }, card.recommendation));
    dc.appendChild(el('div', { class: 'dc-section-label' }, 'Impact range (95%)'));
    dc.appendChild(el('p', { style: 'margin:0;font-size:13px' }, `${card.impactRange.label}: ${card.impactRange.low} – ${card.impactRange.high} (vs. ${card.impactRange.vsPool})`));
    dc.appendChild(el('div', { class: 'dc-section-label' }, 'Evidence'));
    const ul = el('ul');
    for (const e of card.evidence) ul.appendChild(el('li', {}, e));
    dc.appendChild(ul);
    dc.appendChild(el('div', { class: 'dc-section-label' }, 'What could make this wrong'));
    dc.appendChild(el('div', { class: 'dc-counter' }, card.counterEvidence));
    dc.appendChild(el('p', { class: 'source-note', style: 'margin-bottom:0' }, `Source: ${card.source}`));
    c.appendChild(dc);
  }
  if (withheld.length) {
    c.appendChild(el('h2', { style: 'margin-top:28px' }, 'Not called'));
    for (const w of withheld) {
      const wc = el('div', { class: 'card withheld-card' });
      wc.appendChild(el('div', { style: 'display:flex;justify-content:space-between;gap:12px' }, [el('div', { class: 'dc-title' }, w.title), el('span', { class: 'pill pill-muted' }, 'withheld')]));
      const ul = el('ul');
      for (const r of w.reason) ul.appendChild(el('li', {}, r));
      wc.appendChild(ul);
      wc.appendChild(el('div', { class: 'dc-section-label' }, 'What would settle it'));
      wc.appendChild(el('p', { style: 'margin:0;font-size:13px' }, w.whatWouldSettleIt));
      c.appendChild(wc);
    }
  }
  return c;
}

// ---------------------------------------------------------------------------
// Screen: Data integrity
// ---------------------------------------------------------------------------
export function renderIntegrity(state) {
  const { real, realChecks } = state;
  const c = el('div');
  const passed = realChecks.checks.filter((x) => x.pass).length;
  c.appendChild(el('p', { class: 'lede' }, `Read from the last build (${new Date(realChecks.runAt).toLocaleString('en-IN')}). Each official table is parsed from the government's own HTML, and the parsed state rows must add up exactly to the total printed in the same table. If any check fails, the build fails and the site isn't deployed.`));
  c.appendChild(el('div', { class: 'card' }, [
    el('h2', { class: realChecks.overallPass ? 'validation-pass' : 'validation-fail' }, realChecks.overallPass ? `✅ ${passed}/${realChecks.checks.length} checks pass` : `❌ ${passed}/${realChecks.checks.length} checks pass`),
    ...realChecks.checks.map((x) => el('div', { class: 'check-row' }, [el('div', { class: 'check-icon' }, x.pass ? '✅' : '❌'), el('div', {}, [el('div', {}, x.description), el('div', { class: 'interval' }, x.detail)])])),
  ]));
  c.appendChild(el('div', { class: 'card' }, [
    el('h3', {}, 'Sources (all free and public)'),
    table(['Dataset', 'Published by', 'Data as of', 'Snapshot taken'], real.sources.map((s) => [
      el('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.title), s.release, s.asOf || '—', s.fetchedAt.slice(0, 10),
    ])),
    el('p', { class: 'chart-note' }, 'Snapshots are committed to the repository (sources/), so anyone can rebuild these exact numbers. Run `npm run fetch` to refresh them.'),
  ]));
  return c;
}
