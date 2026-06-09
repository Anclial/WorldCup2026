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
