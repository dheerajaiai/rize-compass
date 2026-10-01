// app.js — tiny hash-router SPA. All numbers come from the precomputed JSON
// files in /data, produced by server/generate.js -> server/decisions.js ->
// server/validate.js. Nothing here computes a statistic; it only renders one.

const state = {};

async function loadData() {
  const [dimensions, funnel, programs, lab, decisions, validation] = await Promise.all([
    fetchJSON('data/dimensions.json'),
    fetchJSON('data/funnel.json'),
    fetchJSON('data/programs.json'),
    fetchJSON('data/city_community_lab.json'),
    fetchJSON('data/decisions.json'),
    fetchJSON('data/validation_result.json'),
  ]);
  Object.assign(state, { dimensions, funnel, programs, lab, decisions, validation });
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------
function pct(x, digits = 1) {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  return (x * 100).toFixed(digits) + '%';
}
function num(x) {
  if (x === null || x === undefined) return '—';
  return x.toLocaleString('en-IN');
}
function intervalText(stage) {
  if (!stage || stage.insufficientData) return null;
  if (stage.low === null || stage.high === null) return null;
  return `95% CI: ${pct(stage.low)} – ${pct(stage.high)}`;
}
function confidenceClass(label) {
  if (!label) return 'confidence-low';
  if (label === 'high') return 'confidence-high';
  if (label === 'medium') return 'confidence-medium';
  return 'confidence-low';
}
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
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
      <p>Rize Compass is a statistically honest decision-support demo, built independently
      after the Razorpay Rize x Replit Buildathon. It is <strong>not a Razorpay product</strong> and contains
      <strong>no real Rize data</strong> — every founder, city-level rate, and program number
      in this build is synthetic and generated to illustrate the method.</p>
      <p>What's real: the program names and structure (Rize for YC, Global Readiness Program,
      Founder-Buddy Program, buildathons), the three founder communities (Tech+, D2C+, Xport+),
      and the fact that GRP and Founder-Buddy genuinely just launched — which is exactly why
      this tool refuses to give them a confident outcome verdict.</p>
    </div>
    <div class="card">
      <h2>The method, not the domain</h2>
      <p>The statistics layer is domain-agnostic: Wilson confidence intervals on every rate,
      empirical-Bayes shrinkage so small samples can't fake their way to the top of a ranking,
      a hard minimum-sample rule that forces "insufficient data" instead of a guess,
      Holm-corrected significance testing across every comparison family, and a signal-lift
      analysis to catch when the wrong engagement metric is being over-weighted. None of it
      is specific to startup programs — the same code would work pointed at a sales pipeline,
      a support queue, or a hiring funnel.</p>
      <p>An LLM, if one were wired in, would only ever extract or phrase — quoting evidence
      spans and writing recommendation text. It would never compute a number. This build ships
      without a live LLM call at all: every number and every sentence on these screens comes
      from plain, unit-tested code.</p>
    </div>
    <div class="card">
      <h2>Why this exists</h2>
      <p>Built as a conversation piece, not a pitch. The honest framing matters more than the
      polish: this is what a statistically disciplined read of Rize's own funnel could look like,
      and the Validation screen shows its receipts rather than asking you to take its word for it.</p>
    </div>
    <footer class="disclaimer">Buildathon-adjacent independent project. Illustrative data only. No affiliation with or endorsement by Razorpay implied.</footer>
  `;
  return container;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
const ROUTES = {
  funnel: { title: 'Funnel', render: renderFunnel },
  programs: { title: 'Program Performance', render: renderPrograms },
  lab: { title: 'City & Community Lab', render: renderLab },
  decisions: { title: 'Decisions', render: renderDecisions },
  validation: { title: 'Validation', render: renderValidation },
  about: { title: 'About', render: renderAbout },
};

function navigate() {
  const route = (location.hash || '#funnel').slice(1);
  const config = ROUTES[route] || ROUTES.funnel;
  document.getElementById('screen-title').textContent = config.title;
  document.querySelectorAll('.sidebar nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === route);
  });
  const app = document.getElementById('app');
  app.innerHTML = '';
  app.appendChild(config.render());
}

window.addEventListener('hashchange', navigate);

loadData()
  .then(navigate)
  .catch((err) => {
    document.getElementById('app').textContent = 'Failed to load data: ' + err.message;
    console.error(err);
  });
