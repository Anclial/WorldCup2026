/**
 * World Cup 2026 — 6-Team Challenge (Google Sheets backend)
 *
 * SETUP:
 * 1. Open your Google Sheet → Extensions → Apps Script
 * 2. Paste this file, save
 * 3. Run migrateSheets() once if upgrading an existing sheet
 * 4. Deploy → Manage deployments → Edit → New version → Deploy
 *      Execute as: Me | Who has access: Anyone
 *
 * SHEET TABS:
 * Players:  player_id | name | pin | created_at | circle
 * Rosters:  player_id | team_1 … team_6 | points | updated_at | locked
 * Results:  team_id | group_wins | group_draws | r32 | r16 | qf | sf | final | champion
 *   (knockout columns: 1 = team reached that round)
 * Config:   key | value
 */

const SPREADSHEET_ID = '1hP3GiaeaMfaokbmm9nJDy8T9ZtF_y7oaljRZgxuX-48';

const TABS = {
  PLAYERS: 'Players',
  ROSTERS: 'Rosters',
  RESULTS: 'Results',
  CONFIG: 'Config',
};

const TIER_MULTIPLIER = { 1: 1, 2: 1.5, 3: 2.5 };

const GROUP_STAGE_POINTS = {
  1: { win: 1.0, draw: 0.5 },
  2: { win: 1.2, draw: 0.6 },
  3: { win: 1.5, draw: 0.75 },
};

const KNOCKOUT_ROUNDS = [
  { key: 'r32', points: 1 },
  { key: 'r16', points: 2 },
  { key: 'qf', points: 3 },
  { key: 'sf', points: 4 },
  { key: 'final', points: 5 },
  { key: 'champion', points: 7 },
];

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

function doGet(e) {
  try {
    migrateSheetsOnce();

    // GET fallback for join (use if POST returns "Unknown action")
    const params = (e && e.parameter) || {};
    if (params.action === 'join') {
      const result = joinPlayer(params.name, params.pin, params.circle);
      if (result.error) return jsonResponse({ error: result.error });
      return jsonResponse(result);
    }

    return jsonResponse(getAllData());
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
}

function doPost(e) {
  try {
    migrateSheetsOnce();
    const body = JSON.parse(e.postData.contents);
    const action = body.action;

    // v2 API — if you see "Unknown action", redeploy this file as a new version
    if (action === 'join' || (action === 'login' && body.name)) {
      const result = joinPlayer(body.name, body.pin, body.circle);
      if (result.error) return jsonResponse({ error: result.error });
      return jsonResponse(result);
    }

    if (action === 'submitRoster' || action === 'submitPicks') {
      const player = authenticatePlayer(body.playerId, body.pin);
      if (!player) return jsonResponse({ error: 'Invalid player or PIN' });
      if (isEntriesLocked()) {
        return jsonResponse({ error: 'Entries are closed — rosters can no longer be submitted.' });
      }
      if (isRosterLocked(body.playerId)) {
        return jsonResponse({ error: 'Your roster is already locked.' });
      }

      const validation = validateRoster(body.teamIds);
      if (!validation.valid) return jsonResponse({ error: validation.errors.join(' ') });

      saveRoster(body.playerId, body.teamIds, true);
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

// ─── Sheet setup & migration ─────────────────────────────────────────────────

function setupSheets() {
  const ss = getSpreadsheet();

  ensureSheet(ss, TABS.PLAYERS, [
    ['player_id', 'name', 'pin', 'created_at', 'circle'],
  ]);

  ensureSheet(ss, TABS.ROSTERS, [
    ['player_id', 'team_1', 'team_2', 'team_3', 'team_4', 'team_5', 'team_6', 'points', 'updated_at', 'locked'],
  ]);

  ensureSheet(ss, TABS.RESULTS, [
    ['team_id', 'group_wins', 'group_draws', 'r32', 'r16', 'qf', 'sf', 'final', 'champion'],
  ]);

  ensureSheet(ss, TABS.CONFIG, [
    ['key', 'value'],
    ['entries_locked', 'false'],
  ]);

  seedResults(ss);
}

var VALID_CIRCLES = ['family', 'friends', 'work'];

function migrateSheets() {
  const ss = getSpreadsheet();
  ensureColumn(ss, TABS.PLAYERS, 'created_at');
  ensureColumn(ss, TABS.PLAYERS, 'circle');
  ensureColumn(ss, TABS.ROSTERS, 'locked');
  KNOCKOUT_ROUNDS.forEach(function(round) {
    ensureColumn(ss, TABS.RESULTS, round.key);
  });
  ensureMissingResultRows(ss);
}

function migrateSheetsOnce() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('schema_v2') === 'done') return;
  migrateSheets();
  props.setProperty('schema_v2', 'done');
}

function ensureColumn(ss, tabName, columnName) {
  const sheet = ss.getSheetByName(tabName);
  if (!sheet) return;
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(normalizeHeader);
  if (headers.indexOf(columnName) === -1) {
    sheet.getRange(1, lastCol + 1).setValue(columnName).setFontWeight('bold');
  }
}

function seedResults(ss) {
  const resultsSheet = ss.getSheetByName(TABS.RESULTS);
  if (!resultsSheet || resultsSheet.getLastRow() > 1) return;
  Object.keys(TEAMS).forEach((teamId) => {
    resultsSheet.appendRow([teamId, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
}

function ensureMissingResultRows(ss) {
  const sheet = ss.getSheetByName(TABS.RESULTS);
  if (!sheet || sheet.getLastRow() < 1) return;

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(normalizeHeader);
  const teamIdCol = headers.indexOf('team_id');
  if (teamIdCol === -1) return;

  const values = sheet.getDataRange().getValues();
  const existing = {};
  for (var i = 1; i < values.length; i++) {
    existing[String(values[i][teamIdCol])] = true;
  }

  Object.keys(TEAMS).forEach(function(teamId) {
    if (!existing[teamId]) {
      var row = new Array(headers.length).fill(0);
      row[teamIdCol] = teamId;
      sheet.appendRow(row);
    }
  });
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

function isRosterLocked(playerId) {
  const rows = getSheetData(TABS.ROSTERS);
  const row = rows.find((r) => String(r.player_id) === String(playerId));
  return row ? isTruthy(row.locked) : false;
}

function getAllData() {
  const ss = getSpreadsheet();
  const players = readSheetRows(ss, TABS.PLAYERS).map((p) => ({
    playerId: String(p.player_id),
    name: String(p.name || ''),
    circle: normalizeCircle(p.circle),
  }));

  const rosters = readSheetRows(ss, TABS.ROSTERS).map((r) => ({
    playerId: String(r.player_id),
    teamIds: [r.team_1, r.team_2, r.team_3, r.team_4, r.team_5, r.team_6]
      .map((t) => String(t || '').trim())
      .filter(Boolean),
    points: Number(r.points) || 0,
    updatedAt: formatDateTime(r.updated_at),
    locked: isTruthy(r.locked),
  }));

  const rosterByPlayer = {};
  rosters.forEach(function(r) { rosterByPlayer[r.playerId] = r; });

  const standings = players
    .map((p) => {
      const roster = rosterByPlayer[p.playerId];
      return {
        playerId: p.playerId,
        name: p.name,
        circle: p.circle,
        points: roster ? roster.points : 0,
      };
    })
    .sort((a, b) => b.points - a.points);

  const standingsByCircle = {};
  VALID_CIRCLES.forEach(function(circle) {
    standingsByCircle[circle] = standings
      .filter(function(s) { return s.circle === circle; })
      .sort(function(a, b) { return b.points - a.points; });
  });

  const configRows = readSheetRows(ss, TABS.CONFIG);
  const entriesLockedRow = configRows.find((r) => String(r.key) === 'entries_locked');

  return {
    apiVersion: 2,
    players,
    rosters,
    standings,
    standingsByCircle: standingsByCircle,
    entriesLocked: entriesLockedRow ? isTruthy(entriesLockedRow.value) : false,
  };
}

function readSheetRows(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
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

function formatDateTime(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
  }
  return String(value || '');
}

// ─── Join & auth ─────────────────────────────────────────────────────────────

function normalizeCircle(value) {
  var circle = String(value || '').trim().toLowerCase();
  if (circle === 'colleague') circle = 'work';
  return VALID_CIRCLES.indexOf(circle) !== -1 ? circle : '';
}

function joinPlayer(name, pin, circle) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return { error: 'Please enter your name.' };
  if (trimmed.length < 2) return { error: 'Name must be at least 2 characters.' };

  const pinStr = String(pin || '').trim();
  const existing = findPlayerByName(trimmed);

  if (existing) {
    if (!pinStr) {
      return {
        error: 'That name is already registered. Enter your PIN, or use a different name.',
      };
    }
    if (String(existing.pin) !== pinStr) {
      return { error: 'Incorrect PIN for that name.' };
    }
    const playerCircle = normalizeCircle(existing.circle);
    return {
      player: {
        playerId: String(existing.player_id),
        name: String(existing.name),
        circle: playerCircle,
      },
      isNew: false,
      rosterLocked: isRosterLocked(existing.player_id),
    };
  }

  if (pinStr) {
    return { error: 'Name not found. Leave PIN blank to join as a new player.' };
  }

  const playerCircle = normalizeCircle(circle);
  if (!playerCircle) {
    return { error: 'Please select how you know Jason (Family, Friends, or Work).' };
  }

  const playerId = createPlayerId(trimmed);
  const newPin = generatePin();
  const sheet = getSpreadsheet().getSheetByName(TABS.PLAYERS);
  sheet.appendRow([playerId, trimmed, newPin, new Date(), playerCircle]);

  return {
    player: { playerId: playerId, name: trimmed, circle: playerCircle },
    pin: newPin,
    isNew: true,
    rosterLocked: false,
  };
}

function findPlayerByName(name) {
  const normalized = name.trim().toLowerCase();
  return getSheetData(TABS.PLAYERS).find(
    (r) => String(r.name).trim().toLowerCase() === normalized
  );
}

function slugify(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'player';
}

function createPlayerId(name) {
  const base = slugify(name);
  const rows = getSheetData(TABS.PLAYERS);
  let id = base;
  let attempts = 0;
  while (rows.some((r) => String(r.player_id) === id) && attempts < 50) {
    id = base + '-' + Math.floor(1000 + Math.random() * 9000);
    attempts++;
  }
  return id;
}

function generatePin() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

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
    errors.push('Fill all 6 roster slots before locking in.');
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

function saveRoster(playerId, teamIds, lock) {
  const sheet = getSpreadsheet().getSheetByName(TABS.ROSTERS);
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(normalizeHeader);
  const playerIdCol = headers.indexOf('player_id');
  const lockedCol = headers.indexOf('locked');
  const now = new Date();

  let rowNum = -1;
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][playerIdCol]) === String(playerId)) {
      rowNum = i + 1;
      break;
    }
  }

  const rowData = new Array(headers.length).fill('');
  rowData[playerIdCol] = playerId;
  const teamCols = [1, 2, 3, 4, 5, 6].map((n) => headers.indexOf('team_' + n));
  teamCols.forEach((col, i) => {
    if (col !== -1) rowData[col] = teamIds[i];
  });
  const pointsCol = headers.indexOf('points');
  const updatedCol = headers.indexOf('updated_at');
  if (updatedCol !== -1) rowData[updatedCol] = now;
  if (lockedCol !== -1) rowData[lockedCol] = lock ? 'true' : '';

  if (rowNum > 0) {
    sheet.getRange(rowNum, 1, 1, rowData.length).setValues([rowData]);
  } else {
    if (pointsCol !== -1) rowData[pointsCol] = '';
    sheet.appendRow(rowData);
  }
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

function scoreGroupStage(team, result) {
  var pts = GROUP_STAGE_POINTS[team.tier];
  if (!pts) return 0;
  var wins = Number(result.group_wins) || 0;
  var draws = Number(result.group_draws) || 0;
  return (wins * pts.win) + (draws * pts.draw);
}

function scoreKnockout(team, result) {
  var multiplier = TIER_MULTIPLIER[team.tier];
  var total = 0;
  KNOCKOUT_ROUNDS.forEach(function(round) {
    if (isTruthy(result[round.key])) {
      total += round.points * multiplier;
    }
  });
  return total;
}

function buildResultsByTeam() {
  var resultsByTeam = {};
  getSheetData(TABS.RESULTS).forEach(function(r) {
    resultsByTeam[String(r.team_id)] = r;
  });
  return resultsByTeam;
}

function scoreTeamWithResults(teamId, resultsByTeam) {
  var team = TEAMS[teamId];
  if (!team) return 0;

  var result = resultsByTeam[teamId];
  if (!result) return 0;

  return scoreGroupStage(team, result) + scoreKnockout(team, result);
}

function recalculateAllPoints() {
  const sheet = getSpreadsheet().getSheetByName(TABS.ROSTERS);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return;

  const headers = values[0].map(normalizeHeader);
  const pointsCol = headers.indexOf('points');
  if (pointsCol === -1) return;

  const teamCols = [1, 2, 3, 4, 5, 6].map((n) => headers.indexOf('team_' + n));
  const resultsByTeam = buildResultsByTeam();
  const pointValues = [];

  for (let i = 1; i < values.length; i++) {
    let total = 0;
    teamCols.forEach((col) => {
      if (col === -1) return;
      const teamId = String(values[i][col] || '').trim();
      if (teamId) total += scoreTeamWithResults(teamId, resultsByTeam);
    });
    pointValues.push([total]);
  }

  if (pointValues.length) {
    sheet.getRange(2, pointsCol + 1, pointValues.length, 1).setValues(pointValues);
  }
}
