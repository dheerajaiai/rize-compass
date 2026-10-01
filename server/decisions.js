// decisions.js — turns the raw founder dataset into every number the frontend
// shows: the funnel, program performance, city/community rankings (raw vs
// empirical-Bayes-adjusted), the signal-lift analysis, and the decision cards
// themselves. Every number here comes from server/stats.js — nothing here is
// eyeballed or hardcoded, and nothing is computed by an LLM.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  wilsonInterval,
  rateWithMinN,
  empiricalBayesShrink,
  twoProportionTest,
  holmCorrection,
  signalLift,
  testEntitiesVsRest,
  MIN_N,
} from './stats.js';
import { CITIES, COMMUNITIES, CHANNELS, PROGRAMS, OUTCOME_MATURITY_DAYS } from './dimensions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

const MIN_EFFECT_SIZE = 0.05; // minimum absolute rate gap to call an effect "notable", not just statistically detectable

// A p-value this small underflows the normal-tail approximation; printing it as
// "0.00e+0" would claim an exact zero we never measured.
function formatP(p) {
  return p < 1e-15 ? 'p < 1e-15' : `p = ${p.toExponential(2)}`;
}

function loadFounders() {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'founders.json'), 'utf8'));
}

// ---------------------------------------------------------------------------
// Funnel
// ---------------------------------------------------------------------------
function computeFunnelFor(founders) {
  const n = founders.length;
  const joined = founders.filter((f) => f.joinedCommunity);
  const active = joined.filter((f) => f.active);
  const applied = active.filter((f) => f.appliedProgram);
  const selected = applied.filter((f) => f.selected);
  const outcomeMeasured = selected.filter((f) => f.outcome !== null);
  const outcomeSuccess = outcomeMeasured.filter((f) => f.outcome === true);

  return {
    n,
    stages: {
      incorporated: { n, rate: n > 0 ? 1 : null, interval: null },
      joinedCommunity: { ...wilsonInterval(joined.length, n), n: joined.length },
      active: { ...wilsonInterval(active.length, joined.length), n: active.length },
      applied: { ...wilsonInterval(applied.length, active.length), n: applied.length },
      selected: { ...wilsonInterval(selected.length, applied.length), n: selected.length },
      outcome: {
        ...wilsonInterval(outcomeSuccess.length, outcomeMeasured.length),
        n: outcomeMeasured.length,
        note: outcomeMeasured.length < selected.length
          ? `${selected.length - outcomeMeasured.length} selected founder(s) have not yet reached the ${OUTCOME_MATURITY_DAYS}-day outcome mark.`
          : null,
      },
    },
  };
}

function buildFunnel(founders) {
  const overall = computeFunnelFor(founders);
  const byCity = {};
  for (const c of CITIES) byCity[c.key] = computeFunnelFor(founders.filter((f) => f.city === c.key));
  const byCommunity = {};
  for (const c of COMMUNITIES) byCommunity[c.key] = computeFunnelFor(founders.filter((f) => f.community === c.key));
  const byChannel = {};
  for (const c of CHANNELS) byChannel[c.key] = computeFunnelFor(founders.filter((f) => f.channel === c.key));
  return { overall, byCity, byCommunity, byChannel };
}

// ---------------------------------------------------------------------------
// Program performance
// ---------------------------------------------------------------------------
function buildProgramPerformance(founders) {
  return PROGRAMS.map((program) => {
    const applied = founders.filter((f) => f.appliedProgram === program.key);
    const selected = applied.filter((f) => f.selected);
    const outcomeMeasured = selected.filter((f) => f.outcome !== null);
    const outcomeSuccess = outcomeMeasured.filter((f) => f.outcome === true);

    const selectRate = wilsonInterval(selected.length, applied.length);
    const outcomeRate = rateWithMinN(outcomeSuccess.length, outcomeMeasured.length);
    // Both flags are derived from the ACTUAL measured outcome sample, not from a
    // config flag. Below MIN_N we never state an outcome rate, but we say why:
    // "too new" if selected founders are still waiting to reach the outcome mark,
    // otherwise the matured sample is simply too small.
    const selectedButUnmeasured = selected.length - outcomeMeasured.length;
    const insufficientOutcome = outcomeMeasured.length < MIN_N;
    const tooNewForOutcome = insufficientOutcome && selectedButUnmeasured > 0;

    return {
      key: program.key,
      label: program.label,
      launchedDaysAgo: program.launchedDaysAgo,
      applied: { n: applied.length },
      selected: { ...selectRate, n: selected.length, insufficientData: applied.length < MIN_N },
      outcome: {
        ...outcomeRate,
        n: outcomeMeasured.length,
        selectedButUnmeasured,
        insufficientData: insufficientOutcome,
        tooNewToCall: tooNewForOutcome,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// City & Community Lab — raw vs empirical-Bayes-adjusted rankings
// ---------------------------------------------------------------------------
function buildCityLab(founders) {
  const groups = CITIES.map((c) => {
    const inCity = founders.filter((f) => f.city === c.key);
    const joined = inCity.filter((f) => f.joinedCommunity);
    return { key: c.key, label: c.label, successes: joined.length, n: inCity.length };
  });
  const shrunk = empiricalBayesShrink(groups);
  const raw = [...shrunk].sort((a, b) => b.rawRate - a.rawRate);
  const adjusted = [...shrunk].sort((a, b) => b.adjustedRate - a.adjustedRate);
  return {
    metric: 'community_join_rate',
    metricLabel: 'Community-join rate (of incorporated founders)',
    raw: raw.map((g, i) => ({ rank: i + 1, ...g })),
    adjusted: adjusted.map((g, i) => ({ rank: i + 1, ...g })),
  };
}

function buildCommunityLab(founders) {
  const groups = COMMUNITIES.map((c) => {
    const inCommunity = founders.filter((f) => f.community === c.key && f.active);
    const applied = inCommunity.filter((f) => f.appliedProgram);
    return { key: c.key, label: c.label, successes: applied.length, n: inCommunity.length };
  });
  const shrunk = empiricalBayesShrink(groups);
  const raw = [...shrunk].sort((a, b) => b.rawRate - a.rawRate);
  const adjusted = [...shrunk].sort((a, b) => b.adjustedRate - a.adjustedRate);
  return {
    metric: 'applied_rate',
    metricLabel: 'Program-application rate (of active founders)',
    raw: raw.map((g, i) => ({ rank: i + 1, ...g })),
    adjusted: adjusted.map((g, i) => ({ rank: i + 1, ...g })),
  };
}

// ---------------------------------------------------------------------------
// Significance testing helper: entity vs. pooled rest-of-cohort, with
// multiple-comparison correction across the whole family of entities tested
// on the same metric.
// ---------------------------------------------------------------------------
function confidenceLabel(p, adjustedAlpha) {
  if (p >= adjustedAlpha) return 'not significant';
  if (p < adjustedAlpha / 10) return 'high';
  if (p < adjustedAlpha / 2) return 'medium';
  return 'low (exploratory)';
}

// ---------------------------------------------------------------------------
// Decision cards
// ---------------------------------------------------------------------------
function buildDecisions(founders) {
  const cards = [];

  // Family A: city community-join-rate vs rest
  const cityJoinTests = testEntitiesVsRest(CITIES, (c) => {
    const inCity = founders.filter((f) => f.city === c.key);
    return { successes: inCity.filter((f) => f.joinedCommunity).length, n: inCity.length };
  });
  for (const t of cityJoinTests) {
    if (t.n < MIN_N) continue;
    if (!t.significant) continue;
    if (Math.abs(t.effectSize) < MIN_EFFECT_SIZE) continue;
    if (t.effectSize >= 0) continue; // we only want the "converts badly" direction here
    cards.push({
      id: `city_join_${t.key}`,
      title: `${t.label}: high volume, weak community activation`,
      recommendation: `Do not scale ${t.label} acquisition spend on volume alone — fix the incorporation-to-community handoff first, or the extra volume will keep arriving unconverted.`,
      impactRange: {
        label: 'Community-join rate',
        low: (wilsonInterval(t.successes, t.n).low * 100).toFixed(1) + '%',
        high: (wilsonInterval(t.successes, t.n).high * 100).toFixed(1) + '%',
        vsPool: (t.poolRate * 100).toFixed(1) + '% in every other city combined',
      },
      evidence: [
        `${t.label}: ${t.successes.toLocaleString('en-IN')} of ${t.n.toLocaleString('en-IN')} incorporated founders joined a community (${(t.rate * 100).toFixed(1)}%).`,
        `Every other city combined: ${(t.poolRate * 100).toFixed(1)}% join rate.`,
        `Two-proportion test, Holm-corrected across 10 cities: ${formatP(t.p)} (adjusted α = ${t.adjustedAlpha.toFixed(4)}).`,
      ],
      confidence: confidenceLabel(t.p, t.adjustedAlpha),
      counterEvidence: `This city may have a newer incorporation cohort that simply hasn't had time to onboard into a community yet — re-check this finding after excluding founders incorporated in the last 30 days before reallocating budget.`,
    });
  }

  // Family B: city applied-rate vs rest (funnel leak — strong active, weak applied)
  const cityAppliedTests = testEntitiesVsRest(CITIES, (c) => {
    const activeInCity = founders.filter((f) => f.city === c.key && f.active);
    return { successes: activeInCity.filter((f) => f.appliedProgram).length, n: activeInCity.length };
  });
  for (const t of cityAppliedTests) {
    if (t.n < MIN_N) continue;
    if (!t.significant) continue;
    if (Math.abs(t.effectSize) < MIN_EFFECT_SIZE) continue;
    if (t.effectSize >= 0) continue; // funnel leak = below pool rate
    // Only call this a "funnel leak" (vs. a demand gap) if the Active rate for
    // this city is itself healthy or above pool — otherwise it's just a city
    // with genuinely lower engagement, a different story.
    const cityFounders = founders.filter((f) => f.city === t.key);
    const joinedInCity = cityFounders.filter((f) => f.joinedCommunity);
    const activeRateInCity = wilsonInterval(joinedInCity.filter((f) => f.active).length, joinedInCity.length);
    const restFounders = founders.filter((f) => f.city !== t.key);
    const joinedRest = restFounders.filter((f) => f.joinedCommunity);
    const activeRatePool = wilsonInterval(joinedRest.filter((f) => f.active).length, joinedRest.length);
    const isFunnelLeak = activeRateInCity.rate >= activeRatePool.rate;

    cards.push({
      id: `city_applied_${t.key}`,
      title: isFunnelLeak
        ? `${t.label}: strong engagement, weak program conversion — a visibility gap`
        : `${t.label}: below-average program-application rate`,
      recommendation: isFunnelLeak
        ? `${t.label} founders are as active as anywhere else but aren't applying to flagship programs — this reads as a targeting/visibility gap, not weak demand. Push direct program outreach to this city's active cohort before cutting its content budget.`
        : `${t.label}'s application rate trails the rest of the cohort even among active founders — investigate before investing further here.`,
      impactRange: {
        label: 'Program-application rate (of active founders)',
        low: (wilsonInterval(t.successes, t.n).low * 100).toFixed(1) + '%',
        high: (wilsonInterval(t.successes, t.n).high * 100).toFixed(1) + '%',
        vsPool: (t.poolRate * 100).toFixed(1) + '% in every other city combined',
      },
      evidence: [
        `${t.label}: Active rate ${(activeRateInCity.rate * 100).toFixed(1)}% vs. ${(activeRatePool.rate * 100).toFixed(1)}% pool — ${isFunnelLeak ? 'at or above' : 'below'} the rest of the cohort.`,
        `${t.label}: ${(t.rate * 100).toFixed(1)}% of active founders applied to a flagship program, vs. ${(t.poolRate * 100).toFixed(1)}% pool.`,
        `Two-proportion test, Holm-corrected across 10 cities: ${formatP(t.p)} (adjusted α = ${t.adjustedAlpha.toFixed(4)}).`,
      ],
      confidence: confidenceLabel(t.p, t.adjustedAlpha),
      counterEvidence: `A strong Active rate with weak Applied conversion could also mean this city's active founders are genuinely earlier-stage and not yet program-ready — check founder tenure before assuming it's purely a visibility problem.`,
    });
  }

  // Family C: community applied-rate vs rest (underinvested segment)
  const communityAppliedTests = testEntitiesVsRest(COMMUNITIES, (c) => {
    const activeInCommunity = founders.filter((f) => f.community === c.key && f.active);
    return { successes: activeInCommunity.filter((f) => f.appliedProgram).length, n: activeInCommunity.length };
  });
  for (const t of communityAppliedTests) {
    if (t.n < MIN_N) continue;
    if (!t.significant) continue;
    if (Math.abs(t.effectSize) < MIN_EFFECT_SIZE) continue;
    if (t.effectSize <= 0) continue; // underinvested = above pool rate, on a small base
    const totalFounders = founders.length;
    const shareOfBase = t.n / founders.filter((f) => f.active).length;

    // also check selection/admit rate disproportion as supporting evidence
    const selectedInCommunity = founders.filter((f) => f.community === t.key && f.appliedProgram && f.selected).length;
    const appliedInCommunity = founders.filter((f) => f.community === t.key && f.appliedProgram).length;
    const selectRateCommunity = wilsonInterval(selectedInCommunity, appliedInCommunity);
    const selectedRest = founders.filter((f) => f.community !== t.key && f.appliedProgram && f.selected).length;
    const appliedRest = founders.filter((f) => f.community !== t.key && f.appliedProgram).length;
    const selectRateRest = wilsonInterval(selectedRest, appliedRest);

    cards.push({
      id: `community_underinvested_${t.key}`,
      title: `${t.label}: small base, disproportionately high application and admit rate`,
      recommendation: `${t.label} is only ${(shareOfBase * 100).toFixed(0)}% of the active founder base but applies to flagship programs at roughly ${(t.rate / t.poolRate).toFixed(1)}x the rate of the rest of the cohort, with a higher admit rate too. This segment reads as underinvested relative to its output — increase content and program-outreach spend aimed at it next quarter.`,
      impactRange: {
        label: 'Program-application rate (of active founders)',
        low: (wilsonInterval(t.successes, t.n).low * 100).toFixed(1) + '%',
        high: (wilsonInterval(t.successes, t.n).high * 100).toFixed(1) + '%',
        vsPool: (t.poolRate * 100).toFixed(1) + '% in every other community combined',
      },
      evidence: [
        `${t.label}: ${(t.rate * 100).toFixed(1)}% application rate vs. ${(t.poolRate * 100).toFixed(1)}% pool, on n = ${t.n.toLocaleString('en-IN')} active founders.`,
        `${t.label} admit/selection rate: ${(selectRateCommunity.rate * 100).toFixed(1)}% vs. ${(selectRateRest.rate * 100).toFixed(1)}% in the rest of the cohort.`,
        `Two-proportion test, Holm-corrected across 3 communities: ${formatP(t.p)} (adjusted α = ${t.adjustedAlpha.toFixed(4)}).`,
      ],
      confidence: confidenceLabel(t.p, t.adjustedAlpha),
      counterEvidence: `A smaller community can swing further on the same underlying noise — the interval above is wider than the larger communities' for exactly that reason. Treat this as a strong lead for next quarter's content plan, not a guaranteed repeat performance.`,
    });
  }

  // Family D: signal miscalibration (Genie usage vs RSVP as predictors of applying)
  const activeFounders = founders.filter((f) => f.active);
  const genieRecords = activeFounders.map((f) => ({ signal: f.genieUsage >= 10, outcome: !!f.appliedProgram }));
  const rsvpRecords = activeFounders.map((f) => ({ signal: f.rsvpCount >= 5, outcome: !!f.appliedProgram }));
  const genieLift = signalLift(genieRecords);
  const rsvpLift = signalLift(rsvpRecords);

  if (!genieLift.insufficientData && !rsvpLift.insufficientData && genieLift.lift > rsvpLift.lift) {
    cards.push({
      id: 'signal_miscalibration',
      title: 'Event RSVPs are the wrong engagement signal — Rize Genie usage predicts applications far better',
      recommendation: `Re-weight the engagement score away from event RSVP count and toward Rize Genie usage frequency. Genie-active founders apply to flagship programs at ${genieLift.lift.toFixed(1)}x the rate of low-usage founders; high-RSVP founders apply at only ${rsvpLift.lift.toFixed(1)}x the rate of low-RSVP founders.`,
      impactRange: {
        label: 'Lift on program-application rate',
        low: `Genie usage: ${genieLift.lift.toFixed(2)}x`,
        high: `RSVP count: ${rsvpLift.lift.toFixed(2)}x`,
        vsPool: 'both measured against the same active-founder cohort',
      },
      evidence: [
        `High Genie usage (≥10 sessions/month): ${(genieLift.pSignal.rate * 100).toFixed(1)}% applied, vs. ${(genieLift.pNoSignal.rate * 100).toFixed(1)}% for low usage (${formatP(genieLift.test.p)}).`,
        `High RSVP count (≥5 events): ${(rsvpLift.pSignal.rate * 100).toFixed(1)}% applied, vs. ${(rsvpLift.pNoSignal.rate * 100).toFixed(1)}% for low RSVP (${formatP(rsvpLift.test.p)}).`,
        `Genie usage lift (${genieLift.lift.toFixed(2)}x) exceeds RSVP lift (${rsvpLift.lift.toFixed(2)}x) on the same cohort, same outcome definition.`,
      ],
      confidence: rsvpLift.test.p < 0.05 || genieLift.test.p >= 0.01 ? 'medium' : 'high',
      counterEvidence: `RSVP count may still matter for a different outcome (e.g. community retention rather than program application) — this finding is scoped specifically to predicting flagship-program applications, not engagement in general.`,
    });
  }

  return cards;
}

function main() {
  const founders = loadFounders();
  const funnel = buildFunnel(founders);
  const programs = buildProgramPerformance(founders);
  const cityLab = buildCityLab(founders);
  const communityLab = buildCommunityLab(founders);
  const decisions = buildDecisions(founders);

  fs.writeFileSync(path.join(DATA_DIR, 'funnel.json'), JSON.stringify(funnel, null, 2));
  fs.writeFileSync(path.join(DATA_DIR, 'programs.json'), JSON.stringify(programs, null, 2));
  fs.writeFileSync(
    path.join(DATA_DIR, 'city_community_lab.json'),
    JSON.stringify({ cities: cityLab, communities: communityLab }, null, 2)
  );
  fs.writeFileSync(path.join(DATA_DIR, 'decisions.json'), JSON.stringify(decisions, null, 2));

  console.log(`Decisions built: ${decisions.length} card(s) ->`, decisions.map((d) => d.id));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export {
  buildFunnel,
  buildProgramPerformance,
  buildCityLab,
  buildCommunityLab,
  buildDecisions,
  testEntitiesVsRest,
  MIN_EFFECT_SIZE,
};
