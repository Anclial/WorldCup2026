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
    matches_played: 0,
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

function resolveKnockoutWinnerId(game) {
  const homeId = String(game.home_team_id || '0');
  const awayId = String(game.away_team_id || '0');
  if (homeId === '0' || awayId === '0') return null;

  const homeScore = Number(game.home_score);
  const awayScore = Number(game.away_score);
  if (Number.isNaN(homeScore) || Number.isNaN(awayScore)) return null;

  if (homeScore > awayScore) return homeId;
  if (awayScore > homeScore) return awayId;

  const homePen = Number(game.home_penalty_score);
  const awayPen = Number(game.away_penalty_score);
  if (!Number.isNaN(homePen) && !Number.isNaN(awayPen) && homePen !== awayPen) {
    return homePen > awayPen ? homeId : awayId;
  }

  return null;
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

function getGroupTeamApiIds(group) {
  return (group.teams || []).map((entry) => String(entry.team_id || '')).filter(Boolean);
}

function getGroupGames(games, teamApiIds) {
  const idSet = new Set(teamApiIds);
  return games.filter((game) => {
    if (String(game.type || '') !== 'group') return false;
    return idSet.has(String(game.home_team_id || '')) && idSet.has(String(game.away_team_id || ''));
  });
}

function buildGroupStatsFromGames(games, teamApiIds) {
  const stats = {};
  teamApiIds.forEach((apiId) => {
    const slug = slugFromApiTeamId(apiId);
    if (!slug) return;
    stats[slug] = { mp: 0, w: 0, d: 0, gf: 0, ga: 0, gd: 0, pts: 0 };
  });

  let finishedGames = 0;
  getGroupGames(games, teamApiIds).forEach((game) => {
    if (!isGameFinished(game)) return;

    const homeId = String(game.home_team_id || '');
    const awayId = String(game.away_team_id || '');
    const homeSlug = slugFromApiTeamId(homeId);
    const awaySlug = slugFromApiTeamId(awayId);
    const homeScore = Number(game.home_score);
    const awayScore = Number(game.away_score);
    if (!homeSlug || !awaySlug || !stats[homeSlug] || !stats[awaySlug]) return;
    if (Number.isNaN(homeScore) || Number.isNaN(awayScore)) return;

    finishedGames++;
    stats[homeSlug].mp++;
    stats[awaySlug].mp++;
    stats[homeSlug].gf += homeScore;
    stats[homeSlug].ga += awayScore;
    stats[awaySlug].gf += awayScore;
    stats[awaySlug].ga += homeScore;

    if (homeScore > awayScore) stats[homeSlug].w++;
    else if (awayScore > homeScore) stats[awaySlug].w++;
    else {
      stats[homeSlug].d++;
      stats[awaySlug].d++;
    }
  });

  Object.values(stats).forEach((row) => {
    row.gd = row.gf - row.ga;
    row.pts = row.w * 3 + row.d;
  });

  return { stats, finishedGames };
}

function applyGroupStatsToResults(stats, results) {
  Object.entries(stats).forEach(([slug, row]) => {
    if (!results[slug]) return;
    results[slug].group_wins = row.w;
    results[slug].group_draws = row.d;
    results[slug].matches_played = row.mp;
  });
}

function rankGroupStats(stats) {
  return Object.entries(stats)
    .map(([slug, row]) => ({ slug, ...row }))
    .sort((a, b) => {
      const ptsDiff = b.pts - a.pts;
      if (ptsDiff !== 0) return ptsDiff;
      const gdDiff = b.gd - a.gd;
      if (gdDiff !== 0) return gdDiff;
      return b.gf - a.gf;
    });
}

/**
 * Build Results-sheet rows from worldcup26.ir groups + games payloads.
 */
export function computeResultsFromWorldCupApi(groupsPayload, gamesPayload) {
  const results = Object.fromEntries(Object.keys(TEAM_BY_ID).map((id) => [id, emptyResultRow()]));
  const groups = normalizeGroupsPayload(groupsPayload);
  const games = normalizeGamesPayload(gamesPayload);

  groups.forEach((group) => {
    const teamApiIds = getGroupTeamApiIds(group);
    const teams = group.teams || [];

    teams.forEach((entry) => {
      const slug = slugFromApiTeamId(entry.team_id);
      if (!slug || !results[slug]) return;
      results[slug].group_wins = Number(entry.w) || 0;
      results[slug].group_draws = Number(entry.d) || 0;
      results[slug].matches_played = Number(entry.mp) || 0;
    });

    const { stats, finishedGames } = buildGroupStatsFromGames(games, teamApiIds);
    if (finishedGames > 0) {
      applyGroupStatsToResults(stats, results);
    }

    const allFinishedFromTable = teams.length === 4 && teams.every((t) => Number(t.mp) >= 3);
    const allFinishedFromGames =
      teamApiIds.length === 4 &&
      teamApiIds.every((apiId) => {
        const slug = slugFromApiTeamId(apiId);
        return slug && stats[slug] && stats[slug].mp >= 3;
      });

    if (allFinishedFromTable || allFinishedFromGames) {
      const ranked = finishedGames > 0 ? rankGroupStats(stats) : rankGroupStats(
        Object.fromEntries(
          teams.map((entry) => {
            const slug = slugFromApiTeamId(entry.team_id);
            return [
              slug,
              {
                pts: Number(entry.pts) || 0,
                gd: Number(entry.gd) || 0,
                gf: Number(entry.gf) || 0,
              },
            ];
          }).filter(([slug]) => slug && results[slug])
        )
      );

      ranked.slice(0, 2).forEach((entry) => {
        if (entry.slug && results[entry.slug]) setFlag(results[entry.slug], 'r32');
      });
    }
  });

  games.forEach((game) => {
    const type = String(game.type || '');
    if (type === 'group') return;
    if (!isGameFinished(game)) return;

    const homeId = String(game.home_team_id || '0');
    const awayId = String(game.away_team_id || '0');
    if (homeId === '0' || awayId === '0') return;

    if (KNOCKOUT_TYPES.includes(type)) {
      [homeId, awayId].forEach((apiId) => {
        const slug = slugFromApiTeamId(apiId);
        if (slug && results[slug]) setFlag(results[slug], 'r32');
      });
    }

    const winnerId = resolveKnockoutWinnerId(game);
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
