/**
 * Partiet
 * =======
 *
 * Den här modulen håller reda på ett pågående parti: ställningen, klockorna,
 * draglistan och hur partiet slutade. Den känner inte till några knappar eller
 * html-element, utan meddelar omvärlden genom att anropa funktioner som skickas
 * in när partiet skapas.
 *
 * Alla schackregler kommer från chess.js. Att rokad, en passant, bondeförvandling,
 * patt, femtiodragsregeln och ställningsupprepning fungerar är därmed inget vi
 * behöver implementera själva, utan något vi får på köpet av ett bibliotek som
 * är testat av många.
 */

import { Chess } from '../lib/chess.js';

/**
 * Skapar ett nytt parti.
 *
 * @param {object} options
 * @param {'computer'|'local'} options.mode      Mot datorn eller två spelare.
 * @param {'w'|'b'} options.humanColor           Spelarens färg i datorläget.
 * @param {string} options.difficulty            'easy', 'medium' eller 'hard'.
 * @param {number} options.minutes               Betänketid per spelare, 0 = ingen klocka.
 * @param {() => void} [options.onTick]          Anropas varje gång klockan ändras.
 * @param {(reason: string) => void} [options.onTimeout] Anropas när en klocka tar slut.
 */
export function createGame(options) {
  const chess = new Chess();

  const state = {
    mode: options.mode,
    humanColor: options.humanColor ?? 'w',
    difficulty: options.difficulty ?? 'medium',
    minutes: options.minutes ?? 0,
    /** Millisekunder kvar per spelare. Bara relevant när minutes > 0. */
    clocks: { w: (options.minutes ?? 0) * 60000, b: (options.minutes ?? 0) * 60000 },
    /** Alla spelade drag, med information gränssnittet behöver. */
    history: [],
    /** Hur partiet slutade, eller null medan det pågår. */
    result: null,
    startedAt: Date.now(),
    endedAt: null,
  };

  let clockTimer = null;
  let clockStartedAt = null;

  /* ---------------------------------------------------------------- Klockan */

  /** Räknar av den tid som gått sedan klockan senast lästes av. */
  function drainClock() {
    if (!state.minutes || clockStartedAt === null) return;

    const elapsed = Date.now() - clockStartedAt;
    clockStartedAt = Date.now();
    const side = chess.turn();
    state.clocks[side] = Math.max(0, state.clocks[side] - elapsed);
  }

  function stopClock() {
    if (clockTimer !== null) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
    drainClock();
    clockStartedAt = null;
  }

  function startClock() {
    if (!state.minutes || state.result) return;

    stopClock();
    clockStartedAt = Date.now();

    clockTimer = setInterval(() => {
      drainClock();
      clockStartedAt = Date.now();
      options.onTick?.();

      const side = chess.turn();
      if (state.clocks[side] <= 0) {
        stopClock();
        finish({
          type: 'timeout',
          winner: side === 'w' ? 'b' : 'w',
          reason: side === 'w' ? 'Vits tid tog slut' : 'Svarts tid tog slut',
        });
        options.onTimeout?.(state.result);
      }
    }, 200);
  }

  /* ------------------------------------------------------------ Partiets slut */

  function finish(result) {
    state.result = result;
    state.endedAt = Date.now();
    stopClock();
  }

  /**
   * Kontrollerar om partiet är slut och sparar i så fall hur.
   * Anropas efter varje drag.
   */
  function checkForEnd() {
    if (state.result) return;

    if (chess.isCheckmate()) {
      const winner = chess.turn() === 'w' ? 'b' : 'w';
      finish({ type: 'checkmate', winner, reason: 'Schackmatt' });
      return;
    }
    if (chess.isStalemate()) {
      finish({ type: 'draw', winner: null, reason: 'Patt' });
      return;
    }
    if (chess.isInsufficientMaterial()) {
      finish({ type: 'draw', winner: null, reason: 'För lite material för matt' });
      return;
    }
    if (chess.isThreefoldRepetition()) {
      finish({ type: 'draw', winner: null, reason: 'Samma ställning tre gånger' });
      return;
    }
    if (chess.isDraw()) {
      finish({ type: 'draw', winner: null, reason: 'Remi enligt femtiodragsregeln' });
    }
  }

  /* --------------------------------------------------------------- Läsa läget */

  /** Rutan där kungen står, om den kungen är i schack. Annars null. */
  function checkedKingSquare() {
    if (!chess.isCheck()) return null;

    const side = chess.turn();
    for (const row of chess.board()) {
      for (const piece of row) {
        if (piece && piece.type === 'k' && piece.color === side) {
          return piece.square;
        }
      }
    }
    return null;
  }

  return {
    /* ------------------------------------------------------------ Läsa ut läge */

    /** Brädet som en lista med rader, direkt från chess.js. */
    board: () => chess.board(),

    /** Ställningen i FEN-format. Skickas till motorn. */
    fen: () => chess.fen(),

    /** Vems tur det är: 'w' eller 'b'. */
    turn: () => chess.turn(),

    /** Står den som har turen i schack? */
    isCheck: () => chess.isCheck(),

    checkedKingSquare,

    /** Senaste draget, eller null om inget är spelat. */
    lastMove: () => state.history[state.history.length - 1] ?? null,

    /** Alla spelade drag. */
    history: () => state.history.slice(),

    /** Hur partiet slutade, eller null om det pågår. */
    result: () => state.result,

    /** Tid kvar per spelare i millisekunder. */
    clocks: () => ({ ...state.clocks }),

    /** Partiets inställningar. */
    info: () => ({
      mode: state.mode,
      humanColor: state.humanColor,
      difficulty: state.difficulty,
      minutes: state.minutes,
      moveCount: Math.ceil(state.history.length / 2),
      elapsedMs: (state.endedAt ?? Date.now()) - state.startedAt,
    }),

    /**
     * Rutor dit pjäsen på `square` får flyttas.
     * Tom lista om rutan är tom, har fel färg eller pjäsen är fastlåst.
     */
    legalTargets(square) {
      if (state.result) return [];
      return chess.moves({ square, verbose: true }).map((move) => ({
        to: move.to,
        capture: Boolean(move.captured),
        promotion: Boolean(move.promotion),
        castle: move.isKingsideCastle() || move.isQueensideCastle(),
      }));
    },

    /** Behöver draget från `from` till `to` att en pjäs väljs för förvandling? */
    needsPromotion(from, to) {
      return chess
        .moves({ square: from, verbose: true })
        .some((move) => move.to === to && move.promotion);
    },

    /* ------------------------------------------------------------ Ändra läget */

    /**
     * Utför ett drag.
     *
     * @returns {object|null} Draget som gjordes, eller null om det var olagligt.
     *   Att olagliga drag ger null i stället för att kasta fel gör att ett
     *   felklick aldrig kan krascha spelet.
     */
    move(from, to, promotion) {
      if (state.result) return null;

      drainClock();

      let made;
      try {
        made = chess.move({ from, to, promotion });
      } catch {
        // chess.js kastar fel vid olagliga drag. Vi väljer att bara neka draget.
        return null;
      }
      if (!made) return null;

      const record = {
        san: made.san,
        from: made.from,
        to: made.to,
        color: made.color,
        piece: made.piece,
        captured: made.captured ?? null,
        promotion: made.promotion ?? null,
        castle: made.isKingsideCastle() || made.isQueensideCastle(),
        enPassant: made.isEnPassant(),
        check: chess.isCheck(),
      };
      state.history.push(record);

      checkForEnd();
      if (!state.result) startClock();

      return record;
    },

    /**
     * Tar tillbaka det senaste draget.
     *
     * I datorläget tas två drag tillbaka, så att spelaren får tillbaka sin egen
     * tur i stället för att hamna mitt i datorns.
     *
     * @returns {number} Hur många halvdrag som togs tillbaka.
     */
    undo() {
      if (state.history.length === 0) return 0;

      const wantTwo =
        state.mode === 'computer' &&
        state.history.length >= 2 &&
        chess.turn() === state.humanColor;
      const steps = wantTwo ? 2 : 1;

      for (let i = 0; i < steps; i += 1) {
        if (chess.undo()) state.history.pop();
      }

      // Ett återtaget drag öppnar partiet igen, även om det var slut.
      state.result = null;
      state.endedAt = null;
      if (state.minutes) startClock();

      return steps;
    },

    /** Startar klockan. Anropas när partiet börjar. */
    start() {
      state.startedAt = Date.now();
      startClock();
    },

    /** Stoppar klockan och släpper tidtagningen. Anropas när skärmen lämnas. */
    dispose() {
      stopClock();
    },
  };
}
