/**
 * theme.js
 *
 * Darstellung Hell / Dunkel / Automatisch, pro Gerät gemerkt.
 *  - auto:  kein data-theme an <html>; das Stylesheet folgt dem Gerät
 *  - light / dark: data-theme setzt die Wahl fest
 * html.dataset.scheme enthält immer das tatsächlich sichtbare Schema.
 */

const STORAGE_KEY = 'lernkartei.darstellung';
const CHOICES = ['auto', 'light', 'dark'];
const THEME_COLORS = { light: '#f5f6fb', dark: '#0d0f17' };

const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

export function getThemeChoice() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return CHOICES.includes(saved) ? saved : 'auto';
  } catch {
    return 'auto';
  }
}

/** Sichtbares Schema zur Wahl: bei „auto“ das des Geräts. */
function resolve(choice) {
  if (choice === 'auto') return systemDark.matches ? 'dark' : 'light';
  return choice;
}

function apply(choice) {
  const root = document.documentElement;
  if (choice === 'auto') delete root.dataset.theme;
  else root.dataset.theme = choice;
  const scheme = resolve(choice);
  root.dataset.scheme = scheme;
  const meta = document.getElementById('theme-color');
  if (meta) meta.setAttribute('content', THEME_COLORS[scheme]);
  document.dispatchEvent(new CustomEvent('theme:changed', { detail: { choice, scheme } }));
}

export function setThemeChoice(choice) {
  const value = CHOICES.includes(choice) ? choice : 'auto';
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* nur Komfort; die Wahl gilt dann für diese Sitzung */
  }
  apply(value);
}

export function initTheme() {
  apply(getThemeChoice());
  // „Automatisch“ wechselt live, wenn das Gerät umgestellt wird
  systemDark.addEventListener('change', () => {
    if (getThemeChoice() === 'auto') apply('auto');
  });
}
