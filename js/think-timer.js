/**
 * think-timer.js
 *
 * Denkzeit beim Üben: zählt nach der Uhrzeit, nicht nach Takten. Läuft die
 * App im Hintergrund oder ist das Handy gesperrt, ist die Zeit beim
 * Zurückkommen trotzdem richtig weitergelaufen.
 */

export const THINK_CHOICES = [0, 3, 5, 10, 20, 30];
export const THINK_DEFAULT = 5;
export const FADE_MS = 2500;
const TICK_MS = 250;

/**
 * @param {{ startedAt: number, seconds: number, onTick: (remaining: number, share: number) => void, onDone: () => void }} args
 *   remaining = ganze Sekunden (aufgerundet), share = verbleibender Anteil 0…1
 * @returns {{ stop(): void }}
 */
export function startThinkTimer({ startedAt, seconds, onTick, onDone }) {
  const total = seconds * 1000;
  let active = true;
  let interval = null;

  const stop = () => {
    active = false;
    clearInterval(interval);
    document.removeEventListener('visibilitychange', check);
  };

  function check() {
    if (!active) return;
    const left = total - (Date.now() - startedAt);
    if (left <= 0) {
      stop();
      onDone();
      return;
    }
    onTick(Math.ceil(left / 1000), left / total);
  }

  interval = setInterval(check, TICK_MS);
  document.addEventListener('visibilitychange', check);
  check();
  return { stop };
}
