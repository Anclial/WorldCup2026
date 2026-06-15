import { TEAM_BY_ID } from './teams.js';

/** Public World Cup 2026 API — https://worldcup26.ir */
export const WORLDCUP_API_BASE = 'https://worldcup26.ir';

/**
 * Maps worldcup26.ir numeric team IDs to our roster slugs.
 * TBD playoff slots use our canonical team list.
 */
export const API_TEAM_ID_TO_SLUG = {
  '1': 'mexico',
  '2': 'south-africa',
  '3': 'south-korea',
  '4': 'czech-republic',
  '5': 'canada',
  '6': 'bosnia',
  '7': 'qatar',
  '8': 'switzerland',
  '9': 'brazil',
  '10': 'morocco',
  '11': 'haiti',
  '12': 'scotland',
  '13': 'usa',
  '14': 'paraguay',
  '15': 'australia',
  '16': 'turkey',
  '17': 'germany',
  '18': 'curacao',
  '19': 'ivory-coast',
  '20': 'ecuador',
  '21': 'netherlands',
  '22': 'japan',
  '23': 'sweden',
  '24': 'tunisia',
  '25': 'belgium',
  '26': 'egypt',
  '27': 'iran',
  '28': 'new-zealand',
  '29': 'spain',
  '30': 'cape-verde',
  '31': 'saudi-arabia',
  '32': 'uruguay',
  '33': 'france',
  '34': 'senegal',
  '35': 'iraq',
  '36': 'norway',
  '37': 'argentina',
  '38': 'algeria',
  '39': 'austria',
  '40': 'jordan',
  '41': 'portugal',
  '42': 'dr-congo',
  '43': 'uzbekistan',
  '44': 'colombia',
  '45': 'england',
  '46': 'croatia',
  '47': 'ghana',
  '48': 'panama',
};

const KNOCKOUT_TYPES = ['r32', 'r16', 'qf', 'sf', 'final'];
const ADVANCE_ON_WIN = {
  r32: 'r16',
  r16: 'qf',
  qf: 'sf',
  sf: 'final',
  final: 'champion',
};

function emptyResultRow() {
  return {
    group_wins: 0,
    group_draws: 0,
    r32: 0,
    r16: 0,
    qf: 0,
    sf: 0,
    final: 0,
    champion: 0,
  };
}

export function slugFromApiTeamId(apiTeamId) {
  return API_TEAM_ID_TO_SLUG[String(apiTeamId)] || '';
}

function setFlag(row, key) {
  if (row) row[key] = 1;
}

function isGameFinished(game) {
  const finished = String(game?.finished ?? '').toUpperCase();
  return finished === 'TRUE' || finished === '1' || game?.time_elapsed === 'finished';
}

function normalizeGroupsPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.groups)) return payload.groups;
  return [];
}

function normalizeGamesPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.games)) return payload.games;
  return [];
}

function compareGroupRows(a, b) {
  const ptsDiff = (Number(b.pts) || 0) - (Number(a.pts) || 0);
  if (ptsDiff !== 0) return ptsDiff;
  const gdDiff = (Number(b.gd) || 0) - (Number(a.gd) || 0);
  if (gdDiff !== 0) return gdDiff;
  return (Number(b.gf) || 0) - (Number(a.gf) || 0);
}

/**
 * Build Results-sheet rows from worldcup26.ir groups + games payloads.
 */
export function computeResultsFromWorldCupApi(groupsPayload, gamesPayload) {
  const results = Object.fromEntries(Object.keys(TEAM_BY_ID).map((id) => [id, emptyResultRow()]));
  const groups = normalizeGroupsPayload(groupsPayload);
  const games = normalizeGamesPayload(gamesPayload);

  groups.forEach((group) => {
    const teams = group.teams || [];
    teams.forEach((entry) => {
      const slug = slugFromApiTeamId(entry.team_id);
      if (!slug || !results[slug]) return;
      results[slug].group_wins = Number(entry.w) || 0;
      results[slug].group_draws = Number(entry.d) || 0;
    });

    const allFinished = teams.length === 4 && teams.every((t) => Number(t.mp) >= 3);
    if (allFinished) {
      [...teams]
        .sort(compareGroupRows)
        .slice(0, 2)
        .forEach((entry) => {
          const slug = slugFromApiTeamId(entry.team_id);
          if (slug && results[slug]) setFlag(results[slug], 'r32');
        });
    }
  });

  games.forEach((game) => {
    const type = String(game.type || '');
    if (type === 'group') return;

    const homeId = String(game.home_team_id || '0');
    const awayId = String(game.away_team_id || '0');
    [homeId, awayId].forEach((apiId) => {
      if (apiId === '0') return;
      const slug = slugFromApiTeamId(apiId);
      if (!slug || !results[slug]) return;
      if (type === 'r32' || KNOCKOUT_TYPES.includes(type)) setFlag(results[slug], 'r32');
      if (type === 'final') setFlag(results[slug], 'final');
    });

    if (!isGameFinished(game) || homeId === '0' || awayId === '0') return;

    const homeScore = Number(game.home_score);
    const awayScore = Number(game.away_score);
    if (Number.isNaN(homeScore) || Number.isNaN(awayScore)) return;

    let winnerId = null;
    if (homeScore > awayScore) winnerId = homeId;
    else if (awayScore > homeScore) winnerId = awayId;

    if (!winnerId || !KNOCKOUT_TYPES.includes(type)) return;

    const winnerSlug = slugFromApiTeamId(winnerId);
    if (!winnerSlug || !results[winnerSlug]) return;

    const advanceKey = ADVANCE_ON_WIN[type];
    if (advanceKey) setFlag(results[winnerSlug], advanceKey);

    if (type === 'sf') setFlag(results[winnerSlug], 'final');
  });

  return results;
}

const API_FETCH_TIMEOUT_MS = 60_000;

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchWorldCupApiData(baseUrl = WORLDCUP_API_BASE) {
  const [groupsRes, gamesRes] = await Promise.all([
    fetchWithTimeout(`${baseUrl}/get/groups`),
    fetchWithTimeout(`${baseUrl}/get/games`),
  ]);

  if (!groupsRes.ok) {
    throw new Error(`World Cup groups API returned ${groupsRes.status}`);
  }

  const groupsPayload = await groupsRes.json();
  let gamesPayload = { games: [] };

  if (gamesRes.ok) {
    gamesPayload = await gamesRes.json();
  }

  return { groupsPayload, gamesPayload };
}

export async function fetchComputedResults(baseUrl = WORLDCUP_API_BASE) {
  const { groupsPayload, gamesPayload } = await fetchWorldCupApiData(baseUrl);
  return computeResultsFromWorldCupApi(groupsPayload, gamesPayload);
}
