export const GROUP_STAGE_POINTS = {
  1: { win: 1.0, draw: 0.5, label: 'Favorites' },
  2: { win: 1.2, draw: 0.6, label: 'Contenders' },
  3: { win: 1.5, draw: 0.75, label: 'Underdogs' },
};

export const KNOCKOUT_ROUNDS = [
  { key: 'r32', label: 'Qualify for Round of 32', points: 1 },
  { key: 'r16', label: 'Qualify for Round of 16', points: 2 },
  { key: 'qf', label: 'Qualify for Quarter-Finals', points: 3 },
  { key: 'sf', label: 'Qualify for Semi-Finals', points: 4 },
  { key: 'final', label: 'Reach the Final', points: 5 },
  { key: 'champion', label: 'Win the World Cup', points: 7 },
];

export const KNOCKOUT_MULTIPLIERS = {
  1: { label: 'Tier 1 Favorites', value: '1×' },
  2: { label: 'Tier 2 Contenders', value: '1.5×' },
  3: { label: 'Tier 3 Underdogs', value: '2.5×' },
};

export function getTierScoringSummary(tier) {
  const group = GROUP_STAGE_POINTS[tier];
  const knockout = KNOCKOUT_MULTIPLIERS[tier];
  return `Group win ${group.win} · draw ${group.draw} · Knockout ${knockout.value} base`;
}

export function isResultFlagged(value) {
  if (typeof value === 'boolean') return value;
  const s = String(value ?? '').toLowerCase().trim();
  return s === 'true' || s === 'yes' || s === '1' || s === 'y';
}

/** Points accrued by one team from group + knockout results. */
export function scoreTeamPoints(teamId, result, teamById) {
  const team = teamById[teamId];
  if (!team || !result) return 0;

  const groupPts = GROUP_STAGE_POINTS[team.tier];
  const wins = Number(result.group_wins) || 0;
  const draws = Number(result.group_draws) || 0;
  const groupScore = wins * groupPts.win + draws * groupPts.draw;

  const multiplier = team.tier === 1 ? 1 : team.tier === 2 ? 1.5 : 2.5;
  let knockoutScore = 0;
  KNOCKOUT_ROUNDS.forEach((round) => {
    if (isResultFlagged(result[round.key])) knockoutScore += round.points * multiplier;
  });

  return groupScore + knockoutScore;
}

export function hasTeamPlayed(result) {
  if (!result) return false;
  if (Number(result.matches_played || 0) > 0) return true;
  if ((Number(result.group_wins) || 0) > 0 || (Number(result.group_draws) || 0) > 0) return true;
  return KNOCKOUT_ROUNDS.some((round) => isResultFlagged(result[round.key]));
}

export function formatTeamPointSuffix(teamId, result, teamById) {
  if (!hasTeamPlayed(result)) return '*';
  const points = scoreTeamPoints(teamId, result, teamById);
  if (points === 0) return '0';
  return Number.isInteger(points) ? String(points) : Number(points).toFixed(1);
}

export function isTeamEliminated(result) {
  if (!result || !hasTeamPlayed(result)) return false;
  return isResultFlagged(result.eliminated);
}

export function formatTeamLeaderboardLabel(teamId, resultsByTeam, teamById) {
  const team = teamById[teamId];
  if (!team) return '';
  const suffix = formatTeamPointSuffix(teamId, resultsByTeam[teamId], teamById);
  return `${team.name} (${suffix})`;
}
