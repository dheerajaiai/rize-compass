// generate.js — synthetic founder-lifecycle dataset with ground-truth effects
// baked in on purpose (see PRD.md "Planted findings"). Every number here is
// illustrative; only city/community/program names and the "GRP and
// Founder-Buddy just launched" fact are real public information about
// Razorpay Rize.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mulberry32, weightedChoice, bernoulli } from './rng.js';
import { CITIES, COMMUNITIES, CHANNELS, PROGRAMS } from './dimensions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const SEED = 1337;
const N_FOUNDERS = 9000;

function communityJoinRate(cityKey) {
  if (cityKey === 'mumbai') return 0.38; // looks_big_converts_badly
  return 0.72;
}

function activeRate(cityKey) {
  if (cityKey === 'chennai') return 0.8; // funnel_leak: strong active...
  return 0.58;
}

function appliedRateBase(cityKey) {
  if (cityKey === 'chennai') return 0.045; // ...weak applied (visibility/targeting gap)
  return 0.16;
}

function appliedRateForCommunity(baseRate, communityKey) {
  if (communityKey === 'xport_plus') return Math.min(0.55, baseRate * 2.6); // underinvested: disproportionate applications
  return baseRate;
}

function selectRateMultiplier(communityKey) {
  if (communityKey === 'xport_plus') return 1.8; // underinvested: disproportionate admit rate
  return 1.0;
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function generate(seed = SEED, n = N_FOUNDERS) {
  const rng = mulberry32(seed);
  const cityItems = CITIES.map((c) => ({ key: c.key, weight: c.weight }));
  const communityItems = COMMUNITIES.map((c) => ({ key: c.key, weight: c.weight }));
  const channelItems = CHANNELS.map((c) => ({ key: c.key, weight: c.weight }));
  const programItems = [
    { key: 'rize_for_yc', weight: 45 },
    { key: 'buildathon_program', weight: 35 },
    { key: 'grp', weight: 12 },
    { key: 'founder_buddy', weight: 8 },
  ];

  const founders = [];

  for (let i = 0; i < n; i++) {
    const city = weightedChoice(rng, cityItems);
    const community = weightedChoice(rng, communityItems);
    const channel = weightedChoice(rng, channelItems);

    const joinedCommunity = bernoulli(rng, communityJoinRate(city));
    let active = false;
    let genieUsage = null;
    let rsvpCount = null;
    let appliedProgram = null;
    let selected = null;
    let outcome = null;

    if (joinedCommunity) {
      active = bernoulli(rng, activeRate(city));
    }

    if (active) {
      const q = rng(); // latent "founder quality / momentum" signal
      genieUsage = clamp(Math.round(q * 18 + (rng() - 0.5) * 4), 0, 20);
      rsvpCount = clamp(Math.round(rng() * 10), 0, 10); // deliberately weak signal: noise, not tied to q

      const base = appliedRateForCommunity(appliedRateBase(city), community);
      const appliedProb = clamp(base * (0.4 + 1.2 * q), 0, 0.9);
      const applied = bernoulli(rng, appliedProb);

      if (applied) {
        appliedProgram = weightedChoice(rng, programItems);
        const program = PROGRAMS.find((p) => p.key === appliedProgram);
        const selRate = clamp(program.selectRate * selectRateMultiplier(community), 0, 0.95);
        selected = bernoulli(rng, selRate);
        if (selected) {
          outcome = program.outcomeRate === null ? null : bernoulli(rng, program.outcomeRate);
        } else {
          outcome = null;
        }
      }
    }

    founders.push({
      id: i,
      city,
      community,
      channel,
      incorporated: true,
      joinedCommunity,
      active,
      genieUsage,
      rsvpCount,
      appliedProgram,
      selected,
      outcome,
    });
  }

  return founders;
}

function groundTruth() {
  return {
    seed: SEED,
    nFounders: N_FOUNDERS,
    plantedFindings: [
      {
        id: 'looks_big_converts_badly',
        type: 'city',
        key: 'mumbai',
        description:
          'Mumbai has the largest incorporation volume of any city but a community-join rate far below the median — high volume does not mean high conversion.',
        expect: { metric: 'community_join_rate', direction: 'below_median', significant: true },
      },
      {
        id: 'underinvested_segment',
        type: 'community',
        key: 'xport_plus',
        description:
          'Xport+ is the smallest founder community by headcount but shows a disproportionately high program-application rate and admit/selection rate.',
        expect: { metric: 'applied_rate', direction: 'above_median', significant: true },
      },
      {
        id: 'signal_miscalibration',
        type: 'signal',
        key: 'genie_usage_vs_rsvp',
        description:
          'Rize Genie usage frequency predicts program application far better than event RSVP count, even though RSVP is the more commonly tracked engagement metric.',
        expect: { metric: 'signal_lift', direction: 'genie_greater_than_rsvp', significant: true },
      },
      {
        id: 'funnel_leak',
        type: 'city',
        key: 'chennai',
        description:
          'Chennai has a strong Active rate but a weak Active-to-Applied conversion — a visibility/targeting gap, not a demand gap.',
        expect: { metric: 'applied_rate', direction: 'below_median', significant: true },
      },
      {
        id: 'grp_insufficient_data',
        type: 'program',
        key: 'grp',
        description:
          'Global Readiness Program launched ~18 days ago. No founder selected into it has reached the 6-month outcome mark yet, so outcome rate must be reported as insufficient data, not a confident number.',
        expect: { metric: 'outcome_rate', direction: 'insufficient_data', significant: false },
      },
      {
        id: 'founder_buddy_insufficient_data',
        type: 'program',
        key: 'founder_buddy',
        description:
          'Founder-Buddy Program launched ~12 days ago. Same mechanism as GRP: outcome is not yet measurable.',
        expect: { metric: 'outcome_rate', direction: 'insufficient_data', significant: false },
      },
      {
        id: 'control_bengaluru',
        type: 'city',
        key: 'bengaluru',
        description: 'Bengaluru: healthy, near-median rates at every funnel stage with a large sample. Should trigger no decision card.',
        expect: { metric: 'any', direction: 'no_card', significant: false },
      },
      {
        id: 'control_pune',
        type: 'city',
        key: 'pune',
        description: 'Pune: healthy, near-median rates at every funnel stage with a large sample. Should trigger no decision card.',
        expect: { metric: 'any', direction: 'no_card', significant: false },
      },
      {
        id: 'control_ahmedabad',
        type: 'city',
        key: 'ahmedabad',
        description: 'Ahmedabad: healthy, near-median rates at every funnel stage with a large sample. Should trigger no decision card.',
        expect: { metric: 'any', direction: 'no_card', significant: false },
      },
    ],
  };
}

function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const founders = generate();
  fs.writeFileSync(path.join(DATA_DIR, 'founders.json'), JSON.stringify(founders));
  fs.writeFileSync(path.join(DATA_DIR, 'ground_truth.json'), JSON.stringify(groundTruth(), null, 2));
  fs.writeFileSync(
    path.join(DATA_DIR, 'dimensions.json'),
    JSON.stringify({ CITIES, COMMUNITIES, CHANNELS, PROGRAMS }, null, 2)
  );
  console.log(`Generated ${founders.length} synthetic founders -> data/founders.json`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export { generate, groundTruth };
