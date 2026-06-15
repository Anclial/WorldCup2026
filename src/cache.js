const CACHE_KEY = 'wc2026_data_cache';
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_DISPLAY_MS = 30 * 60_000;

function readCacheEntry() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.data || !parsed?.fetchedAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function getCachedData({ allowStale = false } = {}) {
  const parsed = readCacheEntry();
  if (!parsed) return null;

  const age = Date.now() - parsed.fetchedAt;
  if (age <= CACHE_TTL_MS) return parsed.data;
  if (allowStale && age <= CACHE_DISPLAY_MS) return parsed.data;
  return null;
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
  const parsed = readCacheEntry();
  if (!parsed) return false;
  return Date.now() - parsed.fetchedAt <= CACHE_TTL_MS;
}
