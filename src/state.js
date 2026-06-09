const SESSION_KEY = 'wc2026_session';
const DRAFT_KEY = 'wc2026_drafts';

export function getSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setSession(player, pin, extras = {}) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ ...player, pin, ...extras }));
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

export function getDraft(playerId) {
  try {
    const drafts = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
    return drafts[playerId] || [];
  } catch {
    return [];
  }
}

export function saveDraft(playerId, teamIds) {
  const drafts = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
  drafts[playerId] = teamIds;
  localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts));
}

export function clearDraft(playerId) {
  const drafts = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
  delete drafts[playerId];
  localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts));
}
