/**
 * One-time migration: copy all game data from Google Apps Script → Firestore.
 *
 * Prerequisites:
 * 1. Firestore enabled in Firebase Console
 * 2. Paste firestore.rules into Firebase Console → Firestore → Rules → Publish
 * 3. Run: npm run migrate:firestore
 *
 * After it finishes, set BACKEND = 'firebase' in src/config.js and redeploy.
 */
import { initializeApp } from 'firebase/app';
import { collection, doc, setDoc, writeBatch, getFirestore } from 'firebase/firestore';
import { FIREBASE_CONFIG, APPS_SCRIPT_URL } from '../src/config.js';
import { TEAMS } from '../src/data/teams.js';

const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);

async function fetchSheetData() {
  const url = `${APPS_SCRIPT_URL}?t=${Date.now()}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

async function migrate() {
  console.log('Fetching data from Google Apps Script (this may take a minute)...');
  const data = await fetchSheetData();

  console.log(`Migrating ${data.players?.length || 0} players, ${data.rosters?.length || 0} rosters...`);

  let batch = writeBatch(db);
  let ops = 0;

  async function flushBatch() {
    if (ops === 0) return;
    await batch.commit();
    batch = writeBatch(db);
    ops = 0;
  }

  for (const player of data.players || []) {
    const firstName = String(player.name || '').trim().split(/\s+/)[0];
    batch.set(doc(db, 'players', player.playerId), {
      name: firstName,
      nameLower: firstName.toLowerCase(),
      circle: player.circle || '',
      createdAt: new Date().toISOString(),
      migratedFromSheets: true,
    });
    ops++;
    if (ops >= 450) await flushBatch();
  }

  for (const roster of data.rosters || []) {
    batch.set(doc(db, 'rosters', roster.playerId), {
      teamIds: roster.teamIds || [],
      points: roster.points || 0,
      locked: !!roster.locked,
      updatedAt: roster.updatedAt || new Date().toISOString(),
    });
    ops++;
    if (ops >= 450) await flushBatch();
  }

  await flushBatch();

  batch = writeBatch(db);
  batch.set(doc(db, 'config', 'settings'), {
    entries_locked: !!data.entriesLocked,
  });
  await batch.commit();

  // Results: seed all teams with zero stats (update manually or sync from sheet later)
  const resultsBatch = writeBatch(db);
  TEAMS.forEach((team) => {
    resultsBatch.set(doc(db, 'results', team.id), {
      group_wins: 0,
      group_draws: 0,
      r32: 0,
      r16: 0,
      qf: 0,
      sf: 0,
      final: 0,
      champion: 0,
    });
  });
  await resultsBatch.commit();

  console.log('Done! Next steps:');
  console.log('1. Copy results from your Results sheet into Firestore /results docs (or keep updating via sheet sync).');
  console.log("2. Set BACKEND = 'firebase' in src/config.js");
  console.log('3. npm run build && git push');
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
