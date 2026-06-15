export function normalizeLoginName(name) {
  return String(name || '').trim().split(/\s+/)[0];
}

export function loginNameKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function levenshtein(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  const row = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i++) {
    let prev = i;
    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      const next = Math.min(row[j] + 1, prev + 1, row[j - 1] + cost);
      row[j - 1] = prev;
      prev = next;
    }
    row[right.length] = prev;
  }
  return row[right.length];
}

function firstTokenLower(name) {
  return normalizeLoginName(name).toLowerCase();
}

function playerIdKey(player) {
  return String(player.playerId || player.id || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
}

/** True only for an unambiguous match — not partial first-name matches like Tim → Tim B. */
export function isExactPlayerMatch(input, player) {
  const trimmed = String(input || '').trim();
  if (!trimmed) return false;

  const inputKey = loginNameKey(trimmed);
  const playerName = String(player.name || '').trim();
  const playerKey = loginNameKey(playerName);
  const idKey = playerIdKey(player);

  if (trimmed.toLowerCase() === playerName.toLowerCase()) return true;
  if (inputKey && inputKey === playerKey) return true;
  if (inputKey && (inputKey === idKey || inputKey.replace(/-/g, '_') === idKey)) return true;
  return false;
}

function similarityScore(input, player) {
  const trimmed = String(input || '').trim();
  if (!trimmed || isExactPlayerMatch(trimmed, player)) return 0;

  const inputFirst = firstTokenLower(trimmed);
  const playerFirst = firstTokenLower(player.name);
  const inputKey = loginNameKey(trimmed);
  const playerKey = loginNameKey(player.name);
  const idKey = playerIdKey(player);

  if (!inputFirst || !playerFirst) return 0;

  if (inputFirst === playerFirst && inputKey !== playerKey) return 92;
  if (inputKey === idKey.split(/[_-]+/)[0]) return 88;

  const shorter = inputFirst.length <= playerFirst.length ? inputFirst : playerFirst;
  const longer = inputFirst.length > playerFirst.length ? inputFirst : playerFirst;
  if (shorter.length >= 2 && longer.startsWith(shorter) && shorter !== longer) {
    return 84;
  }

  const firstDist = levenshtein(inputFirst, playerFirst);
  const firstMax = Math.max(inputFirst.length, playerFirst.length);
  if (firstMax >= 4 && firstDist <= 1) return 86;
  if (firstMax >= 5 && firstDist <= 2) return 72;

  const fullDist = levenshtein(inputKey, playerKey);
  const fullMax = Math.max(inputKey.length, playerKey.length);
  if (fullMax >= 5 && fullDist <= 2) return 68;

  const idDist = levenshtein(inputKey, idKey);
  const idMax = Math.max(inputKey.length, idKey.length);
  if (idMax >= 5 && idDist <= 2) return 66;

  return 0;
}

/** Players that might be who the user meant — typos or partial names like Tim vs Tim B. */
export function findSimilarPlayers(input, players, { minScore = 66, limit = 3 } = {}) {
  const seen = new Set();
  return (players || [])
    .map((player) => ({ player, score: similarityScore(input, player) }))
    .filter(({ score }) => score >= minScore)
    .sort((a, b) => b.score - a.score || String(a.player.name).localeCompare(String(b.player.name)))
    .filter(({ player }) => {
      const id = String(player.playerId || player.id || '');
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .slice(0, limit)
    .map(({ player }) => player);
}

export function findExactPlayerByLoginName(name, players) {
  return (players || []).find((p) => isExactPlayerMatch(name, p)) || null;
}

export function matchPlayerByLoginName(name, player) {
  return isExactPlayerMatch(name, player);
}

export function findPlayerByLoginName(name, players) {
  return findExactPlayerByLoginName(name, players);
}

export function isLegacyPinLoginError(message) {
  const text = String(message || '').toLowerCase();
  return text.includes('pin') || text.includes('already registered');
}
