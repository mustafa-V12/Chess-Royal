/**
 * Schackbrädet
 * ============
 *
 * Ritar brädet, placerar pjäserna och tar emot klick och dragningar. Modulen
 * kan inga schackregler: den frågar partiet vilka drag som är tillåtna och
 * meddelar vidare när spelaren har valt ett. Det gör att samma bräde kan
 * användas i alla spellägen.
 *
 * Brädet byggs av tre lager ovanpå varandra:
 *   1. Rutorna, som är statiska och bär alla markeringar.
 *   2. Pjäserna, som ligger absolut placerade och flyttas med transform.
 *      Att flytta med transform i stället för att rita om gör att webbläsaren
 *      kan animera förflyttningen mjukt.
 *   3. Koordinaterna a–h och 1–8.
 */

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

/** Räknar om en ruta som 'e4' till kolumn och rad på skärmen. */
function squareToScreen(square, orientation) {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  return orientation === 'w'
    ? { col: file, row: 7 - rank }
    : { col: 7 - file, row: rank };
}

/** Räknar om kolumn och rad på skärmen till en ruta som 'e4'. */
function screenToSquare(col, row, orientation) {
  const file = orientation === 'w' ? col : 7 - col;
  const rank = orientation === 'w' ? 7 - row : row;
  return FILES[file] + (rank + 1);
}

/**
 * Skapar brädet inuti ett element.
 *
 * @param {HTMLElement} root Elementet brädet ritas i.
 * @param {object} handlers
 * @param {(square: string) => void} handlers.onSquareActivated
 *   Anropas när spelaren har tryckt på eller släppt en pjäs över en ruta.
 */
export function createBoard(root, handlers) {
  root.classList.add('board');
  root.innerHTML = `
    <div class="board__squares"></div>
    <div class="board__pieces"></div>
  `;

  const squaresLayer = root.querySelector('.board__squares');
  const piecesLayer = root.querySelector('.board__pieces');

  let orientation = 'w';
  let interactive = true;

  /** Ruta → elementet för pjäsen som står där. */
  const pieceElements = new Map();
  /** Ruta → rutans element, för snabba uppslag när markeringar ska sättas. */
  const squareElements = new Map();

  /* ------------------------------------------------------------------ Rutorna */

  function buildSquares() {
    squaresLayer.innerHTML = '';
    squareElements.clear();

    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        const square = screenToSquare(col, row, orientation);
        const element = document.createElement('div');
        // Rutans färg beror på dess plats på brädet, inte på hur brädet vänds.
        const isLight = (col + row) % 2 === 0;
        element.className = `square ${isLight ? 'square--light' : 'square--dark'}`;
        element.dataset.square = square;

        // Koordinaterna sitter i kantrutorna: siffran till vänster, bokstaven
        // längst ner. De ärver rutans färg och syns därför alltid tydligt.
        let coords = '';
        if (col === 0) {
          coords += `<span class="square__coord square__coord--rank">${square[1]}</span>`;
        }
        if (row === 7) {
          coords += `<span class="square__coord square__coord--file">${square[0]}</span>`;
        }
        element.innerHTML = coords;

        squaresLayer.appendChild(element);
        squareElements.set(square, element);
      }
    }
  }

  /* ----------------------------------------------------------------- Pjäserna */

  function placeElement(element, square) {
    const { col, row } = squareToScreen(square, orientation);
    element.style.transform = `translate(${col * 100}%, ${row * 100}%)`;
  }

  function createPieceElement(piece, square) {
    const element = document.createElement('div');
    element.className = 'piece';
    element.dataset.square = square;
    element.dataset.color = piece.color;
    element.innerHTML =
      `<img src="assets/pieces/${piece.color}${piece.type.toUpperCase()}.svg" alt="" draggable="false">`;
    placeElement(element, square);
    return element;
  }

  /** Ritar om alla pjäser från grunden. Används vid nytt parti och efter ångra. */
  function renderPosition(board) {
    piecesLayer.innerHTML = '';
    pieceElements.clear();

    for (const row of board) {
      for (const piece of row) {
        if (!piece) continue;
        const element = createPieceElement(piece, piece.square);
        piecesLayer.appendChild(element);
        pieceElements.set(piece.square, element);
      }
    }
  }

  /** Tar bort en pjäs med en kort uttoning. */
  function removePiece(square) {
    const element = pieceElements.get(square);
    if (!element) return;

    pieceElements.delete(square);
    element.classList.add('piece--captured');
    element.addEventListener('animationend', () => element.remove(), { once: true });
    // Reservlösning om animationen aldrig körs, till exempel vid reducerad rörelse.
    setTimeout(() => element.remove(), 400);
  }

  /**
   * Flyttar en pjäs på skärmen efter ett spelat drag.
   * Sköter även slagen pjäs, rockadens torn, en passant och förvandling.
   */
  function applyMove(move) {
    // En passant: den slagna bonden står inte på målrutan utan bredvid den.
    if (move.enPassant) {
      const capturedSquare = move.to[0] + (move.color === 'w' ? Number(move.to[1]) - 1 : Number(move.to[1]) + 1);
      removePiece(capturedSquare);
    } else if (move.captured) {
      removePiece(move.to);
    }

    const element = pieceElements.get(move.from);
    if (!element) return;

    pieceElements.delete(move.from);
    pieceElements.set(move.to, element);
    element.dataset.square = move.to;
    placeElement(element, move.to);

    // Bondeförvandling: byt bild på samma element så att rörelsen inte bryts.
    if (move.promotion) {
      const image = element.querySelector('img');
      image.src = `assets/pieces/${move.color}${move.promotion.toUpperCase()}.svg`;
    }

    // Rockad: tornet hoppar över kungen och måste flyttas med.
    if (move.castle) {
      const rank = move.to[1];
      const kingside = move.to[0] === 'g';
      const rookFrom = (kingside ? 'h' : 'a') + rank;
      const rookTo = (kingside ? 'f' : 'd') + rank;
      const rook = pieceElements.get(rookFrom);
      if (rook) {
        pieceElements.delete(rookFrom);
        pieceElements.set(rookTo, rook);
        rook.dataset.square = rookTo;
        placeElement(rook, rookTo);
      }
    }
  }

  /* --------------------------------------------------------------- Markeringar */

  function clearMarks() {
    for (const element of squareElements.values()) {
      element.classList.remove('is-last', 'is-selected', 'is-target', 'is-capture', 'is-check');
    }
  }

  /**
   * Sätter alla markeringar på en gång.
   *
   * @param {object} marks
   * @param {string|null} marks.selected   Rutan spelaren har valt.
   * @param {Array} marks.targets          Rutor pjäsen kan gå till.
   * @param {object|null} marks.lastMove   Senaste draget, markeras svagt.
   * @param {string|null} marks.check      Rutan där en kung står i schack.
   */
  function setMarks({ selected, targets = [], lastMove, check }) {
    clearMarks();

    if (lastMove) {
      squareElements.get(lastMove.from)?.classList.add('is-last');
      squareElements.get(lastMove.to)?.classList.add('is-last');
    }
    if (selected) {
      squareElements.get(selected)?.classList.add('is-selected');
    }
    for (const target of targets) {
      const element = squareElements.get(target.to);
      if (!element) continue;
      element.classList.add(target.capture ? 'is-capture' : 'is-target');
    }
    if (check) {
      squareElements.get(check)?.classList.add('is-check');
    }
  }

  /* ------------------------------------------------------- Klick och dragningar */

  /** Räknar ut vilken ruta en punkt på skärmen hamnar på. */
  function squareAtPoint(clientX, clientY) {
    const bounds = root.getBoundingClientRect();
    const col = Math.floor(((clientX - bounds.left) / bounds.width) * 8);
    const row = Math.floor(((clientY - bounds.top) / bounds.height) * 8);
    if (col < 0 || col > 7 || row < 0 || row > 7) return null;
    return screenToSquare(col, row, orientation);
  }

  let drag = null;

  function onPointerDown(event) {
    if (!interactive || event.button === 1 || event.button === 2) return;

    const square = squareAtPoint(event.clientX, event.clientY);
    if (!square) return;

    // Rutan aktiveras direkt vid nedtryck. Då fungerar spelet likadant för den
    // som trycker två gånger och den som drar pjäsen.
    handlers.onSquareActivated(square);

    const element = pieceElements.get(square);
    if (!element) return;

    drag = {
      element,
      from: square,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    root.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;

    // Små rörelser räknas som ett klick, inte som en dragning.
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;

    if (!drag.moved) {
      drag.moved = true;
      drag.element.classList.add('piece--dragging');
    }

    const { col, row } = squareToScreen(drag.from, orientation);
    const size = root.getBoundingClientRect().width / 8;
    drag.element.style.transform =
      `translate(calc(${col * 100}% + ${dx / size * 100}%), calc(${row * 100}% + ${dy / size * 100}%))`;

    event.preventDefault();
  }

  function onPointerUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;

    const current = drag;
    drag = null;
    root.releasePointerCapture?.(event.pointerId);

    current.element.classList.remove('piece--dragging');

    if (!current.moved) return;

    // Lägg tillbaka pjäsen på sin ruta. Blir draget godkänt flyttas den dit
    // ändå, av applyMove, och annars ska den tillbaka.
    placeElement(current.element, current.from);

    const target = squareAtPoint(event.clientX, event.clientY);
    if (target && target !== current.from) {
      handlers.onSquareActivated(target);
    }
  }

  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerUp);
  root.addEventListener('pointercancel', onPointerUp);
  // Hindrar att webbläsaren visar sin egen meny vid långt tryck på mobil.
  root.addEventListener('contextmenu', (event) => event.preventDefault());

  buildSquares();

  return {
    renderPosition,
    applyMove,
    setMarks,

    /** Vänder brädet. Pjäserna räknas om till sina nya platser. */
    setOrientation(next, board) {
      if (next === orientation) return;
      orientation = next;
      buildSquares();
      renderPosition(board);
    },

    orientation: () => orientation,

    /** Stänger av eller sätter på möjligheten att röra pjäserna. */
    setInteractive(value) {
      interactive = value;
      root.classList.toggle('board--locked', !value);
    },
  };
}
