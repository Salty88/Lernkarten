/**
 * skript-text.js
 *
 * Skripte im einfachen Textformat, in beide Richtungen:
 *
 *   Fach: ReWe
 *   Titel: Grundlagen des Rechnungswesens
 *   Teil: Teil 1
 *
 *   ## Aufgaben des Rechnungswesens (Folien 1 bis 6)
 *   Freier Text mit Absätzen, „- “-Aufzählungen und **fett**.
 *   ### Zwischenüberschrift
 *   Weiterer Text.
 *
 *   ## Nächstes Kapitel
 *   …
 *
 * Text vor dem ersten „## “ wird zum Kapitel „Überblick“.
 */

import { norm } from './ui.js';
import { fachKey } from './wissen-data.js';

export const SKRIPT_TEXT_VORLAGE = `Fach: ReWe
Titel: Grundlagen des Rechnungswesens
Teil: Teil 1

## Aufgaben des Rechnungswesens (Folien 1 bis 6)
Das Rechnungswesen erfasst alle Geld- und Leistungsströme eines Unternehmens.

Es hat vier Aufgaben:
- **Dokumentation:** alle Geschäftsfälle lückenlos festhalten
- **Kontrolle:** Wirtschaftlichkeit laufend prüfen
- **Planung:** Zahlen als Grundlage für Entscheidungen
- **Rechenschaft:** Informationen für Eigentümer, Banken und Finanzamt

## Externes und internes Rechnungswesen (Folien 7 bis 12)
### Externes Rechnungswesen
Richtet sich an Außenstehende und folgt gesetzlichen Vorschriften (Folie 8).

### Internes Rechnungswesen
Dient der Steuerung im Unternehmen. Die Kosten- und Leistungsrechnung (KLR) ist frei gestaltbar.
`;

const HEAD = { id: 'id', fach: 'fach', titel: 'titel', teil: 'teil' };

function slug(text) {
  return norm(text).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function clean(text) {
  return String(text || '').replace(/\n{3,}/g, '\n\n').trim();
}

/** Ist das ein Skript im Textformat (und kein JSON)? */
export function looksLikeSkriptText(text) {
  const t = text.trim();
  return Boolean(t) && !t.startsWith('{') && !t.startsWith('[');
}

/**
 * Wandelt den Text in ein Skript-Objekt (Rohdaten wie aus einer JSON-Datei).
 * @param {string} text
 * @param {{ id?: string }} [options]  feste ID, z. B. beim Bearbeiten
 * @throws {Error} mit verständlicher Meldung
 */
export function textToSkript(text, options = {}) {
  const head = {};
  const kapitel = [];
  let current = null;
  let inHead = true;

  for (const rawLine of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.replace(/\s+$/, '');
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      inHead = false;
      let titel = heading[1].trim();
      let folien = '';
      const f = titel.match(/^(.*?)\s*\(((?:Folie|Folien|Seite|Seiten|S\.)[^)]*)\)\s*$/i);
      if (f) [titel, folien] = [f[1].trim(), f[2].trim()];
      current = { titel, folien, lines: [] };
      kapitel.push(current);
      continue;
    }
    if (inHead) {
      const field = line.match(/^\s*([A-Za-zÄÖÜäöüß]{2,10}):\s*(.*)$/);
      const key = field && HEAD[norm(field[1])];
      if (key) {
        head[key] = field[2].trim();
        continue;
      }
      if (!line.trim() && !current) continue;
      if (!current) {
        current = { titel: 'Überblick', folien: '', lines: [] };
        kapitel.push(current);
      }
    }
    // „### Zwischenüberschrift“ wird als fetter Absatz dargestellt
    const sub = line.match(/^###\s+(.+)$/);
    current.lines.push(sub ? `**${sub[1].trim()}**` : line);
  }

  const titel = clean(head.titel);
  if (!clean(head.fach)) throw new Error('Im Text fehlt die Zeile „Fach: …“ (z. B. „Fach: ReWe“).');
  if (!titel) throw new Error('Im Text fehlt die Zeile „Titel: …“.');
  const filled = kapitel.map((k) => ({ ...k, text: clean(k.lines.join('\n')) })).filter((k) => k.text || k.titel !== 'Überblick');
  if (!filled.length) throw new Error('Im Text fehlt Inhalt. Beginne ein Kapitel mit „## Titel“ und schreibe den Text darunter.');

  const fach = fachKey(clean(head.fach));
  const teil = clean(head.teil);
  const id = options.id || slug(clean(head.id)) || slug(`${fach.replace(/^x:/, '')}-${titel}${teil ? `-${teil}` : ''}`);
  return {
    schema: 1,
    id,
    fach: fach.startsWith('x:') ? clean(head.fach) : fach,
    titel,
    teil,
    kapitel: filled.map((k, i) => ({ id: `k${i + 1}`, titel: k.titel, folien: k.folien, text: k.text })),
  };
}

/** Wandelt ein gespeichertes Skript zurück in Text (zum Bearbeiten). */
export function skriptToText(skript, fachText) {
  const lines = [`Fach: ${fachText}`, `Titel: ${skript.titel}`];
  if (skript.teil) lines.push(`Teil: ${skript.teil}`);
  for (const k of skript.kapitel) {
    lines.push('', `## ${k.titel}${k.folien ? ` (${k.folien})` : ''}`);
    // fette Zeilen, die allein stehen, waren Zwischenüberschriften
    lines.push(k.text.replace(/^\*\*([^*\n]+)\*\*$/gm, '### $1'));
  }
  return `${lines.join('\n')}\n`;
}
