import { APPS_SCRIPT_URL, isAppsScriptConfigured } from './config.js';

async function request(method, body) {
  if (!isAppsScriptConfigured()) {
    throw new Error(
      'APPS_SCRIPT_URL is not set. Open src/config.js and paste your deployed Web App URL (the one ending in /exec).'
    );
  }

  const url =
    method === 'GET'
      ? `${APPS_SCRIPT_URL}?t=${Date.now()}`
      : APPS_SCRIPT_URL;

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
    res = await fetch(url, options);
  } catch {
    throw new Error(
      'Could not reach Google Apps Script. Check that APPS_SCRIPT_URL in src/config.js is your real /exec URL, deployment access is set to "Anyone", and nothing is blocking script.google.com.'
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

export function join(name, pin) {
  return request('POST', { action: 'join', name, pin: pin || '' });
}

export function submitRoster(playerId, pin, teamIds) {
  return request('POST', { action: 'submitRoster', playerId, pin, teamIds });
}
