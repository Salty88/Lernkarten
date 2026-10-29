/**
 * progress.js
 *
 * Lernstand nach dem Leitner-System, gespeichert getrennt von den Karten in
 * lernstand.json. Eine Bewertung lädt so nur noch den kleinen Lernstand hoch.
 *
 *  - Jede Karte liegt in Fach 1 bis 5. Richtig: ein Fach weiter, Pause 1, 2, 4, 8, 16 Tage.
 *    Falsch: zurück in Fach 1, morgen wieder fällig.
 *  - Mehrere Geräte: pro Karte gilt der neueste Stand (Zeitstempel), nichts wird überschrieben.
 *  - Tagesstatistik pro Gerät, damit sich parallele Zähler nicht gegenseitig überschreiben.
 */

import { SyncError, hasValidSettings, settingsTarget, dataDir, getTextFile, putTextFile } from './github-sync.js';
import { showToast } from './ui.js';

const CACHE_KEY = 'lernkartei.lernstand';
const DEVICE_KEY = 'lernkartei.geraet';
const SAVE_DELAY_MS = 3000;
export const MAX_BOX = 5;
/** Pause in Tagen je Fach (Index = Fach). */
export const BOX_DAYS = [0, 1, 2, 4, 8, 16];

const ps = {
  entries: new Map(), // Karten-ID → { b: Fach, f: fällig (JJJJ-MM-TT), z: zuletzt (ISO), r: richtig, w: falsch }
  days: {}, // Datum → Geräte-ID → { neu, richtig, falsch }
  sha: null,
  remoteExists: false,
  loaded: false,
  pending: new Set(),
  pendingDays: false,
  timer: null,
  queue: Promise.resolve(),
  getSettings: () => ({}),
  onChange: () => {},
  failNotified: false,
  revision: 0, // steigt bei jedem Laden von GitHub
};

/** Zähler, der sich ändert, sobald ein neuer Stand von GitHub geladen wurde. */
export function progressRevision() {
  return ps.revision;
}

/* ------------------------------------------------------------------ */
/* Datum                                                               */
/* ------------------------------------------------------------------ */

/** Heutiges Datum in Ortszeit als JJJJ-MM-TT. */
export function today() {
  return dateString(new Date());
}

function dateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return dateString(new Date(y, m - 1, d + n));
}

function deviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = Math.random().toString(36).slice(2, 10);
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return 'geraet';
  }
}

/* ------------------------------------------------------------------ */
/* Zusammenführen und lokaler Speicher                                 */
/* ------------------------------------------------------------------ */

function normEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const b = Math.min(MAX_BOX, Math.max(1, Number(raw.b) || 1));
  return {
    b,
    f: /^\d{4}-\d{2}-\d{2}$/.test(raw.f) ? raw.f : today(),
    z: raw.z ? String(raw.z) : '',
    r: Number(raw.r) || 0,
    w: Number(raw.w) || 0,
  };
}

/** Übernimmt fremde Einträge, wenn sie neuer sind als die eigenen. */
function mergeEntries(karten) {
  for (const [id, raw] of Object.entries(karten || {})) {
    const remote = normEntry(raw);
    if (!remote) continue;
    const local = ps.entries.get(id);
    if (!local || remote.z > local.z) ps.entries.set(id, remote);
  }
}

/** Tageszähler: pro Datum und Gerät gilt jeweils der höhere Wert. */
function mergeDays(tage) {
  for (const [day, devices] of Object.entries(tage || {})) {
    const target = (ps.days[day] = ps.days[day] || {});
    for (const [device, counts] of Object.entries(devices || {})) {
      const mine = (target[device] = target[device] || { neu: 0, richtig: 0, falsch: 0 });
      for (const key of ['neu', 'richtig', 'falsch']) mine[key] = Math.max(mine[key] || 0, Number(counts[key]) || 0);
    }
  }
}

function serialize() {
  // Ältere Tage als 60 Tage werden nicht mehr gebraucht
  const cutoff = addDays(today(), -60);
  const tage = Object.fromEntries(Object.entries(ps.days).filter(([day]) => day >= cutoff));
  return { version: 1, karten: Object.fromEntries(ps.entries), tage };
}

function persist() {
  const settings = ps.getSettings();
  if (!hasValidSettings(settings)) return;
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        target: settingsTarget(settings),
        ...serialize(),
        sha: ps.sha,
        remoteExists: ps.remoteExists,
        pending: [...ps.pending],
        pendingDays: ps.pendingDays,
      }),
    );
  } catch {
    /* Speicher voll: Stand bleibt für diese Sitzung erhalten */
  }
}

/** Stellt den Stand dieses Geräts wieder her (auch offline). */
export function restoreProgress() {
  ps.entries = new Map();
  ps.days = {};
  ps.sha = null;
  ps.remoteExists = false;
  ps.loaded = false;
  ps.pending = new Set();
  ps.pendingDays = false;
  const settings = ps.getSettings();
  if (!hasValidSettings(settings)) return;
  try {
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (!cache || cache.target !== settingsTarget(settings)) return;
    mergeEntries(cache.karten);
    mergeDays(cache.tage);
    ps.sha = cache.sha || null;
    ps.remoteExists = Boolean(cache.remoteExists);
    ps.pending = new Set(Array.isArray(cache.pending) ? cache.pending : []);
    ps.pendingDays = Boolean(cache.pendingDays);
  } catch {
    /* defekter Zwischenspeicher: neu laden */
  }
}

/* ------------------------------------------------------------------ */
/* Laden und Speichern                                                 */
/* ------------------------------------------------------------------ */

function filePath(settings) {
  return `${dataDir(settings)}lernstand.json`;
}

function runExclusive(task) {
  const run = ps.queue.then(task, task);
  ps.queue = run.catch(() => {});
  return run;
}

function parseRemote(text) {
  if (!text || !text.trim()) return { karten: {}, tage: {} };
  try {
    const data = JSON.parse(text);
    return { karten: data.karten || {}, tage: data.tage || {} };
  } catch {
    throw new SyncError('invalid', 'Die Datei lernstand.json enthält kein gültiges JSON.');
  }
}

/** Lädt den Lernstand von GitHub und führt ihn mit dem lokalen zusammen. */
export function loadProgress() {
  return runExclusive(async () => {
    const settings = ps.getSettings();
    if (!hasValidSettings(settings)) return false;
    try {
      const { text, sha } = await getTextFile(settings, filePath(settings));
      const remote = parseRemote(text);
      mergeEntries(remote.karten);
      mergeDays(remote.tage);
      ps.sha = sha;
      ps.remoteExists = text !== null;
      ps.loaded = true;
      ps.revision += 1;
      persist();
      ps.onChange();
      if (ps.pending.size || ps.pendingDays) scheduleSave();
      return true;
    } catch (err) {
      if (!(err instanceof SyncError) || err.code !== 'network') showToast(`Lernstand nicht geladen: ${err.message}`, 'error');
      return false;
    }
  });
}

export function scheduleSave(delay = SAVE_DELAY_MS) {
  clearTimeout(ps.timer);
  ps.timer = setTimeout(() => saveProgress(), delay);
}

/** Speichert sofort (z. B. beim Verlassen der App). */
export function flushProgress() {
  if (ps.pending.size || ps.pendingDays) {
    clearTimeout(ps.timer);
    saveProgress();
  }
}

/**
 * Konfliktsicher speichern: aktuellen Stand holen, neuere fremde Einträge
 * übernehmen, dann schreiben. War ein anderes Gerät schneller, einmal wiederholen.
 */
function saveProgress() {
  return runExclusive(async () => {
    const settings = ps.getSettings();
    if (!hasValidSettings(settings) || (!ps.pending.size && !ps.pendingDays)) return;
    const saving = new Set(ps.pending);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { text, sha } = await getTextFile(settings, filePath(settings));
        const remote = parseRemote(text);
        mergeEntries(remote.karten);
        mergeDays(remote.tage);
        const body = `${JSON.stringify(serialize())}\n`;
        ps.sha = await putTextFile(settings, filePath(settings), body, sha, `Lernstand: ${saving.size} ${saving.size === 1 ? 'Bewertung' : 'Bewertungen'}`);
        ps.remoteExists = true;
        ps.loaded = true;
        for (const id of saving) ps.pending.delete(id);
        ps.pendingDays = false;
        ps.failNotified = false;
        persist();
        ps.onChange();
        return;
      } catch (err) {
        if (err instanceof SyncError && err.code === 'conflict' && attempt === 0) continue;
        persist();
        // Nur einmal melden; der Stand bleibt lokal und wird beim nächsten Mal mitgespeichert
        if (!ps.failNotified) {
          ps.failNotified = true;
          const reason = err instanceof SyncError && err.code === 'network' ? 'keine Verbindung' : err.message;
          showToast(`Lernstand noch nicht gespeichert (${reason}). Er bleibt auf dem Gerät und wird nachgeholt.`, 'error');
        }
        return;
      }
    }
  });
}

/* ------------------------------------------------------------------ */
/* Lesen und Bewerten                                                  */
/* ------------------------------------------------------------------ */

export function initProgress({ getSettings, onChange }) {
  ps.getSettings = getSettings;
  ps.onChange = onChange;
  restoreProgress();
}

export function getEntry(id) {
  return ps.entries.get(id) || null;
}

export function isDue(id, day = today()) {
  const entry = ps.entries.get(id);
  return Boolean(entry && entry.f <= day);
}

/** Neu, Lernen (Fach 1 bis 2) oder Gelernt (ab Fach 3). */
export function statusOf(id) {
  const entry = ps.entries.get(id);
  if (!entry) return 'neu';
  return entry.b >= 3 ? 'gelernt' : 'lernen';
}

/**
 * Speichert eine Antwort.
 * Richtig und fällig (oder neu): ein Fach weiter. Richtig, aber noch nicht fällig
 * (freies Üben): Fach bleibt. Falsch: Fach 1, morgen wieder fällig.
 */
export function record(id, correct) {
  const day = today();
  const before = ps.entries.get(id);
  const entry = before ? { ...before } : { b: 0, f: day, z: '', r: 0, w: 0 };
  if (correct) {
    if (!before || before.f <= day) entry.b = Math.min(MAX_BOX, entry.b + 1);
    entry.f = !before || before.f <= day ? addDays(day, BOX_DAYS[entry.b]) : before.f;
    entry.r += 1;
  } else {
    entry.b = 1;
    entry.f = addDays(day, BOX_DAYS[1]);
    entry.w += 1;
  }
  entry.z = new Date().toISOString();
  ps.entries.set(id, entry);

  const devices = (ps.days[day] = ps.days[day] || {});
  const counts = (devices[deviceId()] = devices[deviceId()] || { neu: 0, richtig: 0, falsch: 0 });
  if (!before) counts.neu += 1;
  counts[correct ? 'richtig' : 'falsch'] += 1;

  ps.pending.add(id);
  ps.pendingDays = true;
  persist();
  scheduleSave();
  return entry;
}

/** Zähler eines Tages über alle Geräte. */
export function dayStats(day = today()) {
  const sum = { neu: 0, richtig: 0, falsch: 0 };
  for (const counts of Object.values(ps.days[day] || {})) {
    for (const key of Object.keys(sum)) sum[key] += Number(counts[key]) || 0;
  }
  return sum;
}

/** Wie viele der Karten-IDs sind an einem Tag fällig? */
export function countDue(ids, day) {
  let n = 0;
  for (const id of ids) {
    const entry = ps.entries.get(id);
    if (entry && entry.f <= day) n += 1;
  }
  return n;
}

/** Nächstes Fälligkeitsdatum nach heute (für „Heute ist nichts fällig“). */
export function nextDueDate(ids) {
  let next = null;
  const day = today();
  for (const id of ids) {
    const entry = ps.entries.get(id);
    if (entry && entry.f > day && (!next || entry.f < next)) next = entry.f;
  }
  return next;
}

/**
 * Einmalige Übernahme der bisherigen Bewertungen aus cards.json, solange es
 * noch keine lernstand.json gibt: „gelernt“ → Fach 2, „lernen“ → Fach 1.
 * Gelernte Karten werden über drei Tage verteilt fällig, damit kein Berg entsteht.
 */
export function migrateFromCards(cards) {
  if (!ps.loaded || ps.remoteExists || ps.entries.size) return 0;
  const day = today();
  let n = 0;
  cards.forEach((card, i) => {
    if (card.status !== 'gelernt' && card.status !== 'lernen') return;
    const gelernt = card.status === 'gelernt';
    ps.entries.set(card.id, {
      b: gelernt ? 2 : 1,
      f: gelernt ? addDays(day, 1 + (i % 3)) : day,
      z: card.letzteUebung || new Date().toISOString(),
      r: gelernt ? Math.max(1, card.wiederholungen || 1) : 0,
      w: gelernt ? 0 : 1,
    });
    ps.pending.add(card.id);
    n += 1;
  });
  if (n) {
    ps.revision += 1; // „Heute fällig“ neu aufbauen, damit übernommene Karten dabei sind
    persist();
    scheduleSave(500);
  }
  return n;
}

export function clearProgressCache() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* nichts zu tun */
  }
}
