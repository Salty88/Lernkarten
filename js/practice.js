/**
 * practice.js
 *
 * Reiter „Üben“:
 *  - „Heute fällig“: fällige Karten (Leitner) plus eine begrenzte Zahl neuer Karten,
 *    bewusst gemischt über Fächer und Themen (Interleaving)
 *  - Fach wählbar (Schwerpunkt) oder „Alle“ gemischt; das Fach ist stets sichtbar
 *  - „Freies Üben“: zusätzlich Thema frei wählen
 *  - Übungsformen: Klassisch (umdrehen, selbst bewerten), Multiple Choice
 *    (Begriff → Erklärung) und Begriff erkennen (Erklärung → Begriff)
 *  - Tipps und Verweise ins Wissen
 */

import { el, button, plural, norm, isAnyModalOpen } from './ui.js';
import { openFachSheet, refreshFachSheet } from './fach-sheet.js';
import { startThinkTimer, THINK_CHOICES, THINK_DEFAULT, FADE_MS } from './think-timer.js';
import { renderRich, plainText } from './richtext.js';
import {
  store,
  createLinker,
  termsInText,
  targetName,
  targetForQuelle,
  merkerTitle,
  quelleGroup,
  fachKey as toFachKey,
  fachLabel,
  fachName,
  FAECHER,
} from './wissen-data.js';
import { openSheet, openMerker, openEntry } from './wissen.js';
import { today, addDays, getEntry, record, dayStats, nextDueDate, countDue, progressRevision } from './progress.js';

const PREFS_KEY = 'lernkartei.ueben';
const ALL = '__all__';
const THEME_EIGEN = 'eigen';
const THEME_NONE = '__ohne__';
const OPTION_COUNT = 4;
const OPTION_MAX_CHARS = 190;
const MAX_HINT_TERMS = 4;
const MAX_LINK_TERMS = 8;
const EXTRA_NEW_STEP = 10;

let bridge = null;
let thinkTimer = null; // laufende Denkzeit der klassischen Karte
let fadeTimer = null;
const $ = (id) => document.getElementById(id);
const linker = createLinker((target) => openSheet(target));

/** Zustand der Übung. Plan-Einstellungen gelten pro Gerät. */
const pr = {
  mode: 'heute',
  format: 'gemischt',
  newPerDay: 20,
  sessionMax: 60,
  fach: ALL, // Schwerpunkt-Fach (Fach-Schlüssel) oder ALL
  theme: ALL,
  queue: [],
  index: 0,
  retried: new Set(),
  stats: { richtig: 0, falsch: 0 },
  extraNew: 0,
  builtFor: null,
  builtRev: -1,
  current: null, // { card, format, choice, answered, chosen }
  revealed: false, // klassische Karte: Antwort vollständig sichtbar
  thinkSeconds: THINK_DEFAULT,
};

/* ------------------------------------------------------------------ */
/* Einstellungen pro Gerät                                             */
/* ------------------------------------------------------------------ */

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    if (['heute', 'frei'].includes(p.mode)) pr.mode = p.mode;
    if (['gemischt', 'mc', 'klassisch'].includes(p.format)) pr.format = p.format;
    if (typeof p.fach === 'string') pr.fach = p.fach;
    if (Number.isInteger(p.newPerDay)) pr.newPerDay = Math.min(200, Math.max(0, p.newPerDay));
    if (Number.isInteger(p.sessionMax)) pr.sessionMax = Math.min(300, Math.max(5, p.sessionMax));
    if (THINK_CHOICES.includes(p.thinkSeconds)) pr.thinkSeconds = p.thinkSeconds;
  } catch {
    /* Standardwerte */
  }
}

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ mode: pr.mode, format: pr.format, fach: pr.fach, newPerDay: pr.newPerDay, sessionMax: pr.sessionMax, thinkSeconds: pr.thinkSeconds }));
  } catch {
    /* nur Komfort */
  }
}

/* ------------------------------------------------------------------ */
/* Hilfen                                                              */
/* ------------------------------------------------------------------ */

function shuffle(items) {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function themeOf(card) {
  return quelleGroup(card.quelle) || THEME_NONE;
}

/** Gruppe fürs Mischen: Thema (Merker) bzw. Fach bei Karten ohne Verknüpfung. */
function mixGroup(card) {
  const theme = themeOf(card);
  return theme === THEME_NONE || theme === THEME_EIGEN ? `${theme}:${toFachKey(card.fach)}` : theme;
}

/**
 * Interleaving: abwechselnd aus verschiedenen Themen ziehen, damit nicht
 * mehrere Karten desselben Themas direkt hintereinander kommen.
 */
function interleave(cards) {
  const groups = new Map();
  for (const card of shuffle(cards)) {
    const key = mixGroup(card);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(card);
  }
  const lists = shuffle([...groups.values()]);
  const result = [];
  while (lists.some((l) => l.length)) {
    for (const list of lists) if (list.length) result.push(list.shift());
  }
  return result;
}

function practicable() {
  return bridge.cards().filter((card) => bridge.view(card).antwort.trim() !== '');
}

function quelleTyp(quelle) {
  if (!quelle) return null;
  if (quelle.startsWith('m:')) return quelle.split('|')[2];
  return quelle[0]; // a oder e
}

function truncate(text, max = OPTION_MAX_CHARS) {
  const t = plainText(text).replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max).replace(/\s+\S*$/, '')} …`;
}

/* ------------------------------------------------------------------ */
/* Sitzung aufbauen                                                    */
/* ------------------------------------------------------------------ */

function inFach(card, fach = pr.fach) {
  return fach === ALL || toFachKey(card.fach) === fach;
}

/** Wie viele Karten „Heute fällig“ in einem Fach enthalten würde (fällige plus neue bis zum Limit). */
function todayCount(fach) {
  const day = today();
  const cards = practicable().filter((c) => inFach(c, fach));
  const due = countDue(cards.map((c) => c.id), day);
  const allowance = Math.max(0, pr.newPerDay + pr.extraNew - dayStats(day).neu);
  const fresh = Math.min(cards.filter((c) => !getEntry(c.id)).length, allowance);
  return Math.min(due + fresh, pr.sessionMax);
}

/** „Heute fällig“: fällige zuerst, dazu neue Karten bis zum Tageslimit; gemischt. */
function buildToday() {
  const day = today();
  const cards = practicable().filter((c) => inFach(c));
  const due = cards.filter((c) => {
    const e = getEntry(c.id);
    return e && e.f <= day;
  });
  // Am längsten überfällige zuerst auswählen, danach mischen
  due.sort((a, b) => getEntry(a.id).f.localeCompare(getEntry(b.id).f));
  const allowance = Math.max(0, pr.newPerDay + pr.extraNew - dayStats(day).neu);
  const fresh = interleave(cards.filter((c) => !getEntry(c.id))).slice(0, allowance);
  const picked = [...due, ...fresh].slice(0, pr.sessionMax);
  return interleave(picked).map((c) => c.id);
}

function buildFree() {
  const cards = practicable().filter(
    (c) => inFach(c) && (pr.theme === ALL || themeOf(c) === pr.theme),
  );
  return interleave(cards).map((c) => c.id);
}

export function startSession() {
  pr.queue = pr.mode === 'heute' ? buildToday() : buildFree();
  pr.index = 0;
  pr.retried = new Set();
  pr.stats = { richtig: 0, falsch: 0 };
  pr.builtFor = pr.mode === 'heute' ? today() : null;
  pr.builtRev = progressRevision();
  pr.current = null;
  renderPractice();
}

/** Nach Datenänderungen: gelöschte Karten entfernen, neue im freien Modus ergänzen. */
function reconcile() {
  const valid = new Set(practicable().map((c) => c.id));
  const before = pr.queue[pr.index];
  const done = pr.queue.slice(0, pr.index).filter((id) => valid.has(id));
  let upcoming = pr.queue.slice(pr.index).filter((id) => valid.has(id));
  if (pr.mode === 'frei') {
    const known = new Set(pr.queue);
    upcoming = [...upcoming, ...buildFree().filter((id) => !known.has(id))];
  }
  pr.queue = [...done, ...upcoming];
  pr.index = done.length;
  if (pr.current && pr.queue[pr.index] !== before) pr.current = null;
}

function currentCard() {
  const id = pr.queue[pr.index];
  return id ? bridge.cards().find((c) => c.id === id) || null : null;
}

/* ------------------------------------------------------------------ */
/* Übungsformen und Antwortmöglichkeiten                                */
/* ------------------------------------------------------------------ */

/** Ablenker nach Nähe sortiert: gleiches Thema, gleicher Merker, gleiches Fach. */
function pickDistractors(tiers, correctText, count = OPTION_COUNT - 1) {
  const seen = new Set([norm(correctText)]);
  const result = [];
  for (const tier of tiers) {
    for (const text of shuffle(tier)) {
      const key = norm(text);
      if (!text || seen.has(key)) continue;
      seen.add(key);
      result.push(text);
      if (result.length === count) return result;
    }
  }
  return result.length === count ? result : null;
}

function termOptionText(term) {
  return truncate([term.kurz, term.funktion].filter(Boolean).join(' '));
}

function termTiers(term, map) {
  const others = store.index.terms.filter((t) => norm(t.begriff) !== norm(term.begriff));
  return [
    others.filter((t) => t.block === term.block).map(map),
    others.filter((t) => t.merker === term.merker && t.block !== term.block).map(map),
    others.filter((t) => t.fach === term.fach && t.merker !== term.merker).map(map),
  ];
}

/** Begriffsnamen im Text ausblenden (für „Begriff erkennen“). */
function maskTerm(text, begriff) {
  const words = begriff
    .replace(/\([^)]*\)/g, ' ')
    .split(/[\s/,-]+/)
    .filter((w) => w.length >= 4);
  let masked = plainText(text);
  for (const word of words) {
    const stem = word.slice(0, Math.max(4, word.length - 2)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    masked = masked.replace(new RegExp(`(?<![\\p{L}])${stem}\\p{L}*`, 'giu'), '▢▢▢');
  }
  return masked;
}

/** Baut eine Auswahlfrage oder null, wenn es keine passenden Ablenker gibt. */
function buildChoice(card, format) {
  const typ = quelleTyp(card.quelle);
  const ziel = targetForQuelle(card.quelle);
  const view = bridge.view(card);
  let label;
  let prompt;
  let correct;
  let distractors;

  if (typ === 'b' && ziel && ziel.term) {
    const term = ziel.term;
    if (format === 'reverse') {
      label = 'Welcher Begriff ist gemeint?';
      prompt = maskTerm([term.kurz, term.funktion].filter(Boolean).join('\n\n'), term.begriff);
      correct = term.begriff;
      distractors = pickDistractors(termTiers(term, (t) => t.begriff), correct);
    } else {
      label = 'Was beschreibt diesen Begriff?';
      prompt = term.begriff;
      correct = termOptionText(term);
      distractors = pickDistractors(termTiers(term, termOptionText), correct);
    }
  } else if (typ === 'h' && ziel && ziel.block) {
    const halle = card.quelle.split('|').slice(3).join('|');
    const own = ziel.block.management.uebersetzungen.find((u) => u.halle === halle);
    if (!own) return null;
    label = 'Wie sagt man das in Managementsprache?';
    prompt = `„${halle}“`;
    correct = truncate(own.management);
    const all = (merker) => merker.bloecke.flatMap((b) => b.management.uebersetzungen).filter((u) => u !== own).map((u) => truncate(u.management));
    distractors = pickDistractors([all(ziel.merker), store.merker.filter((m) => m.fach === ziel.merker.fach && m !== ziel.merker).flatMap(all)], correct);
  } else if (typ === 'z' && ziel && ziel.block) {
    const frage = card.quelle.split('|').slice(3).join('|');
    const own = ziel.block.pruefung.zuordnung.find((z) => z.frage === frage);
    if (!own) return null;
    label = 'Welcher Begriff passt?';
    prompt = own.frage;
    correct = truncate(own.antwort);
    distractors = pickDistractors(
      [ziel.block.pruefung.zuordnung.map((z) => truncate(z.antwort)), ziel.block.glossar.map((g) => g.begriff), ziel.merker.bloecke.flatMap((b) => b.glossar.map((g) => g.begriff))],
      correct,
    );
  } else if (typ === 'a' && ziel && ziel.abk) {
    label = 'Wofür steht die Abkürzung?';
    prompt = ziel.abk.kurz;
    correct = ziel.abk.lang;
    distractors = pickDistractors([store.index.abbreviations.filter((a) => a !== ziel.abk).map((a) => a.lang)], correct);
  } else if (typ === 'e' && ziel && ziel.entry) {
    const entry = ziel.entry;
    const others = store.eigene.filter((e) => e !== entry && e.erklaerung && toFachKey(e.fach) === toFachKey(entry.fach));
    if (format === 'reverse') {
      label = 'Welcher Begriff ist gemeint?';
      prompt = maskTerm(entry.erklaerung, entry.titel);
      correct = entry.titel;
      distractors = pickDistractors([others.map((e) => e.titel)], correct);
    } else {
      label = 'Was beschreibt diesen Begriff?';
      prompt = entry.titel;
      correct = truncate(entry.erklaerung);
      distractors = pickDistractors([others.map((e) => truncate(e.erklaerung))], correct);
    }
  } else if (!card.quelle && format === 'mc') {
    // Eigene Karten ohne Verknüpfung: Antworten anderer Karten desselben Fachs mit ähnlicher Länge
    const len = view.antwort.length;
    const pool = bridge
      .cards()
      .filter((c) => c !== card && !c.quelle && toFachKey(c.fach) === toFachKey(card.fach))
      .map((c) => bridge.view(c).antwort)
      .filter((a) => a.length >= len * 0.4 && a.length <= len * 2.5)
      .map((a) => truncate(a));
    label = 'Welche Antwort stimmt?';
    prompt = view.frage;
    correct = truncate(view.antwort);
    distractors = pickDistractors([pool], correct);
  } else {
    return null;
  }

  if (!distractors) return null;
  const options = shuffle([correct, ...distractors]);
  return { label, prompt, options, correct: options.indexOf(correct) };
}

/** Verfügbare Formen einer Karte. */
function formatsFor(card) {
  const typ = quelleTyp(card.quelle);
  const formats = ['classic'];
  if (['b', 'h', 'z', 'a', 'e'].includes(typ) || !card.quelle) formats.push('mc');
  if (typ === 'b' || typ === 'e') formats.push('reverse');
  return formats;
}

/**
 * Wählt die Übungsform. „Gemischt“ steigert den Anspruch mit dem Fach:
 * neu und unsicher eher Multiple Choice (wiedererkennen), sicher eher klassisch (frei erinnern).
 */
function chooseFormat(card) {
  const available = formatsFor(card);
  if (pr.format === 'klassisch') return 'classic';
  const box = (getEntry(card.id) || { b: 0 }).b;
  let weights;
  if (pr.format === 'mc') weights = { mc: 0.6, reverse: 0.4, classic: 0 };
  else if (box <= 1) weights = { mc: 0.55, reverse: 0.25, classic: 0.2 };
  else if (box <= 3) weights = { mc: 0.3, reverse: 0.35, classic: 0.35 };
  else weights = { mc: 0.1, reverse: 0.3, classic: 0.6 };
  const candidates = available.filter((f) => weights[f] > 0);
  if (!candidates.length) return 'classic';
  const total = candidates.reduce((s, f) => s + weights[f], 0);
  let r = Math.random() * total;
  for (const f of candidates) {
    r -= weights[f];
    if (r <= 0) return f;
  }
  return candidates[candidates.length - 1];
}

/** Bereitet die aktuelle Karte vor (Form und ggf. Antwortmöglichkeiten). */
function prepareCurrent(card) {
  let format = chooseFormat(card);
  let choice = null;
  if (format !== 'classic') {
    choice = buildChoice(card, format);
    if (!choice && format === 'reverse') {
      format = 'mc';
      choice = buildChoice(card, 'mc');
    }
    if (!choice) format = 'classic';
  }
  pr.current = { card, format, choice, answered: false, chosen: null, thinkStart: null, shown: false };
  pr.revealed = false;
}

/* ------------------------------------------------------------------ */
/* Darstellung                                                         */
/* ------------------------------------------------------------------ */

function linkContext(card) {
  const ziel = targetForQuelle(card.quelle);
  return {
    fach: toFachKey(card.fach),
    merkerId: ziel && ziel.merker ? ziel.merker.id : null,
    selfId: ziel ? (ziel.term ? ziel.term.id : ziel.entry ? `e:${ziel.entry.id}` : null) : null,
  };
}

function showEmpty(icon, title, text, actions = []) {
  stopThinking();
  $('practice-area').hidden = true;
  const box = $('practice-empty');
  box.hidden = false;
  $('practice-empty-icon').textContent = icon;
  $('practice-empty-title').textContent = title;
  $('practice-empty-text').textContent = text;
  const wrap = $('practice-empty-actions');
  wrap.replaceChildren(...actions.map(([label, onClick, primary]) => button(`btn ${primary ? 'btn-primary' : 'btn-secondary'}`, label, onClick)));
}

function formatDate(day) {
  const [y, m, d] = day.split('-');
  return day === addDays(today(), 1) ? 'morgen' : `am ${d}.${m}.${y}`;
}

function renderSessionBar() {
  const total = pr.queue.length;
  const doneCount = Math.min(pr.index, total);
  const text = $('session-text');
  if (!total) {
    $('session-bar').hidden = true;
    return;
  }
  $('session-bar').hidden = false;
  text.textContent = `${doneCount} / ${total} · ✓ ${pr.stats.richtig} · ✗ ${pr.stats.falsch}`;
  $('session-fill').style.width = `${Math.round((doneCount / total) * 100)}%`;
}

function updateDueBadge() {
  $('due-count').textContent = String(todayCount(pr.fach));
  renderFachButton();
}

/** Fächer mit Anzahl (heute fällig bzw. Karten) für Knopf und Blatt. */
function fachOptions() {
  const cards = practicable();
  const present = new Set(cards.map((c) => toFachKey(c.fach)));
  const extra = [...present].filter((k) => k.startsWith('x:')).sort((a, b) => a.localeCompare(b, 'de'));
  const keys = [ALL, ...FAECHER.map((f) => f.id), ...extra];
  const count = (key) => (pr.mode === 'heute' ? todayCount(key) : cards.filter((c) => inFach(c, key)).length);
  return keys.map((key) => ({
    key,
    kurz: key === ALL ? 'Alle Fächer gemischt' : fachLabel(key),
    name: key === ALL ? '' : fachName(key),
    count: count(key),
    empty: key !== ALL && !present.has(key),
  }));
}

/** Fach-Knopf im Kopf; ein verschwundenes Zusatzfach fällt auf „Alle Fächer“ zurück. */
function renderFachButton() {
  const keys = fachOptions().map((o) => o.key);
  if (!keys.includes(pr.fach)) pr.fach = ALL;
  $('practice-fach-label').textContent = pr.fach === ALL ? 'Alle Fächer' : fachLabel(pr.fach);
  $('practice-fach-btn').title = pr.fach === ALL ? 'Alle Fächer gemischt' : fachName(pr.fach);
  refreshFachSheet();
}

function openFachChoice() {
  openFachSheet({
    title: pr.mode === 'heute' ? 'Fach wählen · heute fällig' : 'Fach wählen · Karten',
    getOptions: fachOptions,
    current: pr.fach,
    onPick: setFach,
  });
}

export function renderPractice({ animate = true } = {}) {
  if (!bridge) return;
  document.querySelectorAll('#practice-mode .seg').forEach((seg) => {
    const active = seg.dataset.mode === pr.mode;
    seg.classList.toggle('is-active', active);
    seg.setAttribute('aria-selected', String(active));
  });
  $('free-toolbar').hidden = pr.mode !== 'frei';
  $('practice-format').value = pr.format;
  updateDueBadge();
  renderSessionBar();

  const all = bridge.cards();
  if (!all.length) {
    if (!bridge.isConfigured()) {
      showEmpty('🔌', 'Noch nicht verbunden', 'Verbinde zuerst dein GitHub-Repository über das Zahnrad oben rechts.', [['Einstellungen öffnen', bridge.openSettings, true]]);
    } else {
      showEmpty('🗂️', 'Noch keine Karten', 'Lege im Tab „Erstellen“ eine Karte an oder erzeuge Karten aus dem Wissen im Tab „Lücken“.', [
        ['Karte erstellen', () => bridge.switchTab('create'), true],
      ]);
    }
    return;
  }

  if (pr.fach !== ALL && !practicable().some((c) => inFach(c))) {
    showEmpty('📭', `In ${fachLabel(pr.fach)} gibt es noch keine Karten`, `${fachName(pr.fach)}: Importiere einen Merker im Tab „Wissen“ und erzeuge Karten im Tab „Lücken“, oder lege eigene Karten an.`, [
      ['Alle Fächer üben', () => setFach(ALL), true],
    ]);
    renderSessionBar();
    return;
  }
  const card = currentCard();
  if (!card) {
    renderDone();
    return;
  }
  if (!pr.current || pr.current.card.id !== card.id) prepareCurrent(card);
  $('practice-empty').hidden = true;
  $('practice-area').hidden = false;
  renderCurrent(animate);
}

function renderDone() {
  const ids = practicable().map((c) => c.id);
  if (pr.mode === 'heute') {
    const answered = pr.stats.richtig + pr.stats.falsch;
    const next = nextDueDate(ids);
    const unseen = ids.filter((id) => !getEntry(id)).length;
    const actions = [['Freies Üben', () => setMode('frei'), false]];
    // Andere Fächer mit fälligen Karten vorschlagen
    if (pr.fach !== ALL) {
      FAECHER.filter((f) => f.id !== pr.fach)
        .map((f) => [f.id, todayCount(f.id)])
        .filter(([, n]) => n > 0)
        .slice(0, 3)
        .forEach(([key, n]) => actions.unshift([`Weiter mit ${fachLabel(key)} (${n})`, () => setFach(key), false]));
    }
    if (unseen) {
      actions.unshift([
        `${EXTRA_NEW_STEP} weitere neue Karten`,
        () => {
          pr.extraNew += EXTRA_NEW_STEP;
          startSession();
        },
        true,
      ]);
    }
    if (answered) {
      showEmpty('🎉', pr.fach === ALL ? 'Für heute geschafft!' : `${fachLabel(pr.fach)} für heute geschafft!`, `${plural(answered, 'Antwort', 'Antworten')}: ✓ ${pr.stats.richtig} richtig, ✗ ${pr.stats.falsch} falsch.${next ? ` Die nächsten Karten sind ${formatDate(next)} fällig.` : ''} Noch ${plural(unseen, 'neue Karte', 'neue Karten')} ungeübt.`, actions);
    } else {
      showEmpty('☕', pr.fach === ALL ? 'Heute ist nichts fällig' : `In ${fachLabel(pr.fach)} ist heute nichts fällig`, `${next ? `Die nächsten Karten sind ${formatDate(next)} fällig. ` : ''}Noch ${plural(unseen, 'neue Karte', 'neue Karten')} ungeübt.`, actions);
    }
  } else {
    const answered = pr.stats.richtig + pr.stats.falsch;
    if (!pr.queue.length) {
      showEmpty('🔍', 'Keine Karten in dieser Auswahl', 'Wähle ein anderes Fach oder Thema.', [['Alle Fächer', () => setFach(ALL), true]]);
    } else {
      showEmpty('🎉', 'Runde geschafft!', `${plural(answered, 'Antwort', 'Antworten')}: ✓ ${pr.stats.richtig} richtig, ✗ ${pr.stats.falsch} falsch.`, [
        ['🔀 Neu mischen & weiter üben', startSession, true],
        ['Heute fällig', () => setMode('heute'), false],
      ]);
    }
  }
  renderSessionBar();
}

function renderCurrent(animate) {
  const { card, format } = pr.current;
  const view = bridge.view(card);
  const entry = getEntry(card.id);
  const formLabel = format === 'classic' ? 'Klassisch' : format === 'reverse' ? 'Begriff erkennen' : 'Multiple Choice';
  $('practice-progress').textContent = `${fachLabel(toFachKey(card.fach))} · ${bridge.formatNr(card.nr)} · ${entry ? `Stufe ${entry.b}` : 'Neu'} · ${formLabel}`;
  renderTags($(format === 'classic' ? 'card-tags' : 'mc-tags'), card, formLabel);

  const classic = format === 'classic';
  $('card-scene').hidden = !classic;
  $('rate-buttons').hidden = !classic;
  $('mc-area').hidden = classic;
  $('mc-next').hidden = true;
  $('hint-box').hidden = true;
  $('hint-btn').hidden = false;
  $('hint-btn').setAttribute('aria-expanded', 'false');
  $('card-links').hidden = true;
  $('keyboard-hint').textContent = classic
    ? 'Leertaste: Antwort zeigen · T: Tipp · 1: Nochmal · 2: Gewusst'
    : 'Tasten 1 bis 4: Antwort wählen · T: Tipp · Enter: weiter';

  if (!classic) stopThinking();
  if (classic) renderClassic(card, view, animate);
  else renderChoice(card, animate);
}

/** Kennzeichen der Karte: Fach (nur bei „Alle Fächer“), Nummer, Stufe, Übungsform. */
function renderTags(container, card, formLabel) {
  const entry = getEntry(card.id);
  const tags = [];
  if (pr.fach === ALL) tags.push(el('span', 'tag tag-fach', fachLabel(toFachKey(card.fach))));
  tags.push(el('span', 'tag tag-nr', bridge.formatNr(card.nr)));
  tags.push(el('span', 'tag', entry ? `Stufe ${entry.b}` : 'Neu'));
  tags.push(el('span', 'tag', formLabel));
  container.replaceChildren(...tags);
}

function animateIn(node) {
  node.classList.remove('card-enter');
  void node.offsetWidth;
  node.classList.add('card-enter');
}

/* ---------- Klassisch ---------- */

function renderClassic(card, view, animate) {
  stopThinking();
  $('card-question').textContent = view.frage;
  $('card-answer').replaceChildren(renderRich(view.antwort, { linker, linked: new Set(), ...linkContext(card) }));
  $('card-body').scrollTop = 0;
  if (animate) animateIn($('card-scene'));
  startThinking();
}

/**
 * Denkzeit: erst nur die Frage mit ablaufendem Balken, dann blendet die Antwort ein.
 * Beginn je Karte bleibt erhalten (Reiterwechsel, Sync, Hintergrund starten nicht neu).
 */
function startThinking() {
  const current = pr.current;
  if (current.shown) {
    setPhase('sichtbar');
    return;
  }
  if (!pr.thinkSeconds) {
    setPhase('verdeckt');
    return;
  }
  if (current.thinkStart === null) current.thinkStart = Date.now();
  setPhase('denken');
  thinkTimer = startThinkTimer({
    startedAt: current.thinkStart,
    seconds: pr.thinkSeconds,
    onTick: (remaining, share) => {
      $('think-label').textContent = `⏱ Denkzeit läuft · noch ${remaining} s`;
      $('think-bar').style.width = `${(share * 100).toFixed(1)}%`;
    },
    onDone: () => {
      thinkTimer = null;
      // Länger weg als Denkzeit plus Einblenden: Antwort gleich ganz zeigen
      if (Date.now() - current.thinkStart >= pr.thinkSeconds * 1000 + FADE_MS) {
        showAnswer();
        return;
      }
      setPhase('einblenden');
      fadeTimer = setTimeout(showAnswer, FADE_MS);
    },
  });
}

function stopThinking() {
  if (thinkTimer) thinkTimer.stop();
  thinkTimer = null;
  clearTimeout(fadeTimer);
  fadeTimer = null;
}

/** Phasen der klassischen Karte: verdeckt (ohne Denkzeit), denken, einblenden, sichtbar. */
function setPhase(phase) {
  const flashcard = $('flashcard');
  const showing = phase === 'sichtbar';
  pr.revealed = showing;
  flashcard.dataset.phase = phase;
  flashcard.setAttribute('aria-label', showing ? 'Antwort wird angezeigt' : 'Antwort zeigen');
  $('card-answer-wrap').setAttribute('aria-hidden', String(phase === 'verdeckt' || phase === 'denken'));
  const thinking = phase === 'denken' || phase === 'einblenden';
  $('think-track').hidden = !thinking;
  $('think-label').hidden = !pr.thinkSeconds;
  if (phase === 'denken') $('think-bar').style.width = '100%';
  if (phase === 'einblenden') {
    $('think-bar').style.width = '0%';
    $('think-label').textContent = 'Antwort erscheint …';
  }
  if (phase === 'sichtbar' || phase === 'verdeckt') $('think-label').textContent = '';
  $('hint-btn').hidden = showing;
  if (showing) {
    $('hint-box').hidden = true;
    renderCardLinks(pr.current.card);
  } else {
    $('card-links').hidden = true;
  }
}

function showAnswer() {
  if (!pr.current || pr.current.format !== 'classic') return;
  stopThinking();
  pr.current.shown = true;
  setPhase('sichtbar');
}

/** Antippen, Leertaste oder Enter: Antwort sofort zeigen. */
function revealAnswer() {
  if (!pr.current || pr.current.format !== 'classic' || pr.revealed) return;
  showAnswer();
}

/* ---------- Auswahl (Multiple Choice / Begriff erkennen) ---------- */

function renderChoice(card, animate) {
  const { choice } = pr.current;
  $('mc-label').textContent = choice.label;
  const prompt = $('mc-prompt');
  prompt.textContent = choice.prompt;
  prompt.classList.toggle('mc-prompt-long', choice.prompt.length > 120);
  const list = $('mc-options');
  list.replaceChildren(
    ...choice.options.map((text, i) => {
      const option = button('mc-option', null, () => answerChoice(i));
      option.append(el('span', 'mc-key', String(i + 1)), el('span', 'mc-text', text));
      return option;
    }),
  );
  $('mc-area').classList.remove('is-answered');
  $('mc-more').hidden = true;
  $('mc-feedback').hidden = true;
  $('mc-explain').hidden = true;
  if (animate) animateIn($('mc-area'));
}

function answerChoice(index) {
  const current = pr.current;
  if (!current || current.answered || current.format === 'classic') return;
  current.answered = true;
  current.chosen = index;
  const correct = index === current.choice.correct;
  // Zum Nachlesen: größere Schrift, nur gewählte und richtige Antwort bleiben stehen
  let collapsed = 0;
  [...$('mc-options').children].forEach((node, i) => {
    node.disabled = true;
    if (i === current.choice.correct) node.classList.add('is-correct');
    else if (i === index) node.classList.add('is-wrong');
    else {
      node.classList.add('is-collapsed');
      collapsed += 1;
    }
  });
  $('mc-area').classList.add('is-answered');
  $('mc-more').textContent = `${plural(collapsed, 'weitere Antwort', 'weitere Antworten')} ausgeblendet ▾`;
  $('mc-more').hidden = collapsed === 0;
  const { before, after } = grade(current.card, correct, { advance: false });
  const feedback = $('mc-feedback');
  feedback.hidden = false;
  feedback.dataset.result = correct ? 'richtig' : 'falsch';
  const text = el('div', 'feedback-body');
  text.append(el('span', 'feedback-title', correct ? 'Richtig!' : 'Leider falsch'), el('span', 'feedback-sub', feedbackSub(before, after, correct)));
  feedback.replaceChildren(el('span', 'feedback-emoji', correct ? '👍' : '👎'), text);

  // Vollständige Antwort mit Verweisen zum Nachlesen
  const view = bridge.view(current.card);
  const explain = $('mc-explain');
  explain.replaceChildren(el('span', 'face-label', 'Zum Nachlesen'), renderRich(view.antwort, { linker, linked: new Set(), ...linkContext(current.card) }));
  explain.hidden = false;
  $('hint-btn').hidden = true;
  $('hint-box').hidden = true;
  renderCardLinks(current.card);
  $('mc-next').hidden = false;
  $('mc-next').focus({ preventScroll: true });
}

/** Wann eine Karte wieder fällig ist, in Worten. */
function when(day) {
  const now = today();
  if (day <= now) return 'heute';
  if (day === addDays(now, 1)) return 'morgen';
  const days = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${now}T00:00:00Z`)) / 86400000);
  return `in ${days} Tagen`;
}

/** Zeile unter „Richtig!“ bzw. „Leider falsch“ (Stufe und nächste Fälligkeit). */
function feedbackSub(before, after, correct) {
  if (!correct) return `Richtige Antwort grün markiert · kommt ${when(after.f)} wieder`;
  const rose = !before || after.b > before.b;
  return `${rose ? 'Weiter in' : 'Bleibt in'} Stufe ${after.b} · wieder fällig ${when(after.f)}`;
}

function showAllOptions() {
  $('mc-options').querySelectorAll('.is-collapsed').forEach((node) => node.classList.remove('is-collapsed'));
  $('mc-more').hidden = true;
}

function nextCard() {
  if (!pr.current || pr.current.format === 'classic' || !pr.current.answered) return;
  pr.index += 1;
  pr.current = null;
  renderPractice();
}

/* ---------- Bewerten ---------- */

/** Speichert die Antwort im Lernstand; falsche Karten kommen am Ende der Sitzung noch einmal. */
function grade(card, correct, { advance }) {
  const before = getEntry(card.id);
  const after = record(card.id, correct);
  pr.stats[correct ? 'richtig' : 'falsch'] += 1;
  if (!correct && !pr.retried.has(card.id)) {
    pr.retried.add(card.id);
    pr.queue.push(card.id);
  }
  bridge.onGraded();
  renderSessionBar();
  updateDueBadge();
  if (advance) {
    pr.index += 1;
    pr.current = null;
    renderPractice();
    if (!$('practice-area').hidden && pr.current && pr.current.format === 'classic') $('flashcard').focus({ preventScroll: true });
  }
  return { before, after };
}

let flashTimer = null;

/** Kurzes 👍/👎 über der Karte nach „Gewusst“/„Nochmal“; die nächste Karte steht schon da. */
function flash(known) {
  const node = $('practice-flash');
  node.textContent = known ? '👍' : '👎';
  node.classList.remove('is-on');
  void node.offsetWidth;
  node.classList.add('is-on');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => node.classList.remove('is-on'), 700);
}

function rateClassic(known) {
  if (!pr.current || pr.current.format !== 'classic') return;
  grade(pr.current.card, known, { advance: true });
  flash(known);
}

/* ------------------------------------------------------------------ */
/* Tipps und Verweise                                                  */
/* ------------------------------------------------------------------ */

function showHint() {
  const current = pr.current;
  if (!current || current.answered || pr.revealed) return;
  const box = $('hint-box');
  if (!box.hidden) {
    box.hidden = true;
    $('hint-btn').setAttribute('aria-expanded', 'false');
    return;
  }
  const { card } = current;
  const view = bridge.view(card);
  const ziel = targetForQuelle(card.quelle);
  box.replaceChildren();
  if (ziel && ziel.block) box.append(el('p', null, `Thema: ${ziel.block.id} · ${ziel.block.titel}`));
  else if (ziel && ziel.entry) box.append(el('p', null, 'Aus deinen eigenen Einträgen'));

  // Bei „Begriff erkennen“ würde ein Schlüsselbegriff die Lösung verraten
  if (current.format !== 'reverse') {
    const keyTerms = termsInText(view.antwort, linkContext(card)).slice(0, MAX_HINT_TERMS).map(targetName);
    if (keyTerms.length) box.append(el('p', null, `Denk an: ${keyTerms.join(' · ')}`));
    else if (current.format === 'classic') {
      const words = view.antwort.split(/\s+/).filter(Boolean);
      if (words.length) box.append(el('p', null, `Beginnt mit: „${words.slice(0, 3).join(' ')}${words.length > 3 ? ' …' : ''}“`));
    }
  }
  if (!box.childElementCount) box.append(el('p', null, 'Für diese Karte gibt es keinen Tipp.'));
  box.hidden = false;
  $('hint-btn').setAttribute('aria-expanded', 'true');
}

function openZiel(ziel) {
  if (ziel.term) openSheet(ziel.term);
  else if (ziel.item) openSheet(ziel.item);
  else if (ziel.entry) openEntry(ziel.entry.id);
  else if (ziel.abk) openSheet(ziel.abk);
  else if (ziel.block) openMerker(ziel.merker.id, ziel.block.id);
}

/** Fundstelle im Wissen und verwandte Begriffe (bei Karten ohne Verknüpfung aus Frage und Antwort). */
function renderCardLinks(card) {
  const view = bridge.view(card);
  const ziel = targetForQuelle(card.quelle);
  const text = card.quelle ? view.antwort : `${view.frage}\n${view.antwort}`;
  const terms = termsInText(text, linkContext(card)).slice(0, MAX_LINK_TERMS);
  const box = $('card-links');
  box.replaceChildren();
  if (ziel && view.pfad) {
    const row = el('div', 'card-links-row');
    row.append(el('span', 'card-links-label', '🔗 Fundstelle'), el('span', 'card-links-path', view.pfad), button('btn btn-small btn-secondary', 'Im Wissen ansehen ›', () => openZiel(ziel)));
    box.append(row);
  }
  if (terms.length) {
    const row = el('div', 'card-links-row');
    const chips = el('div', 'chips');
    terms.forEach((target) => chips.append(button('chip chip-small', targetName(target), () => openSheet(target))));
    row.append(el('span', 'card-links-label', card.quelle ? 'Siehe auch' : 'Passt zu'), chips);
    box.append(row);
  }
  box.hidden = !box.childElementCount;
}

/* ------------------------------------------------------------------ */
/* Filter und Modus                                                    */
/* ------------------------------------------------------------------ */

function setMode(mode) {
  pr.mode = mode;
  savePrefs();
  startSession();
}

/** Schwerpunkt-Fach wählen (gilt für „Heute fällig“ und „Freies Üben“). */
function setFach(key) {
  pr.fach = key;
  pr.theme = ALL;
  pr.extraNew = 0;
  savePrefs();
  renderFilters();
  startSession();
}

function setTheme(theme) {
  pr.theme = theme;
  startSession();
}

/** Fach- und Themenfilter für „Freies Üben“. */
export function renderFilters() {
  renderFachButton();
  const counts = new Map();
  for (const card of practicable()) {
    if (!inFach(card)) continue;
    const theme = themeOf(card);
    counts.set(theme, (counts.get(theme) || 0) + 1);
  }
  const label = (t) => (t === THEME_EIGEN ? 'Eigene Einträge' : t === THEME_NONE ? 'Ohne Verknüpfung' : merkerTitle(t) || t);
  const themes = [...counts.keys()].sort((a, b) => label(a).localeCompare(label(b), 'de'));
  if (pr.theme !== ALL && !counts.has(pr.theme)) pr.theme = ALL;
  const all = el('option', null, 'Alle Themen');
  all.value = ALL;
  $('practice-theme').replaceChildren(
    all,
    ...themes.map((t) => {
      const option = el('option', null, `${label(t)} (${counts.get(t)})`);
      option.value = t;
      return option;
    }),
  );
  $('practice-theme').value = pr.theme;
  $('practice-theme').hidden = themes.length < 2;
}

/** Nach Datenänderungen (Sync, Bearbeiten, Wissen, Lernstand anderer Geräte). */
export function refreshPractice() {
  if (!bridge) return;
  renderFilters();
  // Neu aufbauen bei: neuem Tag, bisher leerer Sitzung oder frisch geladenem Lernstand vor der ersten Antwort
  const untouched = pr.index === 0 && pr.stats.richtig + pr.stats.falsch === 0;
  const freshProgress = pr.mode === 'heute' && untouched && pr.builtRev !== progressRevision();
  if ((pr.mode === 'heute' && pr.builtFor !== today()) || (!pr.queue.length && practicable().length) || freshProgress) {
    startSession();
    return;
  }
  reconcile();

  if (pr.current && pr.current.answered) {
    renderSessionBar();
    updateDueBadge();
    return; // Erklärung nach einer Auswahlfrage stehen lassen
  }
  renderPractice({ animate: false });
}

/* ------------------------------------------------------------------ */
/* Tastatur                                                            */
/* ------------------------------------------------------------------ */

/** Tastenkürzel beim Üben; liefert true, wenn die Taste verarbeitet wurde. */
export function handlePracticeKey(event) {
  if (isAnyModalOpen() || $('practice-area').hidden || !pr.current) return false;
  const onControl = event.target instanceof HTMLElement && event.target.closest('button, a, select') !== null;
  const key = event.key;
  if (key === 't' || key === 'T') {
    showHint();
    return true;
  }
  if (pr.current.format === 'classic') {
    if ((key === ' ' || key === 'Enter') && !onControl) {
      revealAnswer();
      return true;
    }
    if (key === '1' || key === 'ArrowLeft') {
      rateClassic(false);
      return true;
    }
    if (key === '2' || key === 'ArrowRight') {
      rateClassic(true);
      return true;
    }
    return false;
  }
  if (!pr.current.answered && /^[1-9]$/.test(key)) {
    const index = Number(key) - 1;
    if (index < pr.current.choice.options.length) answerChoice(index);
    return true;
  }
  if (pr.current.answered && (key === 'Enter' || key === 'ArrowRight' || (key === ' ' && !onControl))) {
    nextCard();
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

function bindPlan() {
  const newInput = $('plan-new');
  const maxInput = $('plan-max');
  newInput.value = pr.newPerDay;
  maxInput.value = pr.sessionMax;
  const apply = () => {
    const n = Math.round(Number(newInput.value));
    const m = Math.round(Number(maxInput.value));
    if (Number.isFinite(n)) pr.newPerDay = Math.min(200, Math.max(0, n));
    if (Number.isFinite(m)) pr.sessionMax = Math.min(300, Math.max(5, m));
    newInput.value = pr.newPerDay;
    maxInput.value = pr.sessionMax;
    savePrefs();
    if (pr.mode === 'heute') startSession();
  };
  newInput.addEventListener('change', apply);
  maxInput.addEventListener('change', apply);
}

/**
 * @param {object} b  Brücke zu app.js: cards(), view(card), formatNr(nr), isConfigured(),
 *                    openSettings(), switchTab(tab), onGraded()
 */
export function initPractice(b) {
  bridge = b;
  loadPrefs();
  document.querySelectorAll('#practice-mode .seg').forEach((seg) => seg.addEventListener('click', () => setMode(seg.dataset.mode)));
  $('practice-format').addEventListener('change', (event) => {
    pr.format = event.target.value;
    savePrefs();
    if (pr.current && !pr.current.answered) {
      pr.current = null;
      renderPractice();
    }
  });
  $('practice-fach-btn').addEventListener('click', openFachChoice);
  $('practice-theme').addEventListener('change', (event) => setTheme(event.target.value));
  $('shuffle-btn').addEventListener('click', startSession);
  $('flashcard').addEventListener('click', revealAnswer);
  $('mc-more').addEventListener('click', showAllOptions);
  $('think-seconds').value = String(pr.thinkSeconds);
  $('think-seconds').addEventListener('change', (event) => {
    const value = Number(event.target.value);
    pr.thinkSeconds = THINK_CHOICES.includes(value) ? value : THINK_DEFAULT;
    savePrefs();
  });
  $('rate-again').addEventListener('click', () => rateClassic(false));
  $('rate-known').addEventListener('click', () => rateClassic(true));
  $('mc-next').addEventListener('click', nextCard);
  $('hint-btn').addEventListener('click', showHint);
  bindPlan();
  renderFilters();
  startSession();
}

