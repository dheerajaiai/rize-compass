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

async function snapshotYc(all) {
  const batchTotals = {};
  // How many companies in each batch list a US or San Francisco location, across
  // all of YC. Context for reading any one group's location mix.
  const batchLocations = {};
  for (const c of all) {
    batchTotals[c.batch] = (batchTotals[c.batch] || 0) + 1;
    const b = (batchLocations[c.batch] ??= { total: 0, usa: 0, sanFrancisco: 0 });
    b.total += 1;
    if (/USA/.test(c.all_locations || '')) b.usa += 1;
    if (/San Francisco/.test(c.all_locations || '')) b.sanFrancisco += 1;
  }

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
    batchLocations,
    companies: india,
  };
  fs.writeFileSync(path.join(SOURCES_DIR, 'yc_india.json'), JSON.stringify(file, null, 2));
  console.log(`yc_india: ${india.length} of ${all.length} companies, ${india.filter((c) => !c.state).length} without a mappable state`);
}

const RIZE_YC_URL = 'https://razorpay.com/rize/ycombinator/';
const BATCH_CODES = { W: 'Winter', S: 'Summer', F: 'Fall', P: 'Spring', X: 'Spring' };

function normaliseName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Rize names its YC alumni on its public "Rize for YC" page as "Name (YC W24)".
// Each is matched to the YC directory by current or former name (several have
// renamed since), and by batch where the page gives one.
async function snapshotRizeAlumni(all) {
  const html = await get(RIZE_YC_URL);
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ')
    .replace(/<[^>]+>/g, '|')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
  const tokens = text.split('|').map((t) => t.trim()).filter(Boolean);

  // On the page, each company is followed by its founder's name.
  const named = new Map();
  tokens.forEach((t, i) => {
    const m = /^(.+?)\s*\(YC ([WSFPX])(\d{2})\)$/.exec(t);
    if (m) named.set(normaliseName(m[1]), { name: m[1].trim(), founder: tokens[i + 1] || null, batch: `${BATCH_CODES[m[2]]} 20${m[3]}` });
  });
  // Alumni shown without a batch label: a token in the same alumni block that is
  // exactly a YC company name.
  const first = tokens.findIndex((t) => /\(YC [WSFPX]\d{2}\)$/.test(t));
  const last = tokens.findLastIndex((t) => /\(YC [WSFPX]\d{2}\)$/.test(t));
  const ycNames = new Map(all.map((c) => [normaliseName(c.name), c]));
  tokens.slice(first, last + 4).forEach((t, i) => {
    const k = normaliseName(t);
    if (k.length > 6 && ycNames.has(k) && !named.has(k)) named.set(k, { name: t, founder: tokens[first + i + 1] || null, batch: null });
  });

  const stripAi = (k) => k.replace(/ai$/, '');
  const alumni = [];
  for (const a of named.values()) {
    const k = normaliseName(a.name);
    const match = all.find((c) => {
      if (a.batch && c.batch !== a.batch) return false;
      const names = [c.name, ...(c.former_names || [])].map(normaliseName);
      return names.some((n) => n === k || stripAi(n) === stripAi(k));
    });
    if (!match) {
      alumni.push({ ...a, matched: false });
      continue;
    }
    // Confirm the match independently: the founder Rize names must appear on
    // that company's own YC page.
    const ycPage = await get(match.url);
    const founderOnYcPage = !!a.founder && ycPage.includes(a.founder);
    const locations = (match.all_locations || '').split(';').map((x) => x.trim()).filter(Boolean);
    const first = locations.find((l) => l !== 'Remote') || null;
    const country = first ? first.split(',').pop().trim() : null;
    alumni.push({
      ...a,
      matched: true,
      founderOnYcPage,
      ycUrl: match.url,
      ycName: match.name,
      batch: match.batch,
      status: match.status,
      locations,
      listedCountry: country,
      state: first && /India$/.test(first) ? stateKeyFromYcLocation(first) : null,
    });
  }

  const file = {
    id: 'rize_yc_alumni',
    title: 'YC companies named as alumni on the Rize for YC page',
    release: 'razorpay.com/rize/ycombinator (public page), matched to the yc-oss YC directory',
    url: RIZE_YC_URL,
    fetchedAt: new Date().toISOString(),
    alumni,
  };
  fs.writeFileSync(path.join(SOURCES_DIR, 'rize_yc_alumni.json'), JSON.stringify(file, null, 2));
  console.log(`rize_yc_alumni: ${alumni.length} named, ${alumni.filter((a) => a.matched).length} matched, ${alumni.filter((a) => a.founderOnYcPage).length} confirmed by founder name`);
}

fs.mkdirSync(SOURCES_DIR, { recursive: true });
await snapshotPib();
const allYc = JSON.parse(await get(YC_URL));
await snapshotYc(allYc);
await snapshotRizeAlumni(allYc);
