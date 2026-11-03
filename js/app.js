/**
 * app.js
 *
 * UI-Logik der Lernkartei: Tabs, Übungsmodus, Kartenformular, Kartenliste,
 * Einstellungen-Modal und das verzögerte Speichern der Karten.
 * Alle GitHub- und Speicherzugriffe laufen über github-sync.js,
 * das Nachschlagewerk (Tab „Wissen“) liegt in wissen.js.
 */

import {
  SyncError,
  loadSettings,
  saveSettings,
  clearSettings,
  hasValidSettings,
  settingsTarget,
  loadCache,
  saveCache,
  fetchCards,
  saveCards,
} from './github-sync.js';
import { el, button, norm, showToast, initToast, openModal, closeModal, closeTopModal, isAnyModalOpen, closeOnBackdropClick } from './ui.js';
import { initWissen, syncWissen, reloadWissenForSettings, setCardBridge, refreshWissenStats } from './wissen.js';
import { FAECHER, fachKey, fachLabel, fachName, wissenCard, allWissenCards } from './wissen-data.js';
import { initPractice, refreshPractice, handlePracticeKey } from './practice.js';
import { initFachSheet, openFachSheet, refreshFachSheet } from './fach-sheet.js';
import { initTheme, getThemeChoice, setThemeChoice } from './theme.js';
import {
  initProgress,
  restoreProgress,
  loadProgress,
  flushProgress,
  migrateFromCards,
  statusOf,
  clearProgressCache,
  currentLearner,
  learnerFileName,
} from './progress.js';
import { initLuecken, renderLuecken } from './luecken.js';

const SAVE_DELAY_MS = 1200;
const TAB_KEY = 'lernkartei.tab';
const ALL_SUBJECTS = '__all__';
const VALID_STATUS = ['neu', 'lernen', 'gelernt'];
const STATUS_LABELS = { neu: 'Neu', lernen: 'Lernen', gelernt: 'Gelernt' };
const LIST_PAGE_SIZE = 100;

/* ------------------------------------------------------------------ */
/* Zustand                                                             */
/* ------------------------------------------------------------------ */

const state = {
  settings: loadSettings(),
  cards: [],
  sha: null,
  /** true, sobald in dieser Sitzung erfolgreich von GitHub geladen wurde */
  remoteLoaded: false,
  /** Noch nicht gespeicherte Änderungen: Karten-ID → Änderungszähler */
  pending: new Map(),
  rev: 0,
  /** IDs, die zuletzt auf GitHub lagen (für die Commit-Nachricht: neu vs. geändert) */
  lastRemoteIds: [],
  saveTimer: null,
  saveQueued: false,
  syncStatus: 'idle',
  tab: 'practice',
  editor: {
    editingId: null,
    filter: ALL_SUBJECTS,
    query: '',
    limit: LIST_PAGE_SIZE,
  },
};

/** Alle Lade- und Speichervorgänge laufen nacheinander, nie parallel. */
let syncQueue = Promise.resolve();
function runExclusive(task) {
  const run = syncQueue.then(task, task);
  syncQueue = run.catch(() => {});
  return run;
}

/* ------------------------------------------------------------------ */
/* DOM-Referenzen                                                      */
/* ------------------------------------------------------------------ */

const $ = (id) => document.getElementById(id);

const dom = {
  tabs: document.querySelectorAll('.tab'),
  views: {
    practice: $('view-practice'),
    create: $('view-create'),
    wissen: $('view-wissen'),
    luecken: $('view-luecken'),
    mehr: $('view-mehr'),
  },
  syncDot: $('sync-dot'),
  syncTime: $('sync-time'),
  syncStatus: $('sync-status'),
  openSettings: $('open-settings'),

  syncBtn: $('sync-btn'),

  form: $('card-form'),
  formTitle: $('form-title'),
  inputFach: $('input-fach'),
  inputFrage: $('input-frage'),
  inputAntwort: $('input-antwort'),
  submitBtn: $('submit-btn'),
  cancelEditBtn: $('cancel-edit-btn'),
  fachList: $('fach-list'),
  cardSheet: $('card-sheet'),
  closeCardSheet: $('close-card-sheet'),
  newCardBtn: $('new-card-btn'),
  createFachBtn: $('create-fach-btn'),
  createFachLabel: $('create-fach-label'),
  createSearch: $('create-search'),
  createLetters: $('create-letters'),
  cardCounter: $('card-counter'),
  cardList: $('card-list'),
  listEmpty: $('list-empty'),
  listMore: $('list-more'),

  modal: $('settings-modal'),
  closeSettings: $('close-settings'),
  settingsForm: $('settings-form'),
  setUser: $('set-user'),
  setRepo: $('set-repo'),
  setBranch: $('set-branch'),
  setPath: $('set-path'),
  setToken: $('set-token'),
  setLearner: $('set-learner'),
  settingsMessage: $('settings-message'),
  settingsSave: $('settings-save'),
  settingsClear: $('settings-clear'),

};

/* ------------------------------------------------------------------ */
/* Allgemeine Hilfsfunktionen                                          */
/* ------------------------------------------------------------------ */

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Bringt geladene Karten in eine verlässliche Form (fehlende Felder, falsche Typen). */
function normalizeCard(raw) {
  const card = raw && typeof raw === 'object' ? raw : {};
  return {
    id: card.id ? String(card.id) : createId(),
    fach: String(card.fach ?? '').trim() || 'Allgemein',
    frage: String(card.frage ?? ''),
    antwort: String(card.antwort ?? ''),
    status: VALID_STATUS.includes(card.status) ? card.status : 'neu',
    wiederholungen: Number.isFinite(Number(card.wiederholungen)) ? Number(card.wiederholungen) : 0,
    letzteUebung: card.letzteUebung ? String(card.letzteUebung) : null,
    nr: Number.isInteger(Number(card.nr)) && Number(card.nr) > 0 ? Number(card.nr) : null,
    quelle: card.quelle ? String(card.quelle) : null,
    eigeneFassung: card.eigeneFassung === true,
  };
}

function findCard(id) {
  return state.cards.find((card) => card.id === id) || null;
}

/** Anzeigeform der Kartennummer, z. B. #0042. */
function formatNr(nr) {
  return nr ? `#${String(nr).padStart(4, '0')}` : '#----';
}

/**
 * Text einer Karte: Verknüpfte Karten zeigen den aktuellen Stand aus dem Wissen,
 * selbst bearbeitete Karten („eigene Fassung“) ihren gespeicherten Text.
 */
function cardView(card) {
  if (card.quelle && !card.eigeneFassung) {
    const linked = wissenCard(card.quelle);
    if (linked) return { frage: linked.frage, antwort: linked.antwort, pfad: linked.pfad };
  }
  const linked = card.quelle ? wissenCard(card.quelle) : null;
  return { frage: card.frage, antwort: card.antwort, pfad: linked ? linked.pfad : null };
}

/**
 * Vergibt fortlaufende Nummern: Karten ohne Nummer und doppelte Nummern
 * (z. B. zwei Geräte offline) bekommen die nächste freie. Die zuerst
 * gespeicherte Karte behält ihre Nummer.
 */
function ensureNumbers() {
  const used = new Set();
  const needs = [];
  for (const card of state.cards) {
    if (card.nr && !used.has(card.nr)) used.add(card.nr);
    else needs.push(card);
  }
  if (!needs.length) return;
  let next = used.size ? Math.max(...used) + 1 : 1;
  for (const card of needs) card.nr = next++;
  markChangedMany(needs.map((card) => card.id));
}

function nextNr() {
  return state.cards.reduce((max, card) => Math.max(max, card.nr || 0), 0) + 1;
}

const FACH_ORDER = new Map(FAECHER.map((f, i) => [f.id, i]));

/** Fächer der Karten, zusammengefasst (z. B. „ReWe“ und „Rechnungswesen“ sind dasselbe Fach). */
function getSubjects() {
  const keys = new Set(state.cards.map((card) => fachKey(card.fach)));
  return [...keys].sort((a, b) => (FACH_ORDER.get(a) ?? 99) - (FACH_ORDER.get(b) ?? 99) || a.localeCompare(b, 'de'));
}

function cardsForSubject(subject) {
  return subject === ALL_SUBJECTS ? state.cards : state.cards.filter((card) => fachKey(card.fach) === subject);
}

function pluralCards(n) {
  return `${n} ${n === 1 ? 'Karte' : 'Karten'}`;
}

/* ------------------------------------------------------------------ */
/* Sync-Status in der Kopfzeile                                        */
/* ------------------------------------------------------------------ */

const STATUS_TEXT = {
  idle: '',
  unconfigured: 'Nicht mit GitHub verbunden',
  loading: 'Lade von GitHub …',
  saving: 'Speichere …',
  dirty: 'Ungespeicherte Änderungen',
  saved: 'Synchronisiert',
  offline: 'Offline · zuletzt geladener Stand',
  error: 'Nicht synchronisiert',
};

function setSyncStatus(status) {
  state.syncStatus = status;
  dom.syncStatus.textContent = STATUS_TEXT[status] || '';
  dom.syncStatus.dataset.status = status;
  // Punkt am Eintrag „Mehr“ in der unteren Navigation
  dom.syncDot.dataset.status = status;
  dom.syncDot.title = STATUS_TEXT[status] || '';
  if (status === 'saved') {
    dom.syncTime.textContent = `· zuletzt ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
  }
  dom.syncBtn.disabled = status === 'loading' || status === 'saving';
}

/** Status nach einem Fehler: offline/fehlerhaft, Änderungen bleiben erhalten. */
function statusAfterFailure(err) {
  return err instanceof SyncError && err.code === 'network' ? 'offline' : 'error';
}

/* ------------------------------------------------------------------ */
/* Lokaler Zwischenspeicher                                            */
/* ------------------------------------------------------------------ */

function persistLocally() {
  if (!hasValidSettings(state.settings)) return;
  saveCache(settingsTarget(state.settings), {
    cards: state.cards,
    sha: state.sha,
    pending: [...state.pending.entries()],
    rev: state.rev,
  });
}

/** Stellt den letzten Stand dieses Geräts wieder her (für Offline-Anzeige und ungespeicherte Änderungen). */
function restoreFromCache() {
  if (!hasValidSettings(state.settings)) return;
  const cache = loadCache(settingsTarget(state.settings));
  if (!cache) return;
  state.cards = cache.cards.map(normalizeCard);
  state.sha = cache.sha || null;
  state.pending = new Map(Array.isArray(cache.pending) ? cache.pending : []);
  state.rev = Number(cache.rev) || 0;
}

function resetDataState() {
  state.cards = [];
  state.sha = null;
  state.pending = new Map();
  state.rev = 0;
  state.lastRemoteIds = [];
  state.remoteLoaded = false;
}

/* ------------------------------------------------------------------ */
/* Synchronisation                                                     */
/* ------------------------------------------------------------------ */

/**
 * Übernimmt den GitHub-Stand und legt die eigenen, noch nicht gespeicherten
 * Änderungen darüber. So geht bei Konflikten mit dem anderen Gerät nichts verloren.
 */
function mergeRemote(remoteCards, sha) {
  const local = new Map(state.cards.map((card) => [card.id, card]));
  const merged = [];
  const seen = new Set();

  for (const remote of remoteCards) {
    if (seen.has(remote.id)) continue;
    seen.add(remote.id);
    if (!state.pending.has(remote.id)) {
      merged.push(remote);
    } else if (local.has(remote.id)) {
      merged.push(local.get(remote.id)); // lokal bearbeitet
    } // sonst: lokal gelöscht
  }
  for (const id of state.pending.keys()) {
    if (!seen.has(id) && local.has(id)) merged.push(local.get(id)); // lokal neu angelegt
  }

  state.cards = merged;
  state.sha = sha;
  state.remoteLoaded = true;
  state.lastRemoteIds = remoteCards.map((card) => card.id);
}

/** Lädt von GitHub und führt zusammen. Wirft SyncError. */
async function loadAndMerge() {
  const { cards, sha } = await fetchCards(state.settings);
  mergeRemote(cards.map(normalizeCard), sha);
  ensureNumbers(); // vor jedem Speichern: Nummern eindeutig
  persistLocally();
  refreshAfterDataChange();
}

/**
 * Lädt die Karten von GitHub (Start, Sync-Button, nach Einstellungen).
 * @returns {Promise<boolean>} Erfolg
 */
function syncFromRemote({ announce = false } = {}) {
  return runExclusive(async () => {
    if (!hasValidSettings(state.settings)) {
      setSyncStatus('unconfigured');
      return false;
    }
    setSyncStatus('loading');
    try {
      await loadAndMerge();
    } catch (err) {
      setSyncStatus(statusAfterFailure(err));
      reportError(err, 'load');
      return false;
    }
    if (state.pending.size > 0) {
      setSyncStatus('dirty');
      requestSave();
    } else {
      setSyncStatus('saved');
    }
    if (announce) showToast(`${pluralCards(state.cards.length)} geladen`, 'success');
    syncWissen(); // Merker und eigene Einträge laufen unabhängig von den Karten
    // Lernstand getrennt laden; bisherige Bewertungen einmalig übernehmen
    loadProgress().then((ok) => {
      if (ok && migrateFromCards(state.cards)) refreshAfterDataChange();
    });
    return true;
  });
}

/** Markiert eine Karte als geändert und plant das verzögerte Speichern. */
function markChanged(id) {
  markChangedMany([id]);
}

function markChangedMany(ids) {
  state.rev += 1;
  for (const id of ids) state.pending.set(id, state.rev);
  persistLocally();
  setSyncStatus(hasValidSettings(state.settings) ? 'dirty' : 'unconfigured');
  scheduleSave();
}

function scheduleSave(delay = SAVE_DELAY_MS) {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(requestSave, delay);
}

/** Reiht einen Speichervorgang ein (höchstens einer wartet gleichzeitig). */
function requestSave() {
  clearTimeout(state.saveTimer);
  if (!hasValidSettings(state.settings) || state.saveQueued || state.pending.size === 0) return;
  state.saveQueued = true;
  runExclusive(async () => {
    state.saveQueued = false;
    await performSave();
  });
}

function buildCommitMessage() {
  let added = 0;
  let changed = 0;
  let removed = 0;
  const known = new Set(state.lastRemoteIds);
  for (const id of state.pending.keys()) {
    if (!findCard(id)) removed += 1;
    else if (known.has(id)) changed += 1;
    else added += 1;
  }
  const parts = [];
  if (added) parts.push(`${added} neu`);
  if (changed) parts.push(`${changed} geändert`);
  if (removed) parts.push(`${removed} gelöscht`);
  return `Lernkartei: ${parts.join(', ') || 'aktualisiert'} (${pluralCards(state.cards.length)})`;
}

/**
 * Speichert den aktuellen Stand auf GitHub. Bei einem Konflikt wird einmal
 * neu geladen, zusammengeführt und erneut gespeichert. Kein endloses Wiederholen.
 */
async function performSave(attempt = 1) {
  if (state.pending.size === 0) return;

  setSyncStatus('saving');
  try {
    // Vor dem ersten Speichern in dieser Sitzung den aktuellen GitHub-Stand holen
    if (!state.remoteLoaded) await loadAndMerge();

    const savedUpTo = state.rev;
    const newSha = await saveCards(state.settings, state.cards, state.sha, buildCommitMessage());
    state.sha = newSha;
    state.lastRemoteIds = state.cards.map((card) => card.id);
    for (const [id, rev] of state.pending) {
      if (rev <= savedUpTo) state.pending.delete(id);
    }
    persistLocally();

    if (state.pending.size > 0) {
      setSyncStatus('dirty');
      scheduleSave();
    } else {
      setSyncStatus('saved');
      showToast('Auf GitHub gespeichert', 'success');
    }
  } catch (err) {
    if (err instanceof SyncError && err.code === 'conflict' && attempt === 1) {
      try {
        await loadAndMerge();
      } catch (loadErr) {
        setSyncStatus(statusAfterFailure(loadErr));
        reportError(loadErr, 'save');
        return;
      }
      showToast('Neuere Version vom anderen Gerät übernommen und mit deinen Änderungen zusammengeführt', 'info');
      await performSave(2);
      return;
    }
    setSyncStatus(statusAfterFailure(err));
    reportError(err, 'save');
  }
}

/** Zeigt Fehler verständlich an; unerwartete Fehler zusätzlich in der Konsole. */
function reportError(err, phase) {
  if (!(err instanceof SyncError)) {
    console.error(err);
    showToast('Unerwarteter Fehler. Änderungen bleiben auf diesem Gerät erhalten.', 'error');
    return;
  }
  if (err.code === 'network') {
    showToast(
      phase === 'save'
        ? 'Speichern fehlgeschlagen: keine Verbindung. Änderungen bleiben erhalten.'
        : 'Keine Verbindung zu GitHub. Zeige den zuletzt geladenen Stand.',
      'error',
    );
    return;
  }
  const prefix = phase === 'save' ? 'Speichern fehlgeschlagen: ' : '';
  showToast(`${prefix}${err.message}`, 'error');
}

/* ------------------------------------------------------------------ */
/* Tabs                                                                */
/* ------------------------------------------------------------------ */

function switchTab(tab) {
  state.tab = tab;
  dom.tabs.forEach((button) => {
    const active = button.dataset.tab === tab;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  });
  Object.entries(dom.views).forEach(([name, view]) => {
    view.hidden = name !== tab;
  });
  try {
    localStorage.setItem(TAB_KEY, tab); // pro Gerät merken, wo man zuletzt war
  } catch {
    /* nur Komfort */
  }
}

function restoreTab() {
  try {
    const tab = localStorage.getItem(TAB_KEY);
    if (tab && dom.views[tab]) switchTab(tab);
  } catch {
    /* Standard: Üben */
  }
}

/* ------------------------------------------------------------------ */
/* Fächer: Datalist und Filter                                         */
/* ------------------------------------------------------------------ */

const CREATE_PREFS_KEY = 'lernkartei.erstellen.fach';

function renderSubjects() {
  const subjects = getSubjects();
  if (state.editor.filter !== ALL_SUBJECTS && !subjects.includes(state.editor.filter)) state.editor.filter = ALL_SUBJECTS;
  const all = state.editor.filter === ALL_SUBJECTS;
  dom.createFachLabel.textContent = all ? 'Alle Fächer' : fachLabel(state.editor.filter);
  dom.createFachBtn.title = all ? 'Alle Fächer' : fachName(state.editor.filter);
  refreshFachSheet();

  const suggestions = new Set([...FAECHER.map((f) => f.kurz), ...state.cards.map((card) => card.fach)]);
  dom.fachList.replaceChildren(
    ...[...suggestions].map((value) => {
      const option = document.createElement('option');
      option.value = value;
      return option;
    }),
  );
}

/** Fach-Liste für „Erstellen“: alle Fächer mit Anzahl der Karten. */
function createFachOptions() {
  const counts = new Map();
  for (const card of state.cards) counts.set(fachKey(card.fach), (counts.get(fachKey(card.fach)) || 0) + 1);
  const extra = [...counts.keys()].filter((k) => !FACH_ORDER.has(k)).sort((a, b) => a.localeCompare(b, 'de'));
  const keys = [ALL_SUBJECTS, ...FAECHER.map((f) => f.id), ...extra];
  return keys.map((key) => ({
    key,
    kurz: key === ALL_SUBJECTS ? 'Alle Fächer' : fachLabel(key),
    name: key === ALL_SUBJECTS ? '' : fachName(key),
    count: key === ALL_SUBJECTS ? state.cards.length : counts.get(key) || 0,
    empty: key !== ALL_SUBJECTS && !counts.has(key),
  }));
}

function setCreateFach(key) {
  state.editor.filter = key;
  state.editor.limit = LIST_PAGE_SIZE;
  try {
    localStorage.setItem(CREATE_PREFS_KEY, key);
  } catch {
    /* nur Komfort */
  }
  renderSubjects();
  renderCardList();
}

function restoreCreateFach() {
  try {
    const key = localStorage.getItem(CREATE_PREFS_KEY);
    if (key) state.editor.filter = key;
  } catch {
    /* Standard: alle Fächer */
  }
}

/* ------------------------------------------------------------------ */
/* Erstellen: Formular                                                 */
/* ------------------------------------------------------------------ */

function readForm() {
  return {
    fach: dom.inputFach.value.trim(),
    frage: dom.inputFrage.value.trim(),
    antwort: dom.inputAntwort.value.trim(),
  };
}

function handleFormSubmit(event) {
  event.preventDefault();
  const values = readForm();
  const missing = [
    [values.fach, dom.inputFach],
    [values.frage, dom.inputFrage],
    [values.antwort, dom.inputAntwort],
  ].find(([value]) => !value);
  if (missing) {
    missing[1].focus();
    showToast('Bitte Fach, Frage und Antwort ausfüllen', 'error');
    return;
  }

  if (state.editor.editingId) {
    updateCard(state.editor.editingId, values);
  } else {
    addCard(values);
  }
}

/** Legt eine Karte mit der nächsten freien Nummer an (auch für „Lücken“ und „Wissen“). */
function createCard({ fach, frage, antwort, quelle = null }) {
  const card = normalizeCard({ id: createId(), fach, frage, antwort, quelle, nr: nextNr() });
  state.cards.push(card);
  markChanged(card.id);
  return card;
}

/** Erzeugt Karten für alles Wissen, zu dem es noch keine Karte gibt. */
function generateMissingCards() {
  const existing = new Set(state.cards.map((card) => card.quelle).filter(Boolean));
  const missing = allWissenCards().filter((d) => d.antwort && !existing.has(d.quelle));
  let nr = nextNr();
  const created = missing.map((d) => normalizeCard({ id: createId(), fach: d.fach, frage: d.frage, antwort: d.antwort, quelle: d.quelle, nr: nr++ }));
  if (!created.length) return 0;
  state.cards.push(...created);
  markChangedMany(created.map((card) => card.id));
  refreshAfterDataChange();
  renderLuecken();
  return created.length;
}

function countMissingCards() {
  const existing = new Set(state.cards.map((card) => card.quelle).filter(Boolean));
  return allWissenCards().filter((d) => d.antwort && !existing.has(d.quelle)).length;
}

function addCard({ fach, frage, antwort }) {
  const card = createCard({ fach, frage, antwort });

  // Fach bleibt stehen, damit mehrere Karten desselben Fachs schnell erfasst werden können
  dom.inputFrage.value = '';
  dom.inputAntwort.value = '';
  dom.inputFrage.focus();
  refreshAfterDataChange();
  showToast(`Karte ${formatNr(card.nr)} hinzugefügt`, 'success');
}

function updateCard(id, { fach, frage, antwort }) {
  const card = findCard(id);
  if (!card) {
    exitEditMode();
    showToast('Diese Karte existiert nicht mehr', 'error');
    return;
  }
  const view = cardView(card);
  const textChanged = view.frage !== frage || view.antwort !== antwort;
  // Eigener Text bei einer Wissens-Karte: als eigene Fassung speichern, Verknüpfung bleibt
  if (card.quelle && textChanged) card.eigeneFassung = true;
  Object.assign(card, { fach, frage, antwort });
  markChanged(id);
  exitEditMode();
  refreshAfterDataChange();
  showToast('Änderungen übernommen', 'success');
}

function enterEditMode(id) {
  const card = findCard(id);
  if (!card) return;
  state.editor.editingId = id;
  const view = cardView(card);
  dom.inputFach.value = card.fach;
  dom.inputFrage.value = view.frage;
  dom.inputAntwort.value = view.antwort;
  dom.formTitle.textContent = `Karte ${formatNr(card.nr)} bearbeiten`;
  dom.submitBtn.textContent = 'Änderungen speichern';
  dom.cancelEditBtn.hidden = false;
  dom.form.classList.add('is-editing');
  renderCardList();
  openModal(dom.cardSheet, dom.inputFrage);
}

/** Öffnet das Blatt für eine neue Karte; ein angefangener Entwurf bleibt erhalten. */
function openNewCard() {
  if (state.editor.editingId) exitEditMode();
  if (!dom.inputFach.value.trim() && state.editor.filter !== ALL_SUBJECTS) {
    dom.inputFach.value = fachLabel(state.editor.filter);
  }
  openModal(dom.cardSheet, dom.inputFach.value.trim() ? dom.inputFrage : dom.inputFach);
}

function closeCardSheet() {
  closeModal(dom.cardSheet);
}

function exitEditMode() {
  state.editor.editingId = null;
  dom.form.reset();
  dom.formTitle.textContent = 'Neue Karte';
  dom.submitBtn.textContent = 'Karte hinzufügen';
  dom.cancelEditBtn.hidden = true;
  dom.form.classList.remove('is-editing');
  if (!dom.cardSheet.hidden) closeModal(dom.cardSheet);
  renderCardList();
}

/** Löscht ohne Rückfrage; ein „Rückgängig“-Button im Toast schützt vor Fehltipps. */
function deleteCard(id) {
  const index = state.cards.findIndex((card) => card.id === id);
  if (index === -1) return;
  const [removed] = state.cards.splice(index, 1);
  if (state.editor.editingId === id) exitEditMode();
  markChanged(id);
  refreshAfterDataChange();

  showToast('Karte gelöscht', 'info', {
    label: 'Rückgängig',
    onClick: () => {
      if (findCard(removed.id)) return;
      state.cards.splice(Math.min(index, state.cards.length), 0, removed);
      markChanged(removed.id);
      refreshAfterDataChange();
      showToast('Karte wiederhergestellt', 'success');
    },
  });
}

/* ------------------------------------------------------------------ */
/* Erstellen: Kartenliste                                              */
/* ------------------------------------------------------------------ */

function buildCardListItem(card) {
  const item = el('li', 'list-item');
  item.dataset.id = card.id;
  if (card.id === state.editor.editingId) item.classList.add('is-editing');

  const view = cardView(card);
  const meta = el('div', 'list-meta');
  meta.append(
    el('span', 'card-nr', formatNr(card.nr)),
    el('span', 'badge', card.fach),
    el('span', `status-chip status-${statusOf(card.id)}`, STATUS_LABELS[statusOf(card.id)]),
  );
  if (!view.antwort.trim()) meta.append(el('span', 'tag tag-draft', 'Antwort offen'));

  const body = el('div', 'list-body');
  body.append(el('p', 'list-question', view.frage), el('p', 'list-answer', view.antwort));
  if (card.quelle) {
    const link = el('p', 'list-link', view.pfad ? `🔗 ${view.pfad}` : '🔗 Verknüpfte Stelle im Wissen nicht gefunden');
    if (card.eigeneFassung) link.append(el('span', 'tag', 'eigene Fassung'));
    body.append(link);
  }

  // Bearbeiten und Löschen sitzen rechts in der Kopfzeile, damit die Liste kompakt bleibt
  const actions = el('div', 'list-actions');
  const edit = el('button', 'icon-btn list-icon-btn', '✎');
  edit.type = 'button';
  edit.dataset.action = 'edit';
  edit.title = 'Bearbeiten';
  edit.setAttribute('aria-label', `Karte ${formatNr(card.nr)} bearbeiten`);
  const remove = el('button', 'icon-btn list-icon-btn is-danger', '🗑');
  remove.type = 'button';
  remove.dataset.action = 'delete';
  remove.title = 'Löschen';
  remove.setAttribute('aria-label', `Karte ${formatNr(card.nr)} löschen`);
  actions.append(edit, remove);
  meta.append(actions);

  item.append(meta, body);
  return item;
}

/**
 * Vorsätze wie „Erkläre den Begriff:“ oder „Was ist ein“ zählen für das
 * Register nicht: „Erkläre den Begriff: Bilanz“ steht unter B.
 */
const SORT_PREFIXES = [
  /^was\s+ist\s+die\s+kernaussage\s+zu\s+/i,
  /^(erkläre|erklären sie|erläutere|erläutern sie|beschreibe|beschreiben sie|definiere|definieren sie|nenne|nennen sie)\b\s*(kurz\s+)?((den|die|das)\s+)?(begriffe?|abkürzung|unterschied zwischen)?\s*:?\s*/i,
  /^was\s+(ist|sind|bedeutet|bedeuten|versteht man unter|beschreibt|regelt|misst|zeigt|macht)\b\s*/i,
  /^wof(ü|u)r\s+steht\s+(die\s+abkürzung\s+)?/i,
  /^(formuliere\s+in\s+managementsprache|ordne\s+zu|feynman)\s*:\s*/i,
  /^(der|die|das|ein|eine|einen|einem|einer)\s+/i,
];

function sortTerm(text) {
  let t = String(text || '').trim().replace(/^[„"'»«(\[]+/, '');
  for (let i = 0; i < 3; i++) {
    const before = t;
    for (const re of SORT_PREFIXES) t = t.replace(re, '');
    t = t.replace(/^[„"'»«(\[:\s]+/, '');
    if (t === before) break;
  }
  return t || String(text || '');
}

const LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#'];

function letterOf(term) {
  const c = norm(term).charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : '#';
}

/** Treffer der Suche: Nummer (z. B. „42“ oder „#0042“) oder Text in Frage, Antwort und Fach. */
function matchesQuery(card, view, query) {
  const q = query.trim();
  if (!q) return true;
  const nr = q.match(/^#?0*(\d+)$/);
  if (nr) return String(card.nr || '') === nr[1] || String(card.nr || '').startsWith(nr[1]);
  const needle = norm(q);
  return norm(`${view.frage} ${view.antwort} ${card.fach}`).includes(needle);
}

/** Sichtbare Karten, alphabetisch nach dem eigentlichen Begriff. */
function visibleCards() {
  const query = state.editor.query;
  return cardsForSubject(state.editor.filter)
    .map((card) => {
      const view = cardView(card);
      const term = sortTerm(view.frage);
      return { card, view, term, letter: letterOf(term) };
    })
    .filter(({ card, view }) => matchesQuery(card, view, query))
    .sort((a, b) => {
      const la = LETTERS.indexOf(a.letter);
      const lb = LETTERS.indexOf(b.letter);
      return la - lb || a.term.localeCompare(b.term, 'de', { sensitivity: 'base' }) || (a.card.nr || 0) - (b.card.nr || 0);
    });
}

function jumpToLetter(letter, rows) {
  const index = rows.findIndex((row) => row.letter === letter);
  if (index === -1) return;
  if (index >= state.editor.limit) {
    state.editor.limit = index + LIST_PAGE_SIZE;
    renderCardList();
  }
  const heading = document.getElementById(`cl-${letter === '#' ? 'num' : letter}`);
  if (heading) heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderLetters(rows) {
  const present = new Set(rows.map((row) => row.letter));
  dom.createLetters.replaceChildren(
    ...LETTERS.map((letter) => {
      const has = present.has(letter);
      const item = button(`letter${has ? '' : ' is-empty'}`, letter, () => jumpToLetter(letter, visibleCards()));
      item.disabled = !has;
      item.setAttribute('aria-label', letter === '#' ? 'Ziffern und Zeichen' : `Buchstabe ${letter}`);
      return item;
    }),
  );
  dom.createLetters.hidden = rows.length === 0;
}

function renderCardList() {
  const total = state.cards.length;
  const rows = visibleCards();
  const filtered = state.editor.filter !== ALL_SUBJECTS || state.editor.query.trim();

  dom.cardCounter.textContent = filtered ? `${rows.length} von ${total}` : String(total);
  renderLetters(rows);

  // Große Bestände seitenweise zeigen, damit die Liste flüssig bleibt
  const page = rows.slice(0, state.editor.limit);
  const groups = [];
  let current = null;
  for (const row of page) {
    if (!current || current.letter !== row.letter) {
      current = { letter: row.letter, rows: [] };
      groups.push(current);
    }
    current.rows.push(row);
  }
  dom.cardList.replaceChildren(
    ...groups.map((group) => {
      const section = el('section', 'card-group');
      const heading = el('h3', 'register-letter', group.letter);
      heading.id = `cl-${group.letter === '#' ? 'num' : group.letter}`;
      const list = el('ul', 'card-list-items');
      list.append(...group.rows.map((row) => buildCardListItem(row.card)));
      section.append(heading, list);
      return section;
    }),
  );
  dom.listMore.hidden = rows.length <= state.editor.limit;
  dom.listMore.textContent = `Weitere anzeigen (${rows.length - Math.min(rows.length, state.editor.limit)} übrig)`;

  dom.listEmpty.hidden = rows.length > 0;
  if (rows.length === 0) {
    if (total === 0) dom.listEmpty.textContent = 'Noch keine Karten vorhanden. Lege mit „＋ Neue Karte“ deine erste an.';
    else if (state.editor.query.trim()) dom.listEmpty.textContent = `Keine Karte passt zu „${state.editor.query.trim()}“.`;
    else dom.listEmpty.textContent = 'Keine Karten in diesem Fach.';
  }
}

function handleListClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const id = button.closest('.list-item').dataset.id;
  if (button.dataset.action === 'edit') enterEditMode(id);
  if (button.dataset.action === 'delete') deleteCard(id);
}

/** Alles neu zeichnen, was von den Kartendaten abhängt. */
function refreshAfterDataChange() {
  renderSubjects();
  renderCardList();
  refreshPractice();
  renderLuecken();
  renderLearner();
  refreshWissenStats();
}

function renderThemeButtons() {
  const choice = getThemeChoice();
  document.querySelectorAll('[data-theme-choice]').forEach((button) => {
    const active = button.dataset.themeChoice === choice;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

/** Zeigt, wessen Lernstand gerade gilt (pro Person getrennt). */
function renderLearner() {
  const login = currentLearner();
  const text = login
    ? `Lernstand von ${login} (Datei lernstand/${learnerFileName()}.json). Andere Personen haben ihren eigenen Lernstand.`
    : 'Wessen Lernstand gilt, ermittelt die App nach dem Verbinden anhand des Tokens.';
  document.getElementById('plan-learner').textContent = text;
  document.getElementById('mehr-learner').textContent = login || 'noch nicht verbunden';
  document.getElementById('settings-learner').textContent = login ? `Angemeldet als ${login}. ${text}` : text;
}

/* ------------------------------------------------------------------ */
/* Brücke für „Wissen“ und „Lücken“                                    */
/* ------------------------------------------------------------------ */

const cardBridge = {
  cards: () => state.cards,
  view: cardView,
  formatNr,
  forQuelle: (quelle) => state.cards.filter((card) => card.quelle === quelle),
  /** Neue Karte; mit Quelle wird der Text aus dem Wissen übernommen. */
  create(data) {
    const card = createCard(data);
    refreshAfterDataChange();
    return card;
  },
  createFromQuelle(quelle) {
    const linked = wissenCard(quelle);
    if (!linked) return null;
    return cardBridge.create({ fach: linked.fach, frage: linked.frage, antwort: linked.antwort, quelle });
  },
  /** Verknüpft eine bestehende Karte mit dem Wissen; ihr eigener Text bleibt erhalten. */
  link(id, quelle) {
    const card = findCard(id);
    if (!card) return;
    card.quelle = quelle;
    card.eigeneFassung = true;
    markChanged(id);
    refreshAfterDataChange();
  },
  generateMissing: generateMissingCards,
  countMissing: countMissingCards,
  edit(id) {
    switchTab('create');
    enterEditMode(id);
  },
  canSave: () => hasValidSettings(state.settings),
};

const practiceBridge = {
  cards: () => state.cards,
  view: cardView,
  formatNr,
  isConfigured: () => hasValidSettings(state.settings),
  openSettings: () => openSettings(),
  switchTab: (tab) => switchTab(tab),
  onGraded: () => renderCardList(),
};

/* ------------------------------------------------------------------ */
/* Einstellungen                                                       */
/* ------------------------------------------------------------------ */

function openSettings() {
  const s = state.settings;
  dom.setUser.value = s.user;
  dom.setRepo.value = s.repo;
  dom.setBranch.value = s.branch;
  dom.setPath.value = s.path;
  dom.setToken.value = s.token;
  dom.setLearner.value = s.learner || '';
  setSettingsMessage('');
  dom.settingsClear.hidden = !hasValidSettings(s);

  const firstEmpty = [dom.setUser, dom.setRepo, dom.setToken].find((input) => !input.value);
  openModal(dom.modal, firstEmpty || dom.settingsSave);
}

function closeSettings() {
  closeModal(dom.modal);
}

function setSettingsMessage(text, type = 'info') {
  dom.settingsMessage.hidden = !text;
  dom.settingsMessage.textContent = text;
  dom.settingsMessage.dataset.type = type;
}

async function handleSettingsSubmit(event) {
  event.preventDefault();
  const previous = state.settings;
  let next;
  try {
    next = saveSettings({
      user: dom.setUser.value,
      repo: dom.setRepo.value,
      branch: dom.setBranch.value,
      path: dom.setPath.value,
      token: dom.setToken.value,
      learner: dom.setLearner.value,
    });
  } catch (err) {
    setSettingsMessage(err.message, 'error');
    return;
  }
  if (!hasValidSettings(next)) {
    setSettingsMessage('Bitte Benutzername, Repository und Token ausfüllen.', 'error');
    return;
  }

  const targetChanged = hasValidSettings(previous) && settingsTarget(previous) !== settingsTarget(next);
  state.settings = next;
  if (targetChanged) {
    // Anderes Repository: Daten des alten Ziels nicht vermischen
    resetDataState();
    restoreFromCache();
  } else {
    state.remoteLoaded = false;
  }
  persistLocally();
  restoreProgress();
  refreshAfterDataChange();
  reloadWissenForSettings();

  dom.settingsSave.disabled = true;
  setSettingsMessage('Verbinde mit GitHub …');
  const ok = await syncFromRemote();
  dom.settingsSave.disabled = false;

  if (ok) {
    setSettingsMessage(`Verbunden ✓ ${pluralCards(state.cards.length)} geladen.`, 'success');
    dom.settingsClear.hidden = false;
    setTimeout(() => {
      if (!dom.modal.hidden) closeSettings();
    }, 900);
  } else {
    setSettingsMessage('Verbindung fehlgeschlagen. Bitte Angaben und Token prüfen.', 'error');
  }
}

function handleSettingsClear() {
  clearSettings();
  clearTimeout(state.saveTimer);
  state.settings = loadSettings();
  resetDataState();
  clearProgressCache();
  restoreProgress();
  exitEditMode();
  refreshAfterDataChange();
  reloadWissenForSettings({ clear: true });
  setSyncStatus('unconfigured');
  openSettings();
  setSettingsMessage('Zugangsdaten und lokaler Zwischenspeicher wurden von diesem Gerät entfernt.', 'success');
}

/* ------------------------------------------------------------------ */
/* Tastatur (Mac)                                                      */
/* ------------------------------------------------------------------ */

function isTypingTarget(target) {
  return target instanceof HTMLElement && target.matches('input, textarea, select, [contenteditable="true"]');
}

function handleKeydown(event) {
  if (isAnyModalOpen()) {
    if (event.key === 'Escape') closeTopModal();
    return;
  }
  if (state.tab !== 'practice' || isTypingTarget(event.target)) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (handlePracticeKey(event)) event.preventDefault();
}

/** Strg/Cmd + Enter in den Textfeldern schickt das Formular ab. */
function handleFormKeydown(event) {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    dom.form.requestSubmit();
  }
}

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

function bindEvents() {
  dom.tabs.forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.tab)));
  dom.openSettings.addEventListener('click', openSettings);

  dom.syncBtn.addEventListener('click', () => {
    if (!hasValidSettings(state.settings)) openSettings();
    else syncFromRemote({ announce: true });
  });

  dom.form.addEventListener('submit', handleFormSubmit);
  dom.form.addEventListener('keydown', handleFormKeydown);
  dom.cancelEditBtn.addEventListener('click', exitEditMode);
  dom.newCardBtn.addEventListener('click', openNewCard);
  dom.closeCardSheet.addEventListener('click', closeCardSheet);
  closeOnBackdropClick(dom.cardSheet, closeCardSheet);
  // Schließen über Escape oder Hintergrund beendet auch das Bearbeiten
  new MutationObserver(() => {
    if (dom.cardSheet.hidden && state.editor.editingId) exitEditMode();
  }).observe(dom.cardSheet, { attributes: true, attributeFilter: ['hidden'] });
  dom.createFachBtn.addEventListener('click', () =>
    openFachSheet({ title: 'Fach wählen · Karten', getOptions: createFachOptions, current: state.editor.filter, onPick: setCreateFach }),
  );
  let searchTimer = null;
  dom.createSearch.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.editor.query = dom.createSearch.value;
      state.editor.limit = LIST_PAGE_SIZE;
      renderCardList();
    }, 120);
  });
  dom.listMore.addEventListener('click', () => {
    state.editor.limit += LIST_PAGE_SIZE;
    renderCardList();
  });

  // Geändertes Wissen ändert die Texte verknüpfter Karten
  document.addEventListener('wissen:changed', () => {
    refreshAfterDataChange();
  });
  dom.cardList.addEventListener('click', handleListClick);

  // Darstellung Hell / Dunkel / Auto (Seite „Mehr“)
  document.querySelectorAll('[data-theme-choice]').forEach((button) => {
    button.addEventListener('click', () => setThemeChoice(button.dataset.themeChoice));
  });
  document.addEventListener('theme:changed', renderThemeButtons);
  renderThemeButtons();

  dom.settingsForm.addEventListener('submit', handleSettingsSubmit);
  dom.settingsClear.addEventListener('click', handleSettingsClear);
  dom.closeSettings.addEventListener('click', closeSettings);
  closeOnBackdropClick(dom.modal, closeSettings);
  initToast();

  // Links aus dem Nachschlagewerk (z. B. „Zum Thema“) holen den Tab „Wissen“ nach vorn
  document.addEventListener('wissen:show', () => {
    if (state.tab !== 'wissen') switchTab('wissen');
  });

  document.addEventListener('keydown', handleKeydown);

  // Beim Verlassen der App (z. B. App-Wechsel auf Android) sofort speichern statt auf den Timer zu warten
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return;
    if (state.pending.size > 0) requestSave();
    flushProgress();
  });
  // Nach Wiederherstellung der Verbindung einen einzelnen Speicherversuch starten
  window.addEventListener('online', () => {
    if (state.pending.size > 0) requestSave();
    flushProgress();
  });
}

function init() {
  initTheme();
  bindEvents();
  initWissen({ getSettings: () => state.settings });
  setCardBridge(cardBridge);
  initLuecken({ getSettings: () => state.settings, cards: cardBridge });
  initProgress({ getSettings: () => state.settings, onChange: () => refreshAfterDataChange() });
  restoreTab();
  restoreCreateFach();
  restoreFromCache();
  state.lastRemoteIds = state.cards.filter((card) => !state.pending.has(card.id)).map((card) => card.id);
  renderSubjects();
  renderCardList();
  initFachSheet();
  initPractice(practiceBridge);

  if (hasValidSettings(state.settings)) {
    syncFromRemote();
  } else {
    setSyncStatus('unconfigured');
    openSettings();
  }
}

init();
