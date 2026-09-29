/**
 * Inställningar och statistik
 * ===========================
 *
 * Allt som ska finnas kvar mellan besök sparas i webbläsarens localStorage.
 * Resten av appen läser och skriver via funktionerna här och behöver aldrig
 * veta hur lagringen fungerar.
 */

const SETTINGS_KEY = 'chess-royale.settings';
const STATS_KEY = 'chess-royale.stats';

/** Inställningarna en ny spelare börjar med. */
const DEFAULT_SETTINGS = {
  theme: 'dark',          // 'dark' eller 'light'
  sound: true,            // spela ljudeffekter
  showLegalMoves: true,   // markera vilka rutor en pjäs kan gå till
  flipWhenBlack: true,    // vänd brädet när spelaren har svart
  handoverScreen: true,   // mellanskärm mellan turerna i tvåspelarläget
  defaultMinutes: 0,      // 0 = ingen tidsbegränsning
};

/** Statistiken som visas på startsidan. */
const DEFAULT_STATS = {
  played: 0,
  won: 0,
  lost: 0,
  drawn: 0,
};

/** Läser ett sparat objekt och fyller på med standardvärden som saknas. */
function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { ...fallback };
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { ...fallback };
    return { ...fallback, ...parsed };
  } catch {
    // Trasig eller blockerad lagring ska inte hindra någon från att spela.
    return { ...fallback };
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Privat läge kan blockera skrivning. Spelet fungerar ändå.
  }
}

let settings = read(SETTINGS_KEY, DEFAULT_SETTINGS);
let stats = read(STATS_KEY, DEFAULT_STATS);

/** Hämtar en kopia av inställningarna. */
export function getSettings() {
  return { ...settings };
}

/** Ändrar en eller flera inställningar och sparar dem. */
export function updateSettings(changes) {
  settings = { ...settings, ...changes };
  write(SETTINGS_KEY, settings);
  applyTheme();
  return { ...settings };
}

/** Återställer inställningarna till utgångsläget. */
export function resetSettings() {
  settings = { ...DEFAULT_SETTINGS };
  write(SETTINGS_KEY, settings);
  applyTheme();
  return { ...settings };
}

/** Sätter temat på html-elementet, där CSS-variablerna byts ut. */
export function applyTheme() {
  document.documentElement.dataset.theme = settings.theme;
}

/** Hämtar en kopia av statistiken. */
export function getStats() {
  return { ...stats };
}

/**
 * Räknar upp statistiken efter ett avslutat parti.
 * @param {'won'|'lost'|'drawn'} outcome Hur partiet slutade för spelaren.
 */
export function recordResult(outcome) {
  stats = { ...stats, played: stats.played + 1, [outcome]: stats[outcome] + 1 };
  write(STATS_KEY, stats);
  return { ...stats };
}

/** Nollställer statistiken. */
export function resetStats() {
  stats = { ...DEFAULT_STATS };
  write(STATS_KEY, stats);
  return { ...stats };
}
