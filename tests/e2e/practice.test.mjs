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

finish();
