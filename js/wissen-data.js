/**
 * wissen-data.js
 *
 * Datenschicht des Nachschlagewerks:
 *  - die sieben Fächer (Prüfungsbereiche)
 *  - Merker (merker/*.json) laden, prüfen und lokal zwischenspeichern
 *  - eigene Einträge (lernstoff.json) laden und konfliktsicher schreiben
 *  - Begriffsverzeichnis, automatische Verlinkung und Suche
 */

import {
  SyncError,
  dataDir,
  settingsTarget,
  getTextFile,
  putTextFile,
  listDirectory,
} from './github-sync.js';
import { el, norm } from './ui.js';
import { plainText } from './richtext.js';

const CACHE_KEY = 'lernkartei.wissen';
export const MERKER_SCHEMA = 1;

/* ------------------------------------------------------------------ */
/* Fächer                                                              */
/* ------------------------------------------------------------------ */

export const FAECHER = [
  { id: 'vwl-bwl', kurz: 'VWL/BWL', name: 'Aspekte der allgemeinen Volks- und Betriebswirtschaftslehre', alias: ['VWL', 'BWL', 'Volkswirtschaft', 'Betriebswirtschaft', 'VWL/BWL'] },
  { id: 'rewe', kurz: 'ReWe', name: 'Rechnungswesen', alias: ['ReWe', 'Rechnungswesen', 'KLR', 'Kostenrechnung', 'Buchführung', 'Finanzbuchhaltung'] },
  { id: 'fi-inv', kurz: 'FiInv', name: 'Finanzierung und Investition', alias: ['Finanzierung', 'Investition', 'FiInv'] },
  { id: 'mpa', kurz: 'MPA', name: 'Material-, Produktions- und Absatzwirtschaft', alias: ['MPA', 'Materialwirtschaft', 'Produktionswirtschaft', 'Absatzwirtschaft', 'Produktion', 'Absatz'] },
  { id: 'org', kurz: 'OrgUF', name: 'Organisation und Unternehmensführung', alias: ['Organisation', 'Unternehmensführung', 'OrgUF'] },
  { id: 'pm', kurz: 'PM', name: 'Personalmanagement', alias: ['Personal', 'Personalmanagement', 'PM'] },
  { id: 'ikt', kurz: 'IKT', name: 'Informations- und Kommunikationstechniken', alias: ['IKT', 'IT', 'Informationstechnik', 'Kommunikationstechnik'] },
];

const FACH_BY_ALIAS = new Map();
for (const fach of FAECHER) {
  for (const key of [fach.id, fach.kurz, fach.name, ...fach.alias]) FACH_BY_ALIAS.set(norm(key), fach);
}

/** Ordnet eine Fach-Angabe (ID, Kürzel oder Freitext) einem der sieben Fächer zu, sonst null. */
export function resolveFach(value) {
  const exact = FACH_BY_ALIAS.get(norm(value));
  if (exact) return exact;
  // Varianten wie „VWL - Rechtsformen“ oder „Rechnungswesen - ReWe“: erstes erkanntes Wort zählt
  for (const word of String(value || '').split(/[^\p{L}\p{N}]+/u)) {
    const fach = word && FACH_BY_ALIAS.get(norm(word));
    if (fach) return fach;
  }
  return null;
}

/** Schlüssel für Filter: Fach-ID oder "x:<Freitext>" für unbekannte Fächer. */
export function fachKey(value) {
  const fach = resolveFach(value);
  return fach ? fach.id : `x:${String(value || 'Sonstiges').trim()}`;
}

export function fachLabel(key) {
  const fach = FAECHER.find((f) => f.id === key);
  return fach ? fach.kurz : String(key).replace(/^x:/, '');
}

export function fachName(key) {
  const fach = FAECHER.find((f) => f.id === key);
  return fach ? fach.name : String(key).replace(/^x:/, '');
}

/* ------------------------------------------------------------------ */
/* Merker: Prüfung und Normalisierung                                   */
/* ------------------------------------------------------------------ */

const str = (value) => (value === undefined || value === null ? '' : String(value));
const strList = (value) => (Array.isArray(value) ? value.map(str).filter(Boolean) : []);
const objList = (value) => (Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : []);

function normTable(table) {
  if (!table || typeof table !== 'object') return null;
  const spalten = strList(table.spalten);
  const zeilen = Array.isArray(table.zeilen) ? table.zeilen.filter(Array.isArray).map((row) => row.map(str)) : [];
  return spalten.length || zeilen.length ? { titel: str(table.titel), spalten, zeilen } : null;
}

function normBlock(raw, index) {
  const praxis = raw.praxis || {};
  const pruefung = raw.pruefung || {};
  const management = raw.management || {};
  const abschluss = raw.abschluss || {};
  const feynman = abschluss.feynman || {};
  const muster = management.musterantwort || null;
  return {
    id: str(raw.id) || String.fromCharCode(65 + index),
    titel: str(raw.titel) || `Miniblock ${index + 1}`,
    folien: str(raw.folien),
    praxis: { wann: str(praxis.wann), wofuer: str(praxis.wofuer), warum: str(praxis.warum), verknuepfung: str(praxis.verknuepfung) },
    glossar: objList(raw.glossar)
      .map((g) => ({
        begriff: str(g.begriff).trim(),
        kurz: str(g.kurz),
        funktion: str(g.funktion),
        synonyme: strList(g.synonyme),
        kuerzel: strList(g.kuerzel),
      }))
      .filter((g) => g.begriff),
    pruefung: {
      text: str(pruefung.text),
      zuordnung: objList(pruefung.zuordnung).map((z) => ({ frage: str(z.frage), antwort: str(z.antwort) })),
      tabelle: normTable(pruefung.tabelle),
      nachtrag: str(pruefung.nachtrag),
    },
    management: {
      aussagen: strList(management.aussagen),
      uebersetzungen: objList(management.uebersetzungen).map((u) => ({ halle: str(u.halle), management: str(u.management) })),
      musterantwort: muster ? { frage: str(muster.frage), hinweis: str(muster.hinweis), antwort: str(muster.antwort) } : null,
    },
    abschluss: {
      kernaussage: str(abschluss.kernaussage),
      feynman: feynman.aufgabe ? { aufgabe: str(feynman.aufgabe), muss: strList(feynman.muss) } : null,
    },
    abweichungen: objList(raw.abweichungen).map((a) => ({ typ: str(a.typ) || 'Hinweis', text: str(a.text) })),
  };
}

/**
 * Prüft einen Merker und bringt ihn in eine verlässliche Form.
 * @throws {Error} mit verständlicher Meldung, wenn Pflichtangaben fehlen
 */
export function normalizeMerker(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Kein gültiger Merker (Objekt erwartet).');
  const id = str(raw.id).trim();
  if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(id)) {
    throw new Error('Die Merker-ID fehlt oder enthält ungültige Zeichen (erlaubt: a-z, 0-9, Bindestrich).');
  }
  if (!str(raw.titel).trim()) throw new Error(`Merker „${id}“: Titel fehlt.`);
  if (!Array.isArray(raw.bloecke) || raw.bloecke.length === 0) throw new Error(`Merker „${id}“: keine Miniblöcke enthalten.`);
  if (Number(raw.schema || MERKER_SCHEMA) > MERKER_SCHEMA) {
    throw new Error(`Merker „${id}“ nutzt ein neueres Format. Bitte die App aktualisieren.`);
  }

  return {
    schema: MERKER_SCHEMA,
    id,
    fach: fachKey(raw.fach),
    titel: str(raw.titel).trim(),
    teil: str(raw.teil),
    kontext: str(raw.kontext),
    skript: str(raw.skript),
    aufbau: str(raw.aufbau),
    pruefungsrahmen: str(raw.pruefungsrahmen),
    hinweis: str(raw.hinweis),
    abkuerzungen: objList(raw.abkuerzungen).map((a) => ({ kurz: str(a.kurz).trim(), lang: str(a.lang) })).filter((a) => a.kurz),
    tabellen: (Array.isArray(raw.tabellen) ? raw.tabellen : []).map(normTable).filter(Boolean),
    bloecke: raw.bloecke.filter((b) => b && typeof b === 'object').map(normBlock),
    korrekturen: objList(raw.korrekturen).map((k) => ({ id: str(k.id), text: str(k.text) })),
    quellen: objList(raw.quellen).map((q) => ({ text: str(q.text), url: /^https:\/\//.test(str(q.url)) ? str(q.url) : '' })),
  };
}

export function merkerStats(merker) {
  return {
    themen: merker.bloecke.length,
    begriffe: merker.bloecke.reduce((n, b) => n + b.glossar.length, 0),
  };
}

/* ------------------------------------------------------------------ */
/* Eigene Einträge (lernstoff.json, kompatibel zur Einzeldatei-Version) */
/* ------------------------------------------------------------------ */

export function normalizeEntry(raw) {
  const e = raw && typeof raw === 'object' ? raw : {};
  return {
    id: str(e.id) || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    fach: str(e.fach).trim(),
    titel: str(e.titel).trim(),
    stichworte: strList(e.stichworte),
    erklaerung: str(e.erklaerung),
    verstaendnis: str(e.verstaendnis),
    bilder: strList(e.bilder),
    erstellt: e.erstellt || null,
    geaendert: e.geaendert || null,
  };
}

/** Entwurf = nur Titel und Fach, noch ohne Inhalt. */
export function isDraft(entry) {
  return !entry.erklaerung.trim() && !entry.verstaendnis.trim() && entry.bilder.length === 0;
}

function parseEntries(text) {
  if (!text || !text.trim()) return [];
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SyncError('invalid', 'Die Datei lernstoff.json enthält kein gültiges JSON.');
  }
  if (!Array.isArray(parsed)) throw new SyncError('invalid', 'Die Datei lernstoff.json enthält keine Liste.');
  return parsed.map(normalizeEntry);
}

/* ------------------------------------------------------------------ */
/* Speicher                                                            */
/* ------------------------------------------------------------------ */

export const store = {
  merker: [], // normalisierte Merker
  merkerFiles: new Map(), // Pfad → { sha, data }
  eigene: [],
  eigeneSha: null,
  loaded: false,
  index: null, // Begriffsverzeichnis, siehe buildIndex()
};

export const paths = {
  merkerDir: (settings) => `${dataDir(settings)}merker/`,
  eigene: (settings) => `${dataDir(settings)}lernstoff.json`,
  images: (settings) => `${dataDir(settings)}images/`,
};

function readCache(settings) {
  try {
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    return cache && cache.target === settingsTarget(settings) ? cache : null;
  } catch {
    return null;
  }
}

function writeCache(settings) {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        target: settingsTarget(settings),
        merker: [...store.merkerFiles.entries()],
        eigene: store.eigene,
        eigeneSha: store.eigeneSha,
      }),
    );
  } catch {
    /* Speicher voll oder blockiert: Daten bleiben für diese Sitzung im Arbeitsspeicher */
  }
}

export function clearWissenCache() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* nichts zu tun */
  }
}

function rebuildMerkerList() {
  const list = [];
  for (const { data } of store.merkerFiles.values()) {
    try {
      list.push(normalizeMerker(data));
    } catch {
      /* fehlerhafte Datei überspringen, statt alles zu blockieren */
    }
  }
  const fachOrder = (m) => {
    const i = FAECHER.findIndex((f) => f.id === m.fach);
    return i === -1 ? 99 : i;
  };
  list.sort((a, b) => fachOrder(a) - fachOrder(b) || a.id.localeCompare(b.id, 'de', { numeric: true }));
  store.merker = list;
  store.index = buildIndex();
  announceChange();
}

/** Teilt anderen Ansichten (Lernkarten, Lücken) mit, dass sich das Wissen geändert hat. */
function announceChange() {
  document.dispatchEvent(new CustomEvent('wissen:changed'));
}

/** Stellt den zuletzt geladenen Stand dieses Geräts wieder her (offline lesbar). */
export function restoreWissen(settings) {
  store.merkerFiles = new Map();
  store.eigene = [];
  store.eigeneSha = null;
  const cache = readCache(settings);
  if (cache) {
    store.merkerFiles = new Map(Array.isArray(cache.merker) ? cache.merker : []);
    store.eigene = Array.isArray(cache.eigene) ? cache.eigene.map(normalizeEntry) : [];
    store.eigeneSha = cache.eigeneSha || null;
  }
  rebuildMerkerList();
}

/**
 * Lädt Merker und eigene Einträge von GitHub. Unveränderte Merker (gleiche SHA)
 * werden nicht erneut heruntergeladen.
 * @returns {Promise<{fehler: string[]}>} Dateien, die nicht gelesen werden konnten
 */
export async function loadWissen(settings) {
  const fehler = [];
  const listing = await listDirectory(settings, paths.merkerDir(settings));
  const files = listing.filter((f) => f.type === 'file' && f.name.endsWith('.json'));
  const next = new Map();

  for (const file of files) {
    const cached = store.merkerFiles.get(file.path);
    if (cached && cached.sha === file.sha) {
      next.set(file.path, cached);
      continue;
    }
    const { text, sha } = await getTextFile(settings, file.path);
    try {
      const data = JSON.parse(text || '');
      normalizeMerker(data); // nur prüfen
      next.set(file.path, { sha, data });
    } catch (err) {
      fehler.push(`${file.name}: ${err.message}`);
    }
  }
  store.merkerFiles = next;

  const eigene = await getTextFile(settings, paths.eigene(settings));
  store.eigene = parseEntries(eigene.text);
  store.eigeneSha = eigene.sha;
  store.loaded = true;

  rebuildMerkerList();
  writeCache(settings);
  return { fehler };
}

/** Schreibt einen importierten Merker nach merker/<id>.json. */
export async function saveMerker(settings, merker, rawData) {
  const path = `${paths.merkerDir(settings)}${merker.id}.json`;
  const existing = store.merkerFiles.get(path);
  const text = `${JSON.stringify(rawData, null, 2)}\n`;
  const message = `${existing ? 'Merker aktualisiert' : 'Merker importiert'}: ${merker.titel}`;
  let sha;
  try {
    sha = await putTextFile(settings, path, text, existing ? existing.sha : null, message);
  } catch (err) {
    if (!(err instanceof SyncError) || err.code !== 'conflict') throw err;
    const current = await getTextFile(settings, path); // frische SHA holen und einmal wiederholen
    sha = await putTextFile(settings, path, text, current.sha, message);
  }
  store.merkerFiles.set(path, { sha, data: rawData });
  rebuildMerkerList();
  writeCache(settings);
}

export function merkerPathExists(settings, id) {
  return store.merkerFiles.has(`${paths.merkerDir(settings)}${id}.json`);
}

/**
 * Ändert die eigenen Einträge konfliktsicher: aktuellen Stand lesen, Änderung
 * anwenden, schreiben. War ein anderes Gerät schneller, wird einmal wiederholt.
 */
export async function commitEigene(settings, mutate, message) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const current = await getTextFile(settings, paths.eigene(settings));
    const entries = mutate(parseEntries(current.text));
    try {
      const sha = await putTextFile(settings, paths.eigene(settings), `${JSON.stringify(entries, null, 2)}\n`, current.sha, message);
      store.eigene = entries;
      store.eigeneSha = sha;
      store.index = buildIndex();
      writeCache(settings);
      announceChange();
      return;
    } catch (err) {
      if (err instanceof SyncError && err.code === 'conflict' && attempt === 0) continue;
      throw err;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Begriffsverzeichnis                                                 */
/* ------------------------------------------------------------------ */

const MIN_KEY_LENGTH = 3;
const WORD_SUFFIX = '(?:s|es|e|n|en|er|ern)?';

/**
 * Leitet die Suchschlüssel eines Glossar-Begriffs ab:
 * "Auszahlung / Einzahlung" → beide Wörter, "Bilanz (Stichtag)" → ohne Klammer,
 * plus Synonyme. Paare wie "Sachliche / rechnerische Rechnungsprüfung" werden nicht zerlegt.
 */
function termKeys(begriff, synonyme) {
  const base = begriff.replace(/\s*\([^)]*\)/g, '').trim();
  const keys = new Set(synonyme);
  if (!/\svs\.\s/.test(base)) {
    const parts = base.split(/\s+\/\s+/).map((p) => p.trim()).filter(Boolean);
    const splittable = parts.every((p) => /^[A-ZÄÖÜ]/.test(p));
    (splittable ? parts : [base]).forEach((p) => keys.add(p));
  }
  return [...keys].filter((k) => k.length >= MIN_KEY_LENGTH);
}

/**
 * Baut das Verzeichnis aller Begriffe, Kürzel und Fundstellen.
 * Jeder Begriff: { id, begriff, kurz, funktion, fach, merker, block, keys, kuerzel }
 */
function buildIndex() {
  const terms = [];
  const abbreviations = [];

  for (const merker of store.merker) {
    for (const block of merker.bloecke) {
      block.glossar.forEach((g, i) => {
        terms.push({
          id: `${merker.id}#${block.id}#${i}`,
          begriff: g.begriff,
          kurz: g.kurz,
          funktion: g.funktion,
          fach: merker.fach,
          merker,
          block,
          keys: termKeys(g.begriff, g.synonyme),
          kuerzel: g.kuerzel,
          synonyme: g.synonyme,
        });
      });
    }
    for (const abk of merker.abkuerzungen) {
      abbreviations.push({ id: `${merker.id}@${abk.kurz}`, kurz: abk.kurz, lang: abk.lang, fach: merker.fach, merker });
    }
  }

  // Eigene Einträge (ohne Entwürfe) werden ebenfalls verlinkt: Titel, Kürzel in Klammern
  // und Stichworte, die im Titel vorkommen (z. B. „Leerkosten“ in „Leerkosten und Nutzkosten“)
  const entries = [];
  for (const entry of store.eigene) {
    if (!entry.titel || isDraft(entry)) continue;
    const kuerzel = [...entry.titel.matchAll(/\(([A-ZÄÖÜ][A-Za-zÄÖÜäöü]{1,6})\)/g)]
      .map((m) => m[1])
      .filter((k) => (k.match(/[A-ZÄÖÜ]/g) || []).length >= 2);
    const inTitle = entry.stichworte.filter((w) => !kuerzel.includes(w) && norm(entry.titel).includes(norm(w)));
    entries.push({ id: `e:${entry.id}`, eigen: true, entry, titel: entry.titel, fach: fachKey(entry.fach), merker: null, keys: termKeys(entry.titel, inTitle), kuerzel });
  }

  // Schlüssel → Kandidaten (mehrere bei gleichen Begriffen in verschiedenen Fächern)
  const byKey = new Map();
  const caseSensitive = new Map();
  const add = (map, key, target) => {
    const k = map === byKey ? key.toLowerCase() : key;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(target);
  };
  for (const term of terms) {
    term.keys.forEach((k) => add(byKey, k, term));
    term.kuerzel.forEach((k) => add(caseSensitive, k, term));
  }
  for (const abk of abbreviations) {
    if (!caseSensitive.has(abk.kurz)) add(caseSensitive, abk.kurz, abk);
  }
  // Merker-Begriffe haben Vorrang; eigene Einträge kommen als weitere Kandidaten dazu
  for (const item of entries) {
    item.keys.forEach((k) => add(byKey, k, item));
    item.kuerzel.forEach((k) => {
      if (!caseSensitive.has(k)) add(caseSensitive, k, item);
    });
  }

  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const allKeys = [...new Set([...byKey.keys(), ...caseSensitive.keys()])].sort((a, b) => b.length - a.length);
  const pattern = allKeys.length
    ? new RegExp(`(?<![\\p{L}\\p{N}])(${allKeys.map(escape).join('|')})${WORD_SUFFIX}(?![\\p{L}\\p{N}])`, 'giu')
    : null;

  return { terms, abbreviations, entries, byKey, caseSensitive, pattern };
}

/**
 * Wählt bei mehreren Kandidaten den passendsten: gleicher Merker, dann gleiches Fach.
 * Begriffe werden nur innerhalb des Fachs verlinkt (gleiches Wort, andere Bedeutung:
 * „Richtlinie“ ist in VWL ein EU-Rechtsakt, im Rechnungswesen eine Verwaltungsvorschrift).
 * Abkürzungen wie HGB oder KLR sind eindeutig und gelten fachübergreifend.
 */
function pickCandidate(candidates, ctx) {
  const sameMerker = candidates.find((c) => ctx.merkerId && c.merker && c.merker.id === ctx.merkerId);
  if (sameMerker) return sameMerker;
  if (!ctx.fach) return candidates[0];
  const isAbbreviation = (c) => c.begriff === undefined && !c.eigen;
  return candidates.find((c) => c.fach === ctx.fach) || candidates.find(isAbbreviation) || null;
}

/** Findet zu einem gefundenen Wort den Begriff bzw. das Kürzel. */
function resolveMatch(index, word, ctx) {
  const exact = index.caseSensitive.get(word);
  if (exact) return pickCandidate(exact, ctx);
  const candidates = index.byKey.get(word.toLowerCase());
  if (!candidates) return null;
  // Kürzel-Schlüssel nie ohne exakte Schreibweise verlinken (sonst wird "Bank" zu "BA")
  return pickCandidate(candidates, ctx);
}

/**
 * Linker für richtext.js: zerlegt einfachen Text und ersetzt das jeweils erste
 * Vorkommen bekannter Begriffe durch antippbare Links.
 * @param {(target: object) => void} onOpen  wird beim Antippen aufgerufen
 */
export function createLinker(onOpen) {
  return {
    link(text, ctx) {
      const fragment = document.createDocumentFragment();
      const index = store.index;
      if (!index || !index.pattern || !text) {
        fragment.append(document.createTextNode(text));
        return fragment;
      }
      const linked = ctx.linked || new Set();
      let last = 0;
      index.pattern.lastIndex = 0;
      for (let m = index.pattern.exec(text); m; m = index.pattern.exec(text)) {
        const target = resolveMatch(index, m[1], ctx);
        if (!target || target.id === ctx.selfId || linked.has(target.id)) continue;
        linked.add(target.id);
        if (m.index > last) fragment.append(document.createTextNode(text.slice(last, m.index)));
        const link = el('button', 'term-link', m[0]);
        link.type = 'button';
        link.addEventListener('click', (event) => {
          event.stopPropagation();
          onOpen(target);
        });
        fragment.append(link);
        last = m.index + m[0].length;
      }
      if (last < text.length) fragment.append(document.createTextNode(text.slice(last)));
      return fragment;
    },
  };
}

/** Alle Fundstellen eines Begriffsnamens (z. B. Allokation in VWL und ReWe). */
export function sameNameTerms(term) {
  const key = norm(term.begriff);
  return store.index.terms.filter((t) => t !== term && norm(t.begriff) === key);
}

/* ------------------------------------------------------------------ */
/* Suche                                                               */
/* ------------------------------------------------------------------ */

/** Kurze Suchbegriffe (z. B. "BA") zählen nur am Wortanfang. */
function scoreFields(fields, terms) {
  let total = 0;
  for (const t of terms) {
    const re = t.length <= 2 ? new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) : null;
    const has = (txt) => (re ? re.test(txt) : txt.includes(t));
    let s = 0;
    if (fields.keys.some((k) => k === t)) s = 100;
    else if (fields.title === t) s = 90;
    else if (fields.title.startsWith(t)) s = 50;
    else if (has(fields.title)) s = 30;
    else if (fields.keys.some(has)) s = 20;
    else if (has(fields.body)) s = 5;
    if (s === 0) return 0;
    total += s;
  }
  return total;
}

/** Baut die durchsuchbaren Einträge (einmal pro Datenstand). */
function searchDocs() {
  const docs = [];
  for (const term of store.index.terms) {
    docs.push({
      type: 'begriff',
      target: term,
      title: norm(term.begriff),
      keys: [...term.keys, ...term.kuerzel, ...term.synonyme].map(norm),
      body: norm(`${plainText(term.kurz)} ${plainText(term.funktion)}`),
    });
  }
  for (const abk of store.index.abbreviations) {
    docs.push({ type: 'kuerzel', target: abk, title: norm(abk.kurz), keys: [norm(abk.kurz)], body: norm(abk.lang) });
  }
  for (const merker of store.merker) {
    for (const block of merker.bloecke) {
      const p = block.praxis;
      docs.push({
        type: 'thema',
        target: { merker, block },
        title: norm(block.titel),
        keys: [],
        body: norm([block.abschluss.kernaussage, p.wann, p.wofuer, p.warum, block.pruefung.text].map(plainText).join(' ')),
      });
      if (block.management.musterantwort) {
        const ma = block.management.musterantwort;
        docs.push({ type: 'frage', target: { merker, block, musterantwort: ma }, title: norm(ma.frage), keys: [], body: norm(plainText(ma.antwort)) });
      }
      for (const u of block.management.uebersetzungen) {
        docs.push({ type: 'halle', target: { merker, block, uebersetzung: u }, title: norm(u.halle), keys: [], body: norm(u.management) });
      }
    }
  }
  for (const entry of store.eigene) {
    docs.push({
      type: 'eigen',
      target: entry,
      title: norm(entry.titel),
      keys: entry.stichworte.map(norm),
      body: norm(`${entry.erklaerung} ${entry.verstaendnis} ${entry.fach}`),
    });
  }
  return docs;
}

let docCache = { index: null, eigene: null, docs: [] };

/**
 * Durchsucht alles und liefert Treffer nach Relevanz.
 * @param {(doc) => boolean} [filter]  z. B. nur ein Fach
 */
export function search(query, filter = () => true) {
  const terms = norm(query).split(/\s+/).filter(Boolean);
  if (!terms.length || !store.index) return [];
  if (docCache.index !== store.index || docCache.eigene !== store.eigene) {
    docCache = { index: store.index, eigene: store.eigene, docs: searchDocs() };
  }
  return docCache.docs
    .filter(filter)
    .map((doc) => ({ doc, score: scoreFields(doc, terms) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.doc);
}

/* ------------------------------------------------------------------ */
/* Verknüpfung Wissen ↔ Lernkarten                                     */
/* ------------------------------------------------------------------ */

/*
 * Jede Lernkarte aus dem Wissen trägt eine „Quelle“, die auf genau eine Stelle zeigt:
 *   m:<merker>|<block>|b|<Begriff>     Glossar-Begriff
 *   m:<merker>|<block>|h|<Hallensatz>  Managementsprache
 *   m:<merker>|<block>|m|              Musterantwort
 *   m:<merker>|<block>|k|              Kernaussage
 *   m:<merker>|<block>|z|<Situation>   Zuordnung
 *   m:<merker>|<block>|f|              Feynman
 *   a:<merker>|<Kürzel>                Abkürzung
 *   e:<Eintrags-ID>                    eigener Eintrag
 * Die Karte zeigt immer den aktuellen Text aus dem Wissen; Korrekturen wirken sofort.
 */

export const CARD_TYPES = {
  b: 'Begriff',
  h: 'Managementsprache',
  m: 'Musterantwort',
  k: 'Kernaussage',
  z: 'Zuordnung',
  f: 'Feynman',
  a: 'Abkürzung',
  e: 'Eigener Eintrag',
};

const blockQuelle = (merker, block, typ, key = '') => `m:${merker.id}|${block.id}|${typ}|${key}`;

function joinText(...parts) {
  return parts.map((p) => plainText(p)).filter(Boolean).join('\n\n');
}

/** Alle Karten, die sich aus dem aktuellen Wissen ableiten lassen. */
function deriveAll() {
  const list = [];
  const add = (quelle, typ, fach, frage, antwort, pfad, ziel) => list.push({ quelle, typ, fach, frage, antwort, pfad, ziel });

  for (const merker of store.merker) {
    const fach = fachLabel(merker.fach);
    for (const block of merker.bloecke) {
      const pfad = `${fach} › ${merker.titel} › ${block.id} ${block.titel}`;
      const ziel = { merker, block };
      block.glossar.forEach((g) => {
        add(blockQuelle(merker, block, 'b', g.begriff), 'b', fach, `Erkläre den Begriff: ${g.begriff}`, joinText(g.kurz, g.funktion), `${pfad} › ${g.begriff}`, ziel);
      });
      block.management.uebersetzungen.forEach((u) => {
        add(blockQuelle(merker, block, 'h', u.halle), 'h', fach, `Formuliere in Managementsprache: „${u.halle}“`, plainText(u.management), pfad, ziel);
      });
      const ma = block.management.musterantwort;
      if (ma && ma.frage) add(blockQuelle(merker, block, 'm'), 'm', fach, ma.frage, plainText(ma.antwort), pfad, ziel);
      if (block.abschluss.kernaussage) {
        add(blockQuelle(merker, block, 'k'), 'k', fach, `Was ist die Kernaussage zu „${block.titel}“?`, plainText(block.abschluss.kernaussage), pfad, ziel);
      }
      block.pruefung.zuordnung.forEach((z) => {
        add(blockQuelle(merker, block, 'z', z.frage), 'z', fach, `Ordne zu: ${z.frage}`, plainText(z.antwort), pfad, ziel);
      });
      const fy = block.abschluss.feynman;
      if (fy && fy.muss.length) {
        const muss = fy.muss.map((m, i) => `${i + 1}. ${plainText(m)}`).join('\n');
        add(blockQuelle(merker, block, 'f'), 'f', fach, `Feynman: ${fy.aufgabe}`, `Muss enthalten:\n${muss}`, pfad, ziel);
      }
    }
    for (const abk of merker.abkuerzungen) {
      add(`a:${merker.id}|${abk.kurz}`, 'a', fach, `Wofür steht die Abkürzung ${abk.kurz}?`, abk.lang, `${fach} › ${merker.titel} › ${abk.kurz}`, { merker, abk });
    }
  }
  for (const entry of store.eigene) {
    const fach = entry.fach || 'Allgemein';
    const antwort = isDraft(entry) ? '' : joinText(entry.erklaerung || entry.verstaendnis);
    add(`e:${entry.id}`, 'e', fach, `Erkläre den Begriff: ${entry.titel}`, antwort, `Eigene Einträge › ${entry.titel}`, { entry });
  }
  return list;
}

let derivedCache = { index: null, eigene: null, map: new Map(), list: [] };

function derived() {
  if (derivedCache.index !== store.index || derivedCache.eigene !== store.eigene) {
    const list = store.index ? deriveAll() : [];
    derivedCache = { index: store.index, eigene: store.eigene, list, map: new Map(list.map((d) => [d.quelle, d])) };
  }
  return derivedCache;
}

/** Abgeleitete Karte zu einer Quelle oder null, wenn es die Stelle im Wissen nicht (mehr) gibt. */
export function wissenCard(quelle) {
  return (quelle && derived().map.get(quelle)) || null;
}

/** Alle ableitbaren Karten (für „Lernkarten aus Wissen erzeugen“). */
export function allWissenCards() {
  return derived().list;
}

/** Quelle für einen Suchtreffer bzw. ein Ziel im Wissen. */
export function quelleFor(type, target) {
  switch (type) {
    case 'begriff':
      return blockQuelle(target.merker, target.block, 'b', target.begriff);
    case 'kuerzel':
      return `a:${target.merker.id}|${target.kurz}`;
    case 'thema':
      return target.block.abschluss.kernaussage ? blockQuelle(target.merker, target.block, 'k') : null;
    case 'frage':
      return blockQuelle(target.merker, target.block, 'm');
    case 'halle':
      return blockQuelle(target.merker, target.block, 'h', target.uebersetzung.halle);
    case 'eigen':
      return `e:${target.id}`;
    default:
      return null;
  }
}

/** Titel eines Merkers für Filter und Anzeigen. */
export function merkerTitle(id) {
  const merker = store.merker.find((m) => m.id === id);
  return merker ? merker.titel : null;
}

/** Thema-Gruppe einer Quelle: Merker-ID, "eigen" oder null. */
export function quelleGroup(quelle) {
  if (!quelle) return null;
  if (quelle.startsWith('e:')) return 'eigen';
  const m = quelle.match(/^[ma]:([^|]+)\|/);
  return m ? m[1] : null;
}

/* ------------------------------------------------------------------ */
/* Hilfen für Tipps und Verweise beim Üben                             */
/* ------------------------------------------------------------------ */

/**
 * Findet bekannte Begriffe, Kürzel und eigene Einträge in einem Text
 * (z. B. in der Antwort einer Lernkarte), jeweils einmal.
 */
export function termsInText(text, ctx = {}) {
  const index = store.index;
  if (!index || !index.pattern || !text) return [];
  const found = new Map();
  index.pattern.lastIndex = 0;
  for (let m = index.pattern.exec(text); m; m = index.pattern.exec(text)) {
    const target = resolveMatch(index, m[1], ctx);
    if (target && target.id !== ctx.selfId && !found.has(target.id)) found.set(target.id, target);
  }
  return [...found.values()];
}

/** Anzeigename eines Verlinkungsziels (Begriff, Kürzel oder eigener Eintrag). */
export function targetName(target) {
  if (target.begriff !== undefined) return target.begriff;
  if (target.eigen) return target.titel;
  return target.kurz;
}

/**
 * Ziel im Wissen zu einer Karten-Quelle:
 * { term } für Glossar-Begriffe, { abk } für Kürzel, { entry } für eigene Einträge,
 * { merker, block } für Managementsprache, Musterantwort, Kernaussage usw.
 */
export function targetForQuelle(quelle) {
  if (!quelle || !store.index) return null;
  if (quelle.startsWith('e:')) {
    const entry = store.eigene.find((e) => `e:${e.id}` === quelle);
    return entry ? { entry, item: store.index.entries.find((i) => i.entry === entry) || null } : null;
  }
  if (quelle.startsWith('a:')) {
    const abk = store.index.abbreviations.find((a) => `a:${a.merker.id}|${a.kurz}` === quelle);
    return abk ? { abk } : null;
  }
  const m = quelle.match(/^m:([^|]+)\|([^|]+)\|(\w)\|(.*)$/);
  if (!m) return null;
  const [, merkerId, blockId, typ, key] = m;
  const merker = store.merker.find((x) => x.id === merkerId);
  const block = merker && merker.bloecke.find((b) => b.id === blockId);
  if (!block) return null;
  if (typ === 'b') {
    const term = store.index.terms.find((t) => t.block === block && t.begriff === key);
    if (term) return { term, merker, block };
  }
  return { merker, block };
}
