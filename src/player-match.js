export function normalizeLoginName(name) {
  return String(name || '').trim().split(/\s+/)[0];
}

function loginNameKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

export function matchPlayerByLoginName(name, player) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return false;

  const normalized = trimmed.toLowerCase();
  const first = normalizeLoginName(trimmed).toLowerCase();
  const key = loginNameKey(trimmed);
  const pName = String(player.name || '').trim().toLowerCase();
  const pId = String(player.playerId || player.id || '').toLowerCase();

  if (pName === normalized) return true;
  if (loginNameKey(player.name) === key) return true;
  if (pId === key || pId.replace(/-/g, '_') === key.replace(/-/g, '_')) return true;
  if (pName.split(/[\s_]+/)[0] === first) return true;
  if (pId.split(/[-_]+/)[0] === first) return true;
  return false;
}

export function findPlayerByLoginName(name, players) {
  return players.find((p) => matchPlayerByLoginName(name, p)) || null;
}

export function isLegacyPinLoginError(message) {
  const text = String(message || '').toLowerCase();
  return text.includes('pin') || text.includes('already registered');
}
