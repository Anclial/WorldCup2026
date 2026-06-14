import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import { GROUP_STAGE_POINTS, KNOCKOUT_ROUNDS } from './data/scoring.js';
import { TEAM_BY_ID } from './data/teams.js';
import { computeResultsFromWorldCupApi, fetchWorldCupApiData } from './data/worldcup-sync.js';
import { getDb } from './firebase.js';
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

function normalizeFirstName(name) {
  return String(name || '').trim().split(/\s+/)[0];
}

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

async function syncResultsIfStale() {
  const db = getDb();
  const configRef = doc(db, 'config', 'settings');
  const configSnap = await getDoc(configRef);
  const config = configSnap.exists() ? configSnap.data() : {};
  const lastSync = Number(config.last_results_sync || 0);
  if (Date.now() - lastSync < RESULTS_SYNC_INTERVAL_MS) {
    return config.scores_synced_at || '';
  }

  const { groupsPayload, gamesPayload } = await fetchWorldCupApiData();
  const computed = computeResultsFromWorldCupApi(groupsPayload, gamesPayload);
  const syncedAt = new Date().toISOString();

  await Promise.all(
    Object.keys(TEAM_BY_ID).map((teamId) =>
      setDoc(doc(db, 'results', teamId), {
        ...computed[teamId],
        updatedAt: syncedAt,
      })
    )
  );

  await setDoc(
    configRef,
    {
      ...config,
      last_results_sync: Date.now(),
      scores_synced_at: syncedAt,
    },
    { merge: true }
  );

  return syncedAt;
}

export async function fetchData() {
  let scoresSyncedAt = '';
  try {
    scoresSyncedAt = (await syncResultsIfStale()) || '';
  } catch {
    const configSnap = await getDoc(doc(getDb(), 'config', 'settings'));
    scoresSyncedAt = configSnap.exists() ? configSnap.data().scores_synced_at || '' : '';
  }

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

  const resultsByTeam = {};
  resultsSnap.docs.forEach((snap) => {
    resultsByTeam[snap.id] = snap.data();
  });

  const rosters = rostersSnap.docs.map((snap) => {
    const r = snap.data();
    const teamIds = (r.teamIds || []).map(String).filter(Boolean);
    const points = teamIds.reduce((sum, id) => sum + scoreTeam(id, resultsByTeam), 0);

    return {
      playerId: snap.id,
      teamIds,
      points,
      updatedAt: r.updatedAt || '',
      locked: !!r.locked,
    };
  });

  const standings = buildStandings(players, rosters);
  const config = configSnap.exists() ? configSnap.data() : {};

  return {
    apiVersion: 2,
    players,
    rosters,
    standings,
    standingsByCircle: buildStandingsByCircle(standings),
    entriesLocked: isTruthy(config.entries_locked),
    scoresSyncedAt,
    autoScores: true,
  };
}

async function findPlayerByName(name) {
  const db = getDb();
  const nameLower = normalizeFirstName(name).toLowerCase();
  const snap = await getDocs(query(collection(db, 'players'), where('nameLower', '==', nameLower)));
  if (snap.empty) return null;
  const docSnap = snap.docs[0];
  return { id: docSnap.id, ...docSnap.data() };
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

export async function join(name, circle) {
  const trimmed = normalizeFirstName(name);
  if (!trimmed) throw new Error('Please enter your first name.');
  if (trimmed.length < 2) throw new Error('First name must be at least 2 characters.');

  const existing = await findPlayerByName(trimmed);

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

  const playerCircle = normalizeCircle(circle);
  if (!playerCircle) {
    return { needsCircle: true, name: trimmed };
  }

  const db = getDb();
  const playerId = await createPlayerId(trimmed);

  await setDoc(doc(db, 'players', playerId), {
    name: trimmed,
    nameLower: trimmed.toLowerCase(),
    circle: playerCircle,
    createdAt: new Date().toISOString(),
  });

  return {
    player: { playerId, name: trimmed, circle: playerCircle },
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

  const data = await fetchData();
  return { success: true, data };
}
