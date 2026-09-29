/**
 * Ljudeffekter
 * ============
 *
 * Ljuden skapas i koden med Web Audio API i stället för att laddas som filer.
 * Varje ljud är ett par korta toner som tonar ut. Det gör att appen fungerar
 * helt utan internet och inte drar med sig ljudfiler.
 *
 * Vill du hellre använda riktiga ljudfiler räcker det att byta ut `playTone`
 * mot uppspelning av en fil. Se assets/sounds/README.md.
 */

import { getSettings } from './settings.js';

let context = null;

/**
 * Hämtar ljudkontexten och skapar den vid behov.
 *
 * Webbläsare tillåter inte ljud förrän användaren har klickat någonstans på
 * sidan, därför skapas kontexten först när ett ljud faktiskt ska spelas.
 */
function getContext() {
  if (!context) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    try {
      context = new AudioContextClass();
    } catch {
      return null;
    }
  }
  if (context.state === 'suspended') {
    context.resume().catch(() => {});
  }
  return context;
}

/**
 * Spelar en enkel ton.
 *
 * @param {number} frequency Tonhöjd i hertz.
 * @param {number} duration  Längd i sekunder.
 * @param {string} type      Vågform: 'sine', 'triangle', 'square' eller 'sawtooth'.
 * @param {number} volume    Volym mellan 0 och 1.
 * @param {number} delay     Fördröjning i sekunder innan tonen börjar.
 */
function playTone(frequency, duration, type, volume, delay = 0) {
  if (!getSettings().sound) return;

  const ctx = getContext();
  if (!ctx) return;

  const startTime = ctx.currentTime + delay;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startTime);

  // Tonen tonas in snabbt och ut mjukt, annars hörs ett klick.
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(volume, startTime + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + duration + 0.03);
}

export const sounds = {
  /** Ett vanligt drag: en kort, dov träklang. */
  move() {
    playTone(320, 0.07, 'triangle', 0.16);
    playTone(180, 0.1, 'sine', 0.1, 0.01);
  },

  /** Slag: vassare och lite längre än ett vanligt drag. */
  capture() {
    playTone(520, 0.06, 'square', 0.1);
    playTone(220, 0.16, 'sawtooth', 0.11, 0.03);
  },

  /** Schack: två stigande toner som varning. */
  check() {
    playTone(660, 0.1, 'sine', 0.14);
    playTone(880, 0.14, 'sine', 0.12, 0.09);
  },

  /** Rockad: två drag efter varandra. */
  castle() {
    playTone(300, 0.07, 'triangle', 0.14);
    playTone(300, 0.07, 'triangle', 0.14, 0.1);
  },

  /** Nytt parti: en kort uppåtgående fanfar. */
  gameStart() {
    [392, 523, 659].forEach((frequency, index) => {
      playTone(frequency, 0.12, 'triangle', 0.1, index * 0.07);
    });
  },

  /** Vinst: en längre fanfar. */
  victory() {
    [523, 659, 784, 1047].forEach((frequency, index) => {
      playTone(frequency, 0.16, 'triangle', 0.12, index * 0.1);
    });
  },

  /** Förlust: tre fallande toner, diskret. */
  defeat() {
    [392, 330, 262].forEach((frequency, index) => {
      playTone(frequency, 0.2, 'sine', 0.1, index * 0.14);
    });
  },

  /** Remi: två lika toner, varken glatt eller sorgligt. */
  draw() {
    playTone(440, 0.18, 'sine', 0.1);
    playTone(440, 0.18, 'sine', 0.1, 0.16);
  },

  /** Knapptryck i menyerna. */
  click() {
    playTone(600, 0.04, 'sine', 0.06);
  },

  /**
   * Väcker ljudet vid första klicket.
   * Måste anropas från en riktig användarhändelse för att webbläsaren ska tillåta ljud.
   */
  unlock() {
    getContext();
  },
};
