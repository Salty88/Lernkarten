/**
 * wissen.js
 *
 * Oberfläche des Nachschlagewerks (Tab „Wissen“):
 *  - Themen: Merker je Fach mit Miniblöcken und den sechs Bezügen
 *  - Register A–Z aller Begriffe
 *  - Eigene Einträge inkl. Entwürfe („Offen“) und Bilder
 *  - Suche über alles, die gleichzeitig Neuerfassung anbietet
 *  - Begriff-Fenster mit Kurzerklärung, Funktionsweise und Fundstelle
 *  - Import von Merkern (JSON)
 */

import { SyncError, hasValidSettings, putBase64File, deleteFile, fetchRawBlob } from './github-sync.js';
import { el, button, plural, norm, showToast, openModal, closeModal, closeOnBackdropClick } from './ui.js';
import { renderInline, renderRich, plainText } from './richtext.js';
import {
  FAECHER,
  store,
  paths,
  fachKey,
  fachLabel,
  fachName,
  normalizeMerker,
  merkerStats,
  isDraft,
  restoreWissen,
  loadWissen,
  saveMerker,
  merkerPathExists,
  commitEigene,
  clearWissenCache,
  createLinker,
  sameNameTerms,
  search,
} from './wissen-data.js';

const PREFS_KEY = 'lernkartei.wissen.prefs';
const ALL = 'alle';
const SEARCH_LIMIT = 40;

let getSettings = () => ({});

/** Ansichtszustand (Modus und Fach werden pro Gerät gemerkt). */
const ws = {
  mode: 'themen',
  fach: ALL,
  query: '',
  openMerkerId: null,
  openBlocks: new Set(),
  openEntries: new Set(),
  eigeneFilter: ALL,
  syncing: false,
};

const $ = (id) => document.getElementById(id);
const linker = createLinker((target) => openSheet(target));

function loadPrefs() {
  try {
    const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    if (['themen', 'register', 'eigene'].includes(prefs.mode)) ws.mode = prefs.mode;
    if (typeof prefs.fach === 'string') ws.fach = prefs.fach;
  } catch {
    /* Standardwerte behalten */
  }
}

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ mode: ws.mode, fach: ws.fach }));
  } catch {
    /* nur Komfort, nicht kritisch */
  }
}

/** Kontext für Verlinkung: pro Abschnitt wird jeder Begriff nur einmal verlinkt. */
function linkCtx(extra = {}) {
  return { linker, linked: new Set(), ...extra };
}

function matchesFach(key) {
  return ws.fach === ALL || key === ws.fach;
}

/* ------------------------------------------------------------------ */
/* Laden und Synchronisieren                                           */
/* ------------------------------------------------------------------ */

/** Lädt Merker und eigene Einträge von GitHub; Fehler werden als Toast gemeldet. */
export async function syncWissen({ announce = false } = {}) {
  const settings = getSettings();
  if (!hasValidSettings(settings) || ws.syncing) return false;
  ws.syncing = true;
  $('w-sync').disabled = true;
  try {
    const { fehler } = await loadWissen(settings);
    renderWissen();
    if (fehler.length) showToast(`Nicht lesbar: ${fehler.join('; ')}`, 'error');
    else if (announce) showToast(`${plural(store.merker.length, 'Merker', 'Merker')} und ${plural(store.eigene.length, 'eigener Eintrag', 'eigene Einträge')} geladen`, 'success');
    return true;
  } catch (err) {
    const msg = err instanceof SyncError && err.code === 'network'
      ? 'Wissen: keine Verbindung. Zeige den zuletzt geladenen Stand.'
      : `Wissen nicht geladen: ${err.message}`;
    showToast(msg, 'error');
    return false;
  } finally {
    ws.syncing = false;
    $('w-sync').disabled = false;
  }
}

/** Nach geänderten Einstellungen: Zwischenspeicher des neuen Ziels anzeigen. */
export function reloadWissenForSettings({ clear = false } = {}) {
  if (clear) clearWissenCache();
  ws.openMerkerId = null;
  restoreWissen(getSettings());
  renderWissen();
}

/* ------------------------------------------------------------------ */
/* Rendering: Rahmen                                                   */
/* ------------------------------------------------------------------ */

export function renderWissen() {
  renderChips();
  document.querySelectorAll('#view-wissen .seg').forEach((seg) => {
    const active = seg.dataset.mode === ws.mode;
    seg.classList.toggle('is-active', active);
    seg.setAttribute('aria-selected', String(active));
  });

  const content = $('w-content');
  content.replaceChildren();
  if (ws.query.trim()) content.append(renderSearch());
  else if (ws.mode === 'register') content.append(renderRegister());
  else if (ws.mode === 'eigene') content.append(renderEigene());
  else content.append(ws.openMerkerId ? renderMerkerView() : renderMerkerList());
}

function renderChips() {
  const counts = new Map();
  const bump = (key, n = 1) => counts.set(key, (counts.get(key) || 0) + n);
  for (const term of store.index ? store.index.terms : []) bump(term.fach);
  for (const entry of store.eigene) bump(fachKey(entry.fach));

  const extra = [...counts.keys()].filter((k) => k.startsWith('x:')).sort((a, b) => a.localeCompare(b, 'de'));
  const keys = [ALL, ...FAECHER.map((f) => f.id), ...extra];
  if (!keys.includes(ws.fach)) ws.fach = ALL;

  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  $('w-chips').replaceChildren(
    ...keys.map((key) => {
      const chip = button(`chip${key === ws.fach ? ' is-active' : ''}`, key === ALL ? 'Alle' : fachLabel(key));
      chip.dataset.fach = key;
      chip.title = key === ALL ? 'Alle Fächer' : fachName(key);
      chip.append(el('span', 'chip-count', String(key === ALL ? total : counts.get(key) || 0)));
      return chip;
    }),
  );
}

function emptyState(icon, title, text) {
  const box = el('div', 'empty-state');
  box.append(el('span', 'empty-icon', icon), el('p', 'empty-title', title));
  if (text) box.append(el('p', 'empty-text', text));
  return box;
}

function fachBadge(key) {
  const badge = el('span', 'badge', fachLabel(key));
  badge.title = fachName(key);
  return badge;
}

/* ------------------------------------------------------------------ */
/* Themen: Merker-Liste                                                */
/* ------------------------------------------------------------------ */

function renderMerkerList() {
  const wrap = el('div', 'merker-list');
  const settings = getSettings();
  if (!hasValidSettings(settings) && store.merker.length === 0) {
    wrap.append(emptyState('🔌', 'Noch nicht verbunden', 'Verbinde zuerst dein GitHub-Repository über das Zahnrad oben rechts.'));
    return wrap;
  }

  const groups = ws.fach === ALL
    ? [...FAECHER.map((f) => f.id), ...new Set(store.merker.map((m) => m.fach).filter((k) => k.startsWith('x:')))]
    : [ws.fach];

  for (const key of groups) {
    const list = store.merker.filter((m) => m.fach === key);
    const group = el('section', 'fach-group');
    const head = el('h3', 'fach-group-title');
    head.append(el('span', 'fach-group-kurz', fachLabel(key)), document.createTextNode(fachName(key)));
    group.append(head);

    if (list.length === 0) {
      group.append(el('p', 'fach-group-empty', 'Noch kein Merker importiert.'));
    }
    for (const merker of list) {
      const stats = merkerStats(merker);
      const card = button('merker-card', null, () => openMerker(merker.id));
      card.append(
        el('span', 'merker-card-title', merker.titel),
        el('span', 'merker-card-teil', merker.teil),
        el('span', 'merker-card-stats', `${plural(stats.themen, 'Thema', 'Themen')} · ${plural(stats.begriffe, 'Begriff', 'Begriffe')}`),
      );
      group.append(card);
    }
    wrap.append(group);
  }
  return wrap;
}

/* ------------------------------------------------------------------ */
/* Themen: ein Merker                                                  */
/* ------------------------------------------------------------------ */

/** Öffnet einen Merker, optional direkt an einem Miniblock. */
export function openMerker(merkerId, blockId = null) {
  ws.mode = 'themen';
  ws.query = '';
  $('w-search').value = '';
  ws.openMerkerId = merkerId;
  if (blockId) ws.openBlocks.add(`${merkerId}#${blockId}`);
  savePrefs();
  closeModal($('term-sheet'));
  document.dispatchEvent(new CustomEvent('wissen:show'));
  renderWissen();
  requestAnimationFrame(() => {
    const target = blockId ? document.getElementById(`block-${merkerId}-${blockId}`) : $('w-content');
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function renderMerkerView() {
  const merker = store.merker.find((m) => m.id === ws.openMerkerId);
  if (!merker) {
    ws.openMerkerId = null;
    return renderMerkerList();
  }
  const wrap = el('div', 'merker-view');
  const back = button('btn btn-small btn-secondary back-btn', '‹ Alle Themen', () => {
    ws.openMerkerId = null;
    renderWissen();
  });
  wrap.append(back, renderMerkerHeader(merker));

  const jump = el('nav', 'block-jump');
  jump.setAttribute('aria-label', 'Miniblöcke');
  for (const block of merker.bloecke) {
    const chip = button('chip', block.id, () => openMerker(merker.id, block.id));
    chip.title = block.titel;
    jump.append(chip);
  }
  wrap.append(jump);

  for (const block of merker.bloecke) wrap.append(renderBlock(merker, block));
  wrap.append(renderMerkerFooter(merker));
  return wrap;
}

function renderMerkerHeader(merker) {
  const head = el('header', 'panel merker-head');
  const meta = el('div', 'merker-meta');
  meta.append(fachBadge(merker.fach));
  if (merker.kontext) meta.append(el('span', 'merker-kontext', merker.kontext));
  head.append(meta, el('h2', 'merker-title', merker.titel));
  if (merker.teil) head.append(el('p', 'merker-teil', merker.teil));

  const info = [
    ['Skript', merker.skript],
    ['Aufbau', merker.aufbau],
    ['Prüfungsrahmen', merker.pruefungsrahmen],
    ['Hinweis', merker.hinweis],
  ].filter(([, value]) => value);
  if (info.length) {
    const details = el('details', 'merker-info');
    details.append(el('summary', null, 'Über diesen Merker'));
    const dl = el('dl', 'info-list');
    for (const [label, value] of info) {
      const dd = el('dd');
      dd.append(renderInline(value, linkCtx({ merkerId: merker.id, fach: merker.fach })));
      dl.append(el('dt', null, label), dd);
    }
    details.append(dl);
    head.append(details);
  }
  for (const table of merker.tabellen) {
    const details = el('details', 'merker-info');
    details.append(el('summary', null, table.titel || 'Übersicht'), renderTable(table, linkCtx({ merkerId: merker.id, fach: merker.fach })));
    head.append(details);
  }
  return head;
}

function renderTable(table, ctx) {
  const scroller = el('div', 'table-scroll');
  const t = el('table', 'data-table');
  if (table.spalten.length) {
    const tr = el('tr');
    table.spalten.forEach((s) => tr.append(el('th', null, s)));
    const thead = el('thead');
    thead.append(tr);
    t.append(thead);
  }
  const tbody = el('tbody');
  for (const row of table.zeilen) {
    const tr = el('tr');
    row.forEach((cell) => {
      const td = el('td');
      td.append(renderInline(cell, ctx));
      tr.append(td);
    });
    tbody.append(tr);
  }
  t.append(tbody);
  scroller.append(t);
  return scroller;
}

/** Ein Miniblock mit den sechs Bezügen; Glossar und Abschluss sind sofort offen. */
function renderBlock(merker, block) {
  const key = `${merker.id}#${block.id}`;
  const details = el('details', 'block');
  details.id = `block-${merker.id}-${block.id}`;
  details.open = ws.openBlocks.has(key);
  details.addEventListener('toggle', () => {
    if (details.open) ws.openBlocks.add(key);
    else ws.openBlocks.delete(key);
  });

  const summary = el('summary', 'block-summary');
  const titleWrap = el('div', 'block-head');
  titleWrap.append(el('span', 'block-title', block.titel));
  if (block.folien) titleWrap.append(el('span', 'block-folien', block.folien));
  summary.append(el('span', 'block-id', block.id), titleWrap);
  details.append(summary);
  if (block.abschluss.kernaussage) {
    details.append(el('p', 'block-teaser', plainText(block.abschluss.kernaussage)));
  }

  const body = el('div', 'block-body');
  const ctx = () => linkCtx({ merkerId: merker.id, fach: merker.fach });
  const has = blockContent(block);
  // Glossar und Abschluss sind offen; fehlt das Glossar (z. B. Kurzüberblick), öffnet der Prüfungsbezug
  const openPruefung = !has.glossar && has.pruefung;
  const sections = [
    [has.praxis, '1. Praxisbezug', false, () => renderPraxis(merker, block, ctx())],
    [has.glossar, '2. Glossar', true, () => renderGlossar(block, ctx)],
    [has.pruefung, '3. Prüfungsbezug', openPruefung, () => renderPruefung(block, ctx())],
    [has.management, '4. Managementsprache', false, () => renderManagement(block, ctx())],
    [has.abschluss, '5. Abschluss', true, () => renderAbschluss(block, ctx())],
    [has.abweichungen, '6. Abweichungen', false, () => renderAbweichungen(block, ctx())],
  ];
  // Leere Bezüge werden nicht angezeigt; die Nummerierung bleibt wie im Merker
  sections.filter(([present]) => present).forEach(([, title, open, build]) => body.append(section(title, open, build)));
  details.append(body);
  return details;
}

/** Welche der sechs Bezüge haben Inhalt? */
function blockContent(block) {
  const p = block.praxis;
  const pr = block.pruefung;
  const m = block.management;
  return {
    praxis: Boolean(p.wann || p.wofuer || p.warum || p.verknuepfung),
    glossar: block.glossar.length > 0,
    pruefung: Boolean(pr.text || pr.zuordnung.length || pr.tabelle || pr.nachtrag),
    management: Boolean(m.aussagen.length || m.uebersetzungen.length || m.musterantwort),
    abschluss: Boolean(block.abschluss.kernaussage || block.abschluss.feynman),
    abweichungen: block.abweichungen.length > 0,
  };
}

/** Aufklappbarer Abschnitt; der Inhalt wird erst beim ersten Öffnen gebaut. */
function section(title, open, build) {
  const details = el('details', 'bezug');
  details.append(el('summary', 'bezug-title', title));
  let built = false;
  const ensure = () => {
    if (built) return;
    built = true;
    const content = build();
    if (content) details.append(content);
    else details.append(el('p', 'muted', 'Keine Angaben.'));
  };
  details.addEventListener('toggle', () => {
    if (details.open) ensure();
  });
  if (open) {
    details.open = true;
    ensure();
  }
  return details;
}

function renderPraxis(merker, block, ctx) {
  const p = block.praxis;
  const rows = [['Wann', p.wann], ['Wofür', p.wofuer], ['Warum', p.warum], ['Verknüpfung', p.verknuepfung]].filter(([, v]) => v);
  if (!rows.length) return null;
  const dl = el('dl', 'praxis-list');
  for (const [label, value] of rows) {
    const dd = el('dd');
    dd.append(label === 'Verknüpfung' ? renderVerknuepfung(merker, value, ctx) : renderInline(value, ctx));
    dl.append(el('dt', null, label), dd);
  }
  return dl;
}

/** „Miniblock D“ wird zum Sprung-Link innerhalb des Merkers. */
function renderVerknuepfung(merker, text, ctx) {
  const fragment = document.createDocumentFragment();
  const pattern = /Miniblock ([A-Z])\b/g;
  let last = 0;
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    if (!merker.bloecke.some((b) => b.id === m[1])) continue;
    if (m.index > last) fragment.append(renderInline(text.slice(last, m.index), ctx));
    fragment.append(button('term-link', m[0], () => openMerker(merker.id, m[1])));
    last = m.index + m[0].length;
  }
  if (last < text.length) fragment.append(renderInline(text.slice(last), ctx));
  return fragment;
}

function renderGlossar(block, ctxFactory) {
  if (!block.glossar.length) return null;
  const list = el('div', 'glossary');
  const terms = store.index ? store.index.terms.filter((t) => t.block === block) : [];
  const shared = ctxFactory(); // ein gemeinsames „schon verlinkt“ für das ganze Glossar
  block.glossar.forEach((g, i) => {
    const term = terms[i];
    const row = el('div', 'g-row');
    const name = button('g-term', g.begriff, () => term && openSheet(term));
    const ctx = { ...shared, selfId: term ? term.id : null };
    const kurz = el('div', 'g-kurz');
    kurz.append(renderInline(g.kurz, ctx));
    const funktion = el('div', 'g-funktion');
    funktion.append(renderInline(g.funktion, ctx));
    row.append(name, kurz, funktion);
    list.append(row);
  });
  return list;
}

function renderPruefung(block, ctx) {
  const p = block.pruefung;
  if (!p.text && !p.zuordnung.length && !p.tabelle && !p.nachtrag) return null;
  const wrap = el('div', 'pruefung');
  if (p.text) wrap.append(renderRich(p.text, ctx));
  if (p.zuordnung.length) {
    const list = el('ul', 'quiz-list');
    for (const item of p.zuordnung) {
      const li = el('li', 'quiz-item');
      const answer = el('span', 'quiz-answer', item.antwort);
      answer.hidden = true;
      const reveal = button('btn btn-small btn-secondary', 'Zeigen', () => {
        answer.hidden = !answer.hidden;
        reveal.textContent = answer.hidden ? 'Zeigen' : 'Verbergen';
      });
      li.append(el('span', 'quiz-question', item.frage), reveal, answer);
      list.append(li);
    }
    wrap.append(el('p', 'muted small', 'Erst selbst zuordnen, dann aufdecken.'), list);
  }
  if (p.tabelle) wrap.append(renderTable(p.tabelle, ctx));
  if (p.nachtrag) wrap.append(renderRich(p.nachtrag, ctx));
  return wrap;
}

function renderManagement(block, ctx) {
  const m = block.management;
  if (!m.aussagen.length && !m.uebersetzungen.length && !m.musterantwort) return null;
  const wrap = el('div', 'management');
  if (m.aussagen.length) {
    const ul = el('ul', 'aussagen');
    m.aussagen.forEach((a) => {
      const li = el('li');
      li.append(renderInline(a, ctx));
      ul.append(li);
    });
    wrap.append(ul);
  }
  if (m.uebersetzungen.length) {
    const list = el('div', 'translate-list');
    for (const u of m.uebersetzungen) {
      const row = el('div', 'translate-row');
      const halle = el('div', 'translate-halle');
      halle.append(el('span', 'translate-label', 'Halle'), el('span', null, `„${u.halle}“`));
      const mgmt = el('div', 'translate-mgmt');
      mgmt.append(el('span', 'translate-label', 'Management'));
      const text = el('span');
      text.append(renderInline(u.management, ctx));
      mgmt.append(text);
      row.append(halle, mgmt);
      list.append(row);
    }
    wrap.append(list);
  }
  if (m.musterantwort) wrap.append(renderMusterantwort(m.musterantwort, ctx));
  return wrap;
}

function renderMusterantwort(ma, ctx) {
  const box = el('div', 'musterantwort');
  box.append(el('span', 'musterantwort-label', 'Musterantwort'), el('p', 'musterantwort-frage', `„${ma.frage}“`));
  if (ma.hinweis) box.append(el('p', 'muted small', ma.hinweis));
  const details = el('details');
  details.append(el('summary', null, 'Antwort aufdecken'), renderRich(ma.antwort, ctx));
  box.append(details);
  return box;
}

function renderAbschluss(block, ctx) {
  const a = block.abschluss;
  if (!a.kernaussage && !a.feynman) return null;
  const wrap = el('div', 'abschluss');
  if (a.kernaussage) {
    const box = el('div', 'kernaussage');
    box.append(el('span', 'kernaussage-label', 'Kernaussage'), renderRich(a.kernaussage, ctx));
    wrap.append(box);
  }
  if (a.feynman) {
    const box = el('div', 'feynman');
    const task = el('p');
    task.append(el('strong', null, 'Feynman: '), document.createTextNode(`„${a.feynman.aufgabe}“`));
    box.append(task);
    if (a.feynman.muss.length) {
      const details = el('details');
      details.append(el('summary', null, `Muss enthalten (${a.feynman.muss.length})`));
      const ol = el('ol');
      a.feynman.muss.forEach((item) => {
        const li = el('li');
        li.append(renderInline(item, ctx));
        ol.append(li);
      });
      details.append(ol);
      box.append(details);
    }
    wrap.append(box);
  }
  return wrap;
}

function deviationClass(typ) {
  const t = norm(typ);
  if (t.includes('korrektur')) return 'dev-korrektur';
  if (t.includes('luck')) return 'dev-luecke';
  if (t.includes('keine')) return 'dev-ok';
  if (t.includes('erganz') || t.includes('prazis')) return 'dev-ergaenzung';
  return 'dev-hinweis';
}

function renderAbweichungen(block, ctx) {
  if (!block.abweichungen.length) return null;
  const ul = el('ul', 'deviations');
  for (const a of block.abweichungen) {
    const li = el('li');
    li.append(el('span', `dev-badge ${deviationClass(a.typ)}`, a.typ), renderInline(a.text, ctx));
    ul.append(li);
  }
  return ul;
}

function renderMerkerFooter(merker) {
  if (!merker.korrekturen.length && !merker.quellen.length) return document.createDocumentFragment();
  const details = el('details', 'panel merker-footer');
  details.append(el('summary', null, 'Korrekturen und Quellen'));
  if (merker.korrekturen.length) {
    const ul = el('ul', 'deviations');
    for (const k of merker.korrekturen) {
      const li = el('li');
      li.append(el('span', 'dev-badge dev-korrektur', k.id || 'Korrektur'), renderInline(k.text));
      ul.append(li);
    }
    details.append(ul);
  }
  if (merker.quellen.length) {
    details.append(el('h4', 'footer-title', 'Geprüfte Quellen'));
    const ul = el('ul', 'quellen');
    for (const q of merker.quellen) {
      const li = el('li');
      if (q.url) {
        const a = el('a', null, q.text);
        a.href = q.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        li.append(a);
      } else {
        li.textContent = q.text;
      }
      ul.append(li);
    }
    details.append(ul);
  }
  return details;
}

/* ------------------------------------------------------------------ */
/* Register A–Z                                                        */
/* ------------------------------------------------------------------ */

function firstLetter(text) {
  const c = norm(text).charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : '#';
}

function renderRegister() {
  const items = [];
  for (const term of store.index ? store.index.terms : []) {
    if (matchesFach(term.fach)) items.push({ title: term.begriff, sub: plainText(term.kurz), fach: term.fach, open: () => openSheet(term) });
  }
  for (const entry of store.eigene) {
    const key = fachKey(entry.fach);
    if (matchesFach(key)) {
      items.push({ title: entry.titel, sub: isDraft(entry) ? 'Entwurf' : plainText(entry.erklaerung), fach: key, eigen: true, open: () => openEntry(entry.id) });
    }
  }
  if (!items.length) return emptyState('🔤', 'Noch keine Begriffe', 'Importiere einen Merker oder lege eigene Einträge an.');

  items.sort((a, b) => a.title.localeCompare(b.title, 'de', { sensitivity: 'base' }));
  const wrap = el('div', 'register');
  const bar = el('nav', 'letter-bar');
  bar.setAttribute('aria-label', 'Buchstaben');
  const list = el('div', 'register-list');
  let current = null;

  for (const item of items) {
    const letter = firstLetter(item.title);
    if (letter !== current) {
      current = letter;
      const heading = el('h3', 'register-letter', letter);
      heading.id = `reg-${letter}`;
      list.append(heading);
      bar.append(button('letter', letter, () => heading.scrollIntoView({ behavior: 'smooth', block: 'start' })));
    }
    const row = button('reg-row', null, item.open);
    const top = el('span', 'reg-top');
    top.append(el('span', 'reg-title', item.title));
    if (ws.fach === ALL) top.append(fachBadge(item.fach));
    if (item.eigen) top.append(el('span', 'tag', 'eigen'));
    row.append(top, el('span', 'reg-sub', item.sub));
    list.append(row);
  }
  wrap.append(el('p', 'muted small', plural(items.length, 'Eintrag', 'Einträge')), bar, list);
  return wrap;
}

/* ------------------------------------------------------------------ */
/* Suche                                                               */
/* ------------------------------------------------------------------ */

const RESULT_GROUPS = [
  ['begriff', 'Begriffe'],
  ['kuerzel', 'Kürzel'],
  ['thema', 'Themen'],
  ['frage', 'Musterantworten'],
  ['halle', 'Managementsprache'],
  ['eigen', 'Eigene Einträge'],
];

function docFach(doc) {
  if (doc.type === 'eigen') return fachKey(doc.target.fach);
  if (doc.type === 'begriff' || doc.type === 'kuerzel') return doc.target.fach;
  return doc.target.merker.fach;
}

function resultRow(doc) {
  const t = doc.target;
  let title;
  let sub;
  let open;
  switch (doc.type) {
    case 'begriff':
      title = t.begriff;
      sub = plainText(t.kurz);
      open = () => openSheet(t);
      break;
    case 'kuerzel':
      title = t.kurz;
      sub = t.lang;
      open = () => openSheet(t);
      break;
    case 'thema':
      title = `${t.block.id} · ${t.block.titel}`;
      sub = t.merker.titel;
      open = () => openMerker(t.merker.id, t.block.id);
      break;
    case 'frage':
      title = t.musterantwort.frage;
      sub = `${t.block.id} · ${t.block.titel}`;
      open = () => openMerker(t.merker.id, t.block.id);
      break;
    case 'halle':
      title = `„${t.uebersetzung.halle}“`;
      sub = plainText(t.uebersetzung.management);
      open = () => openMerker(t.merker.id, t.block.id);
      break;
    default:
      title = t.titel;
      sub = isDraft(t) ? 'Entwurf' : plainText(t.erklaerung);
      open = () => openEntry(t.id);
  }
  const row = button('reg-row', null, open);
  const top = el('span', 'reg-top');
  top.append(el('span', 'reg-title', title), fachBadge(docFach(doc)));
  row.append(top, el('span', 'reg-sub', sub));
  return row;
}

function renderSearch() {
  const query = ws.query.trim();
  const results = search(query, (doc) => matchesFach(docFach(doc))).slice(0, SEARCH_LIMIT);
  const wrap = el('div', 'search-results');

  if (!results.length) {
    wrap.append(el('p', 'empty-text', `Nichts gefunden zu „${query}“${ws.fach === ALL ? '' : ` in ${fachLabel(ws.fach)}`}.`));
  }
  // Gruppen in der Reihenfolge ihres besten Treffers (Ergebnisse sind nach Relevanz sortiert)
  const order = [...new Set(results.map((d) => d.type))];
  const groups = RESULT_GROUPS.slice().sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  for (const [type, label] of groups) {
    const group = results.filter((d) => d.type === type);
    if (!group.length) continue;
    wrap.append(el('h3', 'result-group', label));
    group.forEach((doc) => wrap.append(resultRow(doc)));
  }

  const exists = store.eigene.some((e) => norm(e.titel) === norm(query));
  if (!exists) {
    const create = button('btn btn-primary create-draft', `＋ „${query}“ als Entwurf anlegen`, () => openEntryEditor(null, { titel: query }));
    wrap.append(create);
  }
  return wrap;
}

/* ------------------------------------------------------------------ */
/* Begriff-Fenster                                                     */
/* ------------------------------------------------------------------ */

const sheetHistory = [];

/** Öffnet das Fenster für einen Begriff oder ein Kürzel; Links darin öffnen den nächsten. */
export function openSheet(target, { push = true } = {}) {
  const sheet = $('term-sheet');
  if (push) {
    if (sheet.hidden) sheetHistory.length = 0;
    sheetHistory.push(target);
  }
  $('term-back').hidden = sheetHistory.length < 2;
  const body = $('term-body');
  body.replaceChildren();
  $('term-fach').replaceChildren(fachBadge(target.fach));
  body.scrollTop = 0;

  if (target.begriff !== undefined) renderTermSheet(target, body);
  else renderAbbreviationSheet(target, body);

  if (sheet.hidden) openModal(sheet, $('term-close'));
}

function renderTermSheet(term, body) {
  $('term-title').textContent = term.begriff;
  const ctx = linkCtx({ merkerId: term.merker.id, fach: term.fach, selfId: term.id });
  const aliases = [...term.kuerzel, ...term.synonyme].filter((a) => a !== term.begriff);
  if (aliases.length) body.append(el('p', 'muted small', `Auch: ${aliases.join(', ')}`));

  const kurz = el('div', 'sheet-block');
  kurz.append(el('span', 'sheet-label', 'Kurzerklärung'), renderRich(term.kurz, ctx));
  const funktion = el('div', 'sheet-block');
  funktion.append(el('span', 'sheet-label', 'Funktionsweise'), renderRich(term.funktion, ctx));
  body.append(kurz, funktion);

  const origin = el('div', 'sheet-origin');
  origin.append(
    el('span', 'sheet-label', 'Fundstelle'),
    el('p', null, `${term.merker.titel}${term.merker.teil ? ` (${term.merker.teil.split('(')[0].trim()})` : ''}`),
    el('p', 'muted', `Miniblock ${term.block.id}: ${term.block.titel}`),
    button('btn btn-small btn-primary', 'Zum Thema ›', () => openMerker(term.merker.id, term.block.id)),
  );
  body.append(origin);

  const others = sameNameTerms(term);
  if (others.length) {
    const box = el('div', 'sheet-block');
    box.append(el('span', 'sheet-label', 'Auch in anderen Themen'));
    for (const other of others) {
      box.append(button('reg-row', `${fachLabel(other.fach)} · ${other.merker.titel}: ${plainText(other.kurz)}`, () => openSheet(other)));
    }
    body.append(box);
  }
}

function renderAbbreviationSheet(abk, body) {
  $('term-title').textContent = abk.kurz;
  body.append(el('p', 'sheet-lead', abk.lang));
  const related = store.index.terms.find((t) => norm(t.begriff) === norm(abk.lang) || t.synonyme.some((s) => norm(s) === norm(abk.lang)));
  if (related) body.append(button('btn btn-small btn-primary', `Begriff „${related.begriff}“ öffnen`, () => openSheet(related)));
  body.append(
    button('btn btn-small btn-secondary', `Überall nach „${abk.kurz}“ suchen`, () => {
      closeModal($('term-sheet'));
      setQuery(abk.kurz);
    }),
  );
}

/* ------------------------------------------------------------------ */
/* Eigene Einträge                                                     */
/* ------------------------------------------------------------------ */

const imageUrlCache = new Map();

async function imageUrl(path) {
  if (imageUrlCache.has(path)) return imageUrlCache.get(path);
  const url = URL.createObjectURL(await fetchRawBlob(getSettings(), path));
  imageUrlCache.set(path, url);
  return url;
}

function loadImages(container) {
  container.querySelectorAll('img[data-path]').forEach(async (img) => {
    if (img.getAttribute('src')) return;
    try {
      img.src = await imageUrl(img.dataset.path);
    } catch {
      img.alt = 'Bild nicht ladbar';
    }
  });
}

function openEntry(id) {
  ws.mode = 'eigene';
  ws.query = '';
  $('w-search').value = '';
  ws.eigeneFilter = ALL;
  ws.openEntries.add(id);
  savePrefs();
  closeModal($('term-sheet'));
  renderWissen();
  requestAnimationFrame(() => {
    const node = document.getElementById(`entry-${id}`);
    if (node) node.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function renderEigene() {
  const wrap = el('div', 'eigene');
  const inFach = store.eigene.filter((e) => matchesFach(fachKey(e.fach)));
  const drafts = inFach.filter(isDraft);
  const list = ws.eigeneFilter === 'offen' ? drafts : inFach;

  const bar = el('div', 'eigene-bar');
  const filters = el('div', 'chips');
  for (const [key, label, n] of [[ALL, 'Alle', inFach.length], ['offen', 'Offen', drafts.length]]) {
    const chip = button(`chip${ws.eigeneFilter === key ? ' is-active' : ''}`, label, () => {
      ws.eigeneFilter = key;
      renderWissen();
    });
    chip.append(el('span', 'chip-count', String(n)));
    filters.append(chip);
  }
  bar.append(filters, button('btn btn-small btn-primary', '＋ Neu', () => openEntryEditor(null)));
  wrap.append(bar);

  if (!list.length) {
    wrap.append(
      ws.eigeneFilter === 'offen'
        ? emptyState('✅', 'Keine offenen Entwürfe', 'Alle eigenen Einträge sind ausgefüllt.')
        : emptyState('📝', 'Noch keine eigenen Einträge', 'Tipp: Einfach oben einen Begriff eintippen und „als Entwurf anlegen“ wählen.'),
    );
    return wrap;
  }

  const sorted = list.slice().sort((a, b) => a.titel.localeCompare(b.titel, 'de', { sensitivity: 'base' }));
  for (const entry of sorted) wrap.append(renderEntry(entry));
  return wrap;
}

function renderEntry(entry) {
  const details = el('details', 'entry');
  details.id = `entry-${entry.id}`;
  details.open = ws.openEntries.has(entry.id);

  const summary = el('summary', 'entry-summary');
  summary.append(el('span', 'entry-title', entry.titel));
  const tags = el('span', 'entry-tags');
  tags.append(fachBadge(fachKey(entry.fach)));
  if (isDraft(entry)) tags.append(el('span', 'tag tag-draft', 'Entwurf'));
  entry.stichworte.forEach((s) => tags.append(el('span', 'tag', s)));
  if (entry.bilder.length) tags.append(el('span', 'tag', `📷 ${entry.bilder.length}`));
  summary.append(tags);
  details.append(summary);

  const body = el('div', 'entry-body');
  const ctx = linkCtx({ fach: fachKey(entry.fach) });
  if (entry.erklaerung) body.append(el('h4', 'entry-label', 'Erklärung'), renderRich(entry.erklaerung, ctx));
  if (entry.verstaendnis) body.append(el('h4', 'entry-label', 'Verständnis aufbauen'), renderRich(entry.verstaendnis, ctx));
  if (isDraft(entry)) body.append(el('p', 'muted', 'Entwurf: Erklärung noch offen.'));
  if (entry.bilder.length) {
    const images = el('div', 'entry-images');
    entry.bilder.forEach((path) => {
      const img = el('img');
      img.dataset.path = path;
      img.alt = `Bild zu ${entry.titel}`;
      img.addEventListener('click', () => img.src && openLightbox(img.src));
      images.append(img);
    });
    body.append(el('h4', 'entry-label', 'Bilder'), images);
  }
  const actions = el('div', 'list-actions');
  actions.append(
    button('btn btn-small btn-secondary', isDraft(entry) ? '✎ Ausfüllen' : '✎ Bearbeiten', () => openEntryEditor(entry.id)),
    button('btn btn-small btn-ghost-danger', '🗑 Löschen', () => deleteEntry(entry.id)),
  );
  body.append(actions);
  details.append(body);

  details.addEventListener('toggle', () => {
    if (details.open) {
      ws.openEntries.add(entry.id);
      loadImages(details);
    } else {
      ws.openEntries.delete(entry.id);
    }
  });
  if (details.open) loadImages(details);
  return details;
}

function openLightbox(src) {
  $('lightbox-img').src = src;
  openModal($('lightbox'));
}

/* ---------- Editor ---------- */

const editor = { id: null, original: null, images: [] };

function setEditorStatus(text, type = 'info') {
  const line = $('entry-status');
  line.hidden = !text;
  line.textContent = text;
  line.dataset.type = type;
}

/** Öffnet den Editor für einen bestehenden Eintrag oder einen neuen (optional vorbelegt). */
export function openEntryEditor(id, preset = {}) {
  const existing = id ? store.eigene.find((e) => e.id === id) : null;
  editor.original = existing;
  editor.id = existing ? existing.id : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  editor.images = existing ? existing.bilder.map((path) => ({ path, previewUrl: null })) : [];

  $('entry-modal-title').textContent = existing ? (isDraft(existing) ? 'Entwurf ausfüllen' : 'Eintrag bearbeiten') : 'Neuer Eintrag';
  $('entry-fach').value = existing ? existing.fach : preset.fach || (ws.fach !== ALL ? fachName(ws.fach) : '');
  $('entry-titel').value = existing ? existing.titel : preset.titel || '';
  $('entry-stichworte').value = existing ? existing.stichworte.join(', ') : '';
  $('entry-erklaerung').value = existing ? existing.erklaerung : '';
  $('entry-verstaendnis').value = existing ? existing.verstaendnis : '';
  setEditorStatus('');
  renderEditorImages();

  closeModal($('term-sheet'));
  const focus = !$('entry-fach').value ? $('entry-fach') : $('entry-titel').value ? $('entry-erklaerung') : $('entry-titel');
  openModal($('entry-modal'), focus);
}

function closeEntryEditor(saved) {
  if (!saved) editor.images.forEach((im) => !im.path && im.previewUrl && URL.revokeObjectURL(im.previewUrl));
  editor.images = [];
  editor.original = null;
  closeModal($('entry-modal'));
}

function renderEditorImages() {
  const box = $('entry-thumbs');
  box.replaceChildren();
  editor.images.forEach((im, i) => {
    const thumb = el('div', 'thumb');
    const img = el('img');
    img.alt = `Bild ${i + 1}`;
    const remove = button('thumb-remove', '×', () => {
      const [removed] = editor.images.splice(i, 1);
      if (removed && !removed.path && removed.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      renderEditorImages();
    });
    remove.setAttribute('aria-label', 'Bild entfernen');
    thumb.append(img, remove);
    box.append(thumb);
    (async () => {
      try {
        if (!im.previewUrl && im.path) im.previewUrl = await imageUrl(im.path);
        img.src = im.previewUrl;
      } catch {
        img.alt = 'Bild nicht ladbar';
      }
    })();
  });
}

/** Foto auf max. 1600 px Kantenlänge verkleinern und als JPEG komprimieren. */
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Bild nicht lesbar'))), 'image/jpeg', 0.85);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Bild nicht lesbar'));
    };
    img.src = url;
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function handleImageFiles(event) {
  const files = Array.from(event.target.files || []);
  event.target.value = '';
  if (!files.length) return;
  setEditorStatus('Bilder werden verkleinert …');
  let failed = 0;
  for (const file of files) {
    try {
      const blob = await compressImage(file);
      editor.images.push({ path: null, base64: await blobToBase64(blob), previewUrl: URL.createObjectURL(blob) });
    } catch {
      failed += 1;
    }
  }
  renderEditorImages();
  setEditorStatus(failed ? `${failed} Bild(er) konnten nicht verarbeitet werden.` : '', failed ? 'error' : 'info');
}

function errorText(err) {
  if (err instanceof SyncError) return err.message;
  return 'Unerwarteter Fehler beim Speichern.';
}

async function saveEntry(event) {
  event.preventDefault();
  const settings = getSettings();
  const fach = $('entry-fach').value.trim();
  const titel = $('entry-titel').value.trim();
  if (!fach || !titel) {
    setEditorStatus('Bitte mindestens Fach und Titel angeben. Der Rest kann später folgen.', 'error');
    return;
  }
  if (!hasValidSettings(settings)) {
    setEditorStatus('Bitte zuerst die GitHub-Verbindung einrichten (Zahnrad oben rechts).', 'error');
    return;
  }

  const save = $('entry-save');
  save.disabled = true;
  save.textContent = 'Speichere …';
  setEditorStatus('');
  const uploaded = [];
  try {
    const bilder = [];
    for (const im of editor.images) {
      if (im.path) {
        bilder.push(im.path);
        continue;
      }
      const path = `${paths.images(settings)}${editor.id}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}.jpg`;
      await putBase64File(settings, path, im.base64, null, 'Bild hinzugefügt');
      uploaded.push(path);
      imageUrlCache.set(path, im.previewUrl);
      bilder.push(path);
    }
    const now = new Date().toISOString();
    const entry = {
      id: editor.id,
      fach,
      titel,
      stichworte: $('entry-stichworte').value.split(/[,;]/).map((s) => s.trim()).filter(Boolean),
      erklaerung: $('entry-erklaerung').value.trim(),
      verstaendnis: $('entry-verstaendnis').value.trim(),
      bilder,
      erstellt: editor.original ? editor.original.erstellt : now,
      geaendert: now,
    };
    await commitEigene(
      settings,
      (entries) => {
        const i = entries.findIndex((e) => e.id === entry.id);
        if (i >= 0) entries[i] = entry;
        else entries.push(entry);
        return entries;
      },
      `${isDraft(entry) ? 'Entwurf' : 'Eintrag'}: ${titel}`,
    );
    const removed = editor.original ? editor.original.bilder.filter((p) => !bilder.includes(p)) : [];
    removed.forEach((p) => deleteFile(settings, p, 'Bild entfernt').catch(() => {}));

    ws.openEntries.add(entry.id);
    closeEntryEditor(true);
    if (ws.query) {
      ws.query = '';
      $('w-search').value = '';
    }
    renderWissen();
    showToast(isDraft(entry) ? 'Entwurf gespeichert, zu finden unter Eigene › Offen' : 'Eintrag gespeichert', 'success');
  } catch (err) {
    uploaded.forEach((p) => deleteFile(settings, p, 'Bild entfernt').catch(() => {}));
    setEditorStatus(errorText(err), 'error');
  } finally {
    save.disabled = false;
    save.textContent = 'Speichern';
  }
}

async function deleteEntry(id) {
  const entry = store.eigene.find((e) => e.id === id);
  if (!entry) return;
  if (!window.confirm(`„${entry.titel}“ wirklich löschen?`)) return;
  const settings = getSettings();
  try {
    await commitEigene(settings, (entries) => entries.filter((e) => e.id !== id), `Eintrag gelöscht: ${entry.titel}`);
    entry.bilder.forEach((p) => deleteFile(settings, p, 'Bild entfernt').catch(() => {}));
    ws.openEntries.delete(id);
    renderWissen();
    showToast('Eintrag gelöscht', 'success');
  } catch (err) {
    showToast(`Löschen fehlgeschlagen: ${errorText(err)}`, 'error');
  }
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

let importCandidates = [];

function setImportStatus(text, type = 'info') {
  const line = $('import-status');
  line.hidden = !text;
  line.textContent = text;
  line.dataset.type = type;
}

function openImport() {
  importCandidates = [];
  $('import-text').value = '';
  $('import-preview').replaceChildren();
  $('import-confirm').disabled = true;
  setImportStatus('');
  openModal($('import-modal'), $('import-choose'));
}

/** Akzeptiert einen Merker, eine Liste oder { merker: [...] }. */
function parseImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Das ist kein gültiges JSON. Bitte die Datei unverändert übernehmen.');
  }
  const list = Array.isArray(data) ? data : Array.isArray(data.merker) ? data.merker : [data];
  return list.map((raw) => ({ raw, merker: normalizeMerker(raw) }));
}

function checkImport(text) {
  importCandidates = [];
  $('import-preview').replaceChildren();
  $('import-confirm').disabled = true;
  if (!text.trim()) {
    setImportStatus('');
    return;
  }
  try {
    importCandidates = parseImport(text);
  } catch (err) {
    setImportStatus(err.message, 'error');
    return;
  }
  const settings = getSettings();
  for (const { merker } of importCandidates) {
    const stats = merkerStats(merker);
    const row = el('div', 'import-row');
    const top = el('span', 'reg-top');
    top.append(fachBadge(merker.fach), el('span', 'reg-title', merker.titel));
    row.append(
      top,
      el('span', 'reg-sub', `${merker.teil ? `${merker.teil} · ` : ''}${plural(stats.themen, 'Thema', 'Themen')}, ${plural(stats.begriffe, 'Begriff', 'Begriffe')}`),
      el('span', `tag${merkerPathExists(settings, merker.id) ? ' tag-draft' : ''}`, merkerPathExists(settings, merker.id) ? 'ersetzt vorhandene Version' : 'neu'),
    );
    $('import-preview').append(row);
  }
  setImportStatus('Geprüft. Alles in Ordnung.', 'success');
  $('import-confirm').disabled = false;
}

async function confirmImport() {
  const settings = getSettings();
  if (!hasValidSettings(settings)) {
    setImportStatus('Bitte zuerst die GitHub-Verbindung einrichten.', 'error');
    return;
  }
  const btn = $('import-confirm');
  btn.disabled = true;
  btn.textContent = 'Importiere …';
  try {
    for (const { raw, merker } of importCandidates) await saveMerker(settings, merker, raw);
    closeModal($('import-modal'));
    const first = importCandidates[0].merker;
    showToast(`${plural(importCandidates.length, 'Merker', 'Merker')} importiert`, 'success');
    ws.fach = first.fach;
    openMerker(first.id);
  } catch (err) {
    setImportStatus(`Import fehlgeschlagen: ${errorText(err)}`, 'error');
    btn.disabled = false;
  } finally {
    btn.textContent = 'Importieren';
  }
}

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

function setQuery(value) {
  ws.query = value;
  $('w-search').value = value;
  renderWissen();
}

function fillFachOptions() {
  $('entry-fach-list').replaceChildren(
    ...FAECHER.flatMap((f) => [f.name, f.kurz]).map((value) => {
      const option = document.createElement('option');
      option.value = value;
      return option;
    }),
  );
}

export function initWissen(options) {
  getSettings = options.getSettings;
  loadPrefs();
  fillFachOptions();
  restoreWissen(getSettings());

  let searchTimer = null;
  $('w-search').addEventListener('input', (event) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => setQuery(event.target.value), 120);
  });
  $('w-chips').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-fach]');
    if (!chip) return;
    ws.fach = chip.dataset.fach;
    if (ws.openMerkerId && ws.fach !== ALL) {
      const open = store.merker.find((m) => m.id === ws.openMerkerId);
      if (!open || open.fach !== ws.fach) ws.openMerkerId = null;
    }
    savePrefs();
    renderWissen();
  });
  document.querySelectorAll('#view-wissen .seg').forEach((seg) => {
    seg.addEventListener('click', () => {
      ws.mode = seg.dataset.mode;
      ws.query = '';
      $('w-search').value = '';
      savePrefs();
      renderWissen();
    });
  });
  $('w-sync').addEventListener('click', () => syncWissen({ announce: true }));
  $('w-import').addEventListener('click', openImport);

  // Begriff-Fenster
  $('term-close').addEventListener('click', () => closeModal($('term-sheet')));
  $('term-back').addEventListener('click', () => {
    sheetHistory.pop();
    const previous = sheetHistory[sheetHistory.length - 1];
    if (previous) openSheet(previous, { push: false });
  });
  closeOnBackdropClick($('term-sheet'));

  // Editor
  $('entry-form').addEventListener('submit', saveEntry);
  $('entry-cancel').addEventListener('click', () => closeEntryEditor(false));
  $('entry-add-image').addEventListener('click', () => $('entry-files').click());
  $('entry-files').addEventListener('change', handleImageFiles);
  closeOnBackdropClick($('entry-modal'), () => closeEntryEditor(false));

  // Import
  $('import-choose').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', async (event) => {
    const [file] = event.target.files || [];
    event.target.value = '';
    if (!file) return;
    const text = await file.text();
    $('import-text').value = text;
    checkImport(text);
  });
  $('import-text').addEventListener('input', (event) => checkImport(event.target.value));
  $('import-confirm').addEventListener('click', confirmImport);
  $('import-cancel').addEventListener('click', () => closeModal($('import-modal')));
  closeOnBackdropClick($('import-modal'));

  // Lightbox
  $('lightbox').addEventListener('click', () => closeModal($('lightbox')));

  renderWissen();
}
