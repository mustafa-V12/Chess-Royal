/**
 * Chess Royale – start och sammanhållning
 * =======================================
 *
 * Filen binder ihop de andra modulerna och styr flödet i ett parti:
 * vems tur det är, när datorn ska tänka, när brädet ska låsas och när
 * resultatet ska visas.
 *
 * Så här hänger delarna ihop:
 *
 *   game.js    reglerna och partiets tillstånd   (vet inget om skärmen)
 *   ai.js      datorns drag, körs i en worker    (vet inget om skärmen)
 *   board.js   brädet, klick och dragningar      (kan inga regler)
 *   ui.js      allt annat på skärmen             (kan inga regler)
 *   main.js    den här filen, som håller ihop dem
 *
 * Uppdelningen betyder att reglerna kan ändras utan att designen rörs, och
 * tvärtom.
 */

import { createEngine, DIFFICULTY } from './ai.js';
import { sounds } from './audio.js';
import { createBoard } from './board.js';
import { createGame } from './game.js';
import { createHandover, LOCAL_PLAYERS } from './multiplayer.js';
import {
  applyTheme,
  getSettings,
  getStats,
  recordResult,
  resetSettings,
  resetStats,
  updateSettings,
} from './settings.js';
import { createUI } from './ui.js';

/**
 * Kortaste tid datorn låtsas fundera, i millisekunder.
 * Utan den svarar datorn ibland omedelbart, vilket känns som att den inte
 * tänkte alls. Med den får draget en naturlig rytm.
 */
const MINIMUM_THINKING_MS = 420;

const ui = createUI();
const engine = createEngine();
const board = createBoard(document.getElementById('board'), { onSquareActivated: handleSquare });
const handover = createHandover(document.querySelector('[data-overlay="handover"]'));

/** Det pågående partiet, eller null när inget parti är igång. */
let game = null;
/** Inställningarna partiet startades med, så att "Spela igen" blir likadant. */
let currentOptions = null;
/** Rutan spelaren har markerat, eller null. */
let selectedSquare = null;
/** Sant medan datorn räknar. Då ska brädet inte gå att röra. */
let computerThinking = false;

/* ------------------------------------------------------------------ Hjälpare */

/** Namnen som visas på spelarkorten. */
function playerNames() {
  if (!game) return { w: 'Vit', b: 'Svart' };

  const info = game.info();
  if (info.mode === 'local') return { ...LOCAL_PLAYERS };

  return info.humanColor === 'w'
    ? { w: 'Du', b: 'Datorn' }
    : { w: 'Datorn', b: 'Du' };
}

/** Är det spelaren själv som ska dra just nu? */
function isHumanTurn() {
  if (!game || game.result()) return false;
  const info = game.info();
  if (info.mode === 'local') return true;
  return game.turn() === info.humanColor;
}

/** Ritar om hela spelskärmen utifrån partiets nuvarande läge. */
function render() {
  if (!game) return;

  const info = game.info();
  const hasClock = info.minutes > 0;

  // Svårighetsgraden visas under datorns namn, inte i det.
  const subtitles =
    info.mode === 'computer'
      ? { [info.humanColor === 'w' ? 'b' : 'w']: ui.difficultyName(info.difficulty) }
      : {};

  ui.renderPlayers({
    board: game.board(),
    turn: game.turn(),
    orientation: board.orientation(),
    names: playerNames(),
    clocks: game.clocks(),
    hasClock,
    subtitles,
  });

  ui.renderMoves(game.history());
  ui.setUndoEnabled(game.history().length > 0 && !computerThinking);

  const names = playerNames();
  ui.renderFacts({
    white: names.w,
    black: names.b,
    mode: info.mode === 'computer' ? `Dator, ${ui.difficultyName(info.difficulty).toLowerCase()}` : 'Två spelare',
  });

  updateMarks();
  updateStatus();
}

/** Sätter markeringarna på brädet: vald pjäs, möjliga drag, senaste drag, schack. */
function updateMarks() {
  if (!game) return;

  const settings = getSettings();
  const targets =
    selectedSquare && settings.showLegalMoves ? game.legalTargets(selectedSquare) : [];

  board.setMarks({
    selected: selectedSquare,
    targets,
    lastMove: game.lastMove(),
    check: game.checkedKingSquare(),
  });
}

/** Skriver raden under brädet som berättar vad som väntas härnäst. */
function updateStatus() {
  if (!game) return;

  if (game.result()) {
    ui.setStatus('Partiet är slut', true);
    return;
  }

  const names = playerNames();
  const turn = game.turn();

  if (computerThinking) {
    ui.setStatus('Datorn tänker …');
    return;
  }
  if (game.isCheck()) {
    ui.setStatus(`Schack! ${names[turn]} måste rädda kungen`, true);
    return;
  }

  ui.setStatus(`${names[turn]} har turen`);
}

/* ------------------------------------------------------------ Att göra ett drag */

/**
 * Utför ett drag och tar hand om allt som följer: ljud, animation, omritning,
 * kontroll av om partiet är slut och i så fall resultatsidan.
 */
async function playMove(from, to, promotion) {
  const move = game.move(from, to, promotion);
  if (!move) return false;

  selectedSquare = null;
  board.applyMove(move);

  if (move.castle) sounds.castle();
  else if (move.captured) sounds.capture();
  else sounds.move();

  if (move.check) sounds.check();

  render();

  if (game.result()) {
    finishGame();
    return true;
  }

  await continueTurn();
  return true;
}

/**
 * Lämnar över turen.
 *
 * I datorläget betyder det att motorn får tänka. I tvåspelarläget visas
 * mellanskärmen, om den är påslagen.
 */
async function continueTurn() {
  if (!game || game.result()) return;

  const info = game.info();

  if (info.mode === 'computer' && game.turn() !== info.humanColor) {
    await runComputerMove();
    return;
  }

  if (info.mode === 'local' && getSettings().handoverScreen && game.history().length > 0) {
    board.setInteractive(false);
    handover.show(game.turn(), () => {
      board.setInteractive(true);
      updateStatus();
    });
  }
}

/** Ber motorn om ett drag och spelar det. */
async function runComputerMove() {
  const info = game.info();

  computerThinking = true;
  board.setInteractive(false);
  ui.setThinking(true);
  ui.setUndoEnabled(false);
  updateStatus();

  const startedAt = Date.now();
  const sessionGame = game;

  try {
    const move = await engine.requestMove(game.fen(), info.difficulty);

    // Partiet kan ha bytts ut eller avslutats medan motorn räknade.
    if (game !== sessionGame || !game || game.result()) return;
    if (!move) return;

    // Låt draget ta minst en kort stund, så att det inte kommer omedelbart.
    const waited = Date.now() - startedAt;
    if (waited < MINIMUM_THINKING_MS) {
      await new Promise((resolve) => setTimeout(resolve, MINIMUM_THINKING_MS - waited));
    }
    if (game !== sessionGame || !game) return;

    computerThinking = false;
    ui.setThinking(false);
    board.setInteractive(true);

    await playMove(move.from, move.to, move.promotion);
  } catch (error) {
    // Går motorn inte att starta ska spelaren få veta det, inte mötas av
    // ett bräde som tyst slutar svara.
    console.error('Motorn kunde inte ge något drag:', error);
    if (game === sessionGame && game && !game.result()) {
      ui.setStatus('Datorn kunde inte räkna ut ett drag. Prova att börja om.', true);
    }
  } finally {
    if (game === sessionGame) {
      computerThinking = false;
      ui.setThinking(false);
      board.setInteractive(true);
      ui.setUndoEnabled(Boolean(game) && game.history().length > 0);
    }
  }
}

/**
 * Tar emot ett tryck på en ruta.
 *
 * Första trycket väljer en pjäs, andra trycket flyttar den. Trycker man på en
 * annan egen pjäs byter markeringen dit i stället, vilket är vad de flesta
 * förväntar sig.
 */
async function handleSquare(square) {
  if (!game || game.result() || computerThinking || handover.isWaiting()) return;
  if (!isHumanTurn()) return;

  sounds.unlock();

  // Ett andra tryck: försök flytta dit.
  if (selectedSquare && selectedSquare !== square) {
    const targets = game.legalTargets(selectedSquare);
    const target = targets.find((item) => item.to === square);

    if (target) {
      let promotion;
      if (game.needsPromotion(selectedSquare, square)) {
        board.setInteractive(false);
        promotion = await ui.askPromotion(game.turn());
        board.setInteractive(true);
        if (!promotion) {
          // Valet avbröts. Pjäsen förblir markerad så att man kan välja igen.
          updateMarks();
          return;
        }
      }
      await playMove(selectedSquare, square, promotion);
      return;
    }
  }

  // Välj en egen pjäs, eller avmarkera om man trycker på samma igen.
  const piece = game.board().flat().find((item) => item && item.square === square);

  if (piece && piece.color === game.turn()) {
    selectedSquare = selectedSquare === square ? null : square;
  } else {
    selectedSquare = null;
  }

  updateMarks();
}

/* --------------------------------------------------------------- Partiets slut */

/** Visar resultatsidan och uppdaterar statistiken. */
function finishGame() {
  const result = game.result();
  if (!result) return;

  const info = game.info();
  const names = playerNames();

  let outcome;
  let title;

  if (!result.winner) {
    outcome = 'draw';
    title = 'Remi';
  } else if (info.mode === 'computer') {
    const playerWon = result.winner === info.humanColor;
    outcome = playerWon ? 'win' : 'loss';
    title = playerWon ? 'Du vann!' : 'Datorn vann';
  } else {
    outcome = 'win';
    title = `${names[result.winner]} vann`;
  }

  // Statistiken räknas bara i datorläget, där "vunnit" betyder något entydigt.
  if (info.mode === 'computer') {
    recordResult(outcome === 'win' ? 'won' : outcome === 'loss' ? 'lost' : 'drawn');
    ui.renderStats(getStats());
  }

  if (outcome === 'win') sounds.victory();
  else if (outcome === 'loss') sounds.defeat();
  else sounds.draw();

  ui.showResult({
    outcome,
    title,
    reason: result.reason,
    pieceColor: result.winner,
    moves: info.moveCount,
    durationMs: info.elapsedMs,
  });
}

/* ----------------------------------------------------------- Starta och avsluta */

/** Startar ett nytt parti med de inställningar som valts. */
async function startGame(options) {
  stopGame();

  currentOptions = options;

  // Slumpad färg avgörs en gång, när partiet börjar.
  const humanColor =
    options.color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : options.color;

  game = createGame({
    mode: options.mode,
    humanColor,
    difficulty: options.difficulty,
    minutes: options.minutes,
    onTick: () => {
      if (!game) return;
      ui.renderClocks({
        orientation: board.orientation(),
        clocks: game.clocks(),
        hasClock: true,
      });
    },
    onTimeout: () => {
      if (!game) return;
      render();
      finishGame();
    },
  });

  selectedSquare = null;
  computerThinking = false;

  // Brädet vänds så att spelarens egna pjäser står närmast, om den
  // inställningen är på. I tvåspelarläget står vit alltid nedåt.
  const settings = getSettings();
  const orientation =
    options.mode === 'computer' && settings.flipWhenBlack ? humanColor : 'w';

  board.setOrientation(orientation, game.board());
  board.renderPosition(game.board());
  board.setInteractive(true);
  ui.setThinking(false);
  ui.hideResult();

  ui.setGameTitle(
    options.mode === 'computer'
      ? `Mot datorn · ${ui.difficultyName(options.difficulty)}`
      : 'Två spelare',
  );

  ui.showScreen('game');
  render();

  sounds.gameStart();
  game.start();

  // Har datorn vit börjar den direkt.
  if (options.mode === 'computer' && game.turn() !== humanColor) {
    await runComputerMove();
  }
}

/** Avslutar det pågående partiet och släpper allt det håller igång. */
function stopGame() {
  handover.cancel();
  engine.cancel();
  ui.hideResult();
  ui.setThinking(false);
  computerThinking = false;
  selectedSquare = null;

  if (game) {
    game.dispose();
    game = null;
  }
}

/** Går tillbaka till startsidan. */
function goHome() {
  stopGame();
  ui.renderStats(getStats());
  ui.showScreen('home');
}

/** Tar tillbaka ett drag. */
function undoMove() {
  if (!game || computerThinking) return;
  if (game.history().length === 0) return;

  handover.cancel();
  ui.hideResult();

  game.undo();
  selectedSquare = null;
  board.renderPosition(game.board());
  board.setInteractive(true);
  render();
  sounds.click();
}

/* ------------------------------------------------------------------ Händelser */

/** Alla knappar i appen pekar ut vad de gör med data-action. */
const actions = {
  'play-computer': () => {
    ui.openSetup('computer', getSettings().defaultMinutes);
  },
  'play-local': () => {
    ui.openSetup('local', getSettings().defaultMinutes);
  },
  'open-settings': () => {
    ui.renderSettings(getSettings());
    ui.showScreen('settings');
  },
  'go-home': goHome,
  'start-game': () => {
    const { mode, difficulty, color, minutes } = ui.setup;
    startGame({
      mode,
      difficulty,
      color: mode === 'computer' ? color : 'w',
      minutes,
    });
  },
  'leave-game': goHome,
  restart: () => {
    if (currentOptions) startGame(currentOptions);
  },
  rematch: () => {
    if (currentOptions) startGame(currentOptions);
  },
  'new-setup': () => {
    const mode = currentOptions?.mode ?? 'computer';
    stopGame();
    ui.openSetup(mode, getSettings().defaultMinutes);
  },
  undo: undoMove,
  'reset-settings': () => {
    const settings = resetSettings();
    ui.renderSettings(settings);
    sounds.click();
  },
  'reset-stats': (button) => {
    // Ett tryck till krävs, så att statistiken inte försvinner av misstag.
    if (button.dataset.confirm) {
      resetStats();
      ui.renderStats(getStats());
      button.textContent = 'Statistiken är nollställd';
      delete button.dataset.confirm;
      setTimeout(() => {
        button.textContent = 'Nollställ statistik';
      }, 1800);
    } else {
      button.dataset.confirm = '1';
      button.textContent = 'Tryck igen för att bekräfta';
      setTimeout(() => {
        if (button.dataset.confirm) {
          delete button.dataset.confirm;
          button.textContent = 'Nollställ statistik';
        }
      }, 3500);
    }
  },
};

document.addEventListener('click', (event) => {
  // Val på skärmen inför ett parti.
  const choice = event.target.closest('[data-choice]');
  if (choice) {
    ui.setChoice(choice.dataset.choice, choice.dataset.value);
    sounds.unlock();
    sounds.click();
    return;
  }

  // Standardtiden i inställningarna.
  const settingChoice = event.target.closest('[data-setting-choice]');
  if (settingChoice) {
    const settings = updateSettings({
      [settingChoice.dataset.setting]: Number(settingChoice.dataset.value),
    });
    ui.renderSettings(settings);
    sounds.click();
    return;
  }

  const trigger = event.target.closest('[data-action]');
  if (!trigger || trigger.disabled) return;

  const handler = actions[trigger.dataset.action];
  if (!handler) return;

  sounds.unlock();
  handler(trigger);
});

// Reglagen i inställningarna.
document.addEventListener('change', (event) => {
  const input = event.target.closest('[data-setting]');
  if (!input) return;

  const key = input.dataset.setting;
  const value = key === 'theme' ? (input.checked ? 'dark' : 'light') : input.checked;
  updateSettings({ [key]: value });

  if (key === 'showLegalMoves') updateMarks();
  sounds.click();
});

// Escape stänger resultatsidan och går till menyn.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (ui.isResultVisible()) {
    goHome();
  }
});

/* ----------------------------------------------------------------------- Start */

applyTheme();
ui.renderStats(getStats());
ui.renderSettings(getSettings());
ui.renderSetup();
ui.showScreen('home');
