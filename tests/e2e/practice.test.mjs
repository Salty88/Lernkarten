// Üben (Etappe 2): Fach-Blatt, Kopf, Karte, Nachlesen, Denkzeit, Rückmeldung
import { startApp, check, finish, defaultSeed } from './harness.mjs';

/** Beispieldaten mit eigenen Karten (ersetzt cards.json). */
function seedWith(cards) {
  return { ...defaultSeed(), 'cards.json': JSON.stringify(cards) };
}
const card = (id, fach, frage, antwort) => ({ id, nr: Number(id.slice(1)), fach, frage, antwort, status: 'neu', wiederholungen: 0, letzteUebung: null });

async function openSheet(page) {
  await page.click('#practice-fach-btn');
  await page.waitForTimeout(150);
}
async function pick(page, key) {
  await openSheet(page);
  await page.click(`#fach-sheet .sheet-option[data-key="${key}"]`);
  await page.waitForTimeout(250);
}

/* ---------- Task 1: Fach-Blatt und Kopf ---------- */
let app = await startApp();
try {
  const { page } = app;
  const head = await page.evaluate(() => {
    const a = document.getElementById('practice-fach-btn');
    const b = document.getElementById('practice-mode');
    const mid = (n) => { const r = n.getBoundingClientRect(); return r.top + r.height / 2; };
    return a && b ? Math.abs(mid(a) - mid(b)) : 999;
  });
  check('Kopf in einer Zeile', head <= 4 && (await page.locator('#practice-fach').count()) === 0, String(head));
  const mode = await page.evaluate(() => { const r = document.getElementById('practice-mode').getBoundingClientRect(); return { h: r.height, w: r.width }; });
  check('Umschalter kompakt', mode.h <= 48 && mode.w <= 170, JSON.stringify(mode));
  check('Knopf zeigt Fach', (await page.textContent('#practice-fach-label')).trim() === 'Alle Fächer');

  await openSheet(page);
  check('Blatt öffnet', (await page.isVisible('#fach-sheet')) && (await page.textContent('#fach-sheet-title')).trim() === 'Fach wählen · heute fällig', await page.textContent('#fach-sheet-title').catch(() => ''));
  const opts = await page.$$eval('#fach-sheet .sheet-option', (n) => n.map((o) => ({ key: o.dataset.key, empty: o.classList.contains('is-empty'), count: o.querySelector('.sheet-count').textContent.trim() })));
  const empties = opts.filter((o) => o.empty).map((o) => o.key).sort();
  check('Alle Fächer + 7 Fächer', opts.length === 8 && JSON.stringify(empties) === JSON.stringify(['ikt', 'mpa', 'org', 'pm']), JSON.stringify(opts));
  await page.click('#fach-sheet .sheet-option[data-key="rewe"]');
  await page.waitForTimeout(250);
  const reweCount = opts.find((o) => o.key === 'rewe')?.count;
  check('Zahl je Fach', reweCount === (await page.textContent('#due-count')).trim(), `${reweCount} / ${await page.textContent('#due-count')}`);
  check('Auswahl schließt und filtert', !(await page.isVisible('#fach-sheet')) && (await page.textContent('#practice-progress')).startsWith('ReWe') && (await page.evaluate(() => document.activeElement.id)) === 'practice-fach-btn', await page.textContent('#practice-progress'));
  check('Knopf zeigt gewähltes Fach', (await page.textContent('#practice-fach-label')).trim() === 'ReWe');
  check('Fortschritt kompakt', /^\d+ \/ \d+ · ✓ \d+ · ✗ \d+$/.test((await page.textContent('#session-text')).trim()), await page.textContent('#session-text'));

  await page.reload();
  await page.waitForTimeout(2000);
  check('Wahl bleibt nach Neuladen', (await page.textContent('#practice-fach-label')).trim() === 'ReWe');

  await openSheet(page);
  await page.click('#fach-sheet-title');
  const before = await page.textContent('#session-text');
  await page.keyboard.press('2');
  await page.waitForTimeout(150);
  check('Keine Kürzel bei offenem Blatt', (await page.textContent('#session-text')) === before, before);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  check('Esc schließt', !(await page.isVisible('#fach-sheet')));
  await openSheet(page);
  await page.mouse.click(195, 40);
  await page.waitForTimeout(150);
  check('Hintergrund schließt', !(await page.isVisible('#fach-sheet')));

  await pick(page, 'mpa');
  check('Leeres Fach', (await page.isVisible('#practice-empty')) && (await page.isVisible('#practice-fach-btn')));
  await pick(page, '__all__');
  await page.click('#practice-mode [data-mode="frei"]');
  await openSheet(page);
  check('Blatt im Modus Frei', (await page.textContent('#fach-sheet-title')).trim() === 'Fach wählen · Karten');
  await page.keyboard.press('Escape');
  check('Keine JavaScript-Fehler (Blatt)', app.errors.length === 0, app.errors.join('; '));
} catch (e) {
  check('Blatt-Test lief ohne Abbruch', false, e.message.split('\n')[0]);
} finally {
  await app.close();
}

// Zusatzfach verschwindet nach Sync → „Alle Fächer“
app = await startApp({ seed: seedWith([card('k1', 'ReWe', 'Was ist eine Bilanz?', 'Gegenüberstellung.'), card('k2', 'Latein', 'Was heißt amo?', 'Ich liebe.')]) });
try {
  const { page, repo } = app;
  await pick(page, 'x:Latein');
  check('Zusatzfach wählbar', (await page.textContent('#practice-fach-label')).trim() === 'Latein', await page.textContent('#practice-fach-label'));
  const cards = JSON.parse(repo.text('cards.json')).filter((c) => c.fach !== 'Latein');
  repo.files.set('cards.json', { content: Buffer.from(JSON.stringify(cards)), sha: 'neu-1' });
  await page.click('#tab-mehr');
  await page.click('#sync-btn');
  await page.waitForTimeout(1500);
  await page.click('#tab-practice');
  await page.waitForTimeout(250);
  check('Zusatzfach verschwindet', (await page.textContent('#practice-fach-label')).trim() === 'Alle Fächer', await page.textContent('#practice-fach-label'));
} catch (e) {
  check('Zusatzfach-Test lief ohne Abbruch', false, e.message.split('\n')[0]);
} finally {
  await app.close();
}

/* ---------- Task 2: Karte, Nachlesen, Weiter oben rechts ---------- */
const ANTWORTEN = [
  'Gegenüberstellung von Vermögen und Kapital zum Stichtag.',
  'Verteilung des Wertverzehrs auf die Nutzungsjahre.',
  'Erlöse abzüglich variabler Kosten je Stück.',
  'Menge, ab der beide Alternativen gleich viel kosten.',
  'Kosten, die unabhängig von der Ausbringung anfallen.',
  'Kosten, die sich mit der Ausbringung verändern.',
  'Verzinsung des durchschnittlich gebundenen Kapitals.',
  'Summe aller Erträge abzüglich aller Aufwendungen.',
];
const REWE = ANTWORTEN.map((a, i) => card(`k${i + 1}`, 'ReWe', `Frage Nummer ${i + 1}: Was beschreibt diesen Begriff?`, a));
const LONG = 'Langer Text mit vielen Wörtern, damit die Antwort über mehrere Zeilen läuft und auf einem kleinen Handy wirklich Platz braucht; ';
const LONGCARDS = Array.from({ length: 6 }, (_, i) => card(`k${i + 1}`, 'ReWe', (i ? `Kurze Frage ${i}` : LONG.repeat(3).slice(0, 300)), `${i} ${LONG.repeat(2)}`.slice(0, 190)));

async function setFormat(page, value) {
  await page.click('#tab-mehr');
  await page.selectOption('#practice-format', value);
  await page.click('#tab-practice');
  await page.waitForTimeout(300);
}

/** Beantwortet die aktuelle Auswahlfrage richtig oder falsch (Antworttext aus den Daten). */
async function answer(page, cards, correct) {
  const prompt = (await page.textContent('#mc-prompt')).trim();
  const right = cards.find((c) => c.frage === prompt)?.antwort.slice(0, 40);
  const texts = await page.$$eval('#mc-options .mc-text', (n) => n.map((x) => x.textContent));
  const index = texts.findIndex((t) => (t.slice(0, 40) === right) === correct);
  await page.click(`#mc-options .mc-option >> nth=${index}`);
  await page.waitForTimeout(250);
}

const navTop = (page) => page.evaluate(() => document.querySelector('.bottom-nav').getBoundingClientRect().top);

async function weiterOben(page, label) {
  const at = async () => page.evaluate(() => {
    const b = document.getElementById('mc-next');
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { visible: !b.hidden && r.width > 0, right: r.right / innerWidth, top: r.top, hits: hit === b || b.contains(hit) };
  });
  const a = await at();
  await page.evaluate(() => window.scrollTo(0, 1e6));
  await page.waitForTimeout(150);
  const b = await at();
  await page.evaluate(() => window.scrollTo(0, 0));
  const below = await page.evaluate(() => {
    const opts = document.getElementById('mc-options').getBoundingClientRect().bottom;
    return [...document.querySelectorAll('#practice-area button')].filter((n) => /Weiter/.test(n.textContent) && n.getBoundingClientRect().top > opts && n.offsetParent).length;
  });
  check(`Weiter oben rechts ${label}`, a.visible && a.right > 0.6 && a.top < 160 && b.visible && b.right > 0.6 && b.top < 160 && b.hits && below === 0, JSON.stringify({ a, b, below }));
}

for (const viewport of [{ width: 390, height: 844 }, { width: 375, height: 667 }]) {
  const tag = `${viewport.width}×${viewport.height}`;
  app = await startApp({ viewport, seed: seedWith(REWE) });
  try {
    const { page } = app;
    await setFormat(page, 'klassisch');
    const tags = await page.$$eval('#card-tags .tag', (n) => n.map((x) => x.textContent.trim()));
    check(`Kennzeichen ${tag}`, tags.some((t) => /^#\d{4}$/.test(t)) && tags.includes('Neu') && tags.includes('Klassisch') && tags.includes('ReWe'), tags.join(' | '));
    await pick(page, 'rewe');
    const tags2 = await page.$$eval('#card-tags .tag', (n) => n.map((x) => x.textContent.trim()));
    check(`Kein Fach-Kennzeichen bei gewähltem Fach ${tag}`, !tags2.includes('ReWe') && tags2.includes('Klassisch'), tags2.join(' | '));
    check(`Eine Fläche ${tag}`, (await page.locator('#card-back').count()) === 0);
    const layout = await page.evaluate(() => ({ y: scrollY, rate: document.getElementById('rate-buttons').getBoundingClientRect().bottom, card: document.getElementById('flashcard').getBoundingClientRect().height, h: innerHeight }));
    const nt = await navTop(page);
    check(`Klassisch ohne Scrollen ${tag}`, layout.y === 0 && layout.rate <= nt && layout.rate >= nt - 90, JSON.stringify({ ...layout, nt }));
    check(`Karte füllt den Platz ${tag}`, viewport.height === 844 ? layout.card >= 0.45 * layout.h : layout.card >= 220, JSON.stringify(layout));
    await page.click('#flashcard');
    await page.waitForTimeout(300);
    check(`Frage und Antwort zusammen ${tag}`, (await page.isVisible('#card-question')) && (await page.isVisible('#card-answer')));
    check(`Beschriftung ${tag}`, (await page.textContent('#rate-again')).trim() === '👎 Nochmal' && (await page.textContent('#rate-known')).trim() === '👍 Gewusst' && (await page.textContent('#mc-next')).trim() === 'Weiter ›');

    await setFormat(page, 'mc');
    if (viewport.height === 844) {
      const fits = await page.evaluate(() => [...document.querySelectorAll('#mc-options .mc-option')].every((o) => o.getBoundingClientRect().bottom <= document.querySelector('.bottom-nav').getBoundingClientRect().top));
      check('Vor der Antwort passt alles', fits);
    }
    const gap = await page.evaluate(() => document.getElementById('mc-label').getBoundingClientRect().top - document.getElementById('mc-tags').getBoundingClientRect().bottom);
    check(`Kennzeichen überlappen nicht ${tag}`, gap >= 6, String(gap));
    const sizeBefore = await page.$eval('.mc-option', (n) => parseFloat(getComputedStyle(n).fontSize));
    await answer(page, REWE, false);
    const after = await page.evaluate(() => ({ size: parseFloat(getComputedStyle(document.querySelector('.mc-option')).fontSize), shown: [...document.querySelectorAll('.mc-option')].filter((o) => o.offsetParent).length, more: document.getElementById('mc-more').textContent.trim() }));
    check(`Nachlesen größer ${tag}`, after.size > sizeBefore && after.shown === 2 && after.more === '2 weitere Antworten ausgeblendet ▾', JSON.stringify({ sizeBefore, ...after }));
    await weiterOben(page, tag);
    await page.click('#mc-more');
    check(`Aufklappen zeigt alle ${tag}`, (await page.$$eval('.mc-option', (n) => n.filter((o) => o.offsetParent).length)) === 4);
    await page.click('#mc-next');
    await page.waitForTimeout(250);
    await answer(page, REWE, true);
    const right = await page.evaluate(() => ({ shown: [...document.querySelectorAll('.mc-option')].filter((o) => o.offsetParent).length, more: document.getElementById('mc-more').textContent.trim() }));
    check(`Richtig: nur eine sichtbar ${tag}`, right.shown === 1 && right.more === '3 weitere Antworten ausgeblendet ▾', JSON.stringify(right));
    check(`Keine JavaScript-Fehler (Karte) ${tag}`, app.errors.length === 0, app.errors.join('; '));
  } catch (e) {
    check(`Karten-Test ${tag} lief ohne Abbruch`, false, e.message.split('\n')[0]);
  } finally {
    await app.close();
  }
}

// Lange Texte auf kleinem Handy
app = await startApp({ viewport: { width: 375, height: 667 }, seed: seedWith(LONGCARDS) });
try {
  const { page } = app;
  await setFormat(page, 'klassisch');
  const nt = await navTop(page);
  const l = await page.evaluate(() => ({ y: scrollY, rate: document.getElementById('rate-buttons').getBoundingClientRect().bottom, w: document.documentElement.scrollWidth }));
  check('Lange Texte: Klassisch ohne Scrollen', l.y === 0 && l.rate <= nt && l.w <= 375, JSON.stringify({ ...l, nt }));
  await setFormat(page, 'mc');
  await answer(page, LONGCARDS, false);
  await weiterOben(page, 'lange Texte');
  check('Lange Texte: kein seitliches Scrollen', (await page.evaluate(() => document.documentElement.scrollWidth)) <= 375);
} catch (e) {
  check('Lange-Texte-Test lief ohne Abbruch', false, e.message.split('\n')[0]);
} finally {
  await app.close();
}

/* ---------- Task 3: Denkzeit mit Zeitbalken ---------- */
const phase = (page) => page.getAttribute('#flashcard', 'data-phase');
const label = async (page) => (await page.textContent('#think-label')).trim();
const opacity = (page) => page.$eval('#card-answer-wrap', (n) => getComputedStyle(n).opacity);
const barWidth = (page) => page.$eval('#think-bar', (n) => parseFloat(n.style.width));
const MANY = Array.from({ length: 24 }, (_, i) => card(`k${i + 1}`, 'ReWe', `Übungsfrage ${i + 1}`, ANTWORTEN[i % ANTWORTEN.length]));

/** Hält die Uhr an und holt eine frische Karte (Denkzeit beginnt bei voller Dauer). */
async function freshCard(page) {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 50);
  await page.click('#rate-known');
  await page.waitForTimeout(100);
}

app = await startApp({ clock: true, seed: seedWith(MANY) });
try {
  const { page } = app;
  await setFormat(page, 'klassisch');
  await freshCard(page);
  check('Nur Frage zuerst', (await phase(page)) === 'denken' && (await opacity(page)) === '0' && (await label(page)) === '⏱ Denkzeit läuft · noch 5 s', `${await phase(page)} ${await opacity(page)} ${await label(page)}`);
  const centered = await page.evaluate(() => {
    const c = document.getElementById('flashcard').getBoundingClientRect();
    const q = document.getElementById('card-question').getBoundingClientRect();
    return Math.abs((q.top + q.bottom) / 2 - (c.top + c.bottom) / 2) / c.height;
  });
  check('Frage steht mittig', centered < 0.15, centered.toFixed(2));
  const w0 = await barWidth(page);
  await page.clock.runFor(2000);
  check('Balken läuft', (await label(page)) === '⏱ Denkzeit läuft · noch 3 s' && (await barWidth(page)) < w0, `${await label(page)} ${w0} → ${await barWidth(page)}`);
  await page.keyboard.press('t');
  await page.clock.runFor(1000);
  check('Tipp hält die Zeit nicht an', (await page.isVisible('#hint-box')) && (await label(page)) === '⏱ Denkzeit läuft · noch 2 s', await label(page));
  check('Verweise erst mit Antwort', !(await page.isVisible('#card-links')));
  await page.clock.runFor(2000);
  check('Antwort blendet ein', (await phase(page)) === 'einblenden' && (await label(page)) === 'Antwort erscheint …', `${await phase(page)} ${await label(page)}`);
  await page.clock.runFor(2600);
  check('Antwort sichtbar', (await phase(page)) === 'sichtbar' && (await opacity(page)) === '1' && (await label(page)) === '', `${await phase(page)} ${await opacity(page)}`);

  await freshCard(page);
  await page.click('#flashcard');
  check('Antippen zeigt sofort', (await phase(page)) === 'sichtbar' && (await opacity(page)) === '1', `${await phase(page)} ${await opacity(page)}`);

  await freshCard(page);
  const before = (await page.textContent('#session-text')).trim();
  await page.click('#rate-known');
  await page.waitForTimeout(100);
  check('Bewerten ohne Warten', (await page.textContent('#session-text')).trim() !== before && (await phase(page)) === 'denken' && (await label(page)) === '⏱ Denkzeit läuft · noch 5 s', `${before} → ${await page.textContent('#session-text')} ${await label(page)}`);

  await freshCard(page);
  await page.clock.fastForward(9000);
  await page.waitForTimeout(100);
  check('Hintergrund', (await phase(page)) === 'sichtbar', await phase(page));

  await freshCard(page);
  await page.clock.runFor(3000);
  await page.click('#tab-mehr');
  await page.click('#tab-practice');
  await page.waitForTimeout(100);
  check('Reiterwechsel startet nicht neu', (await label(page)) === '⏱ Denkzeit läuft · noch 2 s', await label(page));
  await page.click('#tab-mehr');
  await page.click('#sync-btn');
  await page.clock.runFor(500);
  await page.waitForTimeout(1200);
  await page.click('#tab-practice');
  check('Sync startet nicht neu', ['⏱ Denkzeit läuft · noch 2 s', '⏱ Denkzeit läuft · noch 1 s'].includes(await label(page)), await label(page));

  await freshCard(page);
  await page.keyboard.press(' ');
  check('Leertaste zeigt sofort', (await phase(page)) === 'sichtbar', await phase(page));

  const values = await page.$$eval('#think-seconds option', (n) => n.map((o) => o.value).join(','));
  check('Einstellung: Auswahl', values === '0,3,5,10,20,30' && (await page.inputValue('#think-seconds')) === '5', values);
  await page.click('#tab-mehr');
  await page.selectOption('#think-seconds', '0');
  await page.click('#tab-practice');
  await freshCard(page);
  check('Denkzeit aus', (await phase(page)) === 'verdeckt' && !(await page.isVisible('#think-label')) && !(await page.isVisible('#card-answer')), await phase(page));
  await page.click('#flashcard');
  check('Denkzeit aus: Antippen zeigt', (await phase(page)) === 'sichtbar');
  await page.reload();
  await page.waitForTimeout(2000);
  check('Einstellung bleibt nach Neuladen', (await page.inputValue('#think-seconds')) === '0');
  check('Keine JavaScript-Fehler (Denkzeit)', app.errors.length === 0, app.errors.join('; '));
} catch (e) {
  check('Denkzeit-Test lief ohne Abbruch', false, e.message.split('\n')[0]);
} finally {
  await app.close();
}

app = await startApp({ clock: true, reducedMotion: 'reduce', seed: seedWith(MANY) });
try {
  const { page } = app;
  await setFormat(page, 'klassisch');
  await freshCard(page);
  await page.clock.runFor(5100);
  const anim = await page.$eval('#card-answer-wrap', (n) => getComputedStyle(n).animationName);
  check('Bewegung reduzieren', anim === 'none' && ['einblenden', 'sichtbar'].includes(await phase(page)) && (await opacity(page)) === '1', `${anim} ${await phase(page)} ${await opacity(page)}`);
} catch (e) {
  check('Bewegung-reduzieren-Test lief ohne Abbruch', false, e.message.split('\n')[0]);
} finally {
  await app.close();
}

finish();
