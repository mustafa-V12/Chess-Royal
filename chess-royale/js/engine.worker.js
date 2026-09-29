/**
 * Motorns bakgrundstråd
 * =====================
 *
 * En Web Worker kör i en egen tråd, skild från sidan. Därför kan motorn räkna
 * i flera sekunder utan att knappar, klocka eller animationer hakar upp sig.
 *
 * Filen är avsiktligt kort: allt tänkande ligger i ai.js. Här tas bara
 * meddelanden emot och svar skickas tillbaka.
 */

import { chooseMove } from './ai.js';

self.addEventListener('message', (event) => {
  const { id, fen, level } = event.data;

  try {
    const move = chooseMove(fen, level);
    self.postMessage({ id, move });
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
});
