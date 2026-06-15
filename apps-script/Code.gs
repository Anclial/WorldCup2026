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
 * Players:  player_id | name | created_at | circle
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
      const result = joinPlayer(params.name, params.circle);
      if (result.error) return jsonResponse({ error: result.error });
      clearDataCache();
      return jsonResponse(result);
    }

    if (params.action === 'syncScores') {
      try {
        const result = syncResultsFromApi(true);
        clearDataCache();
        return jsonResponse(result);
      } catch (syncErr) {
        return jsonResponse({ error: String(syncErr) });
      }
    }

    try {
      var syncResult = syncResultsIfStale();
      if (syncResult && syncResult.ok) clearDataCache();
    } catch (syncErr) {
      // Score sync needs UrlFetch authorization — app still loads without it.
    }

    const cached = getCachedAllData();
    if (cached) return jsonResponse(cached);

    const data = getAllData();
    setCachedAllData(data);
    return jsonResponse(data);
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
      const result = joinPlayer(body.name, body.circle);
      if (result.error) return jsonResponse({ error: result.error });
      clearDataCache();
      return jsonResponse(result);
    }

    if (action === 'submitRoster' || action === 'submitPicks') {
      const player = authenticatePlayer(body.playerId);
      if (!player) return jsonResponse({ error: 'Player not found' });
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
      clearDataCache();
      const data = getAllData();
      setCachedAllData(data);
      return jsonResponse({ success: true, data: data });
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
    ['player_id', 'name', 'created_at', 'circle'],
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

var DATA_CACHE_KEY = 'allData_v2';
var DATA_CACHE_TTL = 120;

function getCachedAllData() {
  var cached = CacheService.getScriptCache().get(DATA_CACHE_KEY);
  if (!cached) return null;
  try {
    return JSON.parse(cached);
  } catch (err) {
    return null;
  }
}

function setCachedAllData(data) {
  try {
    CacheService.getScriptCache().put(DATA_CACHE_KEY, JSON.stringify(data), DATA_CACHE_TTL);
  } catch (err) {
    // Payload may exceed cache size limits — skip caching.
  }
}

function clearDataCache() {
  CacheService.getScriptCache().remove(DATA_CACHE_KEY);
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
    scoresSyncedAt: getLastResultsSyncIso(),
    autoScores: true,
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

function normalizeFirstName(name) {
  return String(name || '').trim().split(/\s+/)[0];
}

function joinPlayer(name, circle) {
  const trimmed = normalizeFirstName(name);
  if (!trimmed) return { error: 'Please enter your first name.' };
  if (trimmed.length < 2) return { error: 'First name must be at least 2 characters.' };

  const existing = findPlayerByName(trimmed);

  if (existing) {
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

  const playerCircle = normalizeCircle(circle);
  if (!playerCircle) {
    return { needsCircle: true, name: trimmed };
  }

  const playerId = createPlayerId(trimmed);
  const sheet = getSpreadsheet().getSheetByName(TABS.PLAYERS);
  sheet.appendRow([playerId, trimmed, new Date(), playerCircle]);

  return {
    player: { playerId: playerId, name: trimmed, circle: playerCircle },
    isNew: true,
    rosterLocked: false,
  };
}

function findPlayerByName(name) {
  const trimmed = normalizeFirstName(name);
  const normalized = trimmed.toLowerCase();
  const key = normalized.replace(/[\s_-]+/g, '');
  const first = normalized.split(/[\s_]+/)[0];

  return getSheetData(TABS.PLAYERS).find(function(r) {
    var rowName = String(r.name).trim().toLowerCase();
    var playerId = String(r.player_id).toLowerCase();
    if (rowName === normalized) return true;
    if (rowName.replace(/[\s_-]+/g, '') === key) return true;
    if (playerId === key || playerId.replace(/-/g, '_') === key.replace(/-/g, '_')) return true;
    if (rowName.split(/[\s_]+/)[0] === first) return true;
    if (playerId.split(/[-_]+/)[0] === first) return true;
    return false;
  });
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

function authenticatePlayer(playerId) {
  const rows = getSheetData(TABS.PLAYERS);
  const match = rows.find((r) => String(r.player_id) === String(playerId));
  if (!match) return null;
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

// ─── Auto score sync (worldcup26.ir) ─────────────────────────────────────────

var WORLDCUP_API_BASE = 'https://worldcup26.ir';
var RESULTS_SYNC_INTERVAL_MS = 15 * 60 * 1000;

var API_TEAM_ID_TO_SLUG = {
  '1': 'mexico', '2': 'south-africa', '3': 'south-korea', '4': 'czech-republic',
  '5': 'canada', '6': 'bosnia', '7': 'qatar', '8': 'switzerland',
  '9': 'brazil', '10': 'morocco', '11': 'haiti', '12': 'scotland',
  '13': 'usa', '14': 'paraguay', '15': 'australia', '16': 'turkey',
  '17': 'germany', '18': 'curacao', '19': 'ivory-coast', '20': 'ecuador',
  '21': 'netherlands', '22': 'japan', '23': 'sweden', '24': 'tunisia',
  '25': 'belgium', '26': 'egypt', '27': 'iran', '28': 'new-zealand',
  '29': 'spain', '30': 'cape-verde', '31': 'saudi-arabia', '32': 'uruguay',
  '33': 'france', '34': 'senegal', '35': 'iraq', '36': 'norway',
  '37': 'argentina', '38': 'algeria', '39': 'austria', '40': 'jordan',
  '41': 'portugal', '42': 'dr-congo', '43': 'uzbekistan', '44': 'colombia',
  '45': 'england', '46': 'croatia', '47': 'ghana', '48': 'panama',
};

function getLastResultsSyncIso() {
  var ts = PropertiesService.getScriptProperties().getProperty('last_results_sync');
  if (!ts) return '';
  return Utilities.formatDate(new Date(Number(ts)), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
}

function syncResultsIfStale() {
  var props = PropertiesService.getScriptProperties();
  var last = Number(props.getProperty('last_results_sync') || 0);
  if (Date.now() - last < RESULTS_SYNC_INTERVAL_MS) return { skipped: true };
  return syncResultsFromApi(false);
}

function syncResultsFromApi(force) {
  var props = PropertiesService.getScriptProperties();
  if (!force) {
    var last = Number(props.getProperty('last_results_sync') || 0);
    if (Date.now() - last < RESULTS_SYNC_INTERVAL_MS) {
      return { skipped: true, scoresSyncedAt: getLastResultsSyncIso() };
    }
  }

  var groupsPayload = fetchWorldCupJson_('/get/groups');
  var gamesPayload = { games: [] };
  try {
    gamesPayload = fetchWorldCupJson_('/get/games');
  } catch (err) {
    // Knockout data is optional if groups sync succeeds.
  }

  var computed = computeResultsFromWorldCupApi_(groupsPayload, gamesPayload);
  writeResultsToSheet_(computed);
  recalculateAllPoints();
  props.setProperty('last_results_sync', String(Date.now()));

  return {
    ok: true,
    updatedTeams: Object.keys(computed).length,
    scoresSyncedAt: getLastResultsSyncIso(),
  };
}

function fetchWorldCupJson_(path) {
  var url = WORLDCUP_API_BASE + path;
  var res = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    followRedirects: true,
    headers: { Accept: 'application/json' },
  });
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('World Cup API ' + path + ' returned HTTP ' + code);
  }
  return JSON.parse(res.getContentText());
}

function emptyResultRow_() {
  return { group_wins: 0, group_draws: 0, r32: 0, r16: 0, qf: 0, sf: 0, final: 0, champion: 0 };
}

function slugFromApiTeamId_(apiTeamId) {
  return API_TEAM_ID_TO_SLUG[String(apiTeamId)] || '';
}

function isGameFinished_(game) {
  var finished = String(game.finished || '').toUpperCase();
  return finished === 'TRUE' || finished === '1' || game.time_elapsed === 'finished';
}

function compareGroupRows_(a, b) {
  var ptsDiff = (Number(b.pts) || 0) - (Number(a.pts) || 0);
  if (ptsDiff !== 0) return ptsDiff;
  var gdDiff = (Number(b.gd) || 0) - (Number(a.gd) || 0);
  if (gdDiff !== 0) return gdDiff;
  return (Number(b.gf) || 0) - (Number(a.gf) || 0);
}

function computeResultsFromWorldCupApi_(groupsPayload, gamesPayload) {
  var results = {};
  Object.keys(TEAMS).forEach(function(id) {
    results[id] = emptyResultRow_();
  });

  var groups = Array.isArray(groupsPayload) ? groupsPayload : (groupsPayload.groups || []);
  var games = Array.isArray(gamesPayload) ? gamesPayload : (gamesPayload.games || []);
  var knockoutTypes = ['r32', 'r16', 'qf', 'sf', 'final'];
  var advanceOnWin = { r32: 'r16', r16: 'qf', qf: 'sf', sf: 'final', final: 'champion' };

  groups.forEach(function(group) {
    var teams = group.teams || [];
    teams.forEach(function(entry) {
      var slug = slugFromApiTeamId_(entry.team_id);
      if (!slug || !results[slug]) return;
      results[slug].group_wins = Number(entry.w) || 0;
      results[slug].group_draws = Number(entry.d) || 0;
    });

    var allFinished = teams.length === 4 && teams.every(function(t) { return Number(t.mp) >= 3; });
    if (allFinished) {
      teams.slice().sort(compareGroupRows_).slice(0, 2).forEach(function(entry) {
        var slug = slugFromApiTeamId_(entry.team_id);
        if (slug && results[slug]) results[slug].r32 = 1;
      });
    }
  });

  games.forEach(function(game) {
    var type = String(game.type || '');
    if (type === 'group') return;

    var homeId = String(game.home_team_id || '0');
    var awayId = String(game.away_team_id || '0');
    [homeId, awayId].forEach(function(apiId) {
      if (apiId === '0') return;
      var slug = slugFromApiTeamId_(apiId);
      if (!slug || !results[slug]) return;
      if (type === 'r32' || knockoutTypes.indexOf(type) !== -1) results[slug].r32 = 1;
      if (type === 'final') results[slug].final = 1;
    });

    if (!isGameFinished_(game) || homeId === '0' || awayId === '0') return;

    var homeScore = Number(game.home_score);
    var awayScore = Number(game.away_score);
    if (isNaN(homeScore) || isNaN(awayScore)) return;

    var winnerId = null;
    if (homeScore > awayScore) winnerId = homeId;
    else if (awayScore > homeScore) winnerId = awayId;
    if (!winnerId || knockoutTypes.indexOf(type) === -1) return;

    var winnerSlug = slugFromApiTeamId_(winnerId);
    if (!winnerSlug || !results[winnerSlug]) return;

    var advanceKey = advanceOnWin[type];
    if (advanceKey) results[winnerSlug][advanceKey] = 1;
    if (type === 'sf') results[winnerSlug].final = 1;
  });

  return results;
}

function writeResultsToSheet_(computed) {
  var sheet = getSpreadsheet().getSheetByName(TABS.RESULTS);
  if (!sheet) throw new Error('Missing sheet tab: ' + TABS.RESULTS);

  var values = sheet.getDataRange().getValues();
  if (values.length < 1) return;

  var headers = values[0].map(normalizeHeader);
  var teamIdCol = headers.indexOf('team_id');
  if (teamIdCol === -1) throw new Error('Results sheet missing team_id column');

  var roundKeys = ['group_wins', 'group_draws', 'r32', 'r16', 'qf', 'sf', 'final', 'champion'];
  var colByKey = {};
  roundKeys.forEach(function(key) {
    colByKey[key] = headers.indexOf(key);
  });

  for (var i = 1; i < values.length; i++) {
    var teamId = String(values[i][teamIdCol] || '').trim();
    var row = computed[teamId];
    if (!row) continue;

    roundKeys.forEach(function(key) {
      var col = colByKey[key];
      if (col !== -1) values[i][col] = row[key] || 0;
    });
  }

  if (values.length > 1) {
    sheet.getRange(2, 1, values.length - 1, headers.length).setValues(values.slice(1));
  }
}

/** Run once in Apps Script to refresh scores every 30 minutes during the tournament. */
function installAutoScoreSyncTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'syncResultsFromApiTrigger') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger('syncResultsFromApiTrigger')
    .timeBased()
    .everyMinutes(30)
    .create();
}

function syncResultsFromApiTrigger() {
  syncResultsFromApi(true);
  clearDataCache();
}
