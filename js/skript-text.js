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

/* ------------------------------------------------------------------ */
/* Text aus PDFs aufräumen                                             */
/* ------------------------------------------------------------------ */

/** Wörter, nach denen ein Satz nie endet: Zeile danach gehört noch dazu. */
const JOIN_AFTER = new Set(
  'der die das den dem des ein eine einer einen einem eines und oder sowie bzw von vom zu zur zum mit im in ins auf an am bei für über unter durch gegen ohne um aus nach vor zwischen als wie wenn dass ob sich nicht auch sehr'.split(' '),
);
const BULLET = /^\s*(?:[-–—•●▪◦‣∙·*]|\d+[.)])\s*/;
const SENTENCE_END = /[.!?:;]$/;

const isBullet = (line) => /^- /.test(line);
const isMarked = (line) => /^(###\s|Beispiel:|Merksatz:|Merke:|\|)/i.test(line);

/** Satzzeichen und Abkürzungen: fehlende Leerzeichen ergänzen, doppelte entfernen. */
function fixSpacing(line) {
  return line
    .replace(/\bz\.\s?B\.\s?/g, 'z. B. ')
    .replace(/\bd\.\s?h\.\s?/g, 'd. h. ')
    .replace(/\bu\.\s?a\.\s?/g, 'u. a. ')
    .replace(/,(?=[A-Za-zÄÖÜäöüß])/g, ', ')
    .replace(/\s+([,.;:!?)])/g, '$1')
    .replace(/[ \t ]{2,}/g, ' ')
    .replace(/ +$/, '')
    .trim();
}

/**
 * Räumt kopierten PDF-Text auf:
 *  - Aufzählungszeichen (•, –, -, 1.) einheitlich als „- “
 *  - Silbentrennung und mitten im Satz umgebrochene Zeilen zusammenführen
 *  - fehlende Leerzeichen nach Komma und in „z. B.“ ergänzen
 *  - kurze Zeile direkt vor einer Aufzählung wird Zwischenüberschrift („### “)
 *  - „Beispiel:“ als eigene Zeile, „##Text“ wird Merksatz
 * Die erste Zeile wird als Kapitel-Titel vorgeschlagen, wenn sie allein steht.
 * @returns {{ text: string, titel: string }}
 */
export function cleanPdfText(input) {
  const raw = String(input || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[­​]/g, '')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''));

  // 1. Zeilen vereinheitlichen
  let lines = raw.map((line) => {
    let t = line.trim();
    if (!t) return '';
    if (/^#{2}(?!#)\s*\S/.test(t)) return `Merksatz: ${fixSpacing(t.replace(/^##\s*/, ''))}`;
    if (/^#{3,}\s*/.test(t)) return `### ${fixSpacing(t.replace(/^#{3,}\s*/, ''))}`;
    if (BULLET.test(t) && !/^\d+[.,]\d/.test(t)) {
      t = t.replace(BULLET, '');
      if (/^Beispiel:/i.test(t)) return fixSpacing(t);
      return `- ${fixSpacing(t)}`;
    }
    return fixSpacing(t);
  });

  // 2. Umgebrochene Zeilen zusammenführen
  const joined = [];
  for (const line of lines) {
    const prev = joined[joined.length - 1];
    if (prev && line && !isMarked(line) && !/^###\s/.test(prev) && !SENTENCE_END.test(prev)) {
      const lastWord = (prev.match(/([A-Za-zÄÖÜäöüß]+)-?$/) || ['', ''])[1].toLowerCase();
      const content = line.replace(/^- /, '');
      const hyphen = /[a-zäöüß]-$/.test(prev) && /^[a-zäöüß]/.test(content);
      // Satz läuft weiter: Zeile endet mit Bindewort, „&“, Komma oder offener Klammer
      const afterJoinWord = JOIN_AFTER.has(lastWord) || /[&,(/+]$/.test(prev);
      // Neuer Aufzählungspunkt bleibt eigenständig, außer der vorige endet mitten im Satz („der“)
      const newItem = isBullet(line) && !afterJoinWord;
      if (!newItem && (hyphen || afterJoinWord || /^[a-zäöüß]/.test(content))) {
        joined[joined.length - 1] = hyphen ? `${prev.slice(0, -1)}${content}` : `${prev} ${content}`;
        continue;
      }
    }
    joined.push(line);
  }
  lines = joined;

  // 3. Zwischenüberschriften: kurze Zeile ohne Satzende direkt vor einer Aufzählung
  const nextFilled = (i) => {
    for (let j = i + 1; j < lines.length; j++) if (lines[j]) return lines[j];
    return '';
  };
  lines = lines.map((line, i) => {
    if (!line || isBullet(line) || isMarked(line)) return line;
    const short = line.length <= 70 && !/[.!:;,]$/.test(line);
    return short && isBullet(lines[i + 1] || '') ? `### ${line}` : line;
  });

  // 4. Erste Zeile allein (danach Leerzeile) als Titel vorschlagen
  let titel = '';
  const first = lines.findIndex((l) => l);
  if (first !== -1) {
    const line = lines[first];
    const after = nextFilled(first);
    if (!isBullet(line) && !isMarked(line) && line.length <= 60 && !/[.!?:;,]$/.test(line) && lines[first + 1] === '' && after) {
      titel = line;
      lines.splice(first, 1);
    }
  }

  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text, titel };
}
