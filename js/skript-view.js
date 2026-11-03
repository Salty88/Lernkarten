/**
 * skript-view.js
 *
 * Darstellung eines Skript-Kapitels mit Struktur:
 *   ### Zwischenüberschrift   → eigener Abschnitt (Kasten)
 *   - Punkt                    → Aufzählung
 *   Beispiel: …                → Beispiel-Kasten
 *   Merksatz: … / Merke: …     → hervorgehobener Merksatz
 *   | Spalte | Spalte |        → Tabelle (erste Zeile = Kopf)
 *   sonst                      → Absatz (Leerzeile trennt)
 * Texte laufen immer über renderInline (fett, Folien, Begriffs-Links), nie über innerHTML.
 */

import { el } from './ui.js';
import { renderInline } from './richtext.js';

const EXAMPLE = /^Beispiel(?:e)?:\s*(.*)$/i;
const NOTE = /^(?:Merksatz|Merke|Fazit|Wichtig):\s*(.*)$/i;

function callout(kind, icon, label, text, ctx) {
  const box = el('div', `sk-callout sk-${kind}`);
  const head = el('span', 'sk-callout-label');
  head.append(el('span', 'sk-callout-icon', icon), document.createTextNode(label));
  const body = el('p', 'sk-callout-text');
  body.append(renderInline(text, ctx));
  box.append(head, body);
  return box;
}

function table(rows, ctx) {
  const cells = rows
    .map((line) => line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim()))
    .filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c) || c === ''));
  const scroller = el('div', 'table-scroll');
  const t = el('table', 'data-table');
  cells.forEach((row, i) => {
    const tr = el('tr');
    row.forEach((c) => {
      const cell = el(i === 0 ? 'th' : 'td');
      cell.append(renderInline(c, ctx));
      tr.append(cell);
    });
    if (i === 0) {
      const thead = el('thead');
      thead.append(tr);
      t.append(thead);
    } else {
      let tbody = t.querySelector('tbody');
      if (!tbody) {
        tbody = el('tbody');
        t.append(tbody);
      }
      tbody.append(tr);
    }
  });
  scroller.append(t);
  return scroller;
}

/** Zerlegt den Kapiteltext in Abschnitte: [{ titel, lines }]; der erste kann ohne Titel sein. */
export function skriptSections(text) {
  const sections = [{ titel: '', lines: [] }];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const h = raw.match(/^###\s+(.+)$/);
    if (h) sections.push({ titel: h[1].trim(), lines: [] });
    else sections[sections.length - 1].lines.push(raw);
  }
  return sections.filter((s) => s.titel || s.lines.some((l) => l.trim()));
}

/** Inhalt eines Abschnitts: Absätze, Listen, Beispiele, Merksätze, Tabellen. */
function renderBody(lines, ctx) {
  const box = el('div', 'sk-body');
  let paragraph = [];
  let list = null;
  let rows = [];

  const flush = () => {
    if (paragraph.length) {
      const p = el('p');
      p.append(renderInline(paragraph.join(' '), ctx));
      box.append(p);
      paragraph = [];
    }
    if (rows.length) {
      box.append(table(rows, ctx));
      rows = [];
    }
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    if (line.startsWith('|')) {
      if (paragraph.length || list) flush();
      rows.push(line);
      continue;
    }
    const bullet = line.match(/^[-•]\s+(.*)$/);
    const example = line.match(EXAMPLE);
    const note = line.match(NOTE);
    if (bullet) {
      if (paragraph.length || rows.length) flush();
      if (!list) {
        list = el('ul', 'sk-list');
        box.append(list);
      }
      const li = el('li');
      li.append(renderInline(bullet[1], ctx));
      list.append(li);
    } else if (example) {
      flush();
      box.append(callout('example', '💡', 'Beispiel', example[1], ctx));
    } else if (note) {
      flush();
      box.append(callout('note', '📌', 'Merksatz', note[1], ctx));
    } else {
      if (list || rows.length) flush();
      paragraph.push(line);
    }
  }
  flush();
  return box;
}

/**
 * Rendert den Text eines Kapitels: Einleitung (Text vor dem ersten „### “), dann die
 * Abschnitte als Kästen. Merksätze am Ende des letzten Abschnitts gelten fürs ganze
 * Kapitel und stehen deshalb unter den Kästen.
 */
export function renderSkriptText(text, ctx = {}) {
  const wrap = el('div', 'sk-text');
  const sections = skriptSections(text);
  const intro = sections[0] && !sections[0].titel ? sections.shift() : null;
  if (intro) wrap.append(renderBody(intro.lines, ctx));
  if (!sections.length) return wrap;

  const grid = el('div', `sk-sections${sections.length >= 2 ? ' sk-grid' : ''}`);
  for (const section of sections) {
    const card = el('section', 'sk-section');
    card.append(el('h4', 'sk-section-title', section.titel), renderBody(section.lines, ctx));
    grid.append(card);
  }
  wrap.append(grid);

  const lastBody = grid.lastElementChild.querySelector(':scope > .sk-body');
  const tail = [];
  while (lastBody.lastElementChild && lastBody.lastElementChild.classList.contains('sk-note')) {
    const note = lastBody.lastElementChild;
    note.remove();
    tail.unshift(note);
  }
  if (tail.length) {
    const box = el('div', 'sk-body sk-tail');
    box.append(...tail);
    wrap.append(box);
  }
  return wrap;
}

/** Kurzer Text für Vorschauen: Abschnittstitel oder erste Wörter. */
export function skriptTeaser(text, max = 3) {
  const titles = skriptSections(text).map((s) => s.titel).filter(Boolean);
  return titles.slice(0, max);
}
