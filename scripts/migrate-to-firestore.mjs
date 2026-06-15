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

  const players = (data.players || []).filter((p) => {
    const id = String(p.playerId || '').trim();
    if (!id) {
      console.warn('Skipping player with empty id:', p);
      return false;
    }
    return true;
  });

  const rosters = (data.rosters || []).filter((r) => {
    const id = String(r.playerId || '').trim();
    if (!id) {
      console.warn('Skipping roster with empty playerId:', r);
      return false;
    }
    return true;
  });

  console.log(`Migrating ${players.length} players, ${rosters.length} rosters...`);

  let batch = writeBatch(db);
  let ops = 0;

  async function flushBatch() {
    if (ops === 0) return;
    await batch.commit();
    batch = writeBatch(db);
    ops = 0;
  }

  for (const player of players) {
    const playerId = String(player.playerId).trim();
    const displayName = String(player.name || '').trim();
    if (!displayName) {
      console.warn(`Skipping player ${playerId} — empty name`);
      continue;
    }
    batch.set(doc(db, 'players', playerId), {
      name: displayName,
      nameLower: displayName.toLowerCase(),
      circle: player.circle || '',
      createdAt: new Date().toISOString(),
      migratedFromSheets: true,
    });
    ops++;
    if (ops >= 450) await flushBatch();
  }

  for (const roster of rosters) {
    const playerId = String(roster.playerId).trim();
    batch.set(doc(db, 'rosters', playerId), {
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
  const syncedAt = new Date().toISOString();
  let computed = null;

  try {
    const { groupsPayload, gamesPayload } = await fetchWorldCupApiData();
    computed = computeResultsFromWorldCupApi(groupsPayload, gamesPayload);
  } catch (err) {
    console.warn('World Cup API unavailable — seeding zero results.', err.message || err);
  }

  batch = writeBatch(db);
  ops = 0;
  for (const team of TEAMS) {
    batch.set(doc(db, 'results', team.id), {
      ...(computed?.[team.id] || {
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
      last_results_sync: computed ? Date.now() : 0,
      scores_synced_at: computed ? syncedAt : '',
    },
    { merge: true }
  );

  console.log('Done! Firestore is ready. The app already uses BACKEND = firebase.');
  if (!computed) {
    console.log('Live scores will sync automatically the next time someone opens the app.');
  }
}

migrate().catch((err) => {
  console.error(err);
  if (String(err).includes('PERMISSION_DENIED')) {
    console.error('\nPublish Firestore rules first: npm run deploy:rules');
  }
  process.exit(1);
});
