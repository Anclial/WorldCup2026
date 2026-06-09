export const TIERS = {
  1: { id: 1, name: 'Favorites', label: 'Tier 1', multiplier: '1×', pickCount: 2, color: 'tier-1' },
  2: { id: 2, name: 'Contenders', label: 'Tier 2', multiplier: '1.5×', pickCount: 2, color: 'tier-2' },
  3: { id: 3, name: 'Underdogs', label: 'Tier 3', multiplier: '2.5×', pickCount: 2, color: 'tier-3' },
};

/** @type {{ id: string, name: string, group: string, tier: 1|2|3 }[]} */
export const TEAMS = [
  // Tier 1 — Favorites
  { id: 'brazil', name: 'Brazil', group: 'C', tier: 1 },
  { id: 'germany', name: 'Germany', group: 'E', tier: 1 },
  { id: 'netherlands', name: 'Netherlands', group: 'F', tier: 1 },
  { id: 'belgium', name: 'Belgium', group: 'G', tier: 1 },
  { id: 'spain', name: 'Spain', group: 'H', tier: 1 },
  { id: 'france', name: 'France', group: 'I', tier: 1 },
  { id: 'argentina', name: 'Argentina', group: 'J', tier: 1 },
  { id: 'portugal', name: 'Portugal', group: 'K', tier: 1 },
  { id: 'england', name: 'England', group: 'L', tier: 1 },

  // Tier 2 — Contenders
  { id: 'mexico', name: 'Mexico', group: 'A', tier: 2 },
  { id: 'south-korea', name: 'South Korea', group: 'A', tier: 2 },
  { id: 'switzerland', name: 'Switzerland', group: 'B', tier: 2 },
  { id: 'morocco', name: 'Morocco', group: 'C', tier: 2 },
  { id: 'usa', name: 'United States', group: 'D', tier: 2 },
  { id: 'ecuador', name: 'Ecuador', group: 'E', tier: 2 },
  { id: 'japan', name: 'Japan', group: 'F', tier: 2 },
  { id: 'uruguay', name: 'Uruguay', group: 'H', tier: 2 },
  { id: 'senegal', name: 'Senegal', group: 'I', tier: 2 },
  { id: 'austria', name: 'Austria', group: 'J', tier: 2 },
  { id: 'colombia', name: 'Colombia', group: 'K', tier: 2 },
  { id: 'croatia', name: 'Croatia', group: 'L', tier: 2 },

  // Tier 3 — Underdogs
  { id: 'czech-republic', name: 'Czech Republic', group: 'A', tier: 3 },
  { id: 'south-africa', name: 'South Africa', group: 'A', tier: 3 },
  { id: 'canada', name: 'Canada', group: 'B', tier: 3 },
  { id: 'bosnia', name: 'Bosnia and Herzegovina', group: 'B', tier: 3 },
  { id: 'qatar', name: 'Qatar', group: 'B', tier: 3 },
  { id: 'haiti', name: 'Haiti', group: 'C', tier: 3 },
  { id: 'scotland', name: 'Scotland', group: 'C', tier: 3 },
  { id: 'paraguay', name: 'Paraguay', group: 'D', tier: 3 },
  { id: 'australia', name: 'Australia', group: 'D', tier: 3 },
  { id: 'turkey', name: 'Turkey', group: 'D', tier: 3 },
  { id: 'curacao', name: 'Curaçao', group: 'E', tier: 3 },
  { id: 'ivory-coast', name: 'Ivory Coast', group: 'E', tier: 3 },
  { id: 'sweden', name: 'Sweden', group: 'F', tier: 3 },
  { id: 'tunisia', name: 'Tunisia', group: 'F', tier: 3 },
  { id: 'egypt', name: 'Egypt', group: 'G', tier: 3 },
  { id: 'iran', name: 'Iran', group: 'G', tier: 3 },
  { id: 'new-zealand', name: 'New Zealand', group: 'G', tier: 3 },
  { id: 'cape-verde', name: 'Cape Verde', group: 'H', tier: 3 },
  { id: 'saudi-arabia', name: 'Saudi Arabia', group: 'H', tier: 3 },
  { id: 'iraq', name: 'Iraq', group: 'I', tier: 3 },
  { id: 'norway', name: 'Norway', group: 'I', tier: 3 },
  { id: 'algeria', name: 'Algeria', group: 'J', tier: 3 },
  { id: 'jordan', name: 'Jordan', group: 'J', tier: 3 },
  { id: 'dr-congo', name: 'DR Congo', group: 'K', tier: 3 },
  { id: 'uzbekistan', name: 'Uzbekistan', group: 'K', tier: 3 },
  { id: 'ghana', name: 'Ghana', group: 'L', tier: 3 },
  { id: 'panama', name: 'Panama', group: 'L', tier: 3 },
];

export const TEAM_BY_ID = Object.fromEntries(TEAMS.map((t) => [t.id, t]));

export const RULES = {
  totalPicks: 6,
  tierPicks: { 1: 2, 2: 2, 3: 2 },
  maxPerGroup: 1,
};
