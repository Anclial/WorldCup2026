export const PLAYER_CIRCLES = [
  { id: 'family', label: 'Family' },
  { id: 'friends', label: 'Friends' },
  { id: 'work', label: 'Work' },
];

export const CIRCLE_BY_ID = Object.fromEntries(PLAYER_CIRCLES.map((c) => [c.id, c]));
