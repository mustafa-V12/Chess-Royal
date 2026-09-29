/**
 * Tester för schackmotorn
 * =======================
 *
 * Körs med:  node tests/engine.test.mjs
 *
 * Testerna rör inte gränssnittet alls. De laddar motorn och spelreglerna
 * direkt och kontrollerar att datorn hittar matt, tar material som står gratis,
 * inte hänger sina egna pjäser, håller sin tidsbudget och att de tre
 * svårighetsgraderna verkligen skiljer sig åt.
 *
 * Att det går att testa så här är hela poängen med att hålla ai.js och
 * evaluation.js fria från kod som rör skärmen.
 */

import { Chess } from '../lib/chess.js';
import { chooseMove, DIFFICULTY } from '../js/ai.js';
import { evaluate } from '../js/evaluation.js';

let failures = 0;

function check(name, condition, extra = '') {
  const status = condition ? 'OK  ' : 'FEL ';
  if (!condition) failures += 1;
  console.log(`${status} ${name}${extra ? `  (${extra})` : ''}`);
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

/* ------------------------------------------------------------ Utvärderingen */

section('Utvärdering av ställningar');

check('startställningen är jämn', evaluate(new Chess()) === 0, String(evaluate(new Chess())));

const whiteUpQueen = new Chess('rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
check('en dam upp ger vit klart övertag', evaluate(whiteUpQueen) > 800, String(evaluate(whiteUpQueen)));

const blackUpQueen = new Chess('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNB1KBNR w KQkq - 0 1');
check('en dam upp ger svart klart övertag', evaluate(blackUpQueen) < -800, String(evaluate(blackUpQueen)));

/* ------------------------------------------------------------------- Matt */

section('Motorn hittar matt');

for (const [fen, expected] of [
  ['rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2', 'Qh4#'],
  ['6k1/5ppp/8/8/8/8/8/R3K2R w KQ - 0 1', 'Ra8#'],
]) {
  const played = chooseMove(fen, 'hard');
  check(`hittar ${expected}`, played?.san === expected, `spelade ${played?.san}`);
}

{
  /** Räknar själv fram vilka drag som tvingar fram matt i exakt två drag. */
  function forcedMateIn2(fen) {
    const chess = new Chess(fen);
    const winners = [];

    for (const first of chess.moves()) {
      chess.move(first);
      if (chess.isCheckmate() || chess.isStalemate() || chess.isDraw()) {
        chess.undo();
        continue;
      }
      const replies = chess.moves();
      const forced =
        replies.length > 0 &&
        replies.every((reply) => {
          chess.move(reply);
          const canMate = chess.moves().some((last) => {
            chess.move(last);
            const mate = chess.isCheckmate();
            chess.undo();
            return mate;
          });
          chess.undo();
          return canMate;
        });
      chess.undo();
      if (forced) winners.push(first);
    }

    return winners;
  }

  const fen = 'kbK5/pp6/1P6/8/8/8/8/R7 w - - 0 1';
  const solutions = forcedMateIn2(fen);
  const played = chooseMove(fen, 'hard');

  check(
    `hittar tvingad matt i två drag (${solutions.join(', ')})`,
    solutions.includes(played?.san),
    `spelade ${played?.san}, djup ${played?.depth}`,
  );
}

{
  // Efter 1.f3 e5 förlorar 2.g4 direkt på 2...Qh4 matt. Motorn ska se hotet.
  const chess = new Chess();
  chess.move('f3');
  chess.move('e5');
  const played = chooseMove(chess.fen(), 'hard');
  check('undviker draget som tillåter matt', played?.san !== 'g4', `spelade ${played?.san}`);
}

/* --------------------------------------------------------------- Material */

section('Motorn räknar material rätt');

{
  // Svart dam står oskyddad på d4 och kan slås av springaren på f3.
  const played = chooseMove('4k3/8/8/8/3q4/5N2/8/4K3 w - - 0 1', 'hard');
  check('slår en oskyddad dam', played?.san.startsWith('Nxd4'), `spelade ${played?.san}`);
}

{
  // Svarts torn på d8 täcker hela d-linjen. Damen får inte ställa sig i vägen.
  const fen = '3rk3/8/8/8/8/8/PPP5/3QK3 w - - 0 1';
  const played = chooseMove(fen, 'hard');
  const after = new Chess(fen);
  after.move(played.san);
  const keptQueen = after
    .board()
    .flat()
    .some((piece) => piece && piece.type === 'q' && piece.color === 'w');
  check('hänger inte sin egen dam', keptQueen, `spelade ${played?.san}`);
}

/* --------------------------------------------------- Lagliga drag och tid */

section('Alla nivåer spelar lagligt');

for (const level of ['easy', 'medium', 'hard']) {
  const chess = new Chess();
  let legal = true;
  let plies = 0;
  const started = Date.now();

  while (!chess.isGameOver() && plies < 14) {
    const played = chooseMove(chess.fen(), level);
    if (!played) break;

    if (!chess.moves().includes(played.san)) {
      legal = false;
      console.log(`     olagligt drag ${played.san} i ${chess.fen()}`);
      break;
    }

    chess.move(played.san);
    plies += 1;
  }

  check(`${level}: 14 halvdrag utan olagligt drag`, legal, `${Date.now() - started} ms`);
}

section('Tidsbudgeten hålls');

// En tät mittspelsställning med många möjliga drag är värsta fallet för sökningen.
const COMPLEX = 'r1bq1rk1/pp2ppbp/2np1np1/2p5/2P1P3/2NP1NP1/PP3PBP/R1BQ1RK1 w - - 0 9';

for (const level of ['easy', 'medium', 'hard']) {
  const budget = DIFFICULTY[level].timeBudget;
  const started = Date.now();
  const played = chooseMove(COMPLEX, level);
  const elapsed = Date.now() - started;

  // Ett litet påslag tillåts: klockan läses av mellan ställningar, inte i varje.
  check(
    `${level}: klar inom ${budget} ms`,
    elapsed < budget + 900,
    `${elapsed} ms, djup ${played.depth}, ${played.nodes} ställningar`,
  );
}

section('Nivåerna skiljer sig åt');

const depths = {};
for (const level of ['easy', 'medium', 'hard']) {
  const played = chooseMove(COMPLEX, level);
  depths[level] = played.depth;
  console.log(`     ${level.padEnd(7)} djup ${played.depth}, ${played.timeMs} ms, drag ${played.san}`);
}

check('medel söker djupare än enkel', depths.medium > depths.easy, `${depths.easy} mot ${depths.medium}`);
check('svår söker minst lika djupt som medel', depths.hard >= depths.medium, `${depths.medium} mot ${depths.hard}`);

section('Sökningen är förutsägbar');

{
  // Med samma slumpkälla ska samma ställning ge samma drag varje gång.
  // Det visar att reduktionerna i sökningen inte gör resultatet slumpmässigt.
  let identical = 0;
  const positions = [
    'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
    '8/5pk1/6p1/8/5PK1/8/6P1/8 w - - 0 1',
  ];

  for (const fen of positions) {
    const first = chooseMove(fen, 'medium', () => 0.5);
    const second = chooseMove(fen, 'medium', () => 0.5);
    if (first.san === second.san) identical += 1;
  }

  check('samma ställning ger samma drag', identical === positions.length, `${identical} av ${positions.length}`);
}

/* ------------------------------------------------------------------ Facit */

console.log(
  `\n${failures === 0 ? 'ALLA TESTER GICK IGENOM' : `${failures} TESTER MISSLYCKADES`}\n`,
);
process.exit(failures === 0 ? 0 : 1);
