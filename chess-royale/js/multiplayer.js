/**
 * Tvåspelarläge på samma enhet
 * ============================
 *
 * När två personer delar en mobil behöver de veta när det är dags att lämna
 * över den. Modulen sköter mellanskärmen som visas mellan turerna, och håller
 * reda på vad spelarna heter.
 *
 * Mellanskärmen kan stängas av i inställningarna. Då byter spelarna bara tur
 * som vanligt, vilket passar när båda sitter framför samma skärm.
 */

/** Namnen som visas i panelen. Spelare 1 har alltid vit. */
export const LOCAL_PLAYERS = {
  w: 'Spelare 1',
  b: 'Spelare 2',
};

/**
 * Skapar hanteraren för det lokala tvåspelarläget.
 *
 * @param {HTMLElement} overlay Elementet som används som mellanskärm.
 */
export function createHandover(overlay) {
  let waiting = false;
  let onContinue = null;

  function hide() {
    waiting = false;
    overlay.hidden = true;
    overlay.classList.remove('is-visible');
  }

  function proceed() {
    if (!waiting) return;
    const callback = onContinue;
    onContinue = null;
    hide();
    callback?.();
  }

  overlay.addEventListener('click', proceed);
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      proceed();
    }
  });

  return {
    /**
     * Visar mellanskärmen och väntar på att någon trycker.
     *
     * @param {'w'|'b'} color   Färgen som står på tur.
     * @param {() => void} next Anropas när spelaren har tryckt vidare.
     */
    show(color, next) {
      waiting = true;
      onContinue = next;

      const name = LOCAL_PLAYERS[color];
      overlay.innerHTML = `
        <div class="handover__card">
          <img class="handover__piece" src="assets/pieces/${color}K.svg" alt="">
          <p class="handover__turn">${name}s tur</p>
          <p class="handover__hint">Lämna över enheten och tryck för att fortsätta</p>
        </div>
      `;
      overlay.hidden = false;
      // Elementet måste vara synligt innan klassen sätts, annars hinner
      // webbläsaren inte animera övergången.
      requestAnimationFrame(() => overlay.classList.add('is-visible'));
      overlay.focus();
    },

    /** Stänger mellanskärmen utan att fortsätta. Används när partiet lämnas. */
    cancel() {
      onContinue = null;
      hide();
    },

    isWaiting: () => waiting,
  };
}
