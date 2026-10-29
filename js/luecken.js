/**
 * luecken.js
 *
 * Reiter „Lücken“: fehlendes Wissen gezielt schließen.
 *  1. Begriff oder Frage eintragen und prüfen
 *  2. Gibt es Wissen und Lernkarte: beides mit Verknüpfung anzeigen
 *     Gibt es nur Wissen: Lernkarte daraus erstellen
 *     Gibt es nichts: Wissenseintrag (ggf. als Entwurf) plus verknüpfte Lernkarte anlegen
 *  Dazu: fehlende Lernkarten zu vorhandenem Wissen erzeugen, offene Lücken auflisten.
 */

import { hasValidSettings } from './github-sync.js';
import { el, button, plural, norm, showToast } from './ui.js';
import { renderRich } from './richtext.js';
import { store, search, quelleFor, wissenCard, commitEigene, normalizeEntry, isDraft } from './wissen-data.js';
import { openSheet, openMerker, openEntry, openEntryEditor } from './wissen.js';

const MAX_SUGGESTIONS = 6;
const MAX_TEXT_MATCHES = 5;
const CONFIRM_BULK_FROM = 50;

const lq = {
  ready: false,
  query: '',
  selected: null, // gewählter Treffer, wenn es mehrere gibt
  busy: false,
};

let getSettings = () => ({});
let cards = null;
const $ = (id) => document.getElementById(id);

const TYPE_LABEL = {
  begriff: 'Begriff',
  kuerzel: 'Abkürzung',
  thema: 'Thema',
  frage: 'Musterantwort',
  halle: 'Managementsprache',
  eigen: 'Eigener Eintrag',
};

/* ------------------------------------------------------------------ */
/* Hilfen                                                              */
/* ------------------------------------------------------------------ */

function titleOf(doc) {
  const t = doc.target;
  switch (doc.type) {
    case 'begriff':
      return t.begriff;
    case 'kuerzel':
      return t.kurz;
    case 'thema':
      return `${t.block.id} · ${t.block.titel}`;
    case 'frage':
      return t.musterantwort.frage;
    case 'halle':
      return `„${t.uebersetzung.halle}“`;
    default:
      return t.titel;
  }
}

/** Erklärender Text zu einem Treffer (das „Wissen“, das angezeigt wird). */
function infoText(doc) {
  const t = doc.target;
  switch (doc.type) {
    case 'begriff':
      return [t.kurz, t.funktion].filter(Boolean).join('\n\n');
    case 'kuerzel':
      return t.lang;
    case 'thema':
      return t.block.abschluss.kernaussage || 'Zu diesem Thema gibt es keine Kernaussage.';
    case 'frage':
      return t.musterantwort.antwort;
    case 'halle':
      return t.uebersetzung.management;
    default:
      return isDraft(t) ? '' : [t.erklaerung, t.verstaendnis].filter(Boolean).join('\n\n');
  }
}

function openInWissen(doc) {
  const t = doc.target;
  if (doc.type === 'begriff' || doc.type === 'kuerzel') {
    openSheet(t);
  } else if (doc.type === 'eigen') {
    document.dispatchEvent(new CustomEvent('wissen:show'));
    openEntry(t.id);
  } else {
    openMerker(t.merker.id, t.block.id);
  }
}

/** Karten ohne Verknüpfung, deren Text den Suchbegriff enthält (Kandidaten zum Verknüpfen). */
function textMatches(query) {
  const q = norm(query);
  if (q.length < 2) return [];
  return cards
    .cards()
    .filter((card) => !card.quelle)
    .filter((card) => {
      const view = cards.view(card);
      return norm(view.frage).includes(q) || norm(view.antwort).includes(q);
    })
    .slice(0, MAX_TEXT_MATCHES);
}

function cardRow(card, extra = null) {
  const row = el('div', 'gap-card');
  const text = el('div', 'gap-card-text');
  const view = cards.view(card);
  const top = el('span', 'gap-card-top');
  top.append(el('span', 'card-nr', cards.formatNr(card.nr)), el('span', 'gap-card-frage', view.frage));
  text.append(top);
  if (view.antwort) text.append(el('span', 'gap-card-antwort', view.antwort));
  else text.append(el('span', 'tag tag-draft', 'Antwort offen'));
  row.append(text);
  const actions = el('div', 'gap-card-actions');
  if (extra) actions.append(extra);
  actions.append(button('btn btn-small btn-secondary', '✎', () => cards.edit(card.id)));
  actions.lastChild.setAttribute('aria-label', `Karte ${cards.formatNr(card.nr)} bearbeiten`);
  row.append(actions);
  return row;
}

function panel(className, icon, title) {
  const box = el('section', `panel gap-panel ${className}`);
  const head = el('h3', 'gap-panel-title');
  head.append(el('span', 'gap-icon', icon), document.createTextNode(title));
  box.append(head);
  return box;
}

/* ------------------------------------------------------------------ */
/* Prüfergebnis                                                        */
/* ------------------------------------------------------------------ */

function renderResult() {
  const container = $('gap-result');
  container.replaceChildren();
  const query = lq.query.trim();
  if (!query) return;

  const docs = search(query).slice(0, 12);
  const q = norm(query);
  const exact = docs.find((d) => d.title === q || d.keys.includes(q));
  const target = lq.selected || exact || null;

  if (target) {
    container.append(renderMatch(target, query));
    const others = docs.filter((d) => d !== target).slice(0, MAX_SUGGESTIONS);
    if (others.length) container.append(renderSuggestions(others, 'Weitere Treffer', true));
    return;
  }
  if (docs.length) {
    container.append(renderSuggestions(docs.slice(0, MAX_SUGGESTIONS), 'Ähnliche Treffer: Ist einer davon gemeint?', false));
  }
  container.append(renderNewForm(query, docs.length > 0));
}

function renderSuggestions(docs, title, collapsed) {
  const wrap = collapsed ? el('details', 'gap-suggestions') : el('section', 'gap-suggestions');
  const head = el(collapsed ? 'summary' : 'h3', 'gap-sub', title);
  wrap.append(head);
  for (const doc of docs) {
    const row = button('reg-row', null, () => {
      lq.selected = doc;
      renderResult();
    });
    const top = el('span', 'reg-top');
    top.append(el('span', 'reg-title', titleOf(doc)), el('span', 'tag', TYPE_LABEL[doc.type]));
    const quelle = quelleFor(doc.type, doc.target);
    if (quelle && cards.forQuelle(quelle).length) top.append(el('span', 'tag tag-ok', 'Lernkarte ✓'));
    row.append(top);
    const linked = quelle ? wissenCard(quelle) : null;
    if (linked) row.append(el('span', 'reg-sub', linked.pfad));
    wrap.append(row);
  }
  return wrap;
}

/** Treffer im Wissen: Erklärung, Fundstelle und Stand der Lernkarte. */
function renderMatch(doc, query) {
  const quelle = quelleFor(doc.type, doc.target);
  const linked = quelle ? wissenCard(quelle) : null;
  const linkedCards = quelle ? cards.forQuelle(quelle) : [];
  const box = panel('gap-found', '✓', 'Im Wissen vorhanden');

  const head = el('div', 'gap-match-head');
  head.append(el('span', 'gap-match-title', titleOf(doc)), el('span', 'tag', TYPE_LABEL[doc.type]));
  box.append(head);
  if (linked) box.append(el('p', 'gap-path', linked.pfad));

  const info = infoText(doc);
  if (info) box.append(renderRich(info));
  else box.append(el('p', 'muted', 'Noch keine Erklärung eingetragen (offene Lücke).'));

  const actions = el('div', 'form-actions');
  actions.append(button('btn btn-small btn-secondary', 'Im Wissen ansehen ›', () => openInWissen(doc)));
  if (doc.type === 'eigen') actions.append(button('btn btn-small btn-secondary', '✎ Erklärung ergänzen', () => openEntryEditor(doc.target.id)));
  box.append(actions);

  // Lernkarte
  const cardBox = el('div', 'gap-cardbox');
  if (linkedCards.length) {
    cardBox.append(el('h4', 'gap-sub gap-ok', `✓ ${plural(linkedCards.length, 'Lernkarte', 'Lernkarten')} vorhanden`));
    for (const card of linkedCards) {
      cardBox.append(cardRow(card));
      cardBox.append(el('p', 'gap-link-text', `Verknüpfung: Lernkarte ${cards.formatNr(card.nr)} ↔ ${linked ? linked.pfad : 'Wissen'}`));
    }
  } else if (quelle) {
    cardBox.append(el('h4', 'gap-sub', 'Noch keine Lernkarte'));
    const hasAnswer = Boolean(linked && linked.antwort);
    if (!hasAnswer) {
      cardBox.append(el('p', 'muted small', 'Die Karte wird beim Üben übersprungen, bis die Erklärung ergänzt ist.'));
    }
    cardBox.append(
      button('btn btn-primary', '＋ Lernkarte erstellen und verknüpfen', () => {
        const card = linked
          ? cards.createFromQuelle(quelle)
          : cards.create({ fach: doc.target.fach || 'Allgemein', frage: `Erkläre den Begriff: ${titleOf(doc)}`, antwort: '', quelle });
        if (card) showToast(`Lernkarte ${cards.formatNr(card.nr)} erstellt und verknüpft`, 'success');
        renderLuecken();
      }),
    );
  } else {
    cardBox.append(el('p', 'muted small', 'Für diesen Treffer gibt es keine eigene Lernkarte. Öffne das Thema und wähle einen Begriff.'));
  }
  box.append(cardBox);

  // Ähnliche, noch nicht verknüpfte Karten
  const similar = quelle ? textMatches(query) : [];
  if (similar.length && quelle) {
    const sim = el('div', 'gap-cardbox');
    sim.append(el('h4', 'gap-sub', 'Ähnliche Lernkarten ohne diese Verknüpfung'));
    for (const card of similar) {
      sim.append(
        cardRow(
          card,
          button('btn btn-small btn-secondary', '🔗 Verknüpfen', () => {
            cards.link(card.id, quelle);
            showToast(`Lernkarte ${cards.formatNr(card.nr)} verknüpft`, 'success');
            renderLuecken();
          }),
        ),
      );
    }
    box.append(sim);
  }
  return box;
}

/* ------------------------------------------------------------------ */
/* Neue Lücke anlegen                                                  */
/* ------------------------------------------------------------------ */

function renderNewForm(query, hadSuggestions) {
  const box = panel('gap-new', '✗', hadSuggestions ? 'Nichts davon passt? Neue Lücke anlegen' : 'Noch nicht vorhanden');
  box.append(el('p', 'muted', `„${query}“ gibt es weder im Wissen noch als verknüpfte Lernkarte. Lege einen Wissenseintrag und eine verknüpfte Lernkarte an.`));

  const form = el('form', 'gap-new-form');
  form.autocomplete = 'off';
  const fachField = el('label', 'field');
  const fach = el('input', 'input');
  fach.type = 'text';
  fach.setAttribute('list', 'entry-fach-list');
  fach.placeholder = 'z. B. VWL/BWL, ReWe';
  fach.required = true;
  fachField.append(el('span', 'field-label', 'Fach'), fach);

  const expField = el('label', 'field');
  const erklaerung = el('textarea', 'input textarea');
  erklaerung.rows = 3;
  erklaerung.placeholder = 'Falls du sie schon kennst. Sonst bleibt es eine offene Lücke und erscheint unten in der Liste.';
  expField.append(el('span', 'field-label', 'Erklärung (optional)'), erklaerung);
  form.append(fachField, expField);

  // Gibt es schon eine Karte mit dem Begriff im Text, kann sie verknüpft statt doppelt angelegt werden
  const similar = textMatches(query);
  let choice = null;
  if (similar.length) {
    const choiceField = el('label', 'field');
    choice = el('select', 'select');
    const fresh = el('option', null, 'Neue Lernkarte anlegen');
    fresh.value = '';
    choice.append(fresh);
    for (const card of similar) {
      const option = el('option', null, `${cards.formatNr(card.nr)} verknüpfen: ${cards.view(card).frage}`);
      option.value = card.id;
      choice.append(option);
    }
    choice.value = similar[0].id;
    choiceField.append(el('span', 'field-label', 'Lernkarte'), choice);
    form.append(choiceField);
  }

  const status = el('p', 'settings-message');
  status.hidden = true;
  const submit = el('button', 'btn btn-primary', 'Lücke anlegen');
  submit.type = 'submit';
  const actions = el('div', 'form-actions');
  actions.append(submit);
  form.append(status, actions);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const setStatus = (text, type = 'error') => {
      status.hidden = !text;
      status.textContent = text;
      status.dataset.type = type;
    };
    if (!fach.value.trim()) {
      setStatus('Bitte ein Fach angeben.');
      fach.focus();
      return;
    }
    const settings = getSettings();
    if (!hasValidSettings(settings)) {
      setStatus('Bitte zuerst die GitHub-Verbindung einrichten (Zahnrad oben rechts).');
      return;
    }
    if (lq.busy) return;
    lq.busy = true;
    submit.disabled = true;
    submit.textContent = 'Lege an …';
    try {
      const now = new Date().toISOString();
      const entry = normalizeEntry({ titel: query, fach: fach.value.trim(), erklaerung: erklaerung.value.trim(), erstellt: now, geaendert: now });
      await commitEigene(settings, (entries) => [...entries, entry], `Lücke: ${query}`);
      const quelle = `e:${entry.id}`;
      let card;
      if (choice && choice.value) {
        cards.link(choice.value, quelle);
        card = cards.cards().find((c) => c.id === choice.value);
      } else {
        card = cards.create({ fach: entry.fach, frage: `Erkläre den Begriff: ${query}`, antwort: entry.erklaerung, quelle });
      }
      lq.selected = { type: 'eigen', target: store.eigene.find((e) => e.id === entry.id) || entry, title: norm(query), keys: [] };
      showToast(
        isDraft(entry)
          ? `Offene Lücke angelegt, Lernkarte ${cards.formatNr(card.nr)} verknüpft`
          : `Wissenseintrag und Lernkarte ${cards.formatNr(card.nr)} angelegt`,
        'success',
      );
      renderLuecken();
    } catch (err) {
      setStatus(`Anlegen fehlgeschlagen: ${err.message || 'unbekannter Fehler'}`);
    } finally {
      lq.busy = false;
      submit.disabled = false;
      submit.textContent = 'Lücke anlegen';
    }
  });

  box.append(form);
  requestAnimationFrame(() => {
    if (document.activeElement === document.body || document.activeElement === $('gap-check')) fach.focus({ preventScroll: true });
  });
  return box;
}

/* ------------------------------------------------------------------ */
/* Übersicht: fehlende Karten und offene Lücken                         */
/* ------------------------------------------------------------------ */

function renderOverview() {
  const container = $('gap-overview');
  container.replaceChildren();

  // 1. Lernkarten zu vorhandenem Wissen
  const missing = cards.countMissing();
  const gen = panel(`gap-generate${missing ? '' : ' is-done'}`, missing ? '＋' : '✓', 'Lernkarten aus vorhandenem Wissen');
  if (missing) {
    gen.append(el('p', null, `Für ${plural(missing, 'Stelle', 'Stellen')} im Wissen gibt es noch keine Lernkarte (Begriffe, Managementsprache, Musterantworten, Kernaussagen, Zuordnungen, Feynman, Abkürzungen).`));
    gen.append(
      button('btn btn-primary', `${plural(missing, 'Lernkarte', 'Lernkarten')} erzeugen`, () => {
        if (missing >= CONFIRM_BULK_FROM && !window.confirm(`${missing} Lernkarten erzeugen? Sie bleiben mit dem Wissen verknüpft und zeigen immer dessen aktuellen Text.`)) return;
        const created = cards.generateMissing();
        showToast(`${plural(created, 'Lernkarte', 'Lernkarten')} erzeugt und verknüpft`, 'success');
      }),
    );
  } else {
    gen.append(el('p', 'muted', 'Zu allem Wissen gibt es bereits Lernkarten.'));
  }
  const all = cards.cards();
  const linkedCount = all.filter((c) => c.quelle).length;
  gen.append(el('p', 'muted small', `Lernkarten gesamt: ${all.length} · davon mit Wissen verknüpft: ${linkedCount}`));
  container.append(gen);

  // 2. Offene Lücken
  const drafts = store.eigene.filter(isDraft);
  const draftQuellen = new Set(drafts.map((e) => `e:${e.id}`));
  const openCards = all.filter((c) => !cards.view(c).antwort.trim() && !draftQuellen.has(c.quelle));
  const openCount = drafts.length + openCards.length;
  const open = panel(`gap-open${openCount ? '' : ' is-done'}`, openCount ? '!' : '✓', `Offene Lücken (${openCount})`);
  if (!drafts.length && !openCards.length) {
    open.append(el('p', 'muted', 'Keine offenen Lücken. Alles hat eine Erklärung.'));
  }
  for (const entry of drafts) {
    const row = el('div', 'gap-card');
    const text = el('div', 'gap-card-text');
    const top = el('span', 'gap-card-top');
    top.append(el('span', 'gap-card-frage', entry.titel), el('span', 'badge', entry.fach || 'Allgemein'));
    const linkedCards = cards.forQuelle(`e:${entry.id}`);
    text.append(top, el('span', 'gap-card-antwort', linkedCards.length ? `Lernkarte ${linkedCards.map((c) => cards.formatNr(c.nr)).join(', ')} wartet auf die Erklärung` : 'Erklärung fehlt'));
    const actions = el('div', 'gap-card-actions');
    actions.append(button('btn btn-small btn-primary', '✎ Ergänzen', () => openEntryEditor(entry.id)));
    row.append(text, actions);
    open.append(row);
  }
  for (const card of openCards) open.append(cardRow(card));
  container.append(open);
}

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

/** Neu zeichnen nach Daten-Änderungen (Karten oder Wissen). */
export function renderLuecken() {
  if (!lq.ready) return;
  // Gewählten Treffer auf den aktuellen Datenstand umbiegen (z. B. nach dem Ergänzen eines Entwurfs)
  if (lq.selected && lq.selected.type === 'eigen') {
    const fresh = store.eigene.find((e) => e.id === lq.selected.target.id);
    if (fresh) lq.selected = { ...lq.selected, target: fresh };
  }
  renderResult();
  renderOverview();
}

export function initLuecken(options) {
  getSettings = options.getSettings;
  cards = options.cards;
  lq.ready = true;

  $('gap-form').addEventListener('submit', (event) => {
    event.preventDefault();
    lq.query = $('gap-input').value;
    lq.selected = null;
    renderResult();
  });
  $('gap-input').addEventListener('input', (event) => {
    if (!event.target.value.trim()) {
      lq.query = '';
      lq.selected = null;
      renderResult();
    }
  });
  renderLuecken();
}

