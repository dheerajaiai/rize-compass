// fetch.js — snapshots the free, public sources this build uses into sources/.
//
// Run manually (`npm run fetch`) when you want fresher data. The build itself
// never touches the network: it reads only the committed snapshots, so CI and
// anyone cloning the repo get exactly the numbers shown on the site.
//
// Sources:
//   - Press Information Bureau (PIB) releases of written Lok Sabha replies by the
//     Ministry of Commerce & Industry. Their annexures are the official
//     state-wise DPIIT startup tables. Parsed from the HTML <table> cells so a
//     blank cell stays in its column instead of shifting the row.
//   - yc-oss public API: a public mirror of Y Combinator's company directory.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stateKeyFromName, stateKeyFromYcLocation } from './states.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCES_DIR = path.join(__dirname, '..', '..', 'sources');

const PIB_TABLES = [
  {
    id: 'dpiit_recognitions_by_year',
    prid: '2002100',
    annexure: 'I',
    title: 'State/UT-wise number of DPIIT-recognised startups, 2019–2023',
    release: 'PIB, Ministry of Commerce & Industry, written reply in Lok Sabha, Feb 2024',
    asOf: '2023-12-31',
    columns: ['2019', '2020', '2021', '2022', '2023'],
  },
  {
    id: 'dpiit_cumulative_jun2024',
    prid: '2037579',
    annexure: 'I',
    title: 'State/UT-wise cumulative number of DPIIT-recognised startups',
    release: 'PIB, Ministry of Commerce & Industry, written reply in Lok Sabha, Jul 2024',
    asOf: '2024-06-30',
    columns: ['total'],
  },
  {
    id: 'dpiit_closed_nov2025',
    prid: '2197662',
    annexure: 'I',
    title: 'State/UT-wise DPIIT-recognised startups categorised as closed (dissolved/struck-off) per MCA',
    release: 'PIB, Ministry of Commerce & Industry, written reply in Lok Sabha, Dec 2025',
    asOf: '2025-11-11',
    columns: ['closed'],
  },
  {
    id: 'dpiit_women_by_year',
    prid: '2241313',
    annexure: 'I',
    title: 'State/UT-wise DPIIT-recognised startups with at least one woman director/partner, by year of recognition',
    release: 'PIB, Ministry of Commerce & Industry, written reply in Lok Sabha, Feb 2026',
    asOf: '2026-01-31',
    columns: ['2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026'],
  },
  {
    id: 'dpiit_women_closed',
    prid: '2241313',
    annexure: 'II',
    title: 'State/UT-wise closed (dissolved/struck-off) startups with at least one woman director/partner',
    release: 'PIB, Ministry of Commerce & Industry, written reply in Lok Sabha, Feb 2026',
    asOf: '2026-01-31',
    columns: ['closed'],
  },
];

const YC_URL = 'https://yc-oss.github.io/api/companies/all.json';

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (rize-compass data snapshot)' } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

function cellText(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Returns the first <table> after the given annexure heading.
function annexureTable(html, annexure) {
  // Some releases split the heading across tags: ANNEXURE-</strong><strong>I
  const heading = new RegExp(`ANNEXURE-\\s*(?:<[^>]+>\\s*)*${annexure}(?![IV])`);
  const m = heading.exec(html);
  if (!m) throw new Error(`Annexure ${annexure} not found`);
  const start = html.indexOf('<table', m.index);
  const end = html.indexOf('</table>', start);
  if (start < 0 || end < 0) throw new Error(`No table after Annexure ${annexure}`);
  const rows = [...html.slice(start, end).matchAll(/<tr[\s\S]*?<\/tr>/g)].map((r) =>
    [...r[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => cellText(c[1]))
  );
  return rows;
}

function parseNumber(cell) {
  if (cell === '' ) return { value: 0, blank: true };
  if (cell === '-' || cell === '–') return { value: 0, nil: true };
  const v = Number(cell.replace(/,/g, ''));
  return Number.isFinite(v) ? { value: v } : null;
}

function parsePibTable(spec, html) {
  const rows = annexureTable(html, spec.annexure);
  const out = [];
  let publishedTotal = null;
  const k = spec.columns.length;
  for (const cells of rows) {
    // The name column is the first cell naming a State/UT or a total; anything
    // before it is a serial-number column (sometimes an empty auto-numbered list).
    const nameIdx = cells.findIndex((x) => stateKeyFromName(x) || /total/i.test(x));
    if (nameIdx < 0) continue;
    const c = cells.slice(nameIdx);
    const name = c[0] || '';
    const valueCells = c.slice(1, 1 + k);
    if (valueCells.length !== k) continue;
    const parsed = valueCells.map(parseNumber);
    if (parsed.some((p) => p === null)) continue; // header row
    const values = Object.fromEntries(spec.columns.map((col, i) => [col, parsed[i].value]));
    const nilCells = parsed.filter((p) => p.nil || p.blank).length;
    if (/total/i.test(name)) {
      publishedTotal = values;
      continue;
    }
    const key = stateKeyFromName(name);
    out.push({ key, name, values, nilCells });
  }
  return { rows: out, publishedTotal };
}

async function snapshotPib() {
  const pages = new Map();
  for (const spec of PIB_TABLES) {
    const url = `https://www.pib.gov.in/PressReleasePage.aspx?PRID=${spec.prid}`;
    if (!pages.has(url)) pages.set(url, await get(url));
    let parsed;
    try { parsed = parsePibTable(spec, pages.get(url)); } catch (e) { throw new Error(`${spec.id} (${url}): ${e.message}`); }
    const { rows, publishedTotal } = parsed;
    const unmapped = rows.filter((r) => !r.key).map((r) => r.name);
    if (unmapped.length) throw new Error(`${spec.id}: unmapped state names: ${unmapped.join(', ')}`);
    const file = {
      id: spec.id,
      title: spec.title,
      release: spec.release,
      url,
      asOf: spec.asOf,
      fetchedAt: new Date().toISOString(),
      columns: spec.columns,
      publishedTotal,
      rows: rows.map(({ key, name, values, nilCells }) => ({ key, name, ...values, nilCells })),
    };
    fs.writeFileSync(path.join(SOURCES_DIR, `${spec.id}.json`), JSON.stringify(file, null, 2));
    console.log(`${spec.id}: ${rows.length} states, published total ${JSON.stringify(publishedTotal)}`);
  }
}

async function snapshotYc() {
  const all = JSON.parse(await get(YC_URL));
  const batchTotals = {};
  for (const c of all) batchTotals[c.batch] = (batchTotals[c.batch] || 0) + 1;

  const india = all
    .filter((c) => (c.regions || []).includes('India'))
    .map((c) => {
      const locations = (c.all_locations || '').split(';').map((s) => s.trim()).filter(Boolean);
      const indian = locations.find((l) => /India$/.test(l));
      return {
        name: c.name,
        slug: c.slug,
        batch: c.batch,
        status: c.status,
        industry: c.industry,
        locations,
        state: indian ? stateKeyFromYcLocation(indian) : null,
      };
    });

  const file = {
    id: 'yc_india',
    title: 'Y Combinator companies with an Indian region',
    release: 'yc-oss public mirror of the YC company directory',
    url: YC_URL,
    fetchedAt: new Date().toISOString(),
    totalCompanies: all.length,
    batchTotals,
    companies: india,
  };
  fs.writeFileSync(path.join(SOURCES_DIR, 'yc_india.json'), JSON.stringify(file, null, 2));
  console.log(`yc_india: ${india.length} of ${all.length} companies, ${india.filter((c) => !c.state).length} without a mappable state`);
}

fs.mkdirSync(SOURCES_DIR, { recursive: true });
await snapshotPib();
await snapshotYc();
