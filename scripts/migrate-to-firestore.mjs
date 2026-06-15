/**
 * One-time migration: copy game data from Google Apps Script (Sheets) → Firestore.
 *
 * Prerequisites:
 * 1. Firestore enabled in Firebase Console (project: worldcup2026pickem)
 * 2. Publish rules: npm run deploy:rules
 * 3. Run: npm run migrate:firestore
 */
import { initializeApp } from 'firebase/app';
import { collection, doc, setDoc, writeBatch, getFirestore } from 'firebase/firestore';
import { FIREBASE_CONFIG } from '../src/config.js';
import { TEAMS } from '../src/data/teams.js';
import { computeResultsFromWorldCupApi, fetchWorldCupApiData } from '../src/data/worldcup-sync.js';

/** Legacy Apps Script URL — only used for this one-time migration from Sheets. */
const LEGACY_APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbziEyAjSZTSBehzFzpSnait0DDsyyg42qDgiCGzI1MP5mIu0lzt1N3nezij8RjB5nYP/exec';

const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);

async function fetchSheetData() {
  const url = `${LEGACY_APPS_SCRIPT_URL}?t=${Date.now()}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

async function migrate() {
  console.log('Fetching data from legacy Google Sheets backend...');
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
    const displayName = String(player.name || '').trim();
    batch.set(doc(db, 'players', player.playerId), {
      name: displayName,
      nameLower: displayName.toLowerCase(),
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
    last_results_sync: 0,
    scores_synced_at: '',
  });
  await batch.commit();

  console.log('Seeding results from live World Cup API...');
  const { groupsPayload, gamesPayload } = await fetchWorldCupApiData();
  const computed = computeResultsFromWorldCupApi(groupsPayload, gamesPayload);
  const syncedAt = new Date().toISOString();

  batch = writeBatch(db);
  ops = 0;
  for (const team of TEAMS) {
    batch.set(doc(db, 'results', team.id), {
      ...(computed[team.id] || {
        group_wins: 0,
        group_draws: 0,
        r32: 0,
        r16: 0,
        qf: 0,
        sf: 0,
        final: 0,
        champion: 0,
      }),
      updatedAt: syncedAt,
    });
    ops++;
    if (ops >= 450) await flushBatch();
  }
  await flushBatch();

  await setDoc(
    doc(db, 'config', 'settings'),
    {
      entries_locked: !!data.entriesLocked,
      last_results_sync: Date.now(),
      scores_synced_at: syncedAt,
    },
    { merge: true }
  );

  console.log('Done! Firestore is ready. The app already uses BACKEND = firebase.');
}

migrate().catch((err) => {
  console.error(err);
  if (String(err).includes('PERMISSION_DENIED')) {
    console.error('\nPublish Firestore rules first: npm run deploy:rules');
  }
  process.exit(1);
});
