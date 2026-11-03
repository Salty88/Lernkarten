/**
 * merker-text.js
 *
 * Wandelt einen Merker im einfachen Textformat in das JSON-Format der App um.
 * So lassen sich neue Inhalte ohne JSON-Kenntnisse schreiben oder einfügen.
 *
 * Aufbau (alle Angaben außer Fach und Titel sind freiwillig):
 *
 *   Fach: ReWe
 *   Titel: Abschreibungen
 *
 *   ## Lineare Abschreibung (Folien 40 bis 43)
 *   Begriffe:
 *   - Lineare Abschreibung: Jedes Jahr derselbe Betrag. | AHK geteilt durch Nutzungsdauer.
 *   Kernaussage: Abschreibung verteilt den Wertverlust auf die Nutzungsdauer.
 *
 * Eine Zeile „Schlüssel: Wert“ beginnt ein Feld; folgende Zeilen gehören dazu,
 * bis das nächste bekannte Feld oder „## “ (neues Thema) kommt.
 */

import { norm } from './ui.js';
import { fachKey } from './wissen-data.js';

/** Felder im Kopf des Merkers. */
const HEAD_FIELDS = {
  id: 'id',
  fach: 'fach',
  titel: 'titel',
  teil: 'teil',
  kontext: 'kontext',
  skript: 'skript',
  aufbau: 'aufbau',
  pruefungsrahmen: 'pruefungsrahmen',
};

/** Felder in einem Thema (Miniblock); Schlüssel sind normalisiert (ohne Umlaute, klein). */
const BLOCK_FIELDS = {
  folien: 'folien',
  wann: 'wann',
  wofur: 'wofuer',
  wofuer: 'wofuer',
  warum: 'warum',
  verknupfung: 'verknuepfung',
  verknuepfung: 'verknuepfung',
  begriffe: 'glossar',
  glossar: 'glossar',
  prufung: 'pruefung',
  pruefung: 'pruefung',
  prufungsbezug: 'pruefung',
  pruefungsbezug: 'pruefung',
  zuordnung: 'zuordnung',
  zuordnungen: 'zuordnung',
  tabelle: 'tabelle',
  nachtrag: 'nachtrag',
  aussagen: 'aussagen',
  managementsprache: 'uebersetzungen',
  ubersetzungen: 'uebersetzungen',
  uebersetzungen: 'uebersetzungen',
  musterfrage: 'musterfrage',
  musterhinweis: 'musterhinweis',
  musterantwort: 'musterantwort',
  kernaussage: 'kernaussage',
  feynman: 'feynman',
  muss: 'muss',
  abweichungen: 'abweichungen',
};

/** Felder, die überall stehen dürfen und zum ganzen Merker gehören. */
const SHARED_FIELDS = {
  abkurzungen: 'abkuerzungen',
  abkuerzungen: 'abkuerzungen',
  quellen: 'quellen',
  hinweis: 'hinweis',
};

const SINGLE_LINE = new Set(['id', 'fach', 'titel', 'teil']);
const LIST_FIELDS = new Set(['glossar', 'zuordnung', 'aussagen', 'uebersetzungen', 'muss', 'abweichungen', 'abkuerzungen', 'quellen']);
const DEVIATION_TYPES = ['Korrektur', 'Lücke', 'Ergänzung', 'Hinweis', 'OK'];

export const MERKER_TEXT_VORLAGE = `Fach: ReWe
Titel: Abschreibungen
Skript: Folien 40 bis 46

Abkürzungen:
- AfA: Absetzung für Abnutzung

## Lineare und degressive Abschreibung (Folien 40 bis 43)
Wann: Beim Kauf einer Maschine, die mehrere Jahre genutzt wird.
Wofür: Der Wertverlust wird auf die Nutzungsjahre verteilt.
Warum: Sonst wäre der Gewinn im Kaufjahr zu niedrig.

Begriffe:
- Lineare Abschreibung: Jedes Jahr derselbe Betrag (Folie 41). | AHK geteilt durch Nutzungsdauer.
- Degressive Abschreibung: Fester Prozentsatz vom Restbuchwert. | Anfangs hohe, später niedrige Beträge.

Prüfung: Abschreibungsbetrag und Restbuchwert berechnen.
Zuordnung:
- Gleicher Betrag jedes Jahr = Lineare Abschreibung
- Prozentsatz vom Restbuchwert = Degressive Abschreibung

Managementsprache:
- Die Maschine kostet uns jedes Jahr 2.000 € -> Der Werteverzehr mindert den Gewinn, nicht die Liquidität.

Musterfrage: Warum wird eine Maschine nicht im Kaufjahr voll als Aufwand gebucht?
Musterantwort: Weil sie mehrere Jahre genutzt wird. Die Abschreibung verteilt den Aufwand auf diese Jahre.

Kernaussage: Abschreibung verteilt den Wertverlust einer Anlage auf ihre Nutzungsdauer.
Feynman: Erkläre einem Freund, warum ein Unternehmen trotz teurer Maschine Gewinn machen kann.
Muss:
- Verteilung auf Nutzungsjahre
- Aufwand ist nicht gleich Auszahlung

## Nächstes Thema
Begriffe:
- Restbuchwert: Wert der Anlage nach den bisherigen Abschreibungen.
`;

function keyOf(label) {
  return norm(label).replace(/[^a-z]/g, '');
}

/** Schlüssel einheitlich normalisieren (norm behandelt z. B. „ue“ wie „ü“). */
function byKey(map) {
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [keyOf(k), v]));
}
const HEAD = byKey(HEAD_FIELDS);
const BLOCK = byKey(BLOCK_FIELDS);
const SHARED = byKey(SHARED_FIELDS);
const HINWEIS = keyOf('hinweis');

function slug(text) {
  return norm(text).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

/** Trennt „links Trenner rechts“ beim ersten passenden Trenner. */
function splitPair(text, separators) {
  for (const sep of separators) {
    const i = text.indexOf(sep);
    if (i > 0) return [text.slice(0, i).trim(), text.slice(i + sep.length).trim()];
  }
  return [text.trim(), ''];
}

function newBlock(titel, folien) {
  return { titel, folien, fields: {}, order: [] };
}

/**
 * Liest den Text in Felder: Kopf, gemeinsame Felder und Themen.
 * Liefert außerdem Zeilen, die keinem Feld zugeordnet werden konnten.
 */
function scan(text) {
  const head = {};
  const shared = { abkuerzungen: [], quellen: [], hinweis: '' };
  const blocks = [];
  const unassigned = [];
  let target = null; // { kind: 'head'|'shared'|'block', field, list?: true }
  let block = null;

  const append = (line) => {
    if (!target) {
      if (line.trim()) unassigned.push(line.trim());
      return;
    }
    const store = target.kind === 'head' ? head : target.kind === 'shared' ? shared : block.fields;
    const { field } = target;
    if (LIST_FIELDS.has(field)) {
      const list = store[field] || (store[field] = []);
      const item = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
      if (item) list.push(item[1].trim());
      else if (line.trim() && list.length) list[list.length - 1] += ` ${line.trim()}`;
      else if (line.trim()) list.push(line.trim());
      return;
    }
    if (field === 'tabelle') {
      if (line.includes('|')) (store.tabelleZeilen || (store.tabelleZeilen = [])).push(line);
      else if (line.trim()) store.tabelle = store.tabelle ? `${store.tabelle} ${line.trim()}` : line.trim();
      return;
    }
    const prev = store[field] || '';
    store[field] = prev ? `${prev}\n${line}` : line;
    // Fach, Titel, Teil und ID sind einzeilig: die nächste Zeile gehört nicht mehr dazu
    if (target.kind === 'head' && SINGLE_LINE.has(field) && line.trim()) target = null;
  };

  for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.replace(/\s+$/, '');

    const heading = line.match(/^#{2,3}\s+(.+)$/);
    if (heading) {
      let titel = heading[1].trim();
      let folien = '';
      const f = titel.match(/^(.*?)\s*\(((?:Folie|Folien|Seite|Seiten|S\.)[^)]*)\)\s*$/i);
      if (f) [titel, folien] = [f[1].trim(), f[2].trim()];
      block = newBlock(titel, folien);
      blocks.push(block);
      target = null;
      continue;
    }

    const field = line.match(/^\s*([A-Za-zÄÖÜäöüß ]{2,30}):\s*(.*)$/);
    if (field) {
      const k = keyOf(field[1]);
      const rest = field[2];
      let next = null;
      if (k === HINWEIS && block) next = { kind: 'block', field: 'musterhinweis' };
      else if (SHARED[k]) next = { kind: 'shared', field: SHARED[k] };
      else if (block && BLOCK[k]) next = { kind: 'block', field: BLOCK[k] };
      else if (!block && HEAD[k]) next = { kind: 'head', field: HEAD[k] };
      else if (!block && BLOCK[k]) {
        // Inhalt ohne „## “: ein Thema mit dem Titel des Merkers
        block = newBlock('', '');
        blocks.push(block);
        next = { kind: 'block', field: BLOCK[k] };
      }
      if (next) {
        target = next;
        if (rest.trim()) append(rest);
        continue;
      }
    }
    append(line);
  }
  return { head, shared, blocks, unassigned };
}

function clean(text) {
  return String(text || '').replace(/\n{3,}/g, '\n\n').trim();
}

function buildTable(f) {
  const rows = (f.tabelleZeilen || [])
    .map((line) => line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim()))
    .filter((cells) => !cells.every((c) => /^:?-{2,}:?$/.test(c) || c === ''));
  if (!rows.length) return null;
  const [spalten, ...zeilen] = rows;
  return { titel: clean(f.tabelle), spalten, zeilen };
}

function buildBlock(b, index, merkerTitel) {
  const f = b.fields;
  const block = {
    id: String.fromCharCode(65 + index),
    titel: b.titel || merkerTitel,
    folien: clean(f.folien) || b.folien,
    praxis: { wann: clean(f.wann), wofuer: clean(f.wofuer), warum: clean(f.warum), verknuepfung: clean(f.verknuepfung) },
    glossar: (f.glossar || []).map((item) => {
      const [begriff, rest] = splitPair(item, [':', ' = ', ' – ', ' - ']);
      const [kurz, funktion] = splitPair(rest, [' | ']);
      return { begriff, kurz, funktion, synonyme: [], kuerzel: [] };
    }).filter((g) => g.begriff),
    pruefung: {
      text: clean(f.pruefung),
      zuordnung: (f.zuordnung || []).map((item) => {
        const [frage, antwort] = splitPair(item, [' = ', ' -> ', ' → ', ': ']);
        return { frage, antwort };
      }),
      tabelle: buildTable(f),
      nachtrag: clean(f.nachtrag),
    },
    management: {
      aussagen: f.aussagen || [],
      uebersetzungen: (f.uebersetzungen || []).map((item) => {
        const [halle, management] = splitPair(item, [' -> ', ' → ', ' => ', ' = ']);
        return { halle, management };
      }),
      musterantwort: f.musterfrage || f.musterantwort
        ? { frage: clean(f.musterfrage), hinweis: clean(f.musterhinweis), antwort: clean(f.musterantwort) }
        : null,
    },
    abschluss: {
      kernaussage: clean(f.kernaussage),
      ...(f.feynman ? { feynman: { aufgabe: clean(f.feynman), muss: f.muss || [] } } : {}),
    },
    abweichungen: (f.abweichungen || []).map((item) => {
      const [typ, text] = splitPair(item, [':']);
      const known = DEVIATION_TYPES.find((t) => norm(t) === norm(typ));
      return known ? { typ: known, text } : { typ: 'Hinweis', text: item };
    }),
  };
  return block;
}

/** Ist der Text ein Merker im Textformat (und kein JSON)? */
export function looksLikeMerkerText(text) {
  const t = text.trim();
  return Boolean(t) && !t.startsWith('{') && !t.startsWith('[');
}

/**
 * Wandelt den Text in ein Merker-Objekt (Rohdaten wie aus einer JSON-Datei).
 * @returns {{ raw: object, unassigned: string[] }}
 * @throws {Error} mit verständlicher Meldung
 */
export function textToMerker(text) {
  const { head, shared, blocks, unassigned } = scan(text);
  const titel = clean(head.titel);
  if (!clean(head.fach)) throw new Error('Im Text fehlt die Zeile „Fach: …“ (z. B. „Fach: ReWe“).');
  if (!titel) throw new Error('Im Text fehlt die Zeile „Titel: …“.');
  if (!blocks.length) throw new Error('Im Text fehlt Inhalt. Beginne ein Thema mit „## Titel“ oder schreibe z. B. „Begriffe:“.');

  const fach = fachKey(clean(head.fach));
  const id = slug(clean(head.id)) || slug(`${fach.replace(/^x:/, '')}-${titel}`);
  const raw = {
    schema: 1,
    id,
    fach: fach.startsWith('x:') ? clean(head.fach) : fach,
    titel,
    teil: clean(head.teil),
    kontext: clean(head.kontext),
    skript: clean(head.skript),
    aufbau: clean(head.aufbau),
    pruefungsrahmen: clean(head.pruefungsrahmen),
    hinweis: clean(shared.hinweis),
    abkuerzungen: shared.abkuerzungen.map((item) => {
      const [kurz, lang] = splitPair(item, [':', ' = ', ' – ', ' - ']);
      return { kurz, lang };
    }),
    bloecke: blocks.map((b, i) => buildBlock(b, i, titel)),
    quellen: shared.quellen.map((item) => {
      const url = (item.match(/https:\/\/\S+/) || [''])[0];
      const label = item.replace(url, '').replace(/\s*\|\s*/g, ' ').replace(/\s+/g, ' ').trim();
      return { text: label || url, url };
    }),
  };
  return { raw, unassigned };
}
