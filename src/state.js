const SESSION_KEY = 'wc2026_session';

export function getSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setSession(player, pin) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ ...player, pin }));
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}
