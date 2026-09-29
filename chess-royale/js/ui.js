/**
 * Gränssnittet
 * ============
 *
 * Modulen sköter allt som syns utanför brädet: byte av skärm, spelarkorten,
 * klockorna, draglistan, statusraden och de tre överläggen (bondeförvandling,
 * turbyte och resultat).
 *
 * Den innehåller inga schackregler och fattar inga beslut om partiet. Den tar
 * emot färdig information och visar den. Vill man byta ut utseendet är det den
 * här filen och css-filerna man rör, inte spellogiken.
 */

import { DIFFICULTY } from './ai.js';

/** Kortkommando för att slippa skriva document.querySelector överallt. */
const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

/** Vad pjäserna är värda, för att kunna visa vem som leder i material. */
const MATERIAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

const COLOR_NAME = { w: 'Vit', b: 'Svart' };

/** Gör om millisekunder till mm:ss. */
export function formatClock(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Gör om millisekunder till en läsbar speltid. */
export function formatDuration(milliseconds) {
  const totalSeconds = Math.round(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Räknar ut vem som leder i material och med hur mycket.
 * Används i spelarkorten, som ett litet plus efter namnet.
 */
function materialBalance(board) {
  let balance = 0;
  for (const row of board) {
    for (const piece of row) {
      if (!piece) continue;
      balance += (piece.color === 'w' ? 1 : -1) * MATERIAL[piece.type];
    }
  }
  return balance;
}

export function createUI() {
  const screens = new Map($$('[data-screen]').map((element) => [element.dataset.screen, element]));

  /* -------------------------------------------------------------- Skärmbyte */

  let currentScreen = 'home';

  function showScreen(name) {
    for (const [key, element] of screens) {
      element.classList.toggle('is-active', key === name);
    }
    currentScreen = name;
    // Rullar upp igen, annars kan en ny skärm öppnas mitt i.
    screens.get(name)?.querySelector('.screen__body')?.scrollTo(0, 0);
  }

  /* ------------------------------------------------------------ Startsidan */

  function renderStats(stats) {
    $('[data-stat="played"]').textContent = stats.played;
    $('[data-stat="won"]').textContent = stats.won;
    $('[data-stat="drawn"]').textContent = stats.drawn;
  }

  /* ------------------------------------------------- Skärmen inför ett parti */

  const setup = {
    mode: 'computer',
    difficulty: 'medium',
    color: 'w',
    minutes: 0,
  };

  /** Markerar det valda alternativet i en grupp med knappar. */
  function selectChoice(group, value) {
    for (const button of $$(`[data-choice="${group}"]`)) {
      button.setAttribute('aria-checked', String(button.dataset.value === value));
    }
  }

  function renderSetup() {
    selectChoice('difficulty', setup.difficulty);
    selectChoice('color', setup.color);
    selectChoice('minutes', String(setup.minutes));

    const isComputer = setup.mode === 'computer';
    $('[data-setup-title]').textContent = isComputer ? 'Spela mot datorn' : 'Två spelare';
    $('[data-setup-section="difficulty"]').hidden = !isComputer;
    $('[data-setup-section="color"]').hidden = !isComputer;
  }

  /* -------------------------------------------------------------- Spelskärmen */

  const playerElements = {
    top: $('.player[data-player="top"]'),
    bottom: $('.player[data-player="bottom"]'),
  };

  /**
   * Ritar spelarkorten.
   *
   * Korten byter plats när brädet vänds: den vars pjäser står närmast en själv
   * hamnar alltid nederst.
   */
  function renderPlayers({ board, turn, orientation, names, clocks, hasClock, subtitles = {} }) {
    const bottomColor = orientation;
    const topColor = orientation === 'w' ? 'b' : 'w';
    const balance = materialBalance(board);

    for (const [slot, color] of [['bottom', bottomColor], ['top', topColor]]) {
      const element = playerElements[slot];
      element.classList.toggle('is-active', turn === color);

      $('.player__piece', element).src = `assets/pieces/${color}K.svg`;
      $('.player__piece', element).alt = COLOR_NAME[color];
      $('.player__name', element).textContent = names[color];

      // Raden under namnet: färg, eventuell svårighetsgrad och materialledning.
      const lead = color === 'w' ? balance : -balance;
      const metaParts = [COLOR_NAME[color]];
      if (subtitles[color]) metaParts.push(subtitles[color]);
      if (lead > 0) metaParts.push(`+${lead}`);
      $('.player__meta', element).textContent = metaParts.join(' · ');

      const clockElement = $('.player__clock', element);
      clockElement.hidden = !hasClock;
      if (hasClock) {
        clockElement.textContent = formatClock(clocks[color]);
        clockElement.classList.toggle('is-low', clocks[color] <= 30000);
      }
    }
  }

  /** Uppdaterar bara klockorna. Anropas flera gånger per sekund. */
  function renderClocks({ orientation, clocks, hasClock }) {
    if (!hasClock) return;

    const bottomColor = orientation;
    const topColor = orientation === 'w' ? 'b' : 'w';

    for (const [slot, color] of [['bottom', bottomColor], ['top', topColor]]) {
      const clockElement = $('.player__clock', playerElements[slot]);
      clockElement.textContent = formatClock(clocks[color]);
      clockElement.classList.toggle('is-low', clocks[color] <= 30000);
    }
  }

  const movesElement = $('[data-moves]');

  /** Ritar draglistan med ett dragnummer och två kolumner, som i en partiblankett. */
  function renderMoves(history) {
    if (history.length === 0) {
      movesElement.innerHTML = '<li class="moves__empty">Inga drag än</li>';
      return;
    }

    const rows = [];
    for (let i = 0; i < history.length; i += 2) {
      rows.push({
        number: i / 2 + 1,
        white: history[i]?.san ?? '',
        black: history[i + 1]?.san ?? '',
        whiteLatest: i === history.length - 1,
        blackLatest: i + 1 === history.length - 1,
      });
    }

    movesElement.innerHTML = rows
      .map(
        (row) => `<li>
          <span class="moves__number">${row.number}.</span>
          <span class="${row.whiteLatest ? 'is-latest' : ''}">${row.white}</span>
          <span class="${row.blackLatest ? 'is-latest' : ''}">${row.black}</span>
        </li>`,
      )
      .join('');

    // Håll det senaste draget synligt.
    movesElement.scrollTop = movesElement.scrollHeight;
  }

  const statusElement = $('[data-status]');

  function setStatus(text, alert = false) {
    statusElement.textContent = text;
    statusElement.classList.toggle('is-alert', alert);
  }

  const thinkingElement = $('.thinking');

  function setThinking(isThinking) {
    thinkingElement.hidden = !isThinking;
  }

  function setGameTitle(text) {
    $('[data-game-title]').textContent = text;
  }

  function renderFacts({ white, black, mode }) {
    $('[data-fact="white"]').textContent = white;
    $('[data-fact="black"]').textContent = black;
    $('[data-fact="mode"]').textContent = mode;
  }

  function setUndoEnabled(enabled) {
    for (const button of $$('[data-action="undo"]')) {
      button.disabled = !enabled;
    }
  }

  /* ------------------------------------------------------- Bondeförvandling */

  const promotionOverlay = $('[data-overlay="promotion"]');
  const promotionChoices = $('.promotion__choices');

  /**
   * Visar rutan där spelaren väljer vad bonden ska bli.
   * @returns {Promise<'q'|'r'|'b'|'n'|null>} null om valet avbryts.
   */
  function askPromotion(color) {
    return new Promise((resolve) => {
      const pieces = [
        ['q', 'Dam'],
        ['r', 'Torn'],
        ['b', 'Löpare'],
        ['n', 'Springare'],
      ];

      promotionChoices.innerHTML = pieces
        .map(
          ([type, label]) =>
            `<button type="button" data-promote="${type}" aria-label="${label}">
               <img src="assets/pieces/${color}${type.toUpperCase()}.svg" alt="">
             </button>`,
        )
        .join('');

      promotionOverlay.hidden = false;

      function finish(value) {
        promotionOverlay.hidden = true;
        promotionOverlay.removeEventListener('click', onClick);
        document.removeEventListener('keydown', onKey);
        resolve(value);
      }

      function onClick(event) {
        const button = event.target.closest('[data-promote]');
        // Ett klick utanför rutan avbryter, precis som Escape.
        if (!button) {
          if (event.target === promotionOverlay) finish(null);
          return;
        }
        finish(button.dataset.promote);
      }

      function onKey(event) {
        if (event.key === 'Escape') finish(null);
      }

      promotionOverlay.addEventListener('click', onClick);
      document.addEventListener('keydown', onKey);
      promotionChoices.querySelector('button')?.focus();
    });
  }

  /* ------------------------------------------------------------- Resultatet */

  const resultOverlay = $('[data-overlay="result"]');

  /**
   * Visar resultatsidan.
   *
   * @param {object} data
   * @param {'win'|'loss'|'draw'} data.outcome  Sett från spelarens håll.
   * @param {string} data.title                 Rubrik, till exempel "Du vann".
   * @param {string} data.reason                Kort förklaring, till exempel "Schackmatt".
   * @param {'w'|'b'|null} data.pieceColor      Vilken kung som visas överst.
   * @param {number} data.moves                 Antal drag.
   * @param {number} data.durationMs            Speltid.
   */
  function showResult(data) {
    const card = $('.result', resultOverlay);
    card.classList.toggle('result--win', data.outcome === 'win');

    const piece = $('.result__piece', resultOverlay);
    piece.src = `assets/pieces/${data.pieceColor ?? 'w'}K.svg`;
    piece.alt = '';
    piece.style.opacity = data.outcome === 'draw' ? '0.55' : '1';

    $('.result__title', resultOverlay).textContent = data.title;
    $('.result__reason', resultOverlay).textContent = data.reason;
    $('[data-result="moves"]', resultOverlay).textContent = data.moves;
    $('[data-result="time"]', resultOverlay).textContent = formatDuration(data.durationMs);

    resultOverlay.hidden = false;
    $('.button--primary', resultOverlay)?.focus();
  }

  function hideResult() {
    resultOverlay.hidden = true;
  }

  /* --------------------------------------------------------- Inställningar */

  function renderSettings(settings) {
    $('[data-setting="theme"]').checked = settings.theme === 'dark';
    $('[data-setting="sound"]').checked = settings.sound;
    $('[data-setting="showLegalMoves"]').checked = settings.showLegalMoves;
    $('[data-setting="flipWhenBlack"]').checked = settings.flipWhenBlack;
    $('[data-setting="handoverScreen"]').checked = settings.handoverScreen;

    for (const button of $$('[data-setting-choice="defaultMinutes"]')) {
      button.setAttribute('aria-checked', String(Number(button.dataset.value) === settings.defaultMinutes));
    }
  }

  return {
    showScreen,
    currentScreen: () => currentScreen,
    renderStats,

    setup,
    renderSetup,
    /** Ställer in vilket läge som väljs på setup-skärmen och visar den. */
    openSetup(mode, defaultMinutes) {
      setup.mode = mode;
      setup.minutes = defaultMinutes;
      renderSetup();
      showScreen('setup');
    },
    setChoice(group, value) {
      if (group === 'minutes') setup.minutes = Number(value);
      else setup[group] = value;
      renderSetup();
    },

    renderPlayers,
    renderClocks,
    renderMoves,
    setStatus,
    setThinking,
    setGameTitle,
    renderFacts,
    setUndoEnabled,

    askPromotion,
    showResult,
    hideResult,
    isResultVisible: () => !resultOverlay.hidden,

    renderSettings,

    /** Namnet på en svårighetsgrad, till exempel 'hard' → 'Svår'. */
    difficultyName: (id) => DIFFICULTY[id]?.name ?? id,
  };
}
