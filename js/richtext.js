/**
 * richtext.js
 *
 * Wandelt Merker-Texte sicher in DOM-Knoten um (nie über innerHTML):
 *  - Absätze (Leerzeile) und Aufzählungen ("- " am Zeilenanfang)
 *  - **fett**
 *  - Herkunfts-Markierungen: (Folie 9), [Gesetz: …], [Ergänzung: …],
 *    [Nicht belegt: …], [Fiktiv], [Korrektur], [Präzisierung]
 *  - automatische Verlinkung bekannter Begriffe und Kürzel (über einen Linker)
 */

import { el } from './ui.js';

const BOLD = String.raw`\*\*(.+?)\*\*`;
const MARKER = String.raw`\[(Gesetz(?: laut IHK-Lösung[^:\]]*)?|Ergänzung|Nicht belegt|Fiktiv|Korrektur|Präzisierung)(?::\s*([^\]]*))?\]`;
const FOLIO = String.raw`\(((?:vgl\.\s|siehe\s)?Folien?\s[^)]*)\)`;
const INLINE_SOURCE = `${BOLD}|${MARKER}|${FOLIO}`;

const MARKER_CLASS = {
  Gesetz: 'src-gesetz',
  'Ergänzung': 'src-ergaenzung',
  'Nicht belegt': 'src-unbelegt',
  Fiktiv: 'src-fiktiv',
  Korrektur: 'src-korrektur',
  'Präzisierung': 'src-ergaenzung',
};

/** Kennzeichen für eine Herkunfts-Markierung. */
function markerBadge(kind, detail, fullText) {
  const isLaw = kind.startsWith('Gesetz');
  const cls = isLaw ? 'src-gesetz' : MARKER_CLASS[kind] || 'src-folie';
  let label;
  if (isLaw) {
    const via = kind.includes('IHK-Lösung') ? 'IHK-Lösung: ' : '';
    label = `${via}${detail || 'Gesetz'}`;
  } else {
    label = detail ? `${kind}: ${detail}` : kind;
  }
  const badge = el('span', `src ${cls}`, label);
  badge.title = fullText;
  return badge;
}

/**
 * Kontext für die Darstellung.
 * @typedef {Object} RichContext
 * @property {{ link: Function }} [linker]  erkennt Begriffe in einfachem Text
 * @property {Set<string>} [linked]          bereits verlinkte Begriffe (nur erstes Vorkommen verlinken)
 * @property {string} [selfId]               eigener Begriff, der nicht auf sich selbst verlinken soll
 */

/** Rendert eine Zeile mit fett, Markierungen und Begriffs-Links. */
export function renderInline(text, ctx = {}) {
  const fragment = document.createDocumentFragment();
  const source = String(text ?? '');
  let last = 0;
  // Eigene RegExp pro Aufruf: renderInline ruft sich für fetten Text selbst auf
  const pattern = new RegExp(INLINE_SOURCE, 'g');

  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    if (match.index > last) appendLinked(fragment, source.slice(last, match.index), ctx);
    const [full, bold, kind, detail, folio] = match;
    if (bold !== undefined) {
      const strong = el('strong');
      strong.append(renderInline(bold, ctx));
      fragment.append(strong);
    } else if (kind !== undefined) {
      fragment.append(markerBadge(kind, detail ? detail.trim() : '', full));
    } else {
      const badge = el('span', 'src src-folie', folio);
      badge.title = full;
      fragment.append(badge);
    }
    last = match.index + full.length;
  }
  if (last < source.length) appendLinked(fragment, source.slice(last), ctx);
  return fragment;
}

function appendLinked(fragment, text, ctx) {
  if (ctx.linker) fragment.append(ctx.linker.link(text, ctx));
  else fragment.append(document.createTextNode(text));
}

/** Rendert mehrzeiligen Text mit Absätzen und Aufzählungen. */
export function renderRich(text, ctx = {}) {
  const container = el('div', 'rich');
  let paragraph = [];
  let list = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const p = el('p');
    paragraph.forEach((line, i) => {
      if (i > 0) p.append(el('br'));
      p.append(renderInline(line, ctx));
    });
    container.append(p);
    paragraph = [];
  };
  const closeList = () => {
    list = null;
  };

  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    const bullet = line.match(/^[-•]\s+(.*)$/);
    if (!line) {
      flushParagraph();
      closeList();
    } else if (bullet) {
      flushParagraph();
      if (!list) {
        list = el('ul');
        container.append(list);
      }
      const li = el('li');
      li.append(renderInline(bullet[1], ctx));
      list.append(li);
    } else {
      closeList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  return container;
}

/** Entfernt Markierungen und Formatierung, z. B. für Suche und Vorschauen. */
export function plainText(text) {
  return String(text ?? '')
    .replace(new RegExp(`\\s*(?:${MARKER})`, 'g'), '')
    .replace(new RegExp(`\\s*(?:${FOLIO})`, 'g'), '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
