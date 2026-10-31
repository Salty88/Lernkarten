/**
 * fach-sheet.js
 *
 * Fach-Auswahl als Blatt von unten: Liste aller Fächer mit Symbol und Anzahl.
 * Wird von „Üben“ genutzt (später auch von „Erstellen“ und „Wissen“); jeder
 * Reiter liefert eigene Einträge und reagiert selbst auf die Auswahl.
 */

import { el, button, openModal, closeModal, closeOnBackdropClick } from './ui.js';

const ICONS = { __all__: '🌐', 'vwl-bwl': '📈', rewe: '🧾', 'fi-inv': '💶', mpa: '🏭', org: '🧭', pm: '👥', ikt: '💻' };

/** @typedef {{ key: string, kurz: string, name: string, count: number, empty: boolean }} FachOption */

let open = null; // { title, getOptions, current, onPick }

const $ = (id) => document.getElementById(id);

export function fachIcon(key) {
  return ICONS[key] || '📁';
}

function render() {
  if (!open) return;
  $('fach-sheet-title').textContent = open.title;
  $('fach-sheet-list').replaceChildren(
    ...open.getOptions().map((o) => {
      const active = o.key === open.current;
      const item = button(`sheet-option${active ? ' is-active' : ''}${o.empty ? ' is-empty' : ''}`, null, () => pick(o.key));
      item.dataset.key = o.key;
      item.setAttribute('aria-pressed', String(active));
      const name = o.name && o.name !== o.kurz ? `${o.kurz} · ${o.name}` : o.kurz;
      item.append(el('span', 'sheet-icon', fachIcon(o.key)), el('span', 'sheet-name', name), el('span', 'sheet-count', String(o.count)));
      return item;
    }),
  );
}

function pick(key) {
  const { onPick } = open;
  close();
  onPick(key);
}

function close() {
  open = null;
  closeModal($('fach-sheet'));
}

/**
 * Öffnet das Blatt.
 * @param {{ title: string, getOptions: () => FachOption[], current: string, onPick: (key: string) => void }} args
 */
export function openFachSheet({ title, getOptions, current, onPick }) {
  open = { title, getOptions, current, onPick };
  render();
  const active = $('fach-sheet-list').querySelector('.is-active');
  openModal($('fach-sheet'), active);
}

/** Zeichnet die Liste neu, wenn das Blatt offen ist (z. B. nach einem Sync). */
export function refreshFachSheet() {
  if (open && !$('fach-sheet').hidden) render();
}

export function initFachSheet() {
  closeOnBackdropClick($('fach-sheet'), close);
  // Escape schließt über den gemeinsamen Dialog-Stapel; danach Zustand aufräumen
  new MutationObserver(() => {
    if ($('fach-sheet').hidden) open = null;
  }).observe($('fach-sheet'), { attributes: true, attributeFilter: ['hidden'] });
}
