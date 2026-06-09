import { fetchData, join, submitRoster } from './api.js';
import { CIRCLE_BY_ID, PLAYER_CIRCLES } from './data/groups.js';
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
};
let isSaving = false;
let boardMounted = false;
let boardClickBound = false;
let selectedCircle = '';

init();

async function init() {
  bindEvents();
  showLoading(true);

  try {
    await loadData();
    if (appData.apiVersion !== 2) {
      showError(
        'Google Apps Script needs redeploying. Open apps-script/Code.gs, paste it into Apps Script, save, then Deploy → Manage deployments → Edit → New version → Deploy. Look for "apiVersion":2 in your Web App URL.'
      );
    }

    const session = getSession();
    if (session) {
      const stillValid = appData.players.some((p) => p.playerId === session.playerId);
      if (stillValid) {
        enterApp({
          ...session,
          circle: session.circle || getPlayerCircle(session.playerId),
          rosterLocked: isRosterLocked(session.playerId),
        });
      } else {
        clearSession();
        showLogin();
      }
    } else {
      showLogin();
    }
  } catch (err) {
    showError(err.message);
    showLogin();
  } finally {
    showLoading(false);
  }
}

async function loadData() {
  const data = await fetchData();
  appData = {
    apiVersion: data.apiVersion || 1,
    players: data.players || [],
    rosters: {},
    rosterLocked: {},
    standings: data.standings || [],
    standingsByCircle: data.standingsByCircle || buildStandingsByCircle(data),
    entriesLocked: !!data.entriesLocked,
  };
  (data.rosters || []).forEach((r) => {
    appData.rosters[r.playerId] = r.teamIds || [];
    appData.rosterLocked[r.playerId] = !!r.locked;
  });
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

function renderCirclePicker() {
  const picker = $('#circle-picker');
  picker.innerHTML = PLAYER_CIRCLES.map(
    (circle) => `
    <button type="button" class="circle-pick-btn" data-circle="${circle.id}">
      ${escapeHtml(circle.label)}
    </button>`
  ).join('');

  picker.querySelectorAll('.circle-pick-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedCircle = btn.dataset.circle;
      showJoinForm(selectedCircle);
    });
  });
}

function showWelcome() {
  $('#welcome-section').classList.remove('hidden');
  $('#login-section').classList.add('hidden');
  hideError();
}

function showJoinForm(circleId) {
  const circle = CIRCLE_BY_ID[circleId];
  if (!circle) return;

  selectedCircle = circleId;
  $('#selected-circle-badge').textContent = circle.label;
  $('#welcome-section').classList.add('hidden');
  $('#login-section').classList.remove('hidden');
  $('#name-input').focus();
  hideError();
}

async function onLogin(e) {
  e.preventDefault();
  hideError();

  const name = $('#name-input').value.trim();
  const pin = $('#pin-input').value.trim();
  const circle = pin ? '' : selectedCircle;
  if (!name) return;
  if (!pin && !circle) {
    showError('Please go back and choose how you know Jason.');
    return;
  }

  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;

  try {
    const result = await join(name, pin, circle);

    if (result.isNew) {
      setSession(result.player, result.pin, { rosterLocked: false, isNewPlayer: true });
      enterApp({ ...result.player, pin: result.pin, rosterLocked: false, isNewPlayer: true });
    } else {
      setSession(result.player, pin, {
        rosterLocked: !!result.rosterLocked,
        isNewPlayer: false,
      });
      enterApp({
        ...result.player,
        pin,
        rosterLocked: !!result.rosterLocked,
        isNewPlayer: false,
      });
    }
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
  }
}

function shouldShowPinReminder(session) {
  if (!session?.pin) return false;
  if (isRosterLocked(session.playerId)) return false;
  return true;
}

function renderPinBannerHtml(session) {
  if (!shouldShowPinReminder(session)) return '';

  const isNew = !!session.isNewPlayer;
  return `
    <div class="pin-banner ${isNew ? 'pin-banner--new' : ''}" role="status">
      <div class="pin-banner-inner">
        <div class="pin-banner-main">
          ${isNew ? '<span class="pin-banner-welcome">Welcome! Your PIN is</span>' : '<span class="pin-banner-welcome">Your PIN</span>'}
          <span class="pin-banner-code">${escapeHtml(session.pin)}</span>
        </div>
        <p class="pin-banner-note">Remember this PIN — you'll need it to sign back in.</p>
      </div>
    </div>
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
  const pinHtml = shouldShowPinReminder(player)
    ? `<span class="user-pin">PIN <strong>${escapeHtml(player.pin)}</strong></span>`
    : '';
  const circleLabel = player.circle ? CIRCLE_BY_ID[player.circle]?.label : '';
  const circleHtml = circleLabel
    ? `<span class="user-circle">${escapeHtml(circleLabel)}</span>`
    : '';
  bar.innerHTML = `
    <div class="user-bar-info">
      <span class="user-greeting">Playing as <strong>${escapeHtml(player.name)}</strong>${circleHtml ? ` · ${circleHtml}` : ''}</span>
      ${pinHtml}
    </div>
    <button id="sign-out" class="btn btn-ghost btn-sm">Sign out</button>
  `;
  $('#sign-out').addEventListener('click', () => {
    clearSession();
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
  $('#leaderboard-section').classList.toggle('hidden', tab !== 'leaderboard');
  $('#everyone-section').classList.toggle('hidden', tab !== 'everyone');
  $('#rules-section').classList.toggle('hidden', tab !== 'rules');

  if (tab === 'leaderboard' || tab === 'everyone') {
    try {
      await refreshData();
    } catch (err) {
      showToast('Could not refresh data: ' + err.message);
    }
  }

  if (tab === 'board') renderBoard();
  if (tab === 'leaderboard') renderLeaderboard();
  if (tab === 'everyone') renderEveryone();
  if (tab === 'rules') renderRules();
}

async function refreshData() {
  await loadData();
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
    ${renderPinBannerHtml(session)}
    ${globallyLocked && !playerLocked ? '<div class="locked-banner">🔒 Entries are closed — rosters can no longer be submitted.</div>' : ''}
    <div class="board-layout">
      <aside class="roster-panel card">
        <h2>Your Roster</h2>
        <p class="roster-sub">Exactly 6 teams · max 1 per group</p>
        <div class="roster-slots"></div>
        <div class="tier-progress"></div>
        <div class="roster-validation"></div>
        ${!playerLocked && !globallyLocked ? '<div class="lock-warning"></div>' : ''}
        <div class="roster-actions">
          ${!readonly ? '<button type="button" id="clear-picks" class="btn btn-ghost">Clear all</button>' : ''}
          <button type="button" id="submit-picks" class="btn btn-primary">Lock in roster</button>
        </div>
      </aside>

      <div class="selection-board ${readonly ? 'board-readonly' : ''}">
        <div class="board-header">
          <h2>Select 6 Teams (2 from each Tier)</h2>
          <p>${readonly ? 'Your roster is locked — no further changes allowed.' : 'Tap teams to add or remove. Conflicts are blocked automatically.'}</p>
        </div>
        ${[1, 2, 3].map((tier) => renderTierSection(tier, draftPicks, readonly)).join('')}
      </div>
    </div>
  `;

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

  const warningEl = section.querySelector('.lock-warning');
  if (warningEl) {
    warningEl.innerHTML = `
      <p><strong>⚠️ One-time lock</strong></p>
      <p>Once you click <strong>Lock in roster</strong>, your picks are final and cannot be changed. Fill every slot before locking in.</p>
    `;
  }

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
  if (!v.valid || !session?.pin) return;
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

  try {
    const result = await submitRoster(session.playerId, session.pin, draftPicks);
    if (result.data) {
      await loadData();
      appData.rosterLocked[session.playerId] = true;
      clearDraft(session.playerId);
    }
    setSession(
      {
        playerId: session.playerId,
        name: session.name,
        circle: session.circle || getPlayerCircle(session.playerId),
      },
      session.pin,
      { rosterLocked: true, isNewPlayer: false }
    );
    showToast('Roster locked!');
    renderUserBar(getSession());
    boardMounted = false;
    renderBoard();
  } catch (err) {
    showError(err.message);
  } finally {
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

function renderLeaderboard() {
  const section = $('#leaderboard-section');

  section.innerHTML = `
    <div class="card leaderboard-card">
      <h2>Leaderboards</h2>
      <p class="section-desc">Separate standings for Family, Friends, and Work.</p>
      <div class="leaderboard-groups">
        ${PLAYER_CIRCLES.map(
          (circle) => `
          <section class="leaderboard-group">
            <h3>${circle.label}</h3>
            ${renderLeaderboardTable(appData.standingsByCircle[circle.id] || [])}
          </section>`
        ).join('')}
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
          .filter((p) => p.circle === circle.id)
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
    </div>
  `;
}

function renderRules() {
  $('#rules-section').innerHTML = `
    <div class="card rules-card">
      <h2>Rules of Entry</h2>

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

function showLogin() {
  $('#tabs').classList.add('hidden');
  selectedCircle = '';
  showWelcome();
}

function showLoading(show) {
  $('#loading').classList.toggle('hidden', !show);
}

function showError(msg) {
  const el = $('#error');
  el.textContent = msg;
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
