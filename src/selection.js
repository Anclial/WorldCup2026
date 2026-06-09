import { RULES, TEAM_BY_ID, TEAMS, TIERS } from './data/teams.js';

export function getTeamsByTier(tier) {
  return TEAMS.filter((t) => t.tier === tier);
}

export function getTierCounts(selectedIds) {
  const counts = { 1: 0, 2: 0, 3: 0 };
  selectedIds.forEach((id) => {
    const team = TEAM_BY_ID[id];
    if (team) counts[team.tier]++;
  });
  return counts;
}

export function getUsedGroups(selectedIds) {
  const groups = new Set();
  selectedIds.forEach((id) => {
    const team = TEAM_BY_ID[id];
    if (team) groups.add(team.group);
  });
  return groups;
}

export function isTeamDisabled(teamId, selectedIds) {
  const team = TEAM_BY_ID[teamId];
  if (!team) return true;

  const isSelected = selectedIds.includes(teamId);
  if (isSelected) return false;

  const counts = getTierCounts(selectedIds);
  if (counts[team.tier] >= RULES.tierPicks[team.tier]) return true;

  const usedGroups = getUsedGroups(selectedIds);
  if (usedGroups.has(team.group)) return true;

  return false;
}

export function togglePick(teamId, selectedIds) {
  if (selectedIds.includes(teamId)) {
    return selectedIds.filter((id) => id !== teamId);
  }
  if (isTeamDisabled(teamId, selectedIds)) return selectedIds;
  return [...selectedIds, teamId];
}

export function validateRoster(selectedIds) {
  const errors = [];
  const counts = getTierCounts(selectedIds);

  if (selectedIds.length !== RULES.totalPicks) {
    errors.push(`Select exactly ${RULES.totalPicks} teams (${selectedIds.length} chosen).`);
  }

  Object.entries(RULES.tierPicks).forEach(([tier, required]) => {
    const n = counts[Number(tier)];
    if (n !== required) {
      errors.push(`Need ${required} ${TIERS[tier].name} (${n} chosen).`);
    }
  });

  const groups = selectedIds.map((id) => TEAM_BY_ID[id]?.group);
  const groupSet = new Set();
  groups.forEach((g) => {
    if (groupSet.has(g)) errors.push(`Only one team per group — Group ${g} has two picks.`);
    groupSet.add(g);
  });

  return { valid: errors.length === 0, errors };
}

export function getDisableReason(teamId, selectedIds) {
  const team = TEAM_BY_ID[teamId];
  if (!team) return '';

  if (selectedIds.includes(teamId)) return '';

  const counts = getTierCounts(selectedIds);
  if (counts[team.tier] >= RULES.tierPicks[team.tier]) {
    return `${TIERS[team.tier].name} slots full`;
  }

  const usedGroups = getUsedGroups(selectedIds);
  if (usedGroups.has(team.group)) {
    return `Group ${team.group} already used`;
  }

  return '';
}
