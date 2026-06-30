import {
  getBracketTeamSlug,
  getBracketWinnerSide,
  isBracketGameFinished,
  stadiumLocalToDate,
} from './bracket.js';
import { TEAM_BY_ID } from './teams.js';

const ET_TIMEZONE = 'America/New_York';

const SLUG_TO_ISO = {
  brazil: 'BR',
  germany: 'DE',
  netherlands: 'NL',
  belgium: 'BE',
  spain: 'ES',
  france: 'FR',
  argentina: 'AR',
  portugal: 'PT',
  england: 'GB',
  mexico: 'MX',
  'south-korea': 'KR',
  switzerland: 'CH',
  morocco: 'MA',
  usa: 'US',
  ecuador: 'EC',
  japan: 'JP',
  uruguay: 'UY',
  senegal: 'SN',
  austria: 'AT',
  colombia: 'CO',
  croatia: 'HR',
  'czech-republic': 'CZ',
  'south-africa': 'ZA',
  canada: 'CA',
  bosnia: 'BA',
  qatar: 'QA',
  haiti: 'HT',
  scotland: 'GB',
  paraguay: 'PY',
  australia: 'AU',
  turkey: 'TR',
  curacao: 'CW',
  'ivory-coast': 'CI',
  sweden: 'SE',
  tunisia: 'TN',
  egypt: 'EG',
  iran: 'IR',
  'new-zealand': 'NZ',
  'cape-verde': 'CV',
  'saudi-arabia': 'SA',
  iraq: 'IQ',
  norway: 'NO',
  algeria: 'DZ',
  jordan: 'JO',
  'dr-congo': 'CD',
  uzbekistan: 'UZ',
  ghana: 'GH',
  panama: 'PA',
};

const ROUND_LABELS = {
  r32: 'Round of 32',
  r16: 'Round of 16',
  qf: 'Quarter-finals',
  sf: 'Semi-finals',
  final: 'Final',
  third: 'Third-place match',
};

export function parseFeederGameId(text) {
  const match = String(text || '').match(/(?:Winner|Loser)\s+Match\s+(\d+)/i);
  return match ? match[1] : null;
}

export function getFeederGameIds(game) {
  const fromSide = (side) => {
    const label = side === 'home' ? game.home_team_label : game.away_team_label;
    const name = side === 'home' ? game.home_team_name_en : game.away_team_name_en;
    return parseFeederGameId(label) || parseFeederGameId(name);
  };
  return [fromSide('home'), fromSide('away')];
}

export function buildBracketTree(games) {
  const byId = Object.fromEntries(games.map((game) => [String(game.id), game]));
  const finalGame = games.find((game) => game.type === 'final');
  if (!finalGame) return null;

  function buildNode(gameId) {
    const game = byId[String(gameId)];
    if (!game) return null;

    const [homeFeeder, awayFeeder] = getFeederGameIds(game);
    if (!homeFeeder || !awayFeeder) {
      return { game, children: [] };
    }

    return {
      game,
      children: [buildNode(homeFeeder), buildNode(awayFeeder)],
    };
  }

  return buildNode(finalGame.id);
}

function formatShortDateET(localDate, stadiumId) {
  const date = stadiumLocalToDate(localDate, stadiumId);
  if (!date || Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat('en-US', {
    timeZone: ET_TIMEZONE,
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function formatShortTimeET(localDate, stadiumId) {
  const date = stadiumLocalToDate(localDate, stadiumId);
  if (!date || Number.isNaN(date.getTime())) return '';

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ET_TIMEZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(date);

  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  return `${get('hour')}:${get('minute')} ${get('dayPeriod').toUpperCase()}`;
}

export function formatBracketMatchHeader(game) {
  const gameNum = game.id;
  const dateLabel = formatShortDateET(game.local_date, game.stadium_id);

  if (isBracketGameFinished(game)) {
    return `${dateLabel} · FT · Game ${gameNum}`;
  }

  const timeLabel = formatShortTimeET(game.local_date, game.stadium_id);
  return `${dateLabel} · ${timeLabel} ET · Game ${gameNum}`;
}

function slotLabelFromText(text) {
  const loser = String(text || '').match(/Loser\s+Match\s+(\d+)/i);
  if (loser) return `Loser of Game ${loser[1]}`;

  const winner = String(text || '').match(/Winner\s+Match\s+(\d+)/i);
  if (winner) return `Winner of Game ${winner[1]}`;

  return '';
}

export function getBracketSlotLabel(game, side) {
  const nameEn = side === 'home' ? game.home_team_name_en : game.away_team_name_en;
  if (nameEn) return String(nameEn);

  const label = side === 'home' ? game.home_team_label : game.away_team_label;
  const fromLabel = slotLabelFromText(label);
  if (fromLabel) return fromLabel;

  const slug = getBracketTeamSlug(game, side);
  if (slug && TEAM_BY_ID[slug]) return TEAM_BY_ID[slug].name;

  if (label) return String(label);
  return 'TBD';
}

function isPlaceholderSlot(game, side) {
  if (getBracketTeamSlug(game, side)) return false;
  const nameEn = side === 'home' ? game.home_team_name_en : game.away_team_name_en;
  if (nameEn) return false;
  const label = side === 'home' ? game.home_team_label : game.away_team_label;
  return !!slotLabelFromText(label);
}

function flagEmojiForSlug(slug) {
  const iso = SLUG_TO_ISO[slug];
  if (!iso || iso.length !== 2) return '';
  const code = iso.toUpperCase();
  return String.fromCodePoint(
    ...[...code].map((char) => 0x1f1e6 + char.charCodeAt(0) - 65)
  );
}

function teamIconHtml(game, side) {
  const slug = getBracketTeamSlug(game, side);
  if (slug) {
    const flag = flagEmojiForSlug(slug);
    if (flag) {
      return `<span class="bracket-flag" aria-hidden="true">${flag}</span>`;
    }
  }
  return `<span class="bracket-flag bracket-flag--tbd" aria-hidden="true">⚽</span>`;
}

function formatTeamScoreHtml(game, side) {
  if (!isBracketGameFinished(game)) return '';

  const score = Number(side === 'home' ? game.home_score : game.away_score);
  if (Number.isNaN(score)) return '';

  const homeScore = Number(game.home_score);
  const awayScore = Number(game.away_score);
  const homePen = Number(game.home_penalty_score);
  const awayPen = Number(game.away_penalty_score);
  const wentToPens =
    homeScore === awayScore &&
    !Number.isNaN(homePen) &&
    !Number.isNaN(awayPen) &&
    homePen !== awayPen;

  if (wentToPens) {
    const pen = side === 'home' ? homePen : awayPen;
    return `${score} <span class="bracket-pen">(${pen})</span>`;
  }

  return String(score);
}

function renderTeamRow(game, side, rosterIds, escape) {
  const slug = getBracketTeamSlug(game, side);
  const name = getBracketSlotLabel(game, side);
  const finished = isBracketGameFinished(game);
  const winner = getBracketWinnerSide(game);
  const isWinner = finished && winner === side;
  const isLoser = finished && winner && winner !== side;
  const isPick = slug && rosterIds.has(slug);
  const isPlaceholder = isPlaceholderSlot(game, side);
  const scoreHtml = formatTeamScoreHtml(game, side);

  const classes = [
    'bracket-slot',
    side,
    isWinner ? 'is-winner' : '',
    isLoser ? 'is-loser' : '',
    isPick ? 'is-pick' : '',
    isPlaceholder ? 'is-placeholder' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return `
    <div class="${classes}">
      ${teamIconHtml(game, side)}
      <span class="bracket-slot-name">${escape(name)}</span>
      ${scoreHtml ? `<span class="bracket-slot-score">${scoreHtml}</span>` : ''}
      ${isWinner ? '<span class="bracket-winner-arrow" aria-hidden="true"></span>' : ''}
    </div>`;
}

function renderFixture(game, rosterIds, escape) {
  const finished = isBracketGameFinished(game);

  return `
    <article class="bracket-fixture ${finished ? 'is-finished' : 'is-upcoming'}" data-match-id="${escape(String(game.id))}">
      <header class="bracket-fixture-head">${escape(formatBracketMatchHeader(game))}</header>
      <div class="bracket-fixture-body">
        ${renderTeamRow(game, 'home', rosterIds, escape)}
        ${renderTeamRow(game, 'away', rosterIds, escape)}
      </div>
    </article>`;
}

function renderBracketNode(node, rosterIds, escape) {
  if (!node) return '';

  if (!node.children.length) {
    return `
      <div class="bracket-node bracket-node--leaf">
        ${renderFixture(node.game, rosterIds, escape)}
      </div>`;
  }

  const [topChild, bottomChild] = node.children;

  return `
    <div class="bracket-node">
      <div class="bracket-feeders">
        ${renderBracketNode(topChild, rosterIds, escape)}
        ${renderBracketNode(bottomChild, rosterIds, escape)}
      </div>
      <div class="bracket-join" aria-hidden="true">
        <div class="bracket-connector"></div>
      </div>
      <div class="bracket-node-match">
        ${renderFixture(node.game, rosterIds, escape)}
      </div>
    </div>`;
}

function renderRoundLabels() {
  return `
    <div class="bracket-round-labels" aria-hidden="true">
      <span>Round of 32</span>
      <span>Round of 16</span>
      <span>Quarter-finals</span>
      <span>Semi-finals</span>
      <span>Final</span>
    </div>`;
}

export function renderBracketBoardHtml(games, rosterIds, escape) {
  const tree = buildBracketTree(games);
  const thirdGame = games.find((game) => game.type === 'third');

  if (!tree) {
    return '<p class="section-desc bracket-error">Bracket data is not available yet.</p>';
  }

  const mainBoard = `
    <div class="bracket-board">
      ${renderRoundLabels()}
      <div class="bracket-board-tree">
        ${renderBracketNode(tree, rosterIds, escape)}
      </div>
    </div>`;

  const thirdSection = thirdGame
    ? `
    <section class="bracket-third">
      <h3 class="bracket-third-title">${ROUND_LABELS.third}</h3>
      <div class="bracket-third-match">
        ${renderFixture(thirdGame, rosterIds, escape)}
      </div>
    </section>`
    : '';

  return `${mainBoard}${thirdSection}`;
}
