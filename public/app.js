// app.js — tiny hash-router SPA. All numbers come from the precomputed JSON
// files in /data, produced by server/generate.js -> server/decisions.js ->
// server/validate.js. Nothing here computes a statistic; it only renders one.

import { pct, num, intervalText, confidenceClass, el } from './ui.js';
import { renderBrief, renderMarket, renderYc, renderRealDecisions, renderIntegrity } from './real.js';
import { renderYours } from './yours.js';

const state = {};

async function loadData() {
  const [dimensions, funnel, programs, lab, decisions, validation, real, realChecks] = await Promise.all([
    fetchJSON('data/dimensions.json'),
    fetchJSON('data/funnel.json'),
    fetchJSON('data/programs.json'),
    fetchJSON('data/city_community_lab.json'),
    fetchJSON('data/decisions.json'),
    fetchJSON('data/validation_result.json'),
    fetchJSON('data/real.json'),
    fetchJSON('data/real_checks.json'),
  ]);
  Object.assign(state, { dimensions, funnel, programs, lab, decisions, validation, real, realChecks });
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Screen: Funnel
// ---------------------------------------------------------------------------
function renderFunnel() {
  const container = el('div');
  container.appendChild(
    el('p', { class: 'lede' },
      'Incorporated → Community → Active → Applied → Selected → Outcome. Every stage shows a Wilson confidence interval on its conversion rate, or "insufficient data" when the sample is too small to trust.'
    )
  );

  const sliceRow = el('div', { class: 'toggle-row' });
  const sliceSelect = el('select', { id: 'funnel-slice-type' }, [
    el('option', { value: 'overall' }, 'Overall'),
    el('option', { value: 'byCity' }, 'By city'),
    el('option', { value: 'byCommunity' }, 'By community'),
    el('option', { value: 'byChannel' }, 'By channel'),
  ]);
  const valueSelect = el('select', { id: 'funnel-slice-value', style: 'display:none;margin-left:8px' });
  sliceRow.appendChild(sliceSelect);
  sliceRow.appendChild(valueSelect);
  container.appendChild(sliceRow);

  const funnelBody = el('div', { class: 'card', id: 'funnel-body' });
  container.appendChild(funnelBody);

  function populateValueSelect(type) {
    valueSelect.innerHTML = '';
    if (type === 'overall') {
      valueSelect.style.display = 'none';
      return;
    }
    valueSelect.style.display = '';
    const dimKey = type === 'byCity' ? 'CITIES' : type === 'byCommunity' ? 'COMMUNITIES' : 'CHANNELS';
    for (const item of state.dimensions[dimKey]) {
      valueSelect.appendChild(el('option', { value: item.key }, item.label));
    }
  }

  function currentFunnelData() {
    const type = sliceSelect.value;
    if (type === 'overall') return state.funnel.overall;
    const key = valueSelect.value;
    return state.funnel[type][key];
  }

  const STAGE_ORDER = [
    ['incorporated', 'Incorporated'],
    ['joinedCommunity', 'Joined community'],
    ['active', 'Active'],
    ['applied', 'Applied to program'],
    ['selected', 'Selected'],
    ['outcome', 'Outcome (success)'],
  ];

  function renderFunnelBody() {
    const data = currentFunnelData();
    funnelBody.innerHTML = '';
    if (!data || data.n === 0) {
      funnelBody.appendChild(el('p', {}, 'No founders in this slice.'));
      return;
    }
    const maxN = data.n;
    for (const [key, label] of STAGE_ORDER) {
      const stage = data.stages[key];
      const widthPct = Math.max(2, (stage.n / maxN) * 100);
      const row = el('div', { class: 'funnel-stage' });
      row.appendChild(el('div', { class: 'stage-name' }, label));
      const track = el('div', { class: 'funnel-bar-track' });
      track.appendChild(el('div', { class: 'funnel-bar-fill', style: `width:${widthPct}%` }));
      row.appendChild(track);

      let rightText;
      if (key === 'incorporated') {
        rightText = `${num(stage.n)} founders`;
      } else if (stage.insufficientData) {
        rightText = `${num(stage.n)} — insufficient data`;
      } else {
        const iv = intervalText(stage);
        rightText = `${num(stage.n)} (${pct(stage.rate)}${iv ? ', ' + iv : ''})`;
      }
      row.appendChild(el('div', { class: 'stage-n' }, rightText));
      funnelBody.appendChild(row);
      if (stage.note) {
        funnelBody.appendChild(el('p', { style: 'font-size:12px;color:var(--muted);margin:-6px 0 6px 166px' }, stage.note));
      }
    }
  }

  sliceSelect.addEventListener('change', () => {
    populateValueSelect(sliceSelect.value);
    if (sliceSelect.value !== 'overall') valueSelect.selectedIndex = 0;
    renderFunnelBody();
  });
  valueSelect.addEventListener('change', renderFunnelBody);

  populateValueSelect('overall');
  renderFunnelBody();

  return container;
}

// ---------------------------------------------------------------------------
// Screen: Program Performance
// ---------------------------------------------------------------------------
function renderPrograms() {
  const container = el('div');
  container.appendChild(
    el('p', { class: 'lede' },
      'Per-program metrics with confidence intervals. Global Readiness Program and Founder-Buddy Program launched within the last month — nobody selected into either has reached the outcome-measurement mark yet, so their outcome rate is reported as insufficient data rather than guessed.'
    )
  );

  const grid = el('div', { class: 'grid' });
  for (const program of state.programs) {
    const card = el('div', { class: 'stat-card' });
    card.appendChild(el('div', { class: 'label' }, program.label));
    card.appendChild(el('div', { class: 'value' }, num(program.applied.n) + ' applied'));
    const selectedLine = program.selected.insufficientData
      ? el('div', { class: 'insufficient' }, 'Selection rate: insufficient data')
      : el('div', { class: 'interval' }, `Selected: ${num(program.selected.n)} (${pct(program.selected.rate)}, CI ${pct(program.selected.low)}–${pct(program.selected.high)})`);
    card.appendChild(selectedLine);

    if (program.outcome.tooNewToCall) {
      const row = el('div', { style: 'margin-top:8px' });
      row.appendChild(el('span', { class: 'too-new-badge' }, 'Too new to call'));
      row.appendChild(el('div', { class: 'interval', style: 'margin-top:6px' },
        `${num(program.outcome.selectedButUnmeasured)} selected founder(s) haven't reached the 180-day outcome mark.`));
      card.appendChild(row);
    } else if (program.outcome.insufficientData) {
      const row = el('div', { style: 'margin-top:8px' });
      row.appendChild(el('span', { class: 'pill pill-muted' }, 'Sample too small'));
      row.appendChild(el('div', { class: 'interval', style: 'margin-top:6px' },
        `Only ${num(program.outcome.n)} selected founder(s) have a measured outcome — below the minimum of 30 needed to state a rate.`));
      card.appendChild(row);
    } else {
      card.appendChild(el('div', { class: 'interval', style: 'margin-top:8px' },
        `Outcome: ${pct(program.outcome.rate)} (CI ${pct(program.outcome.low)}–${pct(program.outcome.high)}, n=${num(program.outcome.n)})`));
    }
    grid.appendChild(card);
  }
  container.appendChild(grid);
  return container;
}

// ---------------------------------------------------------------------------
// Screen: City & Community Lab
// ---------------------------------------------------------------------------
function renderLab() {
  const container = el('div');
  container.appendChild(
    el('p', { class: 'lede' },
      'Raw rates let small samples get lucky. Adjusted rates apply empirical-Bayes shrinkage toward the grand mean, pulling small-n groups back in line with what their sample size actually supports. Toggle to see which cities/communities only look good because of noise.'
    )
  );

  let mode = 'adjusted';

  const toggleRow = el('div', { class: 'toggle-row' });
  const rawBtn = el('button', { class: 'toggle-btn' }, 'Raw ranking');
  const adjBtn = el('button', { class: 'toggle-btn active' }, 'Adjusted ranking (recommended)');
  toggleRow.appendChild(rawBtn);
  toggleRow.appendChild(adjBtn);
  container.appendChild(toggleRow);

  const body = el('div');
  container.appendChild(body);

  function renderTable(title, labData) {
    const list = mode === 'raw' ? labData.raw : labData.adjusted;
    const card = el('div', { class: 'card' });
    card.appendChild(el('h3', {}, title));
    card.appendChild(el('p', { style: 'font-size:12px;color:var(--muted);margin-top:-4px' }, labData.metricLabel));
    const table = el('table');
    const thead = el('tr', {}, [el('th', {}, 'Rank'), el('th', {}, 'Name'), el('th', {}, 'n'), el('th', {}, 'Raw rate'), el('th', {}, 'Adjusted rate'), el('th', {}, '95% CI')]);
    table.appendChild(thead);
    for (const row of list) {
      const tr = el('tr', {}, [
        el('td', {}, el('span', { class: 'rank-badge' }, String(row.rank))),
        el('td', {}, row.label),
        el('td', {}, num(row.n)),
        el('td', {}, row.insufficientData ? '—' : pct(row.rawRate)),
        el('td', {}, pct(row.adjustedRate)),
        el('td', {}, row.insufficientData ? el('span', { class: 'insufficient' }, 'insufficient data') : `${pct(row.low)} – ${pct(row.high)}`),
      ]);
      table.appendChild(tr);
    }
    card.appendChild(table);
    return card;
  }

  function render() {
    body.innerHTML = '';
    body.appendChild(renderTable('Cities', state.lab.cities));
    body.appendChild(renderTable('Communities', state.lab.communities));
  }

  rawBtn.addEventListener('click', () => {
    mode = 'raw';
    rawBtn.classList.add('active');
    adjBtn.classList.remove('active');
    render();
  });
  adjBtn.addEventListener('click', () => {
    mode = 'adjusted';
    adjBtn.classList.add('active');
    rawBtn.classList.remove('active');
    render();
  });

  render();
  return container;
}

// ---------------------------------------------------------------------------
// Screen: Decisions
// ---------------------------------------------------------------------------
function renderDecisions() {
  const container = el('div');
  container.appendChild(
    el('p', { class: 'lede' },
      'Every card below cleared a Holm-corrected significance test across its whole comparison family, not just a single-comparison p-value. Each one lists what would make it wrong.'
    )
  );

  if (state.decisions.length === 0) {
    container.appendChild(el('p', {}, 'No findings clear the significance and effect-size bar this quarter.'));
    return container;
  }

  for (const card of state.decisions) {
    const dc = el('div', { class: 'card decision-card' });
    const headRow = el('div', { style: 'display:flex;justify-content:space-between;align-items:flex-start;gap:12px' });
    headRow.appendChild(el('div', { class: 'dc-title' }, card.title));
    headRow.appendChild(el('span', { class: `confidence-tag ${confidenceClass(card.confidence)}` }, card.confidence));
    dc.appendChild(headRow);
    dc.appendChild(el('div', { class: 'dc-rec' }, card.recommendation));

    dc.appendChild(el('div', { class: 'dc-section-label' }, 'Impact range'));
    dc.appendChild(el('p', { style: 'margin:0;font-size:13px' },
      `${card.impactRange.label}: ${card.impactRange.low} – ${card.impactRange.high} (vs. ${card.impactRange.vsPool})`));

    dc.appendChild(el('div', { class: 'dc-section-label' }, 'Evidence'));
    const ul = el('ul');
    for (const e of card.evidence) ul.appendChild(el('li', {}, e));
    dc.appendChild(ul);

    dc.appendChild(el('div', { class: 'dc-section-label' }, 'What could make this wrong'));
    dc.appendChild(el('div', { class: 'dc-counter' }, card.counterEvidence));

    container.appendChild(dc);
  }
  return container;
}

// ---------------------------------------------------------------------------
// Screen: Validation
// ---------------------------------------------------------------------------
function renderValidation() {
  const v = state.validation;
  const container = el('div');
  container.appendChild(
    el('p', { class: 'lede' },
      `Read straight from the last validation run (${new Date(v.runAt).toLocaleString()}), never hardcoded. It checks that every planted finding is recovered, that the control cities stay quiet, and that a shuffled-label negative control finds nothing.`
    )
  );

  const banner = el('div', { class: 'card' });
  banner.appendChild(el('h2', {}, v.overallPass ? '✅ Validation passed' : '⚠️ Validation found a miss'));
  banner.appendChild(el('p', { class: v.overallPass ? 'validation-pass' : 'validation-fail' },
    `${v.plantedFindings.filter(f => f.recovered).length}/${v.plantedFindings.length} planted findings recovered · ${v.negativeControl.totalFalsePositives} false positive(s) on the shuffled negative control`));
  container.appendChild(banner);

  const findingsCard = el('div', { class: 'card' });
  findingsCard.appendChild(el('h3', {}, 'Planted findings'));
  for (const f of v.plantedFindings) {
    const row = el('div', { class: 'check-row' });
    row.appendChild(el('div', { class: 'check-icon' }, f.recovered ? '✅' : '❌'));
    const text = el('div');
    text.appendChild(el('div', { style: 'font-weight:600;font-size:13px' }, f.description));
    text.appendChild(el('div', { style: 'font-size:12px;color:var(--muted);margin-top:2px' }, f.detail));
    row.appendChild(text);
    findingsCard.appendChild(row);
  }
  container.appendChild(findingsCard);

  const negCard = el('div', { class: 'card' });
  negCard.appendChild(el('h3', {}, 'Negative control: shuffled-label run'));
  negCard.appendChild(el('p', { style: 'font-size:13px;color:var(--muted)' },
    'Outcome labels were randomly reassigned, breaking any real relationship between city/community/signal and outcome. A trustworthy method should find nothing here.'));
  const nc = v.negativeControl;
  negCard.appendChild(el('ul', {}, [
    el('li', {}, `City community-join-rate family: ${nc.cityJoinFalsePositives.length} false positive(s)${nc.cityJoinFalsePositives.length ? ' — ' + nc.cityJoinFalsePositives.join(', ') : ''}`),
    el('li', {}, `City applied-rate family: ${nc.cityAppliedFalsePositives.length} false positive(s)${nc.cityAppliedFalsePositives.length ? ' — ' + nc.cityAppliedFalsePositives.join(', ') : ''}`),
    el('li', {}, `Community applied-rate family: ${nc.communityAppliedFalsePositives.length} false positive(s)${nc.communityAppliedFalsePositives.length ? ' — ' + nc.communityAppliedFalsePositives.join(', ') : ''}`),
    el('li', {}, `Signal-lift test: genie p=${nc.signalLiftShuffled.genieP.toExponential(2)}, rsvp p=${nc.signalLiftShuffled.rsvpP.toExponential(2)} — ${nc.signalLiftShuffled.falsePositive ? 'false positive' : 'clean'}`),
  ]));
  container.appendChild(negCard);

  return container;
}

// ---------------------------------------------------------------------------
// Screen: About
// ---------------------------------------------------------------------------
function renderAbout() {
  const container = el('div', { class: 'about-section' });
  container.innerHTML = `
    <div class="card">
      <h2>What this is</h2>
      <p>Rize Compass is an independent, statistically careful decision-support tool, built after
      the Razorpay Rize x Replit Buildathon for the people who decide where Rize spends its
      founder-acquisition effort. It is <strong>not a Razorpay product</strong> and contains
      <strong>no Rize data</strong>.</p>
      <p>It has two halves:</p>
      <ul>
        <li><strong>Real public data</strong> (Brief, Founder Map, YC Pipeline, Decisions): the
        government's state-wise startup tables, published as written replies in Parliament (PIB),
        and Y Combinator's public company directory. Every source is linked and snapshotted in the
        repository, and the parsed tables are checked against the totals the government printed.</li>
        <li><strong>Method check</strong> (synthetic): a generated founder funnel with
        six findings planted in it. Real data has no answer key, so this is where the engine
        proves it recovers what was planted and finds nothing in shuffled noise.</li>
      </ul>
    </div>
    <div class="card">
      <h2>How it decides</h2>
      <p>Every rate has a Wilson 95% interval. Fewer than 30 observations means "insufficient data",
      not a guess. Rankings use empirical-Bayes shrinkage, so a small state can't top a table on
      one lucky result. Every "each state vs the rest of India" family is Holm-corrected. A decision
      card only appears when a result is both significant and large enough to matter, and each card
      says what could make it wrong.</p>
      <p>When a pattern is significant but can't be separated from a confounder, the engine withholds
      the call and says why. Closure rates by state are one example: they look different, but the
      differences track how young each state's startups are.</p>
      <p>No LLM computes or writes anything here. Numbers and decision-card text come from plain,
      unit-tested code. The 90-day plan on the Brief is my own proposal, and it's labelled as one.</p>
    </div>
    <div class="card">
      <h2>Limits worth knowing</h2>
      <ul>
        <li>The state "funnel" joins two different populations (DPIIT-recognised startups and YC
        companies). It is an index of YC pull, not a tracked conversion.</li>
        <li>YC's location field is self-reported and reflects where companies are now. Founders
        who moved to Bengaluru or the US are counted there.</li>
        <li>DPIIT recognition is opt-in, and state policies affect how many founders register.</li>
      </ul>
    </div>
    <footer class="disclaimer">Independent project. Public data plus clearly labelled synthetic data. No affiliation with or endorsement by Razorpay implied.</footer>
  `;
  return container;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
// data: which kind of numbers the screen shows; drives the pill in the top bar.
const ROUTES = {
  brief: { title: 'Brief', data: 'real', render: () => renderBrief(state) },
  market: { title: 'Founder Map', data: 'real', render: () => renderMarket(state) },
  yc: { title: 'YC Pipeline', data: 'real', render: () => renderYc(state) },
  'real-decisions': { title: 'Decisions', data: 'real', render: () => renderRealDecisions(state) },
  yours: { title: 'Try It on Your Data', data: 'yours', render: () => renderYours(state) },
  integrity: { title: 'Data Integrity', data: 'real', render: () => renderIntegrity(state) },
  funnel: { title: 'Method Check · Funnel', data: 'synthetic', render: renderFunnel },
  programs: { title: 'Method Check · Programs', data: 'synthetic', render: renderPrograms },
  lab: { title: 'Method Check · Shrinkage Lab', data: 'synthetic', render: renderLab },
  decisions: { title: 'Method Check · Decisions', data: 'synthetic', render: renderDecisions },
  validation: { title: 'Method Check · Validation', data: 'synthetic', render: renderValidation },
  about: { title: 'About', data: 'none', render: renderAbout },
};

const PILLS = {
  real: ['pill pill-green', 'Real public data · DPIIT/PIB + YC directory'],
  synthetic: ['pill pill-amber', 'Synthetic data · planted answers, for testing the method'],
  yours: ['pill pill-blue', 'Your data · stays in your browser'],
  none: null,
};

function navigate() {
  const route = (location.hash || '#brief').slice(1);
  const config = ROUTES[route] || ROUTES.brief;
  document.getElementById('screen-title').textContent = config.title;
  const pill = document.getElementById('data-pill');
  const p = PILLS[config.data];
  pill.hidden = !p;
  if (p) [pill.className, pill.textContent] = p;
  window.scrollTo(0, 0);
  document.querySelectorAll('.sidebar nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === route);
  });
  const app = document.getElementById('app');
  app.innerHTML = '';
  app.appendChild(config.render());
}

// Listen for navigation only once data is loaded, so a click during loading
// can't render a screen against empty state.
loadData()
  .then(() => {
    window.addEventListener('hashchange', navigate);
    navigate();
  })
  .catch((err) => {
    document.getElementById('app').textContent = 'Failed to load data: ' + err.message;
    console.error(err);
  });
