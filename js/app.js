/**
 * app.js
 *
 * UI-Logik der Lernkartei: Tabs, Übungsmodus, Kartenformular, Kartenliste,
 * Einstellungen-Modal, Toasts und das verzögerte Speichern.
 * Alle GitHub- und Speicherzugriffe laufen über github-sync.js.
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

const SAVE_DELAY_MS = 1200;
const TOAST_DURATION_MS = 2500;
const TOAST_UNDO_DURATION_MS = 5000;
const ALL_SUBJECTS = '__all__';
const VALID_STATUS = ['neu', 'lernen', 'gelernt'];
const STATUS_LABELS = { neu: 'Neu', lernen: 'Lernen', gelernt: 'Gelernt' };

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
  practice: {
    filter: ALL_SUBJECTS,
    order: [],
    index: 0,
    flipped: false,
    known: 0,
    again: 0,
  },
  editor: {
    editingId: null,
    filter: ALL_SUBJECTS,
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
  views: { practice: $('view-practice'), create: $('view-create') },
  syncStatus: $('sync-status'),
  openSettings: $('open-settings'),

  practiceFilter: $('practice-filter'),
  shuffleBtn: $('shuffle-btn'),
  syncBtn: $('sync-btn'),
  practiceArea: $('practice-area'),
  progress: $('practice-progress'),
  cardScene: $('card-scene'),
  flashcard: $('flashcard'),
  cardFront: $('card-front'),
  cardBack: $('card-back'),
  cardFachFront: $('card-fach-front'),
  cardFachBack: $('card-fach-back'),
  cardQuestion: $('card-question'),
  cardAnswer: $('card-answer'),
  rateAgain: $('rate-again'),
  rateKnown: $('rate-known'),
  practiceEmpty: $('practice-empty'),
  practiceEmptyIcon: $('practice-empty-icon'),
  practiceEmptyTitle: $('practice-empty-title'),
  practiceEmptyText: $('practice-empty-text'),
  practiceEmptyAction: $('practice-empty-action'),

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

  toast: $('toast'),
  toastText: $('toast-text'),
  toastAction: $('toast-action'),
};

/* ------------------------------------------------------------------ */
/* Allgemeine Hilfsfunktionen                                          */
/* ------------------------------------------------------------------ */

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Fisher-Yates-Shuffle, liefert eine neue Liste. */
function shuffle(items) {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Erzeugt ein Element; Texte werden immer über textContent gesetzt (kein HTML-Injection-Risiko). */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
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
  };
}

function findCard(id) {
  return state.cards.find((card) => card.id === id) || null;
}

function getSubjects() {
  const subjects = new Set(state.cards.map((card) => card.fach));
  return [...subjects].sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' }));
}

function cardsForSubject(subject) {
  return subject === ALL_SUBJECTS ? state.cards : state.cards.filter((card) => card.fach === subject);
}

function pluralCards(n) {
  return `${n} ${n === 1 ? 'Karte' : 'Karten'}`;
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
function showToast(message, type = 'info', action = null) {
  clearTimeout(toastTimer);
  dom.toastText.textContent = message;
  dom.toast.dataset.type = type;
  toastActionHandler = action ? action.onClick : null;
  dom.toastAction.hidden = !action;
  if (action) dom.toastAction.textContent = action.label;

  dom.toast.hidden = false;
  // Reflow erzwingen, damit die Einblend-Transition jedes Mal greift
  void dom.toast.offsetWidth;
  dom.toast.classList.add('is-visible');

  toastTimer = setTimeout(hideToast, action ? TOAST_UNDO_DURATION_MS : TOAST_DURATION_MS);
}

function hideToast() {
  dom.toast.classList.remove('is-visible');
  toastActionHandler = null;
  toastTimer = setTimeout(() => {
    dom.toast.hidden = true;
  }, 250);
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
    return true;
  });
}

/** Markiert eine Karte als geändert und plant das verzögerte Speichern. */
function markChanged(id) {
  state.rev += 1;
  state.pending.set(id, state.rev);
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
    const option = el('option', null, subject);
    option.value = subject;
    select.append(option);
  }
  select.value = value;
  return value;
}

function renderSubjects() {
  const subjects = getSubjects();
  state.practice.filter = fillSubjectSelect(dom.practiceFilter, subjects, state.practice.filter);
  state.editor.filter = fillSubjectSelect(dom.listFilter, subjects, state.editor.filter);

  dom.fachList.replaceChildren(
    ...subjects.map((subject) => {
      const option = document.createElement('option');
      option.value = subject;
      return option;
    }),
  );
}

/* ------------------------------------------------------------------ */
/* Üben                                                                */
/* ------------------------------------------------------------------ */

/** Baut die Übungsreihenfolge für das gewählte Fach neu auf (gemischt). */
function startRound() {
  const ids = cardsForSubject(state.practice.filter).map((card) => card.id);
  Object.assign(state.practice, { order: shuffle(ids), index: 0, known: 0, again: 0 });
  renderPractice({ animate: true });
}

/**
 * Passt die laufende Runde an geänderte Daten an (Sync, Bearbeiten, Löschen),
 * ohne den Fortschritt zu verlieren. Neue Karten werden hinten angehängt.
 */
function reconcilePracticeOrder() {
  const p = state.practice;
  const validIds = new Set(cardsForSubject(p.filter).map((card) => card.id));
  const done = p.order.slice(0, p.index).filter((id) => validIds.has(id));
  const upcoming = p.order.slice(p.index).filter((id) => validIds.has(id));
  const known = new Set(p.order);
  const added = shuffle([...validIds].filter((id) => !known.has(id)));
  p.order = [...done, ...upcoming, ...added];
  p.index = done.length;
}

function currentPracticeCard() {
  const id = state.practice.order[state.practice.index];
  return id ? findCard(id) : null;
}

function showPracticeEmpty(icon, title, text, action = null) {
  dom.practiceArea.hidden = true;
  dom.practiceEmpty.hidden = false;
  dom.practiceEmptyIcon.textContent = icon;
  dom.practiceEmptyTitle.textContent = title;
  dom.practiceEmptyText.textContent = text;
  dom.practiceEmptyAction.hidden = !action;
  if (action) {
    dom.practiceEmptyAction.textContent = action.label;
    dom.practiceEmptyAction.onclick = action.onClick;
  }
}

function renderPractice({ animate = false } = {}) {
  const p = state.practice;
  const total = p.order.length;

  if (state.cards.length === 0) {
    if (!hasValidSettings(state.settings)) {
      showPracticeEmpty('🔌', 'Noch nicht verbunden', 'Verbinde zuerst dein GitHub-Repository, um deine Karten zu laden.', {
        label: 'Einstellungen öffnen',
        onClick: openSettings,
      });
    } else {
      showPracticeEmpty('🗂️', 'Noch keine Karten', 'Lege im Tab „Erstellen“ deine erste Lernkarte an.', {
        label: 'Karte erstellen',
        onClick: () => {
          switchTab('create');
          dom.inputFach.focus();
        },
      });
    }
    return;
  }

  if (total === 0) {
    showPracticeEmpty('🔍', 'Keine Karten in diesem Fach', `Im Fach „${p.filter}“ gibt es noch keine Karten.`, {
      label: 'Alle Fächer üben',
      onClick: () => {
        state.practice.filter = ALL_SUBJECTS;
        dom.practiceFilter.value = ALL_SUBJECTS;
        startRound();
      },
    });
    return;
  }

  if (p.index >= total) {
    showPracticeEmpty(
      '🎉',
      'Runde geschafft!',
      `Du hast ${pluralCards(total)} geübt: ${p.known} gewusst, ${p.again} zum Wiederholen markiert.`,
      { label: '🔀 Neu mischen & weiter üben', onClick: startRound },
    );
    return;
  }

  dom.practiceEmpty.hidden = true;
  dom.practiceArea.hidden = false;
  dom.progress.textContent = `Karte ${p.index + 1} von ${total}`;
  showCard(currentPracticeCard(), animate);
}

/** Setzt die Karte ohne sichtbare Rückdreh-Animation auf die Vorderseite und füllt die Texte. */
function showCard(card, animate) {
  const inner = dom.flashcard.firstElementChild;
  inner.classList.add('no-transition');
  setFlipped(false);
  dom.cardFachFront.textContent = card.fach;
  dom.cardFachBack.textContent = card.fach;
  dom.cardQuestion.textContent = card.frage;
  dom.cardAnswer.textContent = card.antwort;
  dom.cardFront.scrollTop = 0;
  dom.cardBack.scrollTop = 0;
  void inner.offsetWidth;
  inner.classList.remove('no-transition');

  if (animate) {
    dom.cardScene.classList.remove('card-enter');
    void dom.cardScene.offsetWidth;
    dom.cardScene.classList.add('card-enter');
  }
}

function setFlipped(flipped) {
  state.practice.flipped = flipped;
  dom.flashcard.classList.toggle('is-flipped', flipped);
  dom.cardFront.setAttribute('aria-hidden', String(flipped));
  dom.cardBack.setAttribute('aria-hidden', String(!flipped));
  dom.flashcard.setAttribute('aria-label', flipped ? 'Karte zurückdrehen' : 'Karte umdrehen, Antwort zeigen');
}

function flipCard() {
  if (!currentPracticeCard()) return;
  setFlipped(!state.practice.flipped);
}

/** Bewertet die aktuelle Karte und zeigt die nächste. */
function rateCard(known) {
  const card = currentPracticeCard();
  if (!card) return;

  card.status = known ? 'gelernt' : 'lernen';
  card.wiederholungen += 1;
  card.letzteUebung = new Date().toISOString();
  if (known) state.practice.known += 1;
  else state.practice.again += 1;
  state.practice.index += 1;

  markChanged(card.id);
  renderCardList();
  renderPractice({ animate: true });
  if (!dom.practiceArea.hidden) dom.flashcard.focus({ preventScroll: true });
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

function addCard({ fach, frage, antwort }) {
  const card = { id: createId(), fach, frage, antwort, status: 'neu', wiederholungen: 0, letzteUebung: null };
  state.cards.push(card);
  markChanged(card.id);

  // Fach bleibt stehen, damit mehrere Karten desselben Fachs schnell erfasst werden können
  dom.inputFrage.value = '';
  dom.inputAntwort.value = '';
  dom.inputFrage.focus();
  refreshAfterDataChange();
  showToast('Karte hinzugefügt', 'success');
}

function updateCard(id, { fach, frage, antwort }) {
  const card = findCard(id);
  if (!card) {
    exitEditMode();
    showToast('Diese Karte existiert nicht mehr', 'error');
    return;
  }
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
  dom.inputFach.value = card.fach;
  dom.inputFrage.value = card.frage;
  dom.inputAntwort.value = card.antwort;
  dom.formTitle.textContent = 'Karte bearbeiten';
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

  const meta = el('div', 'list-meta');
  meta.append(el('span', 'badge', card.fach), el('span', `status-chip status-${card.status}`, STATUS_LABELS[card.status]));

  const body = el('div', 'list-body');
  body.append(el('p', 'list-question', card.frage), el('p', 'list-answer', card.antwort));

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
  const visible = cardsForSubject(state.editor.filter).slice().reverse(); // neueste zuerst

  dom.cardCounter.textContent =
    state.editor.filter === ALL_SUBJECTS ? `(${total})` : `(${visible.length} von ${total})`;
  dom.cardList.replaceChildren(...visible.map(buildCardListItem));

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
  const before = currentPracticeCard();
  const flipped = state.practice.flipped;
  reconcilePracticeOrder();
  renderPractice();
  // Ist dieselbe Karte noch dran, bleibt sie umgedreht
  if (before && currentPracticeCard() === before && flipped) setFlipped(true);
}

/* ------------------------------------------------------------------ */
/* Einstellungen                                                       */
/* ------------------------------------------------------------------ */

let lastFocusBeforeModal = null;

function openSettings() {
  const s = state.settings;
  dom.setUser.value = s.user;
  dom.setRepo.value = s.repo;
  dom.setBranch.value = s.branch;
  dom.setPath.value = s.path;
  dom.setToken.value = s.token;
  setSettingsMessage('');
  dom.settingsClear.hidden = !hasValidSettings(s);

  lastFocusBeforeModal = document.activeElement;
  dom.modal.hidden = false;
  document.body.classList.add('modal-open');
  const firstEmpty = [dom.setUser, dom.setRepo, dom.setToken].find((input) => !input.value);
  (firstEmpty || dom.settingsSave).focus();
}

function closeSettings() {
  dom.modal.hidden = true;
  document.body.classList.remove('modal-open');
  if (lastFocusBeforeModal && typeof lastFocusBeforeModal.focus === 'function') lastFocusBeforeModal.focus();
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
  refreshAfterDataChange();

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
    if (state.practice.order.length > 0 && state.practice.index === 0) startRound();
  } else {
    setSettingsMessage('Verbindung fehlgeschlagen. Bitte Angaben und Token prüfen.', 'error');
  }
}

function handleSettingsClear() {
  clearSettings();
  clearTimeout(state.saveTimer);
  state.settings = loadSettings();
  resetDataState();
  exitEditMode();
  refreshAfterDataChange();
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
  if (!dom.modal.hidden) {
    if (event.key === 'Escape') closeSettings();
    return;
  }
  if (state.tab !== 'practice' || dom.practiceArea.hidden || isTypingTarget(event.target)) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  const onOtherControl = event.target instanceof HTMLElement && event.target.closest('button, a') !== null;

  if ((event.key === ' ' || event.key === 'Enter') && !onOtherControl) {
    event.preventDefault();
    flipCard();
  } else if (event.key === '1' || event.key === 'ArrowLeft') {
    event.preventDefault();
    rateCard(false);
  } else if (event.key === '2' || event.key === 'ArrowRight') {
    event.preventDefault();
    rateCard(true);
  }
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

  dom.practiceFilter.addEventListener('change', () => {
    state.practice.filter = dom.practiceFilter.value;
    startRound();
  });
  dom.shuffleBtn.addEventListener('click', startRound);
  dom.syncBtn.addEventListener('click', () => {
    if (!hasValidSettings(state.settings)) openSettings();
    else syncFromRemote({ announce: true });
  });
  dom.flashcard.addEventListener('click', flipCard);
  dom.rateAgain.addEventListener('click', () => rateCard(false));
  dom.rateKnown.addEventListener('click', () => rateCard(true));

  dom.form.addEventListener('submit', handleFormSubmit);
  dom.form.addEventListener('keydown', handleFormKeydown);
  dom.cancelEditBtn.addEventListener('click', exitEditMode);
  dom.listFilter.addEventListener('change', () => {
    state.editor.filter = dom.listFilter.value;
    renderCardList();
  });
  dom.cardList.addEventListener('click', handleListClick);

  dom.settingsForm.addEventListener('submit', handleSettingsSubmit);
  dom.settingsClear.addEventListener('click', handleSettingsClear);
  dom.closeSettings.addEventListener('click', closeSettings);
  dom.modal.addEventListener('click', (event) => {
    if (event.target === dom.modal) closeSettings();
  });

  dom.toastAction.addEventListener('click', () => {
    const handler = toastActionHandler;
    hideToast();
    if (handler) handler();
  });

  document.addEventListener('keydown', handleKeydown);

  // Beim Verlassen der App (z. B. App-Wechsel auf Android) sofort speichern statt auf den Timer zu warten
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && state.pending.size > 0) requestSave();
  });
  // Nach Wiederherstellung der Verbindung einen einzelnen Speicherversuch starten
  window.addEventListener('online', () => {
    if (state.pending.size > 0) requestSave();
  });
}

function init() {
  bindEvents();
  restoreFromCache();
  state.lastRemoteIds = state.cards.filter((card) => !state.pending.has(card.id)).map((card) => card.id);
  renderSubjects();
  renderCardList();
  startRound();

  if (hasValidSettings(state.settings)) {
    syncFromRemote().then((ok) => {
      // Neu mischen, solange noch keine Karte bewertet wurde
      if (ok && state.practice.index === 0) startRound();
    });
  } else {
    setSyncStatus('unconfigured');
    openSettings();
  }
}

init();
