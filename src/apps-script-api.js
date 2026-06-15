import { APPS_SCRIPT_URL, isAppsScriptConfigured } from './config.js';

const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 800;
const GET_TIMEOUT_MS = 65_000;
const POST_TIMEOUT_MS = 45_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function request(method, body, urlOverride, attempt = 1) {
  if (!isAppsScriptConfigured()) {
    throw new Error(
      'APPS_SCRIPT_URL is not set. Open src/config.js and paste your deployed Web App URL (the one ending in /exec).'
    );
  }

  const url =
    urlOverride ||
    (method === 'GET'
      ? `${APPS_SCRIPT_URL}?t=${Date.now()}`
      : APPS_SCRIPT_URL);

  const options = {
    method,
    redirect: 'follow',
  };

  if (body) {
    options.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
    options.body = JSON.stringify(body);
  }

  let res;
  const timeoutMs = method === 'GET' ? GET_TIMEOUT_MS : POST_TIMEOUT_MS;
  try {
    res = await fetchWithTimeout(url, options, timeoutMs);
  } catch (err) {
    const timedOut = err?.name === 'AbortError';
    if (attempt < MAX_ATTEMPTS) {
      await sleep(RETRY_DELAY_MS * attempt);
      return request(method, body, urlOverride, attempt + 1);
    }
    if (timedOut) {
      throw new Error(
        'Google Apps Script took too long to respond. Try again in a moment, or open this page in Chrome instead of an in-app browser.'
      );
    }
    throw new Error(
      `Could not reach Google Apps Script after ${MAX_ATTEMPTS} tries. Open your /exec URL in a new tab — you should see JSON starting with {"apiVersion":2. If that works, hard-refresh this page (Cmd+Shift+R).`
    );
  }

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      'Apps Script returned an unexpected response. Open your Web App URL directly in the browser — you should see JSON. If you see a sign-in page, set deployment access to "Anyone".'
    );
  }

  if (data.error) {
    const message = String(data.error);
    if (message.includes('UrlFetchApp.fetch') || message.includes('external_request')) {
      throw new Error(
        'Live score sync is not authorized yet in Apps Script. Paste the latest Code.gs, redeploy, then run syncResultsFromApi once to grant permissions.'
      );
    }
    throw new Error(message);
  }
  return data;
}

export function fetchData() {
  return request('GET');
}

function joinViaGet(name, circle) {
  const params = new URLSearchParams({
    action: 'join',
    name,
    circle: circle || '',
    t: String(Date.now()),
  });
  return request('GET', null, `${APPS_SCRIPT_URL}?${params}`);
}

function submitRosterViaGet(playerId, teamIds) {
  const params = new URLSearchParams({
    action: 'submitRoster',
    playerId,
    teamIds: teamIds.join(','),
    t: String(Date.now()),
  });
  return request('GET', null, `${APPS_SCRIPT_URL}?${params}`);
}

function shouldFallbackToGet(err) {
  const message = String(err?.message || err || '');
  return (
    message.includes('Unknown action') ||
    message.includes('Could not reach') ||
    message.includes('unexpected response') ||
    message.includes('took too long')
  );
}

export async function join(name, circle) {
  try {
    return await joinViaGet(name, circle);
  } catch (err) {
    if (!shouldFallbackToGet(err)) throw err;
    try {
      return await request('POST', { action: 'join', name, circle: circle || '' });
    } catch (postErr) {
      if (shouldFallbackToGet(postErr)) {
        return joinViaGet(name, circle);
      }
      throw postErr;
    }
  }
}

export async function submitRoster(playerId, teamIds) {
  try {
    return await request('POST', { action: 'submitRoster', playerId, teamIds });
  } catch (err) {
    if (!shouldFallbackToGet(err)) throw err;
    return submitRosterViaGet(playerId, teamIds);
  }
}
