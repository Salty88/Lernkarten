/**
 * ui.js
 *
 * Gemeinsame UI-Bausteine für alle Ansichten: Element-Erzeugung, Toasts,
 * Dialoge (Modals) und Textnormalisierung für die Suche.
 */

const TOAST_DURATION_MS = 2500;
const TOAST_ACTION_DURATION_MS = 5000;

/** Erzeugt ein Element; Texte immer über textContent (kein HTML-Injection-Risiko). */
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

/** Button mit Typ "button", optional mit Klick-Handler. */
export function button(className, text, onClick) {
  const node = el('button', className, text);
  node.type = 'button';
  if (onClick) node.addEventListener('click', onClick);
  return node;
}

export function plural(n, singular, pluralForm) {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

/**
 * Normalisiert Text für die Suche: Kleinbuchstaben, ß = ss, Akzente weg,
 * Umlaute und Ersatzschreibung gleich (ä = a = ae).
 */
export function norm(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ae/g, 'a')
    .replace(/oe/g, 'o')
    .replace(/ue/g, 'u');
}

/* ------------------------------------------------------------------ */
/* Toast                                                               */
/* ------------------------------------------------------------------ */

let toastTimer = null;
let toastActionHandler = null;

/**
 * Zeigt eine kurze Meldung unten zentriert.
 * @param {'info'|'success'|'error'} type
 * @param {{label: string, onClick: Function}} [action] optionaler Button, z. B. „Rückgängig“
 */
export function showToast(message, type = 'info', action = null) {
  const toast = document.getElementById('toast');
  const text = document.getElementById('toast-text');
  const actionBtn = document.getElementById('toast-action');

  clearTimeout(toastTimer);
  text.textContent = message;
  toast.dataset.type = type;
  toastActionHandler = action ? action.onClick : null;
  actionBtn.hidden = !action;
  if (action) actionBtn.textContent = action.label;

  toast.hidden = false;
  void toast.offsetWidth; // Reflow, damit die Einblend-Transition jedes Mal greift
  toast.classList.add('is-visible');
  toastTimer = setTimeout(hideToast, action ? TOAST_ACTION_DURATION_MS : TOAST_DURATION_MS);
}

export function hideToast() {
  const toast = document.getElementById('toast');
  toast.classList.remove('is-visible');
  toastActionHandler = null;
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 250);
}

export function initToast() {
  document.getElementById('toast-action').addEventListener('click', () => {
    const handler = toastActionHandler;
    hideToast();
    if (handler) handler();
  });
}

/* ------------------------------------------------------------------ */
/* Dialoge                                                             */
/* ------------------------------------------------------------------ */

/** Stapel offener Dialoge; Escape schließt immer den obersten. */
const modalStack = [];

export function openModal(backdrop, focusTarget = null) {
  if (!modalStack.some((entry) => entry.backdrop === backdrop)) {
    modalStack.push({ backdrop, returnFocus: document.activeElement });
  }
  backdrop.hidden = false;
  document.body.classList.add('modal-open');
  const target = focusTarget || backdrop.querySelector('[data-autofocus]') || backdrop.querySelector('button, input, textarea, select');
  if (target) target.focus({ preventScroll: true });
}

export function closeModal(backdrop) {
  const index = modalStack.findIndex((entry) => entry.backdrop === backdrop);
  backdrop.hidden = true;
  if (index === -1) return;
  const [{ returnFocus }] = modalStack.splice(index, 1);
  if (modalStack.length === 0) document.body.classList.remove('modal-open');
  if (returnFocus && document.contains(returnFocus) && typeof returnFocus.focus === 'function') {
    returnFocus.focus({ preventScroll: true });
  }
}

export function isAnyModalOpen() {
  return modalStack.length > 0;
}

/** Schließt den obersten Dialog; liefert true, wenn einer offen war. */
export function closeTopModal() {
  const top = modalStack[modalStack.length - 1];
  if (!top) return false;
  closeModal(top.backdrop);
  return true;
}

/** Klick auf den abgedunkelten Hintergrund schließt den Dialog. */
export function closeOnBackdropClick(backdrop, onClose = () => closeModal(backdrop)) {
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) onClose();
  });
}
