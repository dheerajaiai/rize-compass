// yours.js — "Try it on your data". Runs the same unit-tested stats.js that the
// build uses, but in the browser, on numbers the visitor pastes. Nothing is sent
// anywhere: there is no network call on this screen.
import { wilsonInterval, empiricalBayesShrink, testEntitiesVsRest, MIN_N } from './lib/stats.js';
import { num, el } from './ui.js';

const MIN_RATE_RATIO = 1.5;

function normalise(s) {
  return s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z]/g, '');
}

function parse(text, states) {
  const lookup = new Map();
  for (const s of states) {
    lookup.set(normalise(s.label), s);
    lookup.set(normalise(s.key), s);
  }
  const rows = [];
  const errors = [];
  for (const [i, raw] of text.split('\n').entries()) {
    const line = raw.trim();
    if (!line || /^state\s*,/i.test(line)) continue;
    const [name, value] = line.split(',').map((x) => x.trim());
    const st = lookup.get(normalise(name || ''));
    const count = Number((value || '').replace(/_/g, ''));
    if (!st) errors.push(`Line ${i + 1}: "${name}" isn't a recognised State/UT name or code.`);
    else if (!Number.isInteger(count) || count < 0) errors.push(`Line ${i + 1}: "${value}" isn't a whole number.`);
    else if (count > st.total) errors.push(`Line ${i + 1}: ${st.label} count (${num(count)}) is larger than its startup base (${num(st.total)}), so a rate can't be computed.`);
    else rows.push({ key: st.key, label: st.label, successes: count, n: st.total });
  }
  return { rows, errors };
}

function analyse(rows) {
  const testable = rows.filter((r) => r.n >= MIN_N);
  const tests = testEntitiesVsRest(testable, (r) => ({ successes: r.successes, n: r.n }));
  const testByKey = new Map(tests.map((t) => [t.key, t]));
  const shrunk = new Map(empiricalBayesShrink(testable).map((g) => [g.key, g]));
  return testable
    .map((r) => {
      const t = testByKey.get(r.key);
      const ratio = t.rateRatio;
      const notable = t.significant && ratio !== null && (ratio >= MIN_RATE_RATIO || ratio <= 1 / MIN_RATE_RATIO);
      return { ...r, ...wilsonInterval(r.successes, r.n), n: r.n, adjustedRate: shrunk.get(r.key).adjustedRate, test: t, ratio, notable };
    })
    .sort((a, b) => b.adjustedRate - a.adjustedRate);
}

function per1000(x) {
  return x === null || x === undefined ? '—' : (x * 1000).toFixed(1);
}

export function renderYours(state) {
  const states = state.real.market.states;
  const c = el('div');
  c.appendChild(el('p', { class: 'lede' }, 'Paste a count by state (for example Rize incorporations, community sign-ups or Rize for YC applications). The engine compares each state with its startup base (DPIIT recognitions, 2019–2023) and tells you where you over- or under-index, using the same intervals, shrinkage and Holm correction as the rest of this site. It runs entirely in your browser: nothing you paste is uploaded or stored.'));

  const input = el('textarea', { class: 'csv-input', rows: '10', spellcheck: 'false', 'aria-label': 'Counts by state, as CSV' });
  input.placeholder = 'state,count\nKarnataka,1200\nMaharashtra,1400\nGujarat,180\n…';
  const out = el('div');
  const run = el('button', { class: 'toggle-btn active', type: 'button' }, 'Analyse');
  const example = el('button', { class: 'toggle-btn', type: 'button' }, 'Load an invented example');

  example.addEventListener('click', () => {
    // Deliberately fake numbers, shaped like a metro-heavy programme, so the
    // screen can be tried without real data. Labelled as invented in the output.
    const metro = new Set(['KA', 'MH', 'DL', 'HR', 'TG']);
    input.value = 'state,count\n' + states
      .filter((s) => s.total >= MIN_N)
      .map((s) => `${s.label},${Math.round(s.total * (metro.has(s.key) ? 0.06 : 0.02))}`)
      .join('\n');
    input.dataset.example = 'true';
    run.click();
  });
  input.addEventListener('input', () => { delete input.dataset.example; });

  run.addEventListener('click', () => {
    out.innerHTML = '';
    const { rows, errors } = parse(input.value, states);
    if (errors.length) out.appendChild(el('div', { class: 'card dc-counter' }, [el('strong', {}, 'Skipped lines'), el('ul', {}, errors.map((e) => el('li', {}, e)))]));
    const results = analyse(rows);
    if (results.length < 2) {
      out.appendChild(el('p', {}, `Need at least two states with a startup base of ${MIN_N} or more to compare.`));
      return;
    }
    if (input.dataset.example) out.appendChild(el('div', { class: 'pill pill-amber', style: 'margin-bottom:12px' }, 'Invented example numbers, not real Rize data'));

    const under = results.filter((r) => r.notable && r.ratio < 1);
    const over = results.filter((r) => r.notable && r.ratio > 1);
    const summary = el('div', { class: 'card' }, [el('h3', {}, 'Summary')]);
    const line = (label, list) => summary.appendChild(el('p', {}, [el('strong', {}, label + ': '), list.length ? list.map((r) => `${r.label} (${r.ratio.toFixed(1)}× the rest)`).join(', ') : 'none that clear the bar']));
    line('Under-indexed', under);
    line('Over-indexed', over);
    summary.appendChild(el('p', { class: 'chart-note' }, `To count, a state must be significant after Holm correction across ${results.length} states and differ from the rest by at least ${MIN_RATE_RATIO}×.`));
    out.appendChild(summary);

    const t = el('table');
    t.appendChild(el('thead', {}, el('tr', {}, ['State', 'Your count', 'Startup base', 'Per 1,000 (95%)', 'Adjusted', 'vs rest'].map((h) => el('th', {}, h)))));
    const tb = el('tbody');
    for (const r of results) {
      tb.appendChild(el('tr', {}, [
        el('td', {}, r.label), el('td', {}, num(r.successes)), el('td', {}, num(r.n)),
        el('td', {}, `${per1000(r.rate)} (${per1000(r.low)}–${per1000(r.high)})`),
        el('td', {}, per1000(r.adjustedRate)),
        el('td', {}, r.notable ? el('span', { class: 'pill pill-blue' }, r.ratio > 1 ? 'over-indexed ↑' : 'under-indexed ↓') : el('span', { class: 'pill pill-muted' }, 'no clear difference')),
      ]));
    }
    t.appendChild(tb);
    out.appendChild(el('div', { class: 'card' }, el('div', { class: 'table-wrap' }, t)));
    const skipped = rows.length - results.length;
    if (skipped) out.appendChild(el('p', { class: 'chart-note' }, `${skipped} state(s) skipped: startup base below ${MIN_N}.`));
    out.appendChild(el('p', { class: 'chart-note' }, 'Base: DPIIT-recognised startups by state, 2019–2023 (PIB, Feb 2024).'));
  });

  c.appendChild(el('div', { class: 'card' }, [input, el('div', { class: 'toggle-row', style: 'margin:12px 0 0' }, [run, example])]));
  c.appendChild(out);
  return c;
}
