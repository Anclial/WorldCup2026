const CACHE_KEY = 'wc2026_data_cache';
const CACHE_TTL_MS = 60_000;

export function getCachedData() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.data || !parsed?.fetchedAt) return null;
    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export function setCachedData(data) {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ fetchedAt: Date.now(), data })
    );
  } catch {
    // Ignore quota / private-mode storage errors.
  }
}

export function clearCachedData() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // Ignore.
  }
}

export function isCacheFresh() {
  return getCachedData() !== null;
}
