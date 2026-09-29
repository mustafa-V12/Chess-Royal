/**
 * Schackmotorn
 * ============
 *
 * Datorns drag väljs med minimax och alpha-beta-beskärning.
 *
 * Minimax betyder att motorn spelar igenom alla drag, alla motdrag, alla
 * motdrag till motdragen och så vidare, och antar att båda sidor väljer det
 * som är bäst för dem själva. Alpha-beta-beskärning är ett knep som låter
 * motorn hoppa över grenar som ändå aldrig kan bli bättre än något den redan
 * har hittat. Den hittar exakt samma drag, men hinner titta mycket djupare.
 *
 * Utöver det finns tre saker som gör motorn märkbart starkare:
 *
 *   Dragordning          Slag på värdefulla pjäser undersöks först. Ju tidigare
 *                        ett bra drag hittas, desto mer kan beskäras bort.
 *   Lugnsökning          Innan en ställning bedöms spelas alla slag klart, så
 *                        att motorn inte stannar mitt i ett byte och tror att
 *                        den vunnit en dam som är på väg att slås tillbaka.
 *   Stegvis fördjupning  Motorn söker först djup 1, sedan 2, sedan 3 ... tills
 *                        tiden är slut. Då finns alltid ett färdigt drag att
 *                        spela, och nivåerna kan styras med en tidsbudget.
 *
 * En sak om prestanda som är värd att känna till: chess.js kan ge tillbaka
 * dragen antingen som korta textsträngar ("Nf3") eller som fullständiga objekt.
 * Objekten är ungefär tjugo gånger långsammare att skapa, eftersom biblioteket
 * då räknar ut notationen för varje drag. Sökningen använder därför strängar
 * och läser ut det den behöver ur dem. Det ensamma bytet tar motorn från djup 2
 * till djup 5 inom samma tidsbudget.
 *
 * Filen innehåller ingen kod som rör gränssnittet. Den körs i en Web Worker
 * (se engine.worker.js) så att sidan aldrig fryser medan datorn tänker.
 */

import { Chess } from '../lib/chess.js';
import { PIECE_VALUE, evaluateForSideToMove } from './evaluation.js';

/** Poäng för matt. Ligger långt över allt material så att matt alltid väljs. */
const MATE_SCORE = 100000;

/** Hur många slag i rad lugnsökningen som mest får följa. */
const MAX_QUIESCENCE_DEPTH = 6;

/**
 * De tre svårighetsgraderna.
 *
 * Nivåerna skiljer sig på riktigt, inte bara i namn:
 *
 *   maxDepth    hur många halvdrag framåt motorn som mest får räkna
 *   timeBudget  hur många millisekunder den får tänka
 *   quiescence  om den räknar färdigt pågående avbyten innan den dömer
 *   noise       slumpmässigt påslag i poängen, gör spelet mindre förutsägbart
 *   blunder     sannolikheten att den med flit väljer ett sämre drag
 */
export const DIFFICULTY = {
  easy: {
    id: 'easy',
    name: 'Enkel',
    maxDepth: 2,
    timeBudget: 600,
    quiescence: false,
    noise: 70,
    blunder: 0.35,
  },
  medium: {
    id: 'medium',
    name: 'Medel',
    maxDepth: 3,
    timeBudget: 1200,
    quiescence: true,
    noise: 25,
    blunder: 0.05,
  },
  hard: {
    id: 'hard',
    name: 'Svår',
    maxDepth: 6,
    timeBudget: 3000,
    quiescence: true,
    noise: 0,
    blunder: 0,
  },
};

/** Kastas när tidsbudgeten tar slut, så att sökningen kan avbrytas direkt. */
class TimeUp extends Error {}

/** Räknare för hur många ställningar sökningen har tittat på. */
let nodeCount = 0;

/**
 * Kollar klockan, men bara var 512:e ställning.
 * Date.now() är billigt, men inte gratis, och anropas annars miljontals gånger.
 */
function checkTime(deadline) {
  nodeCount += 1;
  if ((nodeCount & 511) === 0 && Date.now() > deadline) {
    throw new TimeUp();
  }
}

/**
 * Skapar minnet som hjälper sökningen att gissa rätt dragordning.
 *
 * killers  Två drag per djup som tidigare visade sig så starka att sökningen
 *          kunde avbryta grenen. Samma drag är ofta bra i systerställningar.
 * history  En tabell över hur ofta varje drag har lett till en avbruten gren,
 *          oavsett var i trädet. Fungerar som ett långsiktigt minne.
 *
 * Båda är rena gissningar som bara styr ordningen. De kan aldrig ändra vilket
 * drag sökningen till slut kommer fram till, bara hur snabbt den kommer dit.
 */
function createSearchMemory(maxDepth) {
  return {
    killers: Array.from({ length: maxDepth + MAX_QUIESCENCE_DEPTH + 2 }, () => [null, null]),
    history: new Map(),
    table: new Map(),
  };
}

/**
 * Transpositionstabellen.
 *
 * Samma ställning kan nås via olika dragföljder. 1.e4 e5 2.Nf3 ger exakt samma
 * bräde som 1.Nf3 e5 2.e4. Utan minne räknar motorn ut svaret två gånger. Med
 * en tabell slår den upp det i stället, vilket i praktiken ger ungefär ett
 * extra sökdjup inom samma tid.
 *
 * Flaggan berättar hur mycket den sparade siffran är värd:
 *   EXACT  ställningen räknades färdigt, siffran stämmer
 *   LOWER  sökningen avbröts, ställningen är minst så här bra
 *   UPPER  inget drag nådde upp till alpha, ställningen är högst så här bra
 */
const TT_EXACT = 0;
const TT_LOWER = 1;
const TT_UPPER = 2;

/** Hur många ställningar tabellen får innehålla innan den töms. */
const TT_MAX_ENTRIES = 200000;

/**
 * Nyckeln till en ställning.
 *
 * FEN-strängens två sista fält räknar drag sedan senaste slag och vilket
 * dragnummer partiet är på. De beskriver inte hur pjäserna står, så de tas bort
 * för att samma bräde ska kännas igen oftare.
 */
function positionKey(chess) {
  const fen = chess.fen();
  const lastSpace = fen.lastIndexOf(' ');
  return fen.slice(0, fen.lastIndexOf(' ', lastSpace - 1));
}

/**
 * Plockar isär ett drag skrivet i vanlig schacknotation.
 *
 * Exempel på vad som kommer in och vad som kommer ut:
 *   "e4"      →  bonde till e4
 *   "Nxf3+"   →  springare slår på f3 och ger schack
 *   "exd8=Q"  →  bonde slår på d8 och blir dam
 *   "O-O"     →  kort rockad
 *
 * Bara textbehandling, inga objekt skapas, så det går mycket fort.
 */
function parseSan(san) {
  if (san.charCodeAt(0) === 79) {
    // O-O eller O-O-O. Rockad är aldrig ett slag.
    return { to: null, capture: false, promotion: null, piece: 'k' };
  }

  let body = san;
  const lastChar = body[body.length - 1];
  if (lastChar === '+' || lastChar === '#') {
    body = body.slice(0, -1);
  }

  let promotion = null;
  const equals = body.indexOf('=');
  if (equals !== -1) {
    promotion = body[equals + 1].toLowerCase();
    body = body.slice(0, equals);
  }

  const first = san[0];
  // Stor bokstav i början betyder pjäsdrag, annars är det en bonde.
  const piece = first >= 'A' && first <= 'Z' ? first.toLowerCase() : 'p';

  return {
    to: body.slice(-2),
    capture: san.indexOf('x') !== -1,
    promotion,
    piece,
  };
}

/**
 * Ger varje drag en siffra som säger hur lovande det ser ut, och sorterar
 * efter den. Poängen används bara för att bestämma ordningen, aldrig för att
 * bedöma ställningen.
 *
 * Ordningen i tur och ordning:
 *   1. Draget som var bäst förra gången vi sökte den här ställningen.
 *   2. Slag, värderade enligt MVV-LVA: slå det värdefullaste offret med den
 *      billigaste egna pjäsen. En bonde som tar en dam undersöks före en dam
 *      som tar en bonde.
 *   3. Bondeförvandlingar.
 *   4. Killer-drag, som fungerade bra på samma djup i en annan gren.
 *   5. Övriga drag, efter hur ofta de har fungerat tidigare i sökningen.
 */
function orderSans(chess, sans, preferredSan, memory, ply) {
  const killers = memory ? memory.killers[ply] : null;
  const scored = new Array(sans.length);

  for (let i = 0; i < sans.length; i += 1) {
    const san = sans[i];
    let score = 0;

    if (san === preferredSan) {
      score = 100000000;
    } else {
      const parsed = parseSan(san);

      if (parsed.capture && parsed.to) {
        const victim = chess.get(parsed.to);
        // Vid en passant står det ingen pjäs på målrutan, offret är då en bonde.
        const victimValue = victim ? PIECE_VALUE[victim.type] : PIECE_VALUE.p;
        score = 1000000 + 10 * victimValue - PIECE_VALUE[parsed.piece];
      } else if (killers && san === killers[0]) {
        score = 900000;
      } else if (killers && san === killers[1]) {
        score = 800000;
      } else if (memory) {
        score = memory.history.get(san) ?? 0;
      }

      if (parsed.promotion) {
        score += 500000 + PIECE_VALUE[parsed.promotion];
      }
    }

    scored[i] = { san, score };
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((entry) => entry.san);
}

/**
 * Sparar ett drag som visade sig starkt nog att avbryta sökningen i en gren.
 * Bara stilla drag sparas – slag hittas ändå redan högst upp i ordningen.
 */
function rememberCutoff(memory, san, depth, ply) {
  if (san.indexOf('x') !== -1) return;

  const killers = memory.killers[ply];
  if (killers[0] !== san) {
    killers[1] = killers[0];
    killers[0] = san;
  }

  // Djupa avbrott väger tyngre än grunda, därav depth i kvadrat.
  memory.history.set(san, (memory.history.get(san) ?? 0) + depth * depth);
}

/**
 * Lugnsökning.
 *
 * Problemet den löser: om sökningen tar slut mitt i ett avbyte kan motorn tro
 * att den just vunnit en dam, trots att damen slås tillbaka i nästa drag. Innan
 * en ställning bedöms spelas därför alla slag klart.
 *
 * @param {Chess} chess        Ställningen.
 * @param {number} alpha       Bästa poäng den sökande sidan är garanterad.
 * @param {number} beta        Bästa poäng motståndaren är garanterad.
 * @param {number} depthLeft   Hur många slag till som får följas.
 * @param {number} deadline    Tidpunkt då sökningen måste vara klar.
 * @param {string[]} [knownSans] Redan genererade drag, för att slippa göra om det.
 */
function quiescence(chess, alpha, beta, depthLeft, deadline, knownSans) {
  checkTime(deadline);

  // Ställningen som den ser ut om ingen slår mer. Spelaren behöver inte slå,
  // så det här är en undre gräns för hur bra ställningen är.
  const standPat = evaluateForSideToMove(chess);
  if (standPat >= beta) return beta;
  if (standPat > alpha) alpha = standPat;

  if (depthLeft <= 0) return alpha;

  const sans = knownSans ?? chess.moves();
  const captures = sans.filter((san) => san.indexOf('x') !== -1);
  if (captures.length === 0) return alpha;

  for (const san of orderSans(chess, captures, null, null, 0)) {
    chess.move(san);
    const score = -quiescence(chess, -beta, -alpha, depthLeft - 1, deadline);
    chess.undo();

    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }

  return alpha;
}

/**
 * Själva minimax-sökningen, skriven i negamax-form: i varje steg byter vi
 * perspektiv och vänder tecknet på poängen, i stället för att ha två nästan
 * identiska fall för vit och svart.
 *
 * @param {Chess} chess      Ställningen, som ändras och återställs under sökningen.
 * @param {number} depth     Hur många halvdrag som återstår att söka.
 * @param {number} alpha     Bästa poäng den sökande sidan är garanterad hittills.
 * @param {number} beta      Bästa poäng motståndaren är garanterad hittills.
 * @param {number} ply       Hur djupt vi står nu, används för att föredra snabb matt.
 * @param {object} settings  Inställningarna för vald svårighetsgrad.
 * @param {number} deadline  Tidpunkt då sökningen måste vara klar.
 * @param {object} memory    Killer-drag och historiktabell för dragordningen.
 */
function search(chess, depth, alpha, beta, ply, settings, deadline, memory) {
  checkTime(deadline);

  const originalAlpha = alpha;
  const key = positionKey(chess);
  const stored = memory.table.get(key);
  let preferredSan = null;

  if (stored) {
    // Även när den sparade siffran inte duger är det sparade draget en bra gissning.
    preferredSan = stored.bestSan;

    if (stored.depth >= depth) {
      if (stored.flag === TT_EXACT) return stored.score;
      if (stored.flag === TT_LOWER && stored.score > alpha) alpha = stored.score;
      else if (stored.flag === TT_UPPER && stored.score < beta) beta = stored.score;
      if (alpha >= beta) return stored.score;
    }
  }

  const sans = chess.moves();

  // Inga lagliga drag betyder antingen matt eller patt.
  if (sans.length === 0) {
    // Matt nära i tiden är bättre än matt långt bort, därav + ply.
    return chess.isCheck() ? -MATE_SCORE + ply : 0;
  }

  if (depth === 0) {
    return settings.quiescence
      ? quiescence(chess, alpha, beta, MAX_QUIESCENCE_DEPTH, deadline, sans)
      : evaluateForSideToMove(chess);
  }

  let best = -Infinity;
  let bestSan = null;
  let moveNumber = 0;

  for (const san of orderSans(chess, sans, preferredSan, memory, ply)) {
    // Dragen är sorterade med det mest lovande först. Har de fyra första inte
    // gett något är resten sällan värda full uppmärksamhet, så de söks först
    // grundare. Visar det sig ändå lovande görs om sökningen ordentligt.
    // Knepet kallas sena dragreduktioner och ger ungefär ett extra sökdjup.
    const isQuiet = san.indexOf('x') === -1 && san.indexOf('+') === -1;
    const canReduce = moveNumber >= 4 && depth >= 3 && isQuiet;
    moveNumber += 1;

    chess.move(san);

    let score;
    if (canReduce) {
      score = -search(chess, depth - 2, -alpha - 1, -alpha, ply + 1, settings, deadline, memory);
      if (score > alpha) {
        score = -search(chess, depth - 1, -beta, -alpha, ply + 1, settings, deadline, memory);
      }
    } else {
      score = -search(chess, depth - 1, -beta, -alpha, ply + 1, settings, deadline, memory);
    }

    chess.undo();

    if (score > best) {
      best = score;
      bestSan = san;
    }
    if (best > alpha) alpha = best;

    // Motståndaren skulle aldrig tillåta den här ställningen. Sluta leta här.
    if (alpha >= beta) {
      rememberCutoff(memory, san, depth, ply);
      break;
    }
  }

  // Mattpoäng sparas inte. De beror på hur djupt ner matten hittades, och skulle
  // bli fel om samma ställning senare nås på ett annat djup.
  if (Math.abs(best) < MATE_SCORE - 1000) {
    let flag = TT_EXACT;
    if (best <= originalAlpha) flag = TT_UPPER;
    else if (best >= beta) flag = TT_LOWER;

    if (memory.table.size >= TT_MAX_ENTRIES) memory.table.clear();
    memory.table.set(key, { depth, score: best, flag, bestSan });
  }

  return best;
}

/**
 * Väljer datorns drag.
 *
 * Sökningen fördjupas steg för steg tills tiden är slut. Det gör att det alltid
 * finns ett fullständigt genomräknat drag att spela, oavsett hur komplicerad
 * ställningen är.
 *
 * @param {string} fen           Ställningen som datorn ska spela i.
 * @param {string} level         'easy', 'medium' eller 'hard'.
 * @param {() => number} random  Slumpkälla, kan bytas ut i tester.
 * @returns {{san: string, from: string, to: string, promotion?: string,
 *            depth: number, score: number, nodes: number, timeMs: number} | null}
 */
export function chooseMove(fen, level = 'medium', random = Math.random) {
  const settings = DIFFICULTY[level] ?? DIFFICULTY.medium;
  const chess = new Chess(fen);

  // Rotdragen hämtas som fullständiga objekt, eftersom gränssnittet behöver
  // veta från vilken ruta till vilken. Det sker bara en gång per drag.
  const rootMoves = chess.moves({ verbose: true });
  if (rootMoves.length === 0) {
    return null;
  }

  const started = Date.now();
  const deadline = started + settings.timeBudget;
  nodeCount = 0;

  const bySan = new Map(rootMoves.map((move) => [move.san, move]));
  const rootSans = rootMoves.map((move) => move.san);
  const memory = createSearchMemory(settings.maxDepth);

  let bestSan = rootSans[0];
  let bestScore = 0;
  let completedDepth = 0;
  let ranking = rootSans.map((san) => ({ san, score: 0 }));

  for (let depth = 1; depth <= settings.maxDepth; depth += 1) {
    try {
      const results = [];
      let alpha = -Infinity;

      for (const san of orderSans(chess, rootSans, bestSan, memory, 0)) {
        chess.move(san);
        const score = -search(chess, depth - 1, -Infinity, -alpha, 1, settings, deadline, memory);
        chess.undo();

        results.push({ san, score });
        if (score > alpha) alpha = score;
      }

      // Sökningen för det här djupet blev klar i tid, så resultatet får gälla.
      results.sort((a, b) => b.score - a.score);
      ranking = results;
      bestSan = results[0].san;
      bestScore = results[0].score;
      completedDepth = depth;

      // Matt hittad – det finns inget bättre att leta efter.
      if (Math.abs(bestScore) > MATE_SCORE - 1000) break;
    } catch (error) {
      if (error instanceof TimeUp) break;
      throw error;
    }
  }

  let chosenSan = bestSan;

  // På lägre nivåer skakas poängen om lite, så att datorn inte spelar exakt
  // samma parti varje gång. Slumpen läggs på efter sökningen, aldrig under,
  // så att alpha-beta-beskärningen förblir korrekt.
  if (settings.noise > 0 && ranking.length > 1) {
    const shaken = ranking.map((entry) => ({
      san: entry.san,
      score: entry.score + (random() * 2 - 1) * settings.noise,
    }));
    shaken.sort((a, b) => b.score - a.score);
    chosenSan = shaken[0].san;
  }

  // På enkel nivå väljer datorn dessutom ibland med flit ett sämre drag, så att
  // en nybörjare får en chans. Den spelar fortfarande alltid lagligt.
  if (settings.blunder > 0 && ranking.length > 1 && random() < settings.blunder) {
    const alternatives = ranking.slice(1, Math.min(4, ranking.length));
    chosenSan = alternatives[Math.floor(random() * alternatives.length)].san;
  }

  const chosen = bySan.get(chosenSan);

  return {
    san: chosen.san,
    from: chosen.from,
    to: chosen.to,
    promotion: chosen.promotion,
    depth: completedDepth,
    score: Math.round(bestScore),
    nodes: nodeCount,
    timeMs: Date.now() - started,
  };
}

/**
 * Startar motorn i en Web Worker och ger tillbaka ett litet gränssnitt mot den.
 *
 * Anledningen till att motorn körs i en egen tråd är att sökningen tar upp till
 * några sekunder. Skulle den köras i sidans vanliga tråd skulle hela
 * gränssnittet frysa under tiden: inga knappar, ingen klocka, ingen rullning.
 */
export function createEngine() {
  let worker = null;
  let nextRequestId = 1;
  const pending = new Map();

  function ensureWorker() {
    if (worker) return worker;

    worker = new Worker(new URL('./engine.worker.js', import.meta.url), { type: 'module' });

    worker.addEventListener('message', (event) => {
      const { id, move, error } = event.data;
      const handlers = pending.get(id);
      if (!handlers) return;
      pending.delete(id);

      if (error) handlers.reject(new Error(error));
      else handlers.resolve(move);
    });

    worker.addEventListener('error', (event) => {
      for (const handlers of pending.values()) {
        handlers.reject(new Error(event.message || 'Motorn kunde inte startas'));
      }
      pending.clear();
    });

    return worker;
  }

  return {
    /** Ber motorn om ett drag i ställningen. Returnerar ett löfte. */
    requestMove(fen, level) {
      const id = nextRequestId;
      nextRequestId += 1;

      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ensureWorker().postMessage({ id, fen, level });
      });
    },

    /** Avbryter allt som pågår. Används när spelaren lämnar partiet. */
    cancel() {
      if (!worker) return;
      worker.terminate();
      worker = null;
      for (const handlers of pending.values()) {
        handlers.reject(new Error('avbruten'));
      }
      pending.clear();
    },
  };
}
