// real.js — the screens built on real, free, public data (data/real.json and
// data/real_checks.json, produced by server/real/analyze.js). Rendering only:
// every number shown here was computed server-side by stats.js.
import { pct, num, el } from './ui.js';

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
  const { rize, landscape } = real;
  const byId = Object.fromEntries(real.decisions.map((d) => [d.id, d]));
  const stats = landscape.rizePublicStats;
  const c = el('div', { class: 'brief' });

  c.appendChild(el('div', { class: 'brief-head' }, [
    el('div', { class: 'brief-kicker' }, 'A brief for the Razorpay Rize team'),
    el('h1', {}, 'Most of Rize\'s YC alumni don\'t show up as Indian startups'),
    el('p', { class: 'lede' }, `I looked up every company on Rize's public YC alumni wall in Y Combinator's own directory. Most are listed in San Francisco, not India, so the counts people quote for "Indian startups in YC" don't include them. This page uses only free public sources, and it says so when the data can't support a call.`),
  ]));

  const heroes = el('div', { class: 'hero-grid' });
  const hero = (value, label, sub, href) => heroes.appendChild(el('a', { class: 'hero card', href }, [el('div', { class: 'hero-value' }, value), el('div', { class: 'hero-label' }, label), el('div', { class: 'hero-sub' }, sub)]));
  hero(`${rize.listedInUs} of ${rize.total}`, 'companies on Rize\'s YC alumni wall are listed as US companies', `${rize.listedInIndia} are listed in India, all in ${rize.indiaStates.map((s) => s.label).join(', ')}. YC's directory records where a company is now, not where its founders started.`, '#yc');
  hero(`${pct(real.yc.allYcLocations.early.sanFrancisco.rate, 0)} → ${pct(real.yc.allYcLocations.late.sanFrancisco.rate, 0)}`, 'of all YC companies list San Francisco', `${real.yc.allYcLocations.early.from}–${real.yc.allYcLocations.early.to} against ${real.yc.allYcLocations.late.from}–${real.yc.allYcLocations.late.to}. The move to San Francisco is YC-wide, not particular to Rize's alumni, and it is part of why India's listed share fell.`, '#yc');
  hero(`${stats.companyRegistrations}`, 'company registrations on Rize\'s homepage', `Next to ${stats.communityFounders} founders in the community. Whether that gap is by design is the first thing I'd ask.`, '#brief-questions');
  c.appendChild(heroes);

  // The Brief carries only the findings that stand on their own; the weaker
  // leads live on the Other Findings screen.
  c.appendChild(el('h2', {}, 'What it means'));
  const actions = el('ol', { class: 'action-list' });
  for (const d of real.decisions.filter((x) => x.strength !== 'suggestive')) {
    actions.appendChild(el('li', {}, [el('strong', {}, d.title + '. '), d.recommendation, ' ', el('span', { class: `confidence-tag ${strengthClass(d.strength)}` }, d.strength)]));
  }
  c.appendChild(actions);
  const weaker = real.decisions.filter((x) => x.strength === 'suggestive').length;
  c.appendChild(el('p', {}, [
    el('a', { href: '#post' }, 'How I would turn this into a post and a campaign →'),
    weaker ? el('span', { class: 'source-note' }, [' · ', el('a', { href: '#real-decisions' }, `${weaker} weaker leads and the full evidence`)]) : null,
  ]));

  c.appendChild(el('h2', { id: 'brief-questions' }, 'What I can\'t see from outside'));
  c.appendChild(el('p', {}, 'Public data stops at Rize\'s front door. These are the questions I would want to ask before recommending anything with money attached.'));
  const qs = el('ol', { class: 'action-list' });
  [
    `Rize's homepage shows ${stats.companyRegistrations} company registrations and ${stats.communityFounders} founders in the community. Is the community meant to be selective, or are founders registering and not coming back?`,
    'When a founder Rize supported gets into YC and moves to San Francisco, how does Rize stay in touch with them? They are the people best placed to mentor the next batch of applicants.',
    `Which states do Rize for YC applicants come from? The directory lists every India-based alumnus in ${rize.indiaStates.map((s) => s.label).join(', ')}, but it can't show where they started.`,
    'What will count as success for the Global Readiness Program and Founder-Buddy, and when is the first cohort old enough to judge?',
  ].forEach((q) => qs.appendChild(el('li', {}, q)));
  c.appendChild(qs);

  c.appendChild(el('h2', {}, 'What I wouldn\'t call'));
  const refused = el('ul', { class: 'action-list' });
  for (const w of real.withheld) refused.appendChild(el('li', {}, [el('strong', {}, w.title + '. '), w.reason[0]]));
  c.appendChild(refused);

  c.appendChild(el('h2', {}, 'If I had Rize\'s own data: a 90-day plan'));
  c.appendChild(el('p', { class: 'chart-note' }, 'A proposal, not a finding.'));
  const plan = el('div', { class: 'plan-grid' });
  const step = (when, title, body) => plan.appendChild(el('div', { class: 'card plan-step' }, [el('div', { class: 'plan-when' }, when), el('div', { class: 'plan-title' }, title), el('p', {}, body)]));
  step('Days 1–30', 'Own the number', 'Build the per-batch count of Rize-supported and Indian-founder YC companies from Rize\'s application records, and publish it. Nobody else can.');
  step('Days 31–60', 'Find where Rize under-reaches', 'Compare Rize registrations and community sign-ups by state with each state\'s startup base. The "Try it on your data" screen already does this in the browser.');
  step('Days 61–90', 'Make new programmes readable', 'Fix the success measure and the waiting period for the Global Readiness Program and Founder-Buddy before results arrive, so the first readout isn\'t chosen after the fact.');
  c.appendChild(plan);

  c.appendChild(el('p', { class: 'source-note' }, [
    'Independent project. Not a Razorpay product, and it contains no internal Rize data. ',
    el('a', { href: '#about' }, 'Who built this and how'),
    ' · ',
    el('a', { href: '#integrity' }, 'Data checks'),
    ' · ',
    el('a', { href: '#validation' }, 'How the engine is tested'),
  ]));
  return c;
}

// "Winter 2024" -> "W24". Spring gets "Sp" so it can't be read as Summer.
function shortBatch(batch) {
  const [season, year] = batch.split(' ');
  return `${season === 'Spring' ? 'Sp' : season[0]}${year.slice(2)}`;
}

function strengthClass(strength) {
  return strength === 'suggestive' ? 'confidence-medium' : 'confidence-high';
}

// ---------------------------------------------------------------------------
// Screen: Founder map (where India's startups are, and where they're growing)
// ---------------------------------------------------------------------------
export function renderMarket(state) {
  const { market, closure } = state.real;
  const c = el('div');
  c.appendChild(el('p', { class: 'lede' }, `New DPIIT-recognised startups by state. Growth is 2023 recognitions ÷ 2019 recognitions. These are complete government counts, not samples, so the question isn't whether a gap is real but what explains it: DPIIT recognition is opt-in, and some states push founders to register. The whisker shows how much the multiple would move from ordinary year-to-year noise. States with fewer than 30 recognitions in 2019 are left out.`));

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
    tipOf: (s) => `<strong>${s.label}</strong><br>${num(s.byYear['2019'])} → ${num(s.byYear['2023'])} recognitions<br>${s.growth.multiple.toFixed(1)}× (95%: ${s.growth.low.toFixed(1)}–${s.growth.high.toFixed(1)}×)<br>${s.test.significant ? 'Clearly different from the rest of India' : 'Within noise of the rest of India'}`,
  }));
  card.appendChild(el('p', { class: 'chart-note' }, 'Faded bars: within noise of the rest of India.'));
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
    el('h3', {}, 'Closed (dissolved/struck-off) recognised startups: descriptive only'),
    el('p', { class: 'chart-note' }, `Not used for decisions. Fast-growing states have younger startups that have had less time to close, so a low closure rate there may only reflect age. See "Not called" on the Other Findings screen. Closures are as of ${closure.numeratorAsOf}; recognitions are as of ${closure.denominatorAsOf}.`),
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
  c.appendChild(el('p', { class: 'lede' }, `${yc.totalIndiaCompanies} YC companies list India as their location. That is not the same as Indian-founder companies, as the companies on Rize's own alumni wall show.`));

  const { rize } = state.real;
  c.appendChild(el('div', { class: 'card' }, [
    el('h3', {}, `Rize's YC alumni, and where YC's directory lists them`),
    el('p', { class: 'chart-note' }, `${rize.listedInUs} listed in the USA, ${rize.listedInIndia} in India, ${rize.noLocation} with no location. ${rize.total} companies is below the minimum sample of 30, so counts are shown and no percentage is claimed. Names are from Rize's public page; several companies have renamed since. For ${rize.founderConfirmed} of ${rize.total}, the founder Rize names also appears on the company's YC page.`),
    el('p', { class: 'chart-note' }, `Context: across all of YC, ${pct(yc.allYcLocations.late.sanFrancisco.rate, 0)} of companies in ${yc.allYcLocations.late.from}–${yc.allYcLocations.late.to} list San Francisco, up from ${pct(yc.allYcLocations.early.sanFrancisco.rate, 0)} in ${yc.allYcLocations.early.from}–${yc.allYcLocations.early.to}. Listing a US location is now the norm for a YC company, wherever its founders are from.`),
    table(['Named by Rize', 'Founder (per Rize)', 'In YC directory as', 'Batch', 'Listed in', 'Status'], rize.alumni.map((a) => [
      a.name, a.founder || '—', el('a', { href: a.ycUrl, target: '_blank', rel: 'noopener' }, a.ycName), a.batch,
      a.listedInIndia ? el('span', { class: 'pill pill-green' }, 'India') : el('span', { class: 'pill pill-muted' }, a.listedCountry || 'not stated'),
      a.status,
    ])),
    sourceNote(state.real, ['rize_yc_alumni', 'yc_india']),
  ]));

  const share = el('div', { class: 'card' }, [el('h3', {}, 'India\'s share of each year\'s YC companies')]);
  share.appendChild(intervalColumnChart({
    rows: yc.shareByYear,
    format: (v) => pct(v, 0),
    tipOf: (r) => `<strong>${r.year}</strong><br>${r.india} of ${num(r.total)} YC companies were Indian<br>${pct(r.rate)} (95%: ${pct(r.low)}–${pct(r.high)})`,
  }));
  share.appendChild(el('p', { class: 'chart-note' }, `Whiskers show the 95% range. ${yc.eraTest.early.from}–${yc.eraTest.early.to}: ${pct(yc.eraTest.early.rate)}; ${yc.eraTest.late.from}–${yc.eraTest.late.to}: ${pct(yc.eraTest.late.rate)}. This counts companies that list India as their location. Most companies on Rize's wall don't, so the fall in Indian-founder companies is smaller than this chart shows.`));
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
  c.appendChild(el('p', { class: 'lede' }, `Each card is labelled by the kind of evidence behind it. "Direct observation" is a count anyone can check. "Clear pattern" is a large gap that survives the obvious objections. "Suggestive" means the gap is real but something else could explain it, and the card says what. A gap only counts if it is at least ${thresholds.minShareGap * 100} percentage points (for shares) or ${thresholds.minRateRatio}× (for rare events). The calls the engine refused to make follow the cards.`));
  for (const card of decisions) {
    const dc = el('div', { class: 'card decision-card' });
    dc.appendChild(el('div', { style: 'display:flex;justify-content:space-between;align-items:flex-start;gap:12px' }, [
      el('div', { class: 'dc-title' }, card.title),
      el('span', { class: `confidence-tag ${strengthClass(card.strength)}`, style: 'white-space:nowrap' }, card.strength),
    ]));
    dc.appendChild(el('div', { class: 'dc-rec' }, card.recommendation));
    dc.appendChild(el('div', { class: 'dc-section-label' }, card.metric.label));
    dc.appendChild(el('p', { style: 'margin:0;font-size:13px' }, `${card.metric.value} (${card.metric.comparison})`));
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
      for (const reason of w.reason) ul.appendChild(el('li', {}, reason));
      wc.appendChild(ul);
      wc.appendChild(el('div', { class: 'dc-section-label' }, 'What would settle it'));
      wc.appendChild(el('p', { style: 'margin:0;font-size:13px' }, w.whatWouldSettleIt));
      c.appendChild(wc);
    }
  }
  return c;
}

// ---------------------------------------------------------------------------
// Screen: Draft post (the finding, turned into something Rize could publish)
// ---------------------------------------------------------------------------
export function renderPost(state) {
  const { rize } = state.real;
  const l = rize.late;
  const inIndia = rize.alumni.filter((a) => a.listedInIndia);
  const elsewhere = rize.alumni.filter((a) => !a.listedInIndia);
  const firstBatch = rize.alumni[0].batch;
  const lastBatch = rize.alumni[rize.alumni.length - 1].batch;
  const c = el('div', { class: 'brief' });

  c.appendChild(el('p', { class: 'lede' }, 'A finding is only useful to a marketing team if it turns into something they can publish. This is how I would turn this one into a post and a small recurring campaign. The draft is mine, written as a suggestion; Rize has not published or approved it, and Rize would replace my counts with its own.'));

  const paras = [
    `Count the Indian startups in Y Combinator's directory since ${l.from} and you get ${l.directoryIndiaListed}.`,
    'That count is missing most of the founders we worked with.',
    `Of the ${rize.total} YC companies on our alumni wall, ${rize.listedInUs} list a US address and ${rize.listedInIndia} list India. The directory records where a company is today. It doesn't record where its founders started.`,
    'So from this batch on, we\'ll keep the count ourselves: how many founders who prepared with Rize for YC got in, and where they are building now.',
    `The count so far: ${rize.total} companies, ${firstBatch} to ${lastBatch}.`,
    'Applying to the next batch? Start with the application reviewer. Link in the comments.',
  ];
  c.appendChild(el('div', { class: 'card post-draft' }, [
    el('div', { class: 'plan-when' }, 'Draft LinkedIn post, in Rize\'s voice'),
    ...paras.map((p) => el('p', {}, p)),
  ]));

  const group = (title, list) => el('div', { class: 'card', style: 'margin:0' }, [
    el('h3', {}, `${title} (${list.length})`),
    el('div', { class: 'chip-row' }, list.map((a) => el('span', { class: 'chip' }, `${a.name} · ${shortBatch(a.batch)}`))),
  ]);
  c.appendChild(el('h2', {}, 'The image that goes with it'));
  c.appendChild(el('p', { class: 'chart-note' }, 'Company names and batches, grouped by where YC\'s directory lists them. Twenty names is few enough to show every one.'));
  c.appendChild(el('div', { class: 'plan-grid' }, [group('Listed in India', inIndia), group('Listed in the US or not stated', elsewhere)]));

  c.appendChild(el('h2', {}, 'The campaign around it'));
  const plan = el('div', { class: 'plan-grid' });
  const step = (when, title, body) => plan.appendChild(el('div', { class: 'card plan-step' }, [el('div', { class: 'plan-when' }, when), el('div', { class: 'plan-title' }, title), el('p', {}, body)]));
  step('Every batch', 'The Rize YC count', 'One post per YC batch with the updated count and the new names. A number that changes on a schedule gives people a reason to come back, and gives Rize a reason to post that isn\'t an announcement.');
  step('Between batches', 'Where they are now', 'Short founder notes from alumni: what they changed in the application, what the interview asked, what they would do differently. Founders in San Francisco are the hardest for a Bengaluru applicant to reach, and Rize already knows them.');
  step('Once', 'Give writers the right number', 'Anyone writing about Indian founders in YC has only the directory to count from. A short note with Rize\'s own count, and how it was counted, gives them a better number and makes Rize the source.');
  c.appendChild(plan);

  c.appendChild(el('h2', {}, 'How I would know if it worked'));
  const ul = el('ul', { class: 'action-list' });
  [
    'Visits to the application reviewer from the post, tracked with a tagged link, against the same weeks before the previous batch deadline.',
    'Completed reviews, not clicks. A founder who uploads an application is the outcome; a like is not.',
    'Whether the count gets quoted outside Rize\'s own channels within one batch cycle.',
  ].forEach((x) => ul.appendChild(el('li', {}, x)));
  c.appendChild(ul);
  c.appendChild(el('p', { class: 'source-note' }, ['The counts in the draft are read from the same data as the ', el('a', { href: '#yc' }, 'Rize for YC'), ' screen and update with it.']));
  return c;
}

// ---------------------------------------------------------------------------
// Screen: Landscape
// ---------------------------------------------------------------------------
export function renderLandscape(state) {
  const { landscape } = state.real;
  const c = el('div');
  c.appendChild(el('p', { class: 'lede' }, `The programmes an early-stage Indian founder is likely to weigh against Rize, from each one's public pages (compiled ${landscape.compiledOn}). Credit amounts change often; each card says how it was checked.`));
  const grid = el('div', { class: 'programme-grid' });
  for (const p of landscape.programmes) {
    grid.appendChild(el('div', { class: 'card programme' }, [
      el('div', { class: 'plan-when' }, p.by),
      el('h3', {}, el('a', { href: p.url, target: '_blank', rel: 'noopener' }, p.name)),
      el('span', { class: p.kind === 'credits' ? 'pill pill-muted' : 'pill pill-blue' }, `Leads with: ${p.leadOffer}`),
      el('p', {}, p.detail),
      el('dl', {}, [
        el('dt', {}, 'Who can get in'), el('dd', {}, p.entryBar),
        el('dt', {}, 'Meets the founder'), el('dd', {}, p.meetsFounder),
        el('dt', {}, 'Checked against'), el('dd', {}, p.verified),
      ]),
    ]));
  }
  c.appendChild(grid);
  c.appendChild(el('div', { class: 'card' }, [
    el('h3', {}, 'My read'),
    el('p', { class: 'chart-note' }, 'Opinion, not data.'),
    el('ul', { class: 'action-list' }, landscape.read.map((x) => el('li', {}, x))),
  ]));
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
      s.url ? el('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.title) : s.title, s.release, s.asOf || '—', s.fetchedAt.slice(0, 10),
    ])),
    el('p', { class: 'chart-note' }, 'Snapshots are committed to the repository (sources/), so anyone can rebuild these exact numbers. Run `npm run fetch` to refresh them.'),
  ]));
  return c;
}
