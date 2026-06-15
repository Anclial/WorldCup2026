import { fetchAppData, join, submitRoster, syncScoresInBackground } from './api.js';
import { CIRCLE_BY_ID, PLAYER_CIRCLES } from './data/groups.js';
import { WIN_ODDS_RANK } from './data/odds.js';
import { GROUP_STAGE_POINTS, KNOCKOUT_MULTIPLIERS, KNOCKOUT_ROUNDS } from './data/scoring.js';
import { RULES, TEAM_BY_ID, TIERS } from './data/teams.js';
import {
  getDisableReason,
  getTeamsByTier,
  getTierCounts,
  isTeamDisabled,
  togglePick,
  validateRoster,
} from './selection.js';
import { clearCachedData, getCachedData, isCacheFresh, setCachedData } from './cache.js';
import {
  findExactPlayerByLoginName,
  findSimilarPlayers,
  normalizeLoginName,
} from './player-match.js';
import { clearDraft, clearSession, getDraft, getSession, saveDraft, setSession } from './state.js';

const $ = (sel) => document.querySelector(sel);

let activeTab = 'board';
let draftPicks = [];
let appData = {
  players: [],
  rosters: {},
  rosterLocked: {},
  standings: [],
  standingsByCircle: {},
  entriesLocked: false,
  scoresSyncedAt: '',
  autoScores: false,
};
let isSaving = false;
let boardMounted = false;
let boardClickBound = false;
let selectedCircle = '';
let loadingCount = 0;
let loadingMessage = 'Loading contest data…';

init();

async function init() {
  bindEvents();

  const cached = getCachedData({ allowStale: true });
  if (cached) {
    applyAppDataFromResponse(cached);
  }

  const session = getSession();
  if (session) {
    enterApp({
      ...session,
      circle: session.circle || getPlayerCircle(session.playerId),
      rosterLocked: isRosterLocked(session.playerId),
    });
  } else {
    showWelcome();
  }

  await refreshDataInBackground();
}

function applyFreshAppData(data) {
  setCachedData(data);
  applyAppDataFromResponse(data);
  refreshVisibleTab();
}

function refreshVisibleTab() {
  const session = getSession();
  if (!session) return;

  if (activeTab === 'board') {
    updateBoardHeaderBar();
    if (boardMounted) updateBoard();
    else renderBoard();
  }
  if (activeTab === 'leaderboard') renderLeaderboard();
  if (activeTab === 'everyone') renderEveryone();
}

function runBackgroundScoreSync() {
  syncScoresInBackground()
    .then((fresh) => {
      if (!fresh) return;
      applyFreshAppData(fresh);
    })
    .catch(() => {
      // Scores stay at last synced values — app remains usable.
    });
}

async function refreshDataInBackground() {
  const hadDisplayableCache = !!getCachedData({ allowStale: true });
  if (!hadDisplayableCache) {
    showLoading(true, 'Loading contest data…');
  }

  try {
    const data = await fetchAppData();
    setCachedData(data);
    applyAppDataFromResponse(data);

    const session = getSession();
    if (session) {
      const stillValid = appData.players.some((p) => p.playerId === session.playerId);
      if (!stillValid) {
        clearSession();
        showWelcome();
        return;
      }
      refreshVisibleTab();
    }
  } catch (err) {
    if (!hadDisplayableCache) {
      showError(err.message, { retry: true });
      if (!getSession()) showWelcome();
    } else {
      showToast('Using saved data — live refresh failed. Tap Try again if scores look stale.');
    }
  } finally {
    showLoading(false);
  }

  runBackgroundScoreSync();
}

function applyAppDataFromResponse(data) {
  appData = {
    apiVersion: data.apiVersion || 1,
    players: data.players || [],
    rosters: {},
    rosterLocked: {},
    standings: data.standings || [],
    standingsByCircle: data.standingsByCircle || buildStandingsByCircle(data),
    entriesLocked: !!data.entriesLocked,
    scoresSyncedAt: data.scoresSyncedAt || '',
    autoScores: !!data.autoScores,
  };
  (data.rosters || []).forEach((r) => {
    appData.rosters[r.playerId] = r.teamIds || [];
    appData.rosterLocked[r.playerId] = !!r.locked;
  });
}

async function loadData({ force = false } = {}) {
  if (!force && isCacheFresh()) {
    const cached = getCachedData();
    if (cached) {
      applyAppDataFromResponse(cached);
      return;
    }
  }

  const data = await fetchAppData();
  setCachedData(data);
  applyAppDataFromResponse(data);
}

function mergePlayerIntoAppData(player) {
  if (!player?.playerId) return;

  const existing = appData.players.find((p) => p.playerId === player.playerId);
  if (existing) {
    if (player.name) existing.name = player.name;
    if (player.circle) existing.circle = player.circle;
  } else {
    appData.players.push({
      playerId: player.playerId,
      name: player.name,
      circle: player.circle || '',
    });
  }

  const standing = appData.standings.find((s) => s.playerId === player.playerId);
  if (standing) {
    if (player.name) standing.name = player.name;
    if (player.circle) standing.circle = player.circle;
  } else {
    appData.standings.push({
      playerId: player.playerId,
      name: player.name,
      circle: player.circle || '',
      points: 0,
    });
  }

  appData.standingsByCircle = buildStandingsByCircle(appData);
}

function getPlayerCircleValue(playerId) {
  const player = appData.players.find((p) => p.playerId === playerId);
  const standing = appData.standings.find((s) => s.playerId === playerId);
  return player?.circle || standing?.circle || '';
}

function getUnassignedPlayers() {
  return appData.players.filter((p) => !getPlayerCircleValue(p.playerId));
}

function getUnassignedStandings() {
  return appData.standings.filter((s) => !getPlayerCircleValue(s.playerId));
}

function buildStandingsByCircle(data) {
  const players = data.players || [];
  const standings = data.standings || [];
  const byCircle = {};
  PLAYER_CIRCLES.forEach((circle) => {
    byCircle[circle.id] = standings
      .filter((row) => {
        const player = players.find((p) => p.playerId === row.playerId);
        return (player?.circle || row.circle) === circle.id;
      })
      .sort((a, b) => b.points - a.points);
  });
  return byCircle;
}

function getPlayerCircle(playerId) {
  return appData.players.find((p) => p.playerId === playerId)?.circle || '';
}

function isRosterLocked(playerId) {
  return !!appData.rosterLocked[playerId] || appData.entriesLocked;
}

function bindEvents() {
  renderCirclePicker();
  $('#login-form').addEventListener('submit', onLogin);
  $('#tabs').addEventListener('click', onTabClick);
  $('#back-to-welcome').addEventListener('click', showWelcome);
}

function normalizeFirstName(value) {
  return normalizeLoginName(value);
}

function loginExistingPlayer(player) {
  mergePlayerIntoAppData(player);
  const rosterLocked = isRosterLocked(player.playerId);
  setSession(player, { rosterLocked, isNewPlayer: false });
  enterApp({ ...player, rosterLocked, isNewPlayer: false });
}

function toPlayerRecord(player) {
  return {
    playerId: player.playerId,
    name: player.name,
    circle: player.circle || '',
  };
}

function promptSimilarNameChoice(typedName, candidates) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'name-check-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'name-check-title');

    const primary = candidates[0];
    const extra =
      candidates.length > 1
        ? `<p class="name-check-alt">Or: ${candidates
            .slice(1)
            .map((p) => `<button type="button" class="name-check-alt-btn" data-player-id="${escapeHtml(p.playerId)}">${escapeHtml(p.name)}</button>`)
            .join(' ')}</p>`
        : '';

    const title =
      candidates.length === 1
        ? `Did you mean ${primary.name}?`
        : 'Did you mean one of these players?';

  const body =
      candidates.length === 1
        ? `<p>You entered <strong>${escapeHtml(typedName)}</strong>. There is already a player named <strong>${escapeHtml(primary.name)}</strong>. Is that you?</p>`
        : `<p>You entered <strong>${escapeHtml(typedName)}</strong>. ${escapeHtml(title)}</p>
           <ul class="name-check-list">${candidates
             .map((p) => `<li><button type="button" class="btn btn-ghost name-check-pick" data-player-id="${escapeHtml(p.playerId)}">${escapeHtml(p.name)}</button></li>`)
             .join('')}</ul>`;

    overlay.innerHTML = `
      <div class="name-check-card card">
        <h3 id="name-check-title" class="name-check-title">${escapeHtml(title)}</h3>
        ${body}
        ${extra}
        <div class="name-check-actions">
          ${
            candidates.length === 1
              ? `<button type="button" class="btn btn-primary" data-action="yes">Yes, that's me</button>`
              : ''
          }
          <button type="button" class="btn btn-ghost" data-action="no">No, join as ${escapeHtml(typedName)}</button>
        </div>
      </div>
    `;

    const cleanup = (value) => {
      overlay.remove();
      document.body.classList.remove('name-check-open');
      resolve(value);
    };

    const pickById = (playerId) => {
      const match = candidates.find((p) => p.playerId === playerId);
      cleanup(match ? toPlayerRecord(match) : false);
    };

    overlay.querySelector('[data-action="yes"]')?.addEventListener('click', () => {
      cleanup(toPlayerRecord(primary));
    });
    overlay.querySelector('[data-action="no"]')?.addEventListener('click', () => cleanup(false));
    overlay.querySelectorAll('[data-player-id]').forEach((btn) => {
      btn.addEventListener('click', () => pickById(btn.dataset.playerId));
    });

    document.body.classList.add('name-check-open');
    document.body.appendChild(overlay);
    overlay.querySelector('[data-action="yes"], .name-check-pick, [data-action="no"]')?.focus();
  });
}

async function completeJoinAsNew(rawName, circle) {
  const result = await join(rawName, circle, { forceNew: true });
  if (result.needsCircle) {
    showWelcome();
    showError('Pick Family, Friends, or Work to continue.');
    return;
  }

  mergePlayerIntoAppData(result.player);
  setSession(result.player, {
    rosterLocked: !!result.rosterLocked,
    isNewPlayer: !!result.isNew,
  });
  enterApp({
    ...result.player,
    rosterLocked: !!result.rosterLocked,
    isNewPlayer: !!result.isNew,
  });
}

function renderCirclePicker() {
  const picker = $('#circle-picker');
  if (!picker) return;

  picker.innerHTML = PLAYER_CIRCLES.map(
    (circle) => `
    <button type="button" class="circle-pick-btn" data-circle="${circle.id}">
      ${escapeHtml(circle.label)}
    </button>`
  ).join('');

  picker.querySelectorAll('.circle-pick-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      showJoinForm(btn.dataset.circle);
    });
  });
}

function showWelcome() {
  $('#welcome-section').classList.remove('hidden');
  $('#login-section').classList.add('hidden');
  $('#tabs').classList.add('hidden');
  $('#user-bar').classList.add('hidden');
  selectedCircle = '';
  hideError();
}

function showJoinForm(circleId) {
  const circle = CIRCLE_BY_ID[circleId];
  if (!circle) return;

  selectedCircle = circleId;
  const badge = $('#selected-circle-badge');
  badge.textContent = circle.label;
  badge.classList.remove('hidden');
  $('#welcome-section').classList.add('hidden');
  $('#login-section').classList.remove('hidden');
  $('#name-input').focus();
  hideError();
}

async function onLogin(e) {
  e.preventDefault();
  hideError();

  const rawName = $('#name-input').value.trim();
  const name = normalizeFirstName(rawName);
  if (!name || name.length < 2) {
    showError('Enter your first name (at least 2 characters).');
    return;
  }

  if (!selectedCircle) {
    showError('Please go back and choose how you know Jason.');
    return;
  }

  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  showLoading(true, 'Signing you in…');

  const findExactPlayer = () =>
    findExactPlayerByLoginName(rawName, appData.players) ||
    findExactPlayerByLoginName(name, appData.players);

  try {
    const exact = findExactPlayer();
    if (exact) {
      loginExistingPlayer(exact);
      return;
    }

    const similar = findSimilarPlayers(rawName, appData.players);
    if (similar.length) {
      showLoading(false);
      const choice = await promptSimilarNameChoice(rawName, similar);
      if (choice && typeof choice === 'object') {
        showLoading(true, 'Signing you in…');
        loginExistingPlayer(choice);
        return;
      }
      if (choice === false) {
        showLoading(true, 'Creating your entry…');
        await completeJoinAsNew(rawName, selectedCircle);
        return;
      }
      return;
    }

    const result = await join(rawName, selectedCircle);
    if (result.needsCircle) {
      showWelcome();
      showError('Pick Family, Friends, or Work to continue.');
      return;
    }

    mergePlayerIntoAppData(result.player);
    setSession(result.player, {
      rosterLocked: !!result.rosterLocked,
      isNewPlayer: !!result.isNew,
    });
    enterApp({
      ...result.player,
      rosterLocked: !!result.rosterLocked,
      isNewPlayer: !!result.isNew,
    });
  } catch (err) {
    let existing = findExactPlayer();
    if (!existing) {
      try {
        await loadData({ force: true });
        existing = findExactPlayer();
      } catch {
        // Fall through to error handling below.
      }
    }
    if (existing) {
      loginExistingPlayer(existing);
      return;
    }

    try {
      const result = await join(rawName, selectedCircle, { forceNew: true });
      if (result?.player) {
        mergePlayerIntoAppData(result.player);
        setSession(result.player, {
          rosterLocked: !!result.rosterLocked,
          isNewPlayer: !!result.isNew,
        });
        enterApp({
          ...result.player,
          rosterLocked: !!result.rosterLocked,
          isNewPlayer: !!result.isNew,
        });
        return;
      }
    } catch {
      // Fall through to error message below.
    }

    showError(err.message);
  } finally {
    showLoading(false);
    btn.disabled = false;
  }
}

function updateBoardHeaderBar() {
  const slot = $('#board-header-slot');
  if (!slot) return;

  const session = getSession();
  const playerLocked = session ? isRosterLocked(session.playerId) : false;
  const globallyLocked = appData.entriesLocked;
  const readonly = playerLocked || globallyLocked;

  slot.innerHTML = `
    <h2>Select 6 Teams (2 from each Tier)</h2>
    <p>${readonly ? 'Your roster is locked — no further changes allowed.' : 'Tap teams to add or remove. Conflicts are blocked automatically.'}</p>
  `;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function enterApp(player) {
  $('#welcome-section').classList.add('hidden');
  $('#login-section').classList.add('hidden');
  $('#tabs').classList.remove('hidden');
  renderUserBar(player);

  const locked = isRosterLocked(player.playerId);
  if (locked) {
    draftPicks = [...(appData.rosters[player.playerId] || [])];
  } else {
    const saved = appData.rosters[player.playerId] || [];
    const draft = getDraft(player.playerId);
    draftPicks = draft.length ? [...draft] : [...saved];
  }

  boardMounted = false;
  switchTab('board');
}

function renderUserBar(player) {
  const bar = $('#user-bar');
  bar.classList.remove('hidden');
  const circleLabel = player.circle ? CIRCLE_BY_ID[player.circle]?.label : '';
  const circleHtml = circleLabel
    ? `<span class="user-circle">${escapeHtml(circleLabel)}</span>`
    : '';
  bar.innerHTML = `
    <div class="user-bar-info">
      <span class="user-greeting">Playing as <strong>${escapeHtml(player.name)}</strong>${circleHtml ? ` · ${circleHtml}` : ''}</span>
    </div>
    <button id="sign-out" class="btn btn-ghost btn-sm">Sign out</button>
  `;
  $('#sign-out').addEventListener('click', () => {
    clearSession();
    clearCachedData();
    location.reload();
  });
}

function onTabClick(e) {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  switchTab(btn.dataset.tab);
}

async function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab').forEach((el) => {
    el.classList.toggle('active', el.dataset.tab === tab);
  });

  $('#board-section').classList.toggle('hidden', tab !== 'board');
  $('#board-header-slot').classList.toggle('hidden', tab !== 'board');
  $('#leaderboard-section').classList.toggle('hidden', tab !== 'leaderboard');
  $('#everyone-section').classList.toggle('hidden', tab !== 'everyone');
  $('#rules-section').classList.toggle('hidden', tab !== 'rules');
  $('#odds-section').classList.toggle('hidden', tab !== 'odds');

  if (tab === 'board') renderBoard();
  if (tab === 'leaderboard') renderLeaderboard();
  if (tab === 'everyone') renderEveryone();
  if (tab === 'rules') renderRules();
  if (tab === 'odds') renderOdds();

  if (tab === 'leaderboard' || tab === 'everyone') {
    runBackgroundScoreSync();
  }
}

function renderOdds() {
  const section = $('#odds-section');

  section.innerHTML = `
    <div class="card odds-card">
      <h2>Odds of Winning the World Cup</h2>
      <p class="section-desc odds-desc">
        Teams higher on this list are expected to do better than teams lower on the list.
      </p>
      <ol class="odds-list">
        ${WIN_ODDS_RANK.map((entry, i) => {
          const team = TEAM_BY_ID[entry.id];
          if (!team) return '';
          return `
          <li class="odds-item">
            <span class="odds-rank">${i + 1}</span>
            <span class="odds-team">
              <span class="odds-name">${escapeHtml(team.name)}</span>
              <span class="odds-meta">${escapeHtml(entry.odds)}</span>
            </span>
          </li>`;
        }).join('')}
      </ol>
    </div>
  `;
}

async function refreshData({ force = false } = {}) {
  await loadData({ force });
  const session = getSession();
  if (session && isRosterLocked(session.playerId)) {
    draftPicks = [...(appData.rosters[session.playerId] || draftPicks)];
  }
}

function renderBoard() {
  const section = $('#board-section');
  section.classList.remove('hidden');

  if (!boardMounted) {
    mountBoard();
    boardMounted = true;
    bindBoardEvents();
  } else {
    updateBoard();
  }
}

function mountBoard() {
  const session = getSession();
  const playerLocked = session ? isRosterLocked(session.playerId) : false;
  const globallyLocked = appData.entriesLocked;
  const readonly = playerLocked || globallyLocked;
  const section = $('#board-section');

  section.innerHTML = `
    ${globallyLocked && !playerLocked ? '<div class="locked-banner">🔒 Entries are closed — rosters can no longer be submitted.</div>' : ''}
    <div class="board-layout ${readonly ? 'board-readonly' : ''}">
      <aside class="roster-panel card">
        <h2>Your Roster</h2>
        <p class="roster-sub">Exactly 6 teams · max 1 per group</p>
        <div class="roster-slots"></div>
        <div class="tier-progress"></div>
        <div class="roster-validation"></div>
        <div class="roster-actions">
          ${!readonly ? '<button type="button" id="clear-picks" class="btn btn-ghost">Clear all</button>' : ''}
          <button type="button" id="submit-picks" class="btn btn-primary">Lock in roster</button>
        </div>
      </aside>
      <div class="selection-tiers">
        ${[1, 2, 3].map((tier) => renderTierSection(tier, draftPicks, readonly)).join('')}
      </div>
    </div>
  `;

  updateBoardHeaderBar();
  updateBoard();
}

function updateBoard() {
  const session = getSession();
  const validation = validateRoster(draftPicks);
  const counts = getTierCounts(draftPicks);
  const playerLocked = session ? isRosterLocked(session.playerId) : false;
  const globallyLocked = appData.entriesLocked;
  const readonly = playerLocked || globallyLocked;
  const section = $('#board-section');

  const slotsEl = section.querySelector('.roster-slots');
  if (slotsEl) slotsEl.innerHTML = renderRosterSlots(draftPicks);

  const progressEl = section.querySelector('.tier-progress');
  if (progressEl) {
    progressEl.innerHTML = [1, 2, 3]
      .map(
        (tier) => `
      <div class="tier-progress-row ${TIERS[tier].color}">
        <span>${TIERS[tier].name}</span>
        <span class="tier-progress-count">${counts[tier]}/${RULES.tierPicks[tier]}</span>
      </div>`
      )
      .join('');
  }

  const validationEl = section.querySelector('.roster-validation');
  if (validationEl) {
    if (playerLocked) {
      validationEl.innerHTML = '<p class="validation-locked">🔒 Roster locked — submitted and final.</p>';
    } else if (validation.errors.length) {
      validationEl.innerHTML = `<ul class="validation-list">${validation.errors.map((e) => `<li>${e}</li>`).join('')}</ul>`;
    } else {
      validationEl.innerHTML = '<p class="validation-ok">All 6 slots filled — ready to lock in!</p>';
    }
  }

  updateBoardHeaderBar();

  [1, 2, 3].forEach((tier) => {
    const countEl = section.querySelector(`[data-tier="${tier}"] .tier-count`);
    if (countEl) countEl.textContent = `${counts[tier]}/${TIERS[tier].pickCount} picked`;

    const grid = section.querySelector(`[data-tier="${tier}"] .team-grid`);
    if (grid) {
      grid.innerHTML = getTeamsByTier(tier)
        .map((team) => renderTeamCard(team, draftPicks, readonly))
        .join('');
    }
  });

  const clearBtn = section.querySelector('#clear-picks');
  const submitBtn = section.querySelector('#submit-picks');
  if (clearBtn) clearBtn.disabled = !draftPicks.length || readonly;
  if (submitBtn) {
    if (playerLocked) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Roster Locked';
      submitBtn.className = 'btn btn-locked';
    } else if (globallyLocked) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Entries Closed';
      submitBtn.className = 'btn btn-locked';
    } else {
      submitBtn.className = 'btn btn-primary';
      submitBtn.disabled = !validation.valid || isSaving;
      submitBtn.textContent = isSaving ? 'Saving…' : 'Lock in roster';
    }
  }
}

function bindBoardEvents() {
  if (boardClickBound) return;
  $('#board-section').addEventListener('click', onBoardClick);
  boardClickBound = true;
}

function onBoardClick(e) {
  const session = getSession();
  if (!session || isRosterLocked(session.playerId) || appData.entriesLocked) return;

  const card = e.target.closest('.team-card');
  if (card && !card.disabled) {
    draftPicks = togglePick(card.dataset.teamId, draftPicks);
    saveDraft(session.playerId, draftPicks);
    updateBoard();
    return;
  }

  if (e.target.closest('#clear-picks')) {
    draftPicks = [];
    saveDraft(session.playerId, draftPicks);
    updateBoard();
    return;
  }

  if (e.target.closest('#submit-picks')) {
    onSubmitRoster();
  }
}

async function onSubmitRoster() {
  const session = getSession();
  const v = validateRoster(draftPicks);
  if (!v.valid || !session?.playerId) return;
  if (isRosterLocked(session.playerId)) return;

  const emptySlots = 6 - draftPicks.length;
  if (emptySlots > 0) {
    showError(`Fill all 6 slots before locking in (${emptySlots} remaining).`);
    return;
  }

  const confirmed = window.confirm(
    'Lock in your roster?\n\nThis is permanent — you cannot change your picks after locking in.'
  );
  if (!confirmed) return;

  isSaving = true;
  updateBoard();
  showLoading(true, 'Locking in your roster…');

  try {
    const result = await submitRoster(session.playerId, draftPicks);
    if (result.data) {
      setCachedData(result.data);
      applyAppDataFromResponse(result.data);
    } else {
      await loadData({ force: true });
    }
    appData.rosterLocked[session.playerId] = true;
    clearDraft(session.playerId);
    setSession(
      {
        playerId: session.playerId,
        name: session.name,
        circle: session.circle || getPlayerCircle(session.playerId),
      },
      { rosterLocked: true, isNewPlayer: false }
    );
    showToast('Roster locked!');
    renderUserBar(getSession());
    boardMounted = false;
    renderBoard();
  } catch (err) {
    showError(err.message);
  } finally {
    showLoading(false);
    isSaving = false;
    updateBoard();
  }
}

function renderRosterSlots(selectedIds) {
  const slots = [
    { tier: 1, label: 'Favorite' },
    { tier: 1, label: 'Favorite' },
    { tier: 2, label: 'Contender' },
    { tier: 2, label: 'Contender' },
    { tier: 3, label: 'Underdog' },
    { tier: 3, label: 'Underdog' },
  ];

  const byTier = { 1: [], 2: [], 3: [] };
  selectedIds.forEach((id) => {
    const team = TEAM_BY_ID[id];
    if (team) byTier[team.tier].push(team);
  });

  const filled = [];
  slots.forEach((slot) => {
    const team = byTier[slot.tier].shift();
    filled.push({ ...slot, team });
  });

  return filled
    .map(
      ({ tier, label, team }) => `
    <div class="roster-slot ${TIERS[tier].color} ${team ? 'filled' : 'empty'}">
      <span class="slot-label">${label}</span>
      ${
        team
          ? `<span class="slot-team">${team.name}<span class="slot-group">Grp ${team.group}</span></span>`
          : '<span class="slot-placeholder">—</span>'
      }
    </div>`
    )
    .join('');
}

function renderTierSection(tier, selectedIds, locked) {
  const meta = TIERS[tier];
  const teams = getTeamsByTier(tier);
  const count = getTierCounts(selectedIds)[tier];

  return `
    <section class="tier-section ${meta.color}" data-tier="${tier}">
      <div class="tier-heading">
        <div>
          <span class="tier-badge">${meta.label}</span>
          <h3>${meta.name}</h3>
          <p class="tier-scoring-hint">(The further your teams go the better, see rules)</p>
        </div>
        <div class="tier-meta">
          <span class="tier-multiplier">${meta.multiplier} knockout</span>
          <span class="tier-count">${count}/${meta.pickCount} picked</span>
        </div>
      </div>
      <p class="tier-desc">${tierDescription(tier)}</p>
      <div class="team-grid">
        ${teams.map((team) => renderTeamCard(team, selectedIds, locked)).join('')}
      </div>
    </section>
  `;
}

function tierDescription(tier) {
  if (tier === 1) return 'Powerhouses — bank on deep tournament runs.';
  if (tier === 2) return 'Strong sides and host nations with tougher routes.';
  return 'Point vampires — knockout wins pay out big.';
}

function renderTeamCard(team, selectedIds, locked) {
  const selected = selectedIds.includes(team.id);
  const disabled = locked || (!selected && isTeamDisabled(team.id, selectedIds));
  const reason = disabled && !locked ? getDisableReason(team.id, selectedIds) : '';

  return `
    <button
      type="button"
      class="team-card ${selected ? 'selected' : ''} ${disabled ? 'disabled' : ''} tier-${team.tier}-card"
      data-team-id="${team.id}"
      ${disabled ? 'disabled' : ''}
      title="${reason}"
      aria-pressed="${selected}"
    >
      <span class="team-name">${team.name}</span>
      <span class="team-group">Group ${team.group}</span>
      ${selected ? '<span class="team-check" aria-hidden="true">✓</span>' : ''}
      ${reason ? `<span class="team-lock">${reason}</span>` : ''}
    </button>
  `;
}

function renderLeaderboardTable(rows) {
  if (!rows.length) {
    return '<p class="leaderboard-empty">No players in this group yet.</p>';
  }

  const enriched = rows.map((row, i) => {
    const picks = appData.rosters[row.playerId] || [];
    const teamNames = picks.map((id) => TEAM_BY_ID[id]?.name).filter(Boolean);
    return { ...row, rank: i + 1, teams: teamNames };
  });

  return `
    <div class="leaderboard-table-wrap">
      <table class="leaderboard-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Player</th>
            <th>Points</th>
            <th>Roster</th>
          </tr>
        </thead>
        <tbody>
          ${enriched
            .map(
              (r) => `
            <tr class="${r.rank <= 3 ? 'top-' + r.rank : ''}">
              <td class="rank">${r.rank}</td>
              <td class="player-name">${escapeHtml(r.name)}</td>
              <td class="points">${formatPoints(r.points)}</td>
              <td class="roster-preview">${r.teams.length ? r.teams.map(escapeHtml).join(', ') : '<em>No roster yet</em>'}</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

function formatScoresSyncedAt(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function renderLeaderboard() {
  const section = $('#leaderboard-section');
  const syncNote = appData.autoScores
    ? `<p class="scores-sync-note">Scores update automatically from live World Cup results${
        appData.scoresSyncedAt
          ? ` · Last synced ${escapeHtml(formatScoresSyncedAt(appData.scoresSyncedAt))}`
          : ''
      }.</p>`
    : '';

  section.innerHTML = `
    <div class="card leaderboard-card">
      <h2>Leaderboards</h2>
      <p class="section-desc">Separate standings for Family, Friends, and Work.</p>
      ${syncNote}
      <div class="leaderboard-groups">
        ${PLAYER_CIRCLES.map(
          (circle) => `
          <section class="leaderboard-group">
            <h3>${circle.label}</h3>
            ${renderLeaderboardTable(appData.standingsByCircle[circle.id] || [])}
          </section>`
        ).join('')}
        ${
          getUnassignedStandings().length
            ? `
          <section class="leaderboard-group">
            <h3>Other</h3>
            ${renderLeaderboardTable(getUnassignedStandings())}
          </section>`
            : ''
        }
      </div>
    </div>
  `;
}

function renderPlayerRosterCard(p) {
  return `
    <article class="player-roster-card">
      <header>
        <h3>${escapeHtml(p.name)}</h3>
        <span class="pick-count">${p.picks.length}/6 teams</span>
      </header>
      ${
        p.picks.length
          ? `<ul class="player-pick-list">
          ${p.picks
            .map(
              (t) => `
            <li class="${TIERS[t.tier].color}">
              <span class="pick-name">${escapeHtml(t.name)}</span>
              <span class="pick-meta">Grp ${t.group} · ${TIERS[t.tier].label}</span>
            </li>`
            )
            .join('')}
        </ul>`
          : '<p class="no-picks">Hasn\'t submitted a roster yet.</p>'
      }
    </article>
  `;
}

function renderEveryone() {
  const section = $('#everyone-section');

  section.innerHTML = `
    <div class="card">
      <h2>All Rosters</h2>
      <p class="section-desc">See who everyone backed, grouped by circle.</p>
      ${PLAYER_CIRCLES.map((circle) => {
        const players = appData.players
          .filter((p) => getPlayerCircleValue(p.playerId) === circle.id)
          .map((p) => ({
            ...p,
            picks: (appData.rosters[p.playerId] || []).map((id) => TEAM_BY_ID[id]).filter(Boolean),
          }));
        return `
          <section class="roster-group">
            <h3>${circle.label}</h3>
            <div class="all-rosters">
              ${
                players.length
                  ? players.map(renderPlayerRosterCard).join('')
                  : '<p class="no-picks">No players in this group yet.</p>'
              }
            </div>
          </section>
        `;
      }).join('')}
      ${
        getUnassignedPlayers().length
          ? `
        <section class="roster-group">
          <h3>Other</h3>
          <div class="all-rosters">
            ${getUnassignedPlayers()
              .map((p) => ({
                ...p,
                picks: (appData.rosters[p.playerId] || []).map((id) => TEAM_BY_ID[id]).filter(Boolean),
              }))
              .map(renderPlayerRosterCard)
              .join('')}
          </div>
        </section>`
          : ''
      }
    </div>
  `;
}

function renderRules() {
  $('#rules-section').innerHTML = `
    <div class="card rules-card">
      <h2>Rules of Entry</h2>

      <section class="rules-block">
        <h3>Signing in</h3>
        <ul>
          <li>Enter your <strong>first name</strong> only — the same name on the roster list.</li>
          <li>If you're on the list, you'll see your existing picks.</li>
          <li>New names can join and make a fresh roster.</li>
        </ul>
      </section>

      <section class="rules-block">
        <h3>Scoring</h3>
        <ul>
          <li>Points update <strong>automatically</strong> from live World Cup match results — no manual score entry needed.</li>
          <li>Standings refresh about every 15 minutes during the tournament.</li>
        </ul>
      </section>

      <section class="rules-block">
        <h3>Your roster</h3>
        <ul>
          <li>Choose <strong>exactly 6 teams</strong> total.</li>
          <li><strong>2 Favorites</strong> (Tier 1)</li>
          <li><strong>2 Contenders</strong> (Tier 2)</li>
          <li><strong>2 Underdogs</strong> (Tier 3)</li>
          <li><strong>Group rule:</strong> no more than one team from the same group.</li>
        </ul>
      </section>

      <section class="rules-block">
        <h3>Act I — Group Stage</h3>
        <p class="rules-intro">Points per match result during the group stage:</p>
        <div class="scoring-table-wrap">
          <table class="scoring-table">
            <thead>
              <tr>
                <th>Tier</th>
                <th>Win</th>
                <th>Draw</th>
              </tr>
            </thead>
            <tbody>
              ${[1, 2, 3]
                .map(
                  (tier) => `
              <tr class="tier-${tier}">
                <td>${GROUP_STAGE_POINTS[tier].label}</td>
                <td>${GROUP_STAGE_POINTS[tier].win} pt</td>
                <td>${GROUP_STAGE_POINTS[tier].draw} pts</td>
              </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </section>

      <section class="rules-block">
        <h3>Act II — Knockout Stage</h3>
        <p class="rules-intro">Base points when a team reaches a round — multiplied by tier:</p>
        <ul class="knockout-round-list">
          ${KNOCKOUT_ROUNDS.map((r) => `<li><strong>${r.label}:</strong> ${r.points} pt${r.points === 1 ? '' : 's'}</li>`).join('')}
        </ul>
        <div class="multiplier-grid">
          ${[1, 2, 3]
            .map(
              (tier) => `
          <div class="multiplier-item tier-${tier}">
            <span class="multiplier-label">${KNOCKOUT_MULTIPLIERS[tier].label}</span>
            <span class="multiplier-value">${KNOCKOUT_MULTIPLIERS[tier].value}</span>
          </div>`
            )
            .join('')}
        </div>
      </section>

      <section class="rules-block">
        <h3>Tier 3 groups</h3>
        <div class="underdog-groups">
          ${renderUnderdogGroupReference()}
        </div>
      </section>
    </div>
  `;
}

function renderUnderdogGroupReference() {
  const groups = {};
  getTeamsByTier(3).forEach((t) => {
    if (!groups[t.group]) groups[t.group] = [];
    groups[t.group].push(t.name);
  });

  return Object.entries(groups)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([group, names]) => `
      <div class="underdog-group">
        <span class="ug-label">Group ${group}</span>
        <span class="ug-teams">${names.join(', ')}</span>
      </div>`
    )
    .join('');
}

function formatPoints(n) {
  return Number.isInteger(n) ? String(n) : Number(n).toFixed(1);
}

function showLoading(show, message = 'Loading contest data…') {
  if (show) {
    loadingCount += 1;
    loadingMessage = message;
  } else {
    loadingCount = Math.max(0, loadingCount - 1);
  }

  const overlay = $('#loading-overlay');
  const messageEl = overlay?.querySelector('.loading-message');
  const visible = loadingCount > 0;

  overlay?.classList.toggle('hidden', !visible);
  document.body.classList.toggle('is-loading', visible);
  overlay?.setAttribute('aria-busy', visible ? 'true' : 'false');
  overlay?.setAttribute('aria-hidden', visible ? 'false' : 'true');

  if (messageEl && visible) {
    messageEl.textContent = loadingMessage;
  }
}

function showError(msg, { retry = false } = {}) {
  const el = $('#error');
  el.replaceChildren();
  el.append(msg);
  if (retry) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-ghost btn-sm error-retry';
    btn.textContent = 'Try again';
    btn.addEventListener('click', () => {
      hideError();
      refreshDataInBackground();
    });
    el.append(' ');
    el.append(btn);
  }
  el.classList.remove('hidden');
}

function hideError() {
  $('#error').classList.add('hidden');
}

function showToast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3500);
}
