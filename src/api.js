import { APPS_SCRIPT_URL, isAppsScriptConfigured } from './config.js';

const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 800;
const REQUEST_TIMEOUT_MS = 25_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchWithTimeout(url, options, timeoutMs = REQUEST_TIMEOUT_MS) {
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
  try {
    res = await fetchWithTimeout(url, options);
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

  if (data.error) throw new Error(data.error);
  return data;
}

export function fetchData() {
  return request('GET');
}

function joinViaGet(name, pin, circle) {
  const params = new URLSearchParams({
    action: 'join',
    name,
    pin: pin || '',
    circle: circle || '',
    t: String(Date.now()),
  });
  return request('GET', null, `${APPS_SCRIPT_URL}?${params}`);
}

export async function join(name, pin, circle) {
  const payload = { action: 'join', name, pin: pin || '', circle: circle || '' };
  try {
    return await request('POST', payload);
  } catch (err) {
    const message = String(err.message);
    if (message.includes('Unknown action') || message.includes('Could not reach')) {
      return joinViaGet(name, pin, circle);
    }
    throw err;
  }
}

export function submitRoster(playerId, pin, teamIds) {
  return request('POST', { action: 'submitRoster', playerId, pin, teamIds });
}
