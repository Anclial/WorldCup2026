import { slugFromApiTeamId } from './worldcup-sync.js';
import { TEAM_BY_ID } from './teams.js';

export const BRACKET_ROUNDS = [
  { type: 'r32', label: 'Round of 32' },
  { type: 'r16', label: 'Round of 16' },
  { type: 'qf', label: 'Quarter-finals' },
  { type: 'sf', label: 'Semi-finals' },
  { type: 'third', label: 'Third-place match' },
  { type: 'final', label: 'Final' },
];

/** Stadium local timezone (API `local_date` is venue local). */
const STADIUM_TIMEZONE = {
  1: 'America/Mexico_City',
  2: 'America/Mexico_City',
  3: 'America/Mexico_City',
  4: 'America/Chicago',
  5: 'America/Chicago',
  6: 'America/Chicago',
  7: 'America/New_York',
  8: 'America/New_York',
  9: 'America/New_York',
  10: 'America/New_York',
  11: 'America/New_York',
  12: 'America/Toronto',
  13: 'America/Vancouver',
  14: 'America/Los_Angeles',
  15: 'America/Los_Angeles',
  16: 'America/Los_Angeles',
};

const ET_TIMEZONE = 'America/New_York';

export function isBracketGameFinished(game) {
  const finished = String(game?.finished ?? '').toUpperCase();
  return finished === 'TRUE' || finished === '1' || game?.time_elapsed === 'finished';
}

function parseLocalDateString(localDate) {
  const match = String(localDate || '').match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/);
  if (!match) return null;
  return {
    month: Number(match[1]),
    day: Number(match[2]),
    year: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
}

/** Convert API local_date + stadium to a UTC instant. */
export function stadiumLocalToDate(localDate, stadiumId) {
  const parts = parseLocalDateString(localDate);
  if (!parts) return null;

  const sourceTz = STADIUM_TIMEZONE[Number(stadiumId)] || ET_TIMEZONE;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: sourceTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  let timestamp = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  for (let i = 0; i < 6; i++) {
    const mapped = Object.fromEntries(
      formatter.formatToParts(new Date(timestamp)).map((p) => [p.type, p.value])
    );
    const deltaMinutes =
      (parts.year - Number(mapped.year)) * 525600 +
      (parts.month - Number(mapped.month)) * 43200 +
      (parts.day - Number(mapped.day)) * 1440 +
      (parts.hour - Number(mapped.hour)) * 60 +
      (parts.minute - Number(mapped.minute));
    if (deltaMinutes === 0) break;
    timestamp -= deltaMinutes * 60_000;
  }

  return new Date(timestamp);
}

export function formatMatchTimeET(localDate, stadiumId) {
  const date = stadiumLocalToDate(localDate, stadiumId);
  if (!date || Number.isNaN(date.getTime())) return '';

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ET_TIMEZONE,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(date);

  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  const dayPeriod = get('dayPeriod').toUpperCase();
  return `${get('weekday')}, ${get('month')} ${get('day')} · ${get('hour')}:${get('minute')} ${dayPeriod} ET`;
}

export function getBracketTeamSlug(game, side) {
  const apiId = String(side === 'home' ? game.home_team_id : game.away_team_id || '');
  if (!apiId || apiId === '0') return '';
  return slugFromApiTeamId(apiId);
}

export function getBracketTeamName(game, side) {
  const nameEn = side === 'home' ? game.home_team_name_en : game.away_team_name_en;
  if (nameEn) return String(nameEn);

  const slug = getBracketTeamSlug(game, side);
  if (slug && TEAM_BY_ID[slug]) return TEAM_BY_ID[slug].name;

  const label = side === 'home' ? game.home_team_label : game.away_team_label;
  if (label) return String(label);

  const apiId = side === 'home' ? game.home_team_id : game.away_team_id;
  return apiId && apiId !== '0' ? `Team ${apiId}` : 'TBD';
}

export function formatBracketScore(game) {
  if (!isBracketGameFinished(game)) return '';

  const homeScore = Number(game.home_score);
  const awayScore = Number(game.away_score);
  if (Number.isNaN(homeScore) || Number.isNaN(awayScore)) return '';

  const homePen = Number(game.home_penalty_score);
  const awayPen = Number(game.away_penalty_score);
  if (
    homeScore === awayScore &&
    !Number.isNaN(homePen) &&
    !Number.isNaN(awayPen) &&
    homePen !== awayPen
  ) {
    return `${homeScore}–${awayScore} (${homePen}–${awayPen} pens)`;
  }

  return `${homeScore}–${awayScore}`;
}

export function getBracketWinnerSide(game) {
  if (!isBracketGameFinished(game)) return null;

  const homeScore = Number(game.home_score);
  const awayScore = Number(game.away_score);
  if (Number.isNaN(homeScore) || Number.isNaN(awayScore)) return null;

  if (homeScore > awayScore) return 'home';
  if (awayScore > homeScore) return 'away';

  const homePen = Number(game.home_penalty_score);
  const awayPen = Number(game.away_penalty_score);
  if (!Number.isNaN(homePen) && !Number.isNaN(awayPen) && homePen !== awayPen) {
    return homePen > awayPen ? 'home' : 'away';
  }

  return null;
}

export function normalizeKnockoutGames(gamesPayload) {
  const games = Array.isArray(gamesPayload)
    ? gamesPayload
    : gamesPayload?.games || [];

  return games
    .filter((game) => game.type && game.type !== 'group')
    .sort((a, b) => Number(a.id) - Number(b.id));
}

export function groupGamesByRound(games) {
  const byRound = Object.fromEntries(BRACKET_ROUNDS.map((round) => [round.type, []]));
  games.forEach((game) => {
    if (byRound[game.type]) byRound[game.type].push(game);
  });
  return byRound;
}
