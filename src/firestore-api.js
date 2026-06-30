import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { scoreTeamPoints } from './data/scoring.js';
import { TEAM_BY_ID } from './data/teams.js';
import { normalizeKnockoutGames } from './data/bracket.js';
import { computeResultsFromWorldCupApi, fetchWorldCupApiData } from './data/worldcup-sync.js';
import { getDb } from './firebase.js';
import { findExactPlayerByLoginName, findPlayerByLoginName } from './player-match.js';
import { validateRoster } from './selection.js';

const VALID_CIRCLES = ['family', 'friends', 'work'];
const RESULTS_SYNC_INTERVAL_MS = 15 * 60 * 1000;

function normalizeCircle(value) {
  let circle = String(value || '')
    .trim()
    .toLowerCase();
  if (circle === 'colleague') circle = 'work';
  return VALID_CIRCLES.includes(circle) ? circle : '';
}

function slugify(name) {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'player'
  );
}

function isTruthy(value) {
  if (typeof value === 'boolean') return value;
  const s = String(value).toLowerCase().trim();
  return s === 'true' || s === 'yes' || s === '1' || s === 'y';
}

function scoreTeam(teamId, resultsByTeam) {
  return scoreTeamPoints(teamId, resultsByTeam[teamId], TEAM_BY_ID);
}

function buildStandings(players, rosters) {
  const rosterByPlayer = Object.fromEntries(rosters.map((r) => [r.playerId, r]));
  return players
    .map((p) => ({
      playerId: p.playerId,
      name: p.name,
      circle: p.circle,
      points: rosterByPlayer[p.playerId]?.points || 0,
    }))
    .sort((a, b) => b.points - a.points);
}

function buildStandingsByCircle(standings) {
  const byCircle = {};
  VALID_CIRCLES.forEach((circle) => {
    byCircle[circle] = standings
      .filter((s) => s.circle === circle)
      .sort((a, b) => b.points - a.points);
  });
  return byCircle;
}

async function recalculateRosterPoints(db, resultsByTeam) {
  const rostersSnap = await getDocs(collection(db, 'rosters'));
  if (rostersSnap.empty) return;

  let batch = writeBatch(db);
  let ops = 0;

  for (const snap of rostersSnap.docs) {
    const r = snap.data();
    const teamIds = (r.teamIds || []).map(String).filter(Boolean);
    const points = teamIds.reduce((sum, id) => sum + scoreTeam(id, resultsByTeam), 0);
    batch.update(snap.ref, { points });
    ops++;
    if (ops >= 450) {
      await batch.commit();
      batch = writeBatch(db);
      ops = 0;
    }
  }

  if (ops > 0) await batch.commit();
}

async function syncResultsIfStale() {
  const db = getDb();
  const configRef = doc(db, 'config', 'settings');
  const configSnap = await getDoc(configRef);
  const config = configSnap.exists() ? configSnap.data() : {};
  const lastSync = Number(config.last_results_sync || 0);
  if (Date.now() - lastSync < RESULTS_SYNC_INTERVAL_MS) {
    return {
      scoresSyncedAt: config.scores_synced_at || '',
      didSync: false,
    };
  }

  const { groupsPayload, gamesPayload } = await fetchWorldCupApiData();
  const computed = computeResultsFromWorldCupApi(groupsPayload, gamesPayload);
  const syncedAt = new Date().toISOString();

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

  await recalculateRosterPoints(db, computed);

  await setDoc(
    configRef,
    {
      ...config,
      last_results_sync: Date.now(),
      scores_synced_at: syncedAt,
    },
    { merge: true }
  );

  return { scoresSyncedAt: syncedAt, didSync: true };
}

async function readAppDataFromFirestore() {
  const db = getDb();
  const [playersSnap, rostersSnap, configSnap, resultsSnap] = await Promise.all([
    getDocs(collection(db, 'players')),
    getDocs(collection(db, 'rosters')),
    getDoc(doc(db, 'config', 'settings')),
    getDocs(collection(db, 'results')),
  ]);

  const players = playersSnap.docs.map((snap) => {
    const p = snap.data();
    return {
      playerId: snap.id,
      name: String(p.name || ''),
      circle: normalizeCircle(p.circle),
    };
  });

  const rosters = rostersSnap.docs.map((snap) => {
    const r = snap.data();
    return {
      playerId: snap.id,
      teamIds: (r.teamIds || []).map(String).filter(Boolean),
      points: Number(r.points) || 0,
      updatedAt: r.updatedAt || '',
      locked: !!r.locked,
    };
  });

  const standings = buildStandings(players, rosters);
  const config = configSnap.exists() ? configSnap.data() : {};
  const resultsByTeam = {};
  resultsSnap.docs.forEach((snap) => {
    resultsByTeam[snap.id] = snap.data();
  });

  return {
    apiVersion: 2,
    players,
    rosters,
    standings,
    standingsByCircle: buildStandingsByCircle(standings),
    resultsByTeam,
    entriesLocked: isTruthy(config.entries_locked),
    scoresSyncedAt: config.scores_synced_at || '',
    autoScores: true,
  };
}

/** Fast read — Firestore only, no live score sync. */
export async function fetchAppData() {
  return readAppDataFromFirestore();
}

export async function fetchBracketGames() {
  const { gamesPayload } = await fetchWorldCupApiData();
  return normalizeKnockoutGames(gamesPayload);
}

/** Sync live scores if stale, then return fresh app data (or null if skipped). */
export async function syncScoresInBackground() {
  const syncResult = await syncResultsIfStale();
  if (!syncResult.didSync) return null;
  return readAppDataFromFirestore();
}

export async function fetchData() {
  try {
    await syncResultsIfStale();
  } catch {
    // Fall through — still return the latest Firestore snapshot.
  }
  return readAppDataFromFirestore();
}

async function findPlayerByName(name, { exactOnly = false } = {}) {
  const db = getDb();
  const trimmed = String(name || '').trim();
  const nameLower = trimmed.toLowerCase();

  const exactSnap = await getDocs(
    query(collection(db, 'players'), where('nameLower', '==', nameLower))
  );
  if (!exactSnap.empty) {
    const docSnap = exactSnap.docs[0];
    return { id: docSnap.id, ...docSnap.data() };
  }

  const allSnap = await getDocs(collection(db, 'players'));
  const players = allSnap.docs.map((snap) => ({
    playerId: snap.id,
    name: String(snap.data().name || ''),
    circle: snap.data().circle,
  }));

  const matchFn = exactOnly ? findExactPlayerByLoginName : findPlayerByLoginName;
  const match = matchFn(trimmed, players);
  if (!match) return null;

  const docSnap = allSnap.docs.find((snap) => snap.id === match.playerId);
  return docSnap ? { id: docSnap.id, ...docSnap.data() } : null;
}

async function isRosterLocked(playerId) {
  const db = getDb();
  const snap = await getDoc(doc(db, 'rosters', playerId));
  return snap.exists() ? !!snap.data().locked : false;
}

async function createPlayerId(name) {
  const db = getDb();
  const base = slugify(name);
  let id = base;
  let attempts = 0;
  while (attempts < 50) {
    const existing = await getDoc(doc(db, 'players', id));
    if (!existing.exists()) return id;
    id = `${base}-${Math.floor(1000 + Math.random() * 9000)}`;
    attempts++;
  }
  return `${base}-${Date.now()}`;
}

export async function join(name, circle, { forceNew = false } = {}) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('Please enter your first name.');
  if (trimmed.length < 2) throw new Error('First name must be at least 2 characters.');

  if (!forceNew) {
    const existing = await findPlayerByName(trimmed, { exactOnly: true });
    if (existing) {
      return {
        player: {
          playerId: existing.id,
          name: String(existing.name),
          circle: normalizeCircle(existing.circle),
        },
        isNew: false,
        rosterLocked: await isRosterLocked(existing.id),
      };
    }
  }

  const playerCircle = normalizeCircle(circle);
  if (!playerCircle) {
    return { needsCircle: true, name: trimmed };
  }

  const db = getDb();
  const playerId = await createPlayerId(trimmed);
  const displayName = trimmed.split(/\s+/)[0] || trimmed;

  await setDoc(doc(db, 'players', playerId), {
    name: displayName,
    nameLower: displayName.toLowerCase(),
    circle: playerCircle,
    createdAt: new Date().toISOString(),
  });

  return {
    player: { playerId, name: displayName, circle: playerCircle },
    isNew: true,
    rosterLocked: false,
  };
}

export async function submitRoster(playerId, teamIds) {
  const db = getDb();
  const playerSnap = await getDoc(doc(db, 'players', playerId));
  if (!playerSnap.exists()) {
    throw new Error('Player not found.');
  }

  const configSnap = await getDoc(doc(db, 'config', 'settings'));
  if (configSnap.exists() && isTruthy(configSnap.data().entries_locked)) {
    throw new Error('Entries are closed — rosters can no longer be submitted.');
  }

  const rosterSnap = await getDoc(doc(db, 'rosters', playerId));
  if (rosterSnap.exists() && rosterSnap.data().locked) {
    throw new Error('Your roster is already locked.');
  }

  const validation = validateRoster(teamIds);
  if (!validation.valid) {
    throw new Error(validation.errors.join(' '));
  }

  const resultsSnap = await getDocs(collection(db, 'results'));
  const resultsByTeam = {};
  resultsSnap.docs.forEach((snap) => {
    resultsByTeam[snap.id] = snap.data();
  });

  const points = teamIds.reduce((sum, id) => sum + scoreTeam(id, resultsByTeam), 0);
  const now = new Date().toISOString();

  await setDoc(doc(db, 'rosters', playerId), {
    teamIds,
    points,
    locked: true,
    updatedAt: now,
  });

  const data = await fetchAppData();
  return { success: true, data };
}
