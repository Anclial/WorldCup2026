/**
 * World Cup 2026 — 6-Team Challenge (Google Sheets backend)
 *
 * SETUP:
 * 1. Open your Google Sheet → Extensions → Apps Script
 * 2. Paste this file (SPREADSHEET_ID is already set)
 * 3. Run setupSheets() once from the editor (authorize when prompted)
 * 4. Edit the Players tab — add your friends and PINs
 * 5. Deploy → New deployment → Web app
 *      Execute as: Me | Who has access: Anyone
 * 6. Copy the Web App URL into src/config.js → APPS_SCRIPT_URL
 *
 * SHEET TABS (created by setupSheets):
 *
 * Players:  player_id | name | pin
 * Rosters:  player_id | team_1 | team_2 | team_3 | team_4 | team_5 | team_6 | points | updated_at
 * Results:  team_id | group_wins | group_draws | knockout_wins
 * Config:   key | value   (entries_locked = true/false)
 */

const SPREADSHEET_ID = '1hP3GiaeaMfaokbmm9nJDy8T9ZtF_y7oaljRZgxuX-48';

const TABS = {
  PLAYERS: 'Players',
  ROSTERS: 'Rosters',
  RESULTS: 'Results',
  CONFIG: 'Config',
};

const TIER_MULTIPLIER = { 1: 1, 2: 1.5, 3: 2.5 };

/** Mirrors src/data/teams.js — used for server-side validation & scoring */
const TEAMS = {
  brazil: { tier: 1, group: 'C' },
  germany: { tier: 1, group: 'E' },
  netherlands: { tier: 1, group: 'F' },
  belgium: { tier: 1, group: 'G' },
  spain: { tier: 1, group: 'H' },
  france: { tier: 1, group: 'I' },
  argentina: { tier: 1, group: 'J' },
  portugal: { tier: 1, group: 'K' },
  england: { tier: 1, group: 'L' },
  mexico: { tier: 2, group: 'A' },
  'south-korea': { tier: 2, group: 'A' },
  switzerland: { tier: 2, group: 'B' },
  morocco: { tier: 2, group: 'C' },
  usa: { tier: 2, group: 'D' },
  ecuador: { tier: 2, group: 'E' },
  japan: { tier: 2, group: 'F' },
  uruguay: { tier: 2, group: 'H' },
  senegal: { tier: 2, group: 'I' },
  austria: { tier: 2, group: 'J' },
  colombia: { tier: 2, group: 'K' },
  croatia: { tier: 2, group: 'L' },
  'czech-republic': { tier: 3, group: 'A' },
  'south-africa': { tier: 3, group: 'A' },
  canada: { tier: 3, group: 'B' },
  bosnia: { tier: 3, group: 'B' },
  qatar: { tier: 3, group: 'B' },
  haiti: { tier: 3, group: 'C' },
  scotland: { tier: 3, group: 'C' },
  paraguay: { tier: 3, group: 'D' },
  australia: { tier: 3, group: 'D' },
  turkey: { tier: 3, group: 'D' },
  curacao: { tier: 3, group: 'E' },
  'ivory-coast': { tier: 3, group: 'E' },
  sweden: { tier: 3, group: 'F' },
  tunisia: { tier: 3, group: 'F' },
  egypt: { tier: 3, group: 'G' },
  iran: { tier: 3, group: 'G' },
  'new-zealand': { tier: 3, group: 'G' },
  'cape-verde': { tier: 3, group: 'H' },
  'saudi-arabia': { tier: 3, group: 'H' },
  iraq: { tier: 3, group: 'I' },
  norway: { tier: 3, group: 'I' },
  algeria: { tier: 3, group: 'J' },
  jordan: { tier: 3, group: 'J' },
  'dr-congo': { tier: 3, group: 'K' },
  uzbekistan: { tier: 3, group: 'K' },
  ghana: { tier: 3, group: 'L' },
  panama: { tier: 3, group: 'L' },
};

// ─── HTTP handlers ───────────────────────────────────────────────────────────

function doGet() {
  try {
    recalculateAllPoints();
    return jsonResponse(getAllData());
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;

    if (action === 'login') {
      const player = authenticatePlayer(body.playerId, body.pin);
      if (!player) return jsonResponse({ error: 'Invalid player or PIN' });
      return jsonResponse({ player });
    }

    if (action === 'submitRoster') {
      const player = authenticatePlayer(body.playerId, body.pin);
      if (!player) return jsonResponse({ error: 'Invalid player or PIN' });
      if (isEntriesLocked()) return jsonResponse({ error: 'Entries are locked — rosters can no longer be changed.' });

      const validation = validateRoster(body.teamIds);
      if (!validation.valid) return jsonResponse({ error: validation.errors.join(' ') });

      saveRoster(body.playerId, body.teamIds);
      recalculateAllPoints();
      return jsonResponse({ success: true, data: getAllData() });
    }

    return jsonResponse({ error: 'Unknown action' });
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── One-time sheet setup ────────────────────────────────────────────────────

function setupSheets() {
  const ss = getSpreadsheet();

  ensureSheet(ss, TABS.PLAYERS, [
    ['player_id', 'name', 'pin'],
    ['jason', 'Jason', '1234'],
    ['mike', 'Mike', '5678'],
    ['sarah', 'Sarah', '9999'],
    ['alex', 'Alex', '0000'],
  ]);

  ensureSheet(ss, TABS.ROSTERS, [
    ['player_id', 'team_1', 'team_2', 'team_3', 'team_4', 'team_5', 'team_6', 'points', 'updated_at'],
  ]);

  ensureSheet(ss, TABS.RESULTS, [
    ['team_id', 'group_wins', 'group_draws', 'knockout_wins'],
  ]);

  ensureSheet(ss, TABS.CONFIG, [
    ['key', 'value'],
    ['entries_locked', 'false'],
  ]);

  // Seed Results rows for every team (all zeros)
  const resultsSheet = ss.getSheetByName(TABS.RESULTS);
  const existing = resultsSheet.getLastRow();
  if (existing <= 1) {
    Object.keys(TEAMS).forEach((teamId) => {
      resultsSheet.appendRow([teamId, 0, 0, 0]);
    });
  }
}

function ensureSheet(ss, name, rows) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  sheet.clear();
  rows.forEach((row) => sheet.appendRow(row));
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, rows[0].length).setFontWeight('bold');
}

// ─── Data access ─────────────────────────────────────────────────────────────

function getSpreadsheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getSheetData(sheetName) {
  const sheet = getSpreadsheet().getSheetByName(sheetName);
  if (!sheet) throw new Error('Missing sheet tab: ' + sheetName);

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0].map(normalizeHeader);
  return values.slice(1)
    .filter((row) => row.some((cell) => cell !== '' && cell !== null))
    .map((row) => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i]; });
      return obj;
    });
}

function normalizeHeader(h) {
  return String(h).trim().toLowerCase().replace(/\s+/g, '_');
}

function isTruthy(value) {
  if (typeof value === 'boolean') return value;
  const s = String(value).toLowerCase().trim();
  return s === 'true' || s === 'yes' || s === '1' || s === 'y';
}

function isEntriesLocked() {
  const rows = getSheetData(TABS.CONFIG);
  const row = rows.find((r) => String(r.key) === 'entries_locked');
  return row ? isTruthy(row.value) : false;
}

function getAllData() {
  const players = getSheetData(TABS.PLAYERS).map((p) => ({
    playerId: String(p.player_id),
    name: String(p.name || ''),
  }));

  const rosters = getSheetData(TABS.ROSTERS).map((r) => ({
    playerId: String(r.player_id),
    teamIds: [r.team_1, r.team_2, r.team_3, r.team_4, r.team_5, r.team_6]
      .map((t) => String(t || '').trim())
      .filter(Boolean),
    points: Number(r.points) || 0,
    updatedAt: formatDateTime(r.updated_at),
  }));

  const standings = players
    .map((p) => {
      const roster = rosters.find((r) => r.playerId === p.playerId);
      return {
        playerId: p.playerId,
        name: p.name,
        points: roster ? roster.points : 0,
      };
    })
    .sort((a, b) => b.points - a.points);

  return {
    players,
    rosters,
    standings,
    entriesLocked: isEntriesLocked(),
  };
}

function formatDateTime(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
  }
  return String(value || '');
}

// ─── Auth ────────────────────────────────────────────────────────────────────

function authenticatePlayer(playerId, pin) {
  const rows = getSheetData(TABS.PLAYERS);
  const match = rows.find((r) => String(r.player_id) === String(playerId));
  if (!match) return null;
  if (String(match.pin) !== String(pin)) return null;
  return { playerId: String(match.player_id), name: String(match.name) };
}

// ─── Roster validation & save ────────────────────────────────────────────────

function validateRoster(teamIds) {
  const errors = [];
  if (!teamIds || teamIds.length !== 6) {
    errors.push('Roster must have exactly 6 teams.');
    return { valid: false, errors };
  }

  const tierCounts = { 1: 0, 2: 0, 3: 0 };
  const groups = [];

  teamIds.forEach((id) => {
    const team = TEAMS[String(id)];
    if (!team) {
      errors.push('Unknown team: ' + id);
      return;
    }
    tierCounts[team.tier]++;
    groups.push(team.group);
  });

  if (tierCounts[1] !== 2) errors.push('Need exactly 2 Tier 1 Favorites.');
  if (tierCounts[2] !== 2) errors.push('Need exactly 2 Tier 2 Contenders.');
  if (tierCounts[3] !== 2) errors.push('Need exactly 2 Tier 3 Underdogs.');

  const groupSet = {};
  groups.forEach((g) => {
    if (groupSet[g]) errors.push('Only one team per group — Group ' + g + ' is used twice.');
    groupSet[g] = true;
  });

  return { valid: errors.length === 0, errors };
}

function saveRoster(playerId, teamIds) {
  const sheet = getSpreadsheet().getSheetByName(TABS.ROSTERS);
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(normalizeHeader);
  const playerIdCol = headers.indexOf('player_id');
  const now = new Date();

  let rowNum = -1;
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][playerIdCol]) === String(playerId)) {
      rowNum = i + 1;
      break;
    }
  }

  const rowData = [
    playerId,
    teamIds[0], teamIds[1], teamIds[2],
    teamIds[3], teamIds[4], teamIds[5],
    '', now,
  ];

  if (rowNum > 0) {
    sheet.getRange(rowNum, 1, 1, rowData.length).setValues([rowData]);
  } else {
    sheet.appendRow(rowData);
  }
}

// ─── Scoring ─────────────────────────────────────────────────────────────────
// Group win = 1 pt | Group draw = 0.5 pt | Knockout win = 1 base pt × tier multiplier

function scoreTeam(teamId) {
  const team = TEAMS[teamId];
  if (!team) return 0;

  const results = getSheetData(TABS.RESULTS);
  const result = results.find((r) => String(r.team_id) === teamId);
  if (!result) return 0;

  const groupWins = Number(result.group_wins) || 0;
  const groupDraws = Number(result.group_draws) || 0;
  const knockoutWins = Number(result.knockout_wins) || 0;
  const multiplier = TIER_MULTIPLIER[team.tier];

  return (groupWins * 1) + (groupDraws * 0.5) + (knockoutWins * 1 * multiplier);
}

function recalculateAllPoints() {
  const sheet = getSpreadsheet().getSheetByName(TABS.ROSTERS);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return;

  const headers = values[0].map(normalizeHeader);
  const pointsCol = headers.indexOf('points');
  if (pointsCol === -1) return;

  const teamCols = [1, 2, 3, 4, 5, 6].map((n) => headers.indexOf('team_' + n));

  for (let i = 1; i < values.length; i++) {
    let total = 0;
    teamCols.forEach((col) => {
      if (col === -1) return;
      const teamId = String(values[i][col] || '').trim();
      if (teamId) total += scoreTeam(teamId);
    });
    sheet.getRange(i + 1, pointsCol + 1).setValue(total);
  }
}
