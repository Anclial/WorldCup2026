/**
 * Force-sync World Cup results into Firestore and recalculate roster points.
 * Run: npm run sync:results
 */
import { initializeApp } from 'firebase/app';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
  getFirestore,
} from 'firebase/firestore';
import { FIREBASE_CONFIG } from '../src/config.js';
import { GROUP_STAGE_POINTS, KNOCKOUT_ROUNDS } from '../src/data/scoring.js';
import { TEAM_BY_ID } from '../src/data/teams.js';
import { computeResultsFromWorldCupApi, fetchWorldCupApiData } from '../src/data/worldcup-sync.js';

const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);

function isTruthy(value) {
  if (typeof value === 'boolean') return value;
  const s = String(value).toLowerCase().trim();
  return s === 'true' || s === 'yes' || s === '1' || s === 'y';
}

function scoreTeam(teamId, resultsByTeam) {
  const team = TEAM_BY_ID[teamId];
  const result = resultsByTeam[teamId];
  if (!team || !result) return 0;

  const groupPts = GROUP_STAGE_POINTS[team.tier];
  const wins = Number(result.group_wins) || 0;
  const draws = Number(result.group_draws) || 0;
  const groupScore = wins * groupPts.win + draws * groupPts.draw;

  const multiplier = team.tier === 1 ? 1 : team.tier === 2 ? 1.5 : 2.5;
  let knockoutScore = 0;
  KNOCKOUT_ROUNDS.forEach((round) => {
    if (isTruthy(result[round.key])) knockoutScore += round.points * multiplier;
  });

  return groupScore + knockoutScore;
}

async function recalculateRosterPoints(resultsByTeam) {
  const rostersSnap = await getDocs(collection(db, 'rosters'));
  if (rostersSnap.empty) return 0;

  let batch = writeBatch(db);
  let ops = 0;
  let updated = 0;

  for (const snap of rostersSnap.docs) {
    const r = snap.data();
    const teamIds = (r.teamIds || []).map(String).filter(Boolean);
    const points = teamIds.reduce((sum, id) => sum + scoreTeam(id, resultsByTeam), 0);
    batch.update(snap.ref, { points });
    ops++;
    updated++;
    if (ops >= 450) {
      await batch.commit();
      batch = writeBatch(db);
      ops = 0;
    }
  }

  if (ops > 0) await batch.commit();
  return updated;
}

async function main() {
  console.log('Fetching live World Cup results from worldcup26.ir...');
  const { groupsPayload, gamesPayload } = await fetchWorldCupApiData();
  const computed = computeResultsFromWorldCupApi(groupsPayload, gamesPayload);
  const syncedAt = new Date().toISOString();

  const withWins = Object.values(computed).filter((r) => (r.group_wins || 0) > 0).length;
  console.log(`Computed results for ${Object.keys(computed).length} teams (${withWins} with group wins).`);

  let batch = writeBatch(db);
  let ops = 0;

  for (const teamId of Object.keys(TEAM_BY_ID)) {
    batch.set(doc(db, 'results', teamId), {
      ...computed[teamId],
      updatedAt: syncedAt,
    });
    ops++;
    if (ops >= 450) {
      await batch.commit();
      batch = writeBatch(db);
      ops = 0;
    }
  }
  if (ops > 0) await batch.commit();

  const rosterCount = await recalculateRosterPoints(computed);

  const configRef = doc(db, 'config', 'settings');
  const configSnap = await getDoc(configRef);
  const config = configSnap.exists() ? configSnap.data() : {};
  await setDoc(
    configRef,
    {
      ...config,
      last_results_sync: Date.now(),
      scores_synced_at: syncedAt,
    },
    { merge: true }
  );

  console.log(`Updated ${Object.keys(TEAM_BY_ID).length} result docs and ${rosterCount} roster point totals.`);
  console.log('Synced at:', syncedAt);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
