/**
 * Positionsutvärdering
 * ====================
 *
 * Motorn behöver kunna svara på frågan "hur bra är den här ställningen?"
 * med en enda siffra. Positiv siffra betyder att vit står bättre, negativ
 * att svart gör det. Enheten är centibönder: 100 poäng = värdet av en bonde.
 *
 * Utvärderingen bygger på tre saker:
 *   1. Material  – vem har flest och värdefullast pjäser.
 *   2. Placering – en springare i mitten är bättre än en i hörnet.
 *   3. Struktur  – löparpar, dubbelbönder, kungens säkerhet.
 *
 * Filen innehåller bara rena funktioner utan beroenden, så den kan
 * användas både i huvudtråden och inne i en Web Worker.
 */

/** Vad varje pjäs är värd i centibönder. */
export const PIECE_VALUE = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
};

/**
 * Placeringstabeller.
 *
 * Varje tabell har 64 värden, ett per ruta, skrivna från vits synvinkel
 * med a8 först och h1 sist – alltså precis som brädet ser ut på skärmen.
 * Ett positivt värde betyder att pjäsen står bra på den rutan.
 *
 * För svart speglas tabellen, vilket görs i `squareBonus` nedan.
 */
const PAWN_TABLE = [
   0,   0,   0,   0,   0,   0,   0,   0,
  50,  50,  50,  50,  50,  50,  50,  50,
  10,  10,  20,  30,  30,  20,  10,  10,
   5,   5,  10,  25,  25,  10,   5,   5,
   0,   0,   0,  20,  20,   0,   0,   0,
   5,  -5, -10,   0,   0, -10,  -5,   5,
   5,  10,  10, -20, -20,  10,  10,   5,
   0,   0,   0,   0,   0,   0,   0,   0,
];

const KNIGHT_TABLE = [
 -50, -40, -30, -30, -30, -30, -40, -50,
 -40, -20,   0,   0,   0,   0, -20, -40,
 -30,   0,  10,  15,  15,  10,   0, -30,
 -30,   5,  15,  20,  20,  15,   5, -30,
 -30,   0,  15,  20,  20,  15,   0, -30,
 -30,   5,  10,  15,  15,  10,   5, -30,
 -40, -20,   0,   5,   5,   0, -20, -40,
 -50, -40, -30, -30, -30, -30, -40, -50,
];

const BISHOP_TABLE = [
 -20, -10, -10, -10, -10, -10, -10, -20,
 -10,   0,   0,   0,   0,   0,   0, -10,
 -10,   0,   5,  10,  10,   5,   0, -10,
 -10,   5,   5,  10,  10,   5,   5, -10,
 -10,   0,  10,  10,  10,  10,   0, -10,
 -10,  10,  10,  10,  10,  10,  10, -10,
 -10,   5,   0,   0,   0,   0,   5, -10,
 -20, -10, -10, -10, -10, -10, -10, -20,
];

const ROOK_TABLE = [
   0,   0,   0,   0,   0,   0,   0,   0,
   5,  10,  10,  10,  10,  10,  10,   5,
  -5,   0,   0,   0,   0,   0,   0,  -5,
  -5,   0,   0,   0,   0,   0,   0,  -5,
  -5,   0,   0,   0,   0,   0,   0,  -5,
  -5,   0,   0,   0,   0,   0,   0,  -5,
  -5,   0,   0,   0,   0,   0,   0,  -5,
   0,   0,   0,   5,   5,   0,   0,   0,
];

const QUEEN_TABLE = [
 -20, -10, -10,  -5,  -5, -10, -10, -20,
 -10,   0,   0,   0,   0,   0,   0, -10,
 -10,   0,   5,   5,   5,   5,   0, -10,
  -5,   0,   5,   5,   5,   5,   0,  -5,
   0,   0,   5,   5,   5,   5,   0,  -5,
 -10,   5,   5,   5,   5,   5,   0, -10,
 -10,   0,   5,   0,   0,   0,   0, -10,
 -20, -10, -10,  -5,  -5, -10, -10, -20,
];

/** I mittspelet vill kungen sitta tryggt bakom sina bönder, gärna rockerad. */
const KING_MIDDLEGAME_TABLE = [
 -30, -40, -40, -50, -50, -40, -40, -30,
 -30, -40, -40, -50, -50, -40, -40, -30,
 -30, -40, -40, -50, -50, -40, -40, -30,
 -30, -40, -40, -50, -50, -40, -40, -30,
 -20, -30, -30, -40, -40, -30, -30, -20,
 -10, -20, -20, -20, -20, -20, -20, -10,
  20,  20,   0,   0,   0,   0,  20,  20,
  20,  30,  10,   0,   0,  10,  30,  20,
];

/** I slutspelet är kungen en anfallspjäs och ska in mot mitten. */
const KING_ENDGAME_TABLE = [
 -50, -40, -30, -20, -20, -30, -40, -50,
 -30, -20, -10,   0,   0, -10, -20, -30,
 -30, -10,  20,  30,  30,  20, -10, -30,
 -30, -10,  30,  40,  40,  30, -10, -30,
 -30, -10,  30,  40,  40,  30, -10, -30,
 -30, -10,  20,  30,  30,  20, -10, -30,
 -30, -30,   0,   0,   0,   0, -30, -30,
 -50, -30, -30, -30, -30, -30, -30, -50,
];

const TABLES = {
  p: PAWN_TABLE,
  n: KNIGHT_TABLE,
  b: BISHOP_TABLE,
  r: ROOK_TABLE,
  q: QUEEN_TABLE,
};

/**
 * Hämtar placeringsbonusen för en pjäs.
 *
 * `row` och `col` är brädets rader och kolumner som chess.js ger dem, där
 * rad 0 är åttonde raden (svarts baslinje). För svarta pjäser speglar vi
 * raden, eftersom tabellerna är skrivna ur vits synvinkel.
 */
function squareBonus(table, row, col, color) {
  const index = color === 'w' ? row * 8 + col : (7 - row) * 8 + col;
  return table[index];
}

/**
 * Avgör om ställningen är ett slutspel.
 *
 * Tumregeln: när damerna är borta, eller när den sida som har dam knappt
 * har något annat kvar, byter kungen roll från gömd till aktiv.
 */
function isEndgame(counts) {
  const heavyMaterial =
    (counts.w.q + counts.b.q) * 9 +
    (counts.w.r + counts.b.r) * 5 +
    (counts.w.n + counts.b.n + counts.w.b + counts.b.b) * 3;
  return heavyMaterial <= 16;
}

/**
 * Utvärderar en ställning.
 *
 * @param {import('../lib/chess.js').Chess} chess Spelet som ska bedömas.
 * @returns {number} Poäng i centibönder, positivt när vit står bättre.
 */
export function evaluate(chess) {
  const board = chess.board();

  let score = 0;
  const counts = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0 },
  };
  // Bönder per kolumn, för att kunna upptäcka dubbelbönder.
  const pawnFiles = { w: new Array(8).fill(0), b: new Array(8).fill(0) };
  const kings = {};

  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const piece = board[row][col];
      if (!piece) continue;

      const sign = piece.color === 'w' ? 1 : -1;

      if (piece.type === 'k') {
        kings[piece.color] = { row, col };
      } else {
        counts[piece.color][piece.type] += 1;
        score += sign * PIECE_VALUE[piece.type];
        score += sign * squareBonus(TABLES[piece.type], row, col, piece.color);
        if (piece.type === 'p') {
          pawnFiles[piece.color][col] += 1;
        }
      }
    }
  }

  // Kungens placering beror på om det är mittspel eller slutspel.
  const endgame = isEndgame(counts);
  const kingTable = endgame ? KING_ENDGAME_TABLE : KING_MIDDLEGAME_TABLE;
  for (const color of ['w', 'b']) {
    const king = kings[color];
    if (king) {
      score += (color === 'w' ? 1 : -1) * squareBonus(kingTable, king.row, king.col, color);
    }
  }

  // Löparparet är värt en liten bonus eftersom löparna täcker varandras svagheter.
  if (counts.w.b >= 2) score += 30;
  if (counts.b.b >= 2) score -= 30;

  // Dubbelbönder står i vägen för varandra och straffas lätt.
  for (let col = 0; col < 8; col += 1) {
    if (pawnFiles.w[col] > 1) score -= (pawnFiles.w[col] - 1) * 15;
    if (pawnFiles.b[col] > 1) score += (pawnFiles.b[col] - 1) * 15;
  }

  return score;
}

/**
 * Utvärderar ställningen sett från den sida som står i tur.
 * Positivt betyder alltid "bra för mig" – det gör sökningen enklare att skriva.
 */
export function evaluateForSideToMove(chess) {
  const score = evaluate(chess);
  return chess.turn() === 'w' ? score : -score;
}
