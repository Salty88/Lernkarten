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
import { el, showToast, initToast, openModal, closeModal, closeTopModal, isAnyModalOpen, closeOnBackdropClick } from './ui.js';
import { initWissen, syncWissen, reloadWissenForSettings, setCardBridge } from './wissen.js';
import { FAECHER, fachKey, fachLabel, fachName, wissenCard, allWissenCards } from './wissen-data.js';
import { initPractice, refreshPractice, handlePracticeKey } from './practice.js';
import {
  initProgress,
  restoreProgress,
  loadProgress,
  flushProgress,
  migrateFromCards,
  statusOf,
  clearProgressCache,
  currentLearner,
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
  views: { practice: $('view-practice'), create: $('view-create'), wissen: $('view-wissen'), luecken: $('view-luecken') },
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
  listFilter: $('list-filter'),
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

/** Befüllt ein Filter-Dropdown und behält die Auswahl, solange das Fach existiert. */
function fillSubjectSelect(select, subjects, current) {
  const value = subjects.includes(current) ? current : ALL_SUBJECTS;
  select.replaceChildren();
  const all = el('option', null, 'Alle Fächer');
  all.value = ALL_SUBJECTS;
  select.append(all);
  for (const subject of subjects) {
    const option = el('option', null, fachLabel(subject));
    option.title = fachName(subject);
    option.value = subject;
    select.append(option);
  }
  select.value = value;
  return value;
}

function renderSubjects() {
  const subjects = getSubjects();
  state.editor.filter = fillSubjectSelect(dom.listFilter, subjects, state.editor.filter);

  const suggestions = new Set([...FAECHER.map((f) => f.kurz), ...state.cards.map((card) => card.fach)]);
  dom.fachList.replaceChildren(
    ...[...suggestions].map((value) => {
      const option = document.createElement('option');
      option.value = value;
      return option;
    }),
  );
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
  dom.form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  dom.inputFrage.focus({ preventScroll: true });
}

function exitEditMode() {
  state.editor.editingId = null;
  dom.form.reset();
  dom.formTitle.textContent = 'Neue Karte';
  dom.submitBtn.textContent = 'Karte hinzufügen';
  dom.cancelEditBtn.hidden = true;
  dom.form.classList.remove('is-editing');
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

  const actions = el('div', 'list-actions');
  const edit = el('button', 'btn btn-small btn-secondary', '✎ Bearbeiten');
  edit.type = 'button';
  edit.dataset.action = 'edit';
  const remove = el('button', 'btn btn-small btn-ghost-danger', '🗑 Löschen');
  remove.type = 'button';
  remove.dataset.action = 'delete';
  actions.append(edit, remove);

  item.append(meta, body, actions);
  return item;
}

function renderCardList() {
  const total = state.cards.length;
  const visible = cardsForSubject(state.editor.filter).slice().sort((a, b) => (b.nr || 0) - (a.nr || 0)); // neueste zuerst

  dom.cardCounter.textContent =
    state.editor.filter === ALL_SUBJECTS ? `(${total})` : `(${visible.length} von ${total})`;
  // Große Bestände seitenweise zeigen, damit die Liste flüssig bleibt
  const editing = state.editor.editingId ? visible.filter((c) => c.id === state.editor.editingId) : [];
  const page = visible.slice(0, state.editor.limit);
  if (editing.length && !page.includes(editing[0])) page.unshift(editing[0]);
  dom.cardList.replaceChildren(...page.map(buildCardListItem));
  dom.listMore.hidden = visible.length <= state.editor.limit;
  dom.listMore.textContent = `Weitere anzeigen (${visible.length - Math.min(visible.length, state.editor.limit)} übrig)`;

  dom.listEmpty.hidden = visible.length > 0;
  if (visible.length === 0) {
    dom.listEmpty.textContent =
      total === 0 ? 'Noch keine Karten vorhanden. Lege oben deine erste Karte an.' : 'Keine Karten in diesem Fach.';
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
}

/** Zeigt, wessen Lernstand gerade gilt (pro Person getrennt). */
function renderLearner() {
  const login = currentLearner();
  const text = login
    ? `Lernstand von ${login} (Datei lernstand/${login.toLowerCase()}.json). Andere Personen haben ihren eigenen Lernstand.`
    : 'Wessen Lernstand gilt, ermittelt die App nach dem Verbinden anhand des Tokens.';
  document.getElementById('plan-learner').textContent = text;
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
  dom.listFilter.addEventListener('change', () => {
    state.editor.filter = dom.listFilter.value;
    state.editor.limit = LIST_PAGE_SIZE;
    renderCardList();
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
  bindEvents();
  initWissen({ getSettings: () => state.settings });
  setCardBridge(cardBridge);
  initLuecken({ getSettings: () => state.settings, cards: cardBridge });
  initProgress({ getSettings: () => state.settings, onChange: () => refreshAfterDataChange() });
  restoreTab();
  restoreFromCache();
  state.lastRemoteIds = state.cards.filter((card) => !state.pending.has(card.id)).map((card) => card.id);
  renderSubjects();
  renderCardList();
  initPractice(practiceBridge);

  if (hasValidSettings(state.settings)) {
    syncFromRemote();
  } else {
    setSyncStatus('unconfigured');
    openSettings();
  }
}

init();
