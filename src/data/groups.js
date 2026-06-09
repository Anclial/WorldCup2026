export const PLAYER_CIRCLES = [
  { id: 'friends', label: 'Friends' },
  { id: 'family', label: 'Family' },
  { id: 'colleague', label: 'Colleague' },
];

export const CIRCLE_BY_ID = Object.fromEntries(PLAYER_CIRCLES.map((c) => [c.id, c]));
