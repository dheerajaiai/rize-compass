// validate.js — the honesty check. Confirms three things, against the actual
// pipeline output (never hardcoded):
//   1. Every planted finding in ground_truth.json is actually recovered by
//      the decision engine / program performance output.
//   2. The planted control cities produce no decision card.
//   3. A shuffled-label negative control (outcome labels randomly reassigned,
//      breaking any real relationship to city/community/signal) produces no
//      significant findings — if it did, the method would be finding noise.
// The Validation screen in the UI reads data/validation_result.json produced
// here. It never displays a hardcoded "all good" — if this script finds a
// miss, that miss is in the file the UI reads.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mulberry32 } from './rng.js';
import { signalLift, MIN_N } from './stats.js';
import { CITIES, COMMUNITIES } from './dimensions.js';
import { buildDecisions, buildProgramPerformance, testEntitiesVsRest } from './decisions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

function loadJSON(name) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'));
}

function shuffle(array, rng) {
  const out = [...array];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function checkPlantedFindings(founders, groundTruth, decisions, programs) {
  const results = [];

  for (const finding of groundTruth.plantedFindings) {
    let recovered = false;
    let detail = '';

    if (finding.expect.direction === 'no_card') {
      const hasCard = decisions.some((d) => d.id.includes(finding.key));
      recovered = !hasCard;
      detail = hasCard
        ? `FAIL: a decision card was produced for control city "${finding.key}", which should be quiet.`
        : `OK: no decision card produced for control city "${finding.key}".`;
    } else if (finding.expect.direction === 'insufficient_data') {
      const program = programs.find((p) => p.key === finding.key);
      recovered = !!program && program.outcome.tooNewToCall === true && program.outcome.n < MIN_N;
      detail = recovered
        ? `OK: ${finding.key} outcome correctly marked too-new-to-call (measured outcome n=${program ? program.outcome.n : 'n/a'}).`
        : `FAIL: ${finding.key} did not come back as insufficient data.`;
    } else {
      // Expect a specific decision card to exist, matching this finding's id/key.
      const idGuesses = [
        `city_join_${finding.key}`,
        `city_applied_${finding.key}`,
        `community_underinvested_${finding.key}`,
        finding.id,
      ];
      const card = decisions.find((d) => idGuesses.includes(d.id));
      recovered = !!card;
      detail = recovered
        ? `OK: recovered as decision card "${card.id}" (confidence: ${card.confidence}).`
        : `FAIL: expected a decision card for "${finding.id}" (${finding.description}) but none was produced.`;
    }

    results.push({ id: finding.id, description: finding.description, recovered, detail });
  }

  return results;
}

function runNegativeControl(founders) {
  const rng = mulberry32(99); // different seed from generation, deterministic for this validation run

  // --- Shuffle joinedCommunity across all incorporated founders, decoupling it from city.
  const joinedValues = shuffle(founders.map((f) => f.joinedCommunity), rng);
  const shuffledJoin = founders.map((f, i) => ({ ...f, joinedCommunity: joinedValues[i] }));
  const cityJoinTests = testEntitiesVsRest(CITIES, (c) => {
    const inCity = shuffledJoin.filter((f) => f.city === c.key);
    return { successes: inCity.filter((f) => f.joinedCommunity).length, n: inCity.length };
  });
  const cityJoinFalsePositives = cityJoinTests.filter((t) => t.significant && t.n >= MIN_N);

  // --- Shuffle "applied" (boolean) across active founders, decoupling it from city/community.
  const activeFounders = founders.filter((f) => f.active);
  const appliedBooleans = shuffle(activeFounders.map((f) => !!f.appliedProgram), rng);
  const shuffledApplied = activeFounders.map((f, i) => ({ ...f, appliedShuffled: appliedBooleans[i] }));

  const cityAppliedTests = testEntitiesVsRest(CITIES, (c) => {
    const inCity = shuffledApplied.filter((f) => f.city === c.key);
    return { successes: inCity.filter((f) => f.appliedShuffled).length, n: inCity.length };
  });
  const cityAppliedFalsePositives = cityAppliedTests.filter((t) => t.significant && t.n >= MIN_N);

  const communityAppliedTests = testEntitiesVsRest(COMMUNITIES, (c) => {
    const inCommunity = shuffledApplied.filter((f) => f.community === c.key);
    return { successes: inCommunity.filter((f) => f.appliedShuffled).length, n: inCommunity.length };
  });
  const communityAppliedFalsePositives = communityAppliedTests.filter((t) => t.significant && t.n >= MIN_N);

  // --- Shuffle "applied" again independently for the signal-lift check, keeping
  // genie/rsvp signals attached to the original founder so any lift found would
  // be a pure false positive.
  const appliedForSignal = shuffle(activeFounders.map((f) => !!f.appliedProgram), rng);
  const genieRecordsShuffled = activeFounders.map((f, i) => ({ signal: f.genieUsage >= 10, outcome: appliedForSignal[i] }));
  const rsvpRecordsShuffled = activeFounders.map((f, i) => ({ signal: f.rsvpCount >= 5, outcome: appliedForSignal[i] }));
  const genieLiftShuffled = signalLift(genieRecordsShuffled);
  const rsvpLiftShuffled = signalLift(rsvpRecordsShuffled);
  const signalFalsePositive = genieLiftShuffled.test.p < 0.05 || rsvpLiftShuffled.test.p < 0.05;

  const totalFalsePositives =
    cityJoinFalsePositives.length + cityAppliedFalsePositives.length + communityAppliedFalsePositives.length + (signalFalsePositive ? 1 : 0);

  return {
    cityJoinFalsePositives: cityJoinFalsePositives.map((t) => t.key),
    cityAppliedFalsePositives: cityAppliedFalsePositives.map((t) => t.key),
    communityAppliedFalsePositives: communityAppliedFalsePositives.map((t) => t.key),
    signalLiftShuffled: {
      genieP: genieLiftShuffled.test.p,
      rsvpP: rsvpLiftShuffled.test.p,
      falsePositive: signalFalsePositive,
    },
    totalFalsePositives,
    clean: totalFalsePositives === 0,
  };
}

function main() {
  const founders = loadJSON('founders.json');
  const groundTruth = loadJSON('ground_truth.json');
  const decisions = loadJSON('decisions.json');
  const programs = loadJSON('programs.json');

  const plantedFindingResults = checkPlantedFindings(founders, groundTruth, decisions, programs);
  const negativeControl = runNegativeControl(founders);

  const allPlantedRecovered = plantedFindingResults.every((r) => r.recovered);

  const result = {
    runAt: new Date().toISOString(),
    seed: groundTruth.seed,
    nFounders: groundTruth.nFounders,
    plantedFindings: plantedFindingResults,
    allPlantedFindingsRecovered: allPlantedRecovered,
    negativeControl,
    overallPass: allPlantedRecovered && negativeControl.clean,
  };

  fs.writeFileSync(path.join(DATA_DIR, 'validation_result.json'), JSON.stringify(result, null, 2));

  console.log(`Planted findings recovered: ${plantedFindingResults.filter((r) => r.recovered).length}/${plantedFindingResults.length}`);
  console.log(`Negative control false positives: ${negativeControl.totalFalsePositives}`);
  console.log(`Overall pass: ${result.overallPass}`);
  for (const r of plantedFindingResults) {
    if (!r.recovered) console.log(`  MISS: ${r.id} — ${r.detail}`);
  }
  // Non-zero exit so `npm run build` (and the deploy workflow) fails loudly.
  if (!result.overallPass) process.exitCode = 1;
}

main();
