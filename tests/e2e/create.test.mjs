// Etappe 3: Erstellen (Register A–Z, Suche, Fach-Knopf, Formular als Blatt) und Wissen (Fach-Knopf, „x % sicher“)
import { startApp, check, finish, defaultSeed } from './harness.mjs';

const seed = defaultSeed();
const extra = [
  ['ReWe', 'Erkläre den Begriff: Aufwand', 'Wertverzehr einer Periode.', 'm:rewe-beispiel|A|b|Aufwand'],
  ['ReWe', 'Erkläre den Begriff: Ertrag', 'Wertzuwachs einer Periode.', 'm:rewe-beispiel|A|b|Ertrag'],
  ['ReWe', 'Erkläre den Begriff: Auszahlung', 'Abfluss liquider Mittel.', 'm:rewe-beispiel|A|b|Auszahlung'],
  ['IKT', 'Wofür steht die Abkürzung ERP?', 'Enterprise Resource Planning.'],
  ['PM', 'Was ist ein Meilenstein? Eine sehr lange Frage, die auf dem Handy nicht seitlich herausragen darf, auch nicht mit einer langen Verknüpfung.', 'Ereignis mit besonderer Bedeutung.'],
];
const cards = [
  ...JSON.parse(seed['cards.json']),
  ...extra.map(([fach, frage, antwort, quelle], i) => ({ id: `x${i}`, nr: 4 + i, fach, frage, antwort, quelle: quelle || null })),
];
seed['cards.json'] = JSON.stringify(cards);
// Zwei von drei Merker-Karten ab Stufe 3: 67 % sicher
seed['lernstand/salty88.json'] = JSON.stringify({
  version: 1,
  karten: { x0: { b: 4, f: '2099-01-01', z: '1' }, x1: { b: 3, f: '2099-01-01', z: '1' }, x2: { b: 1, f: '2099-01-01', z: '1' } },
  tage: {},
});

const app = await startApp({ seed });
const { page } = app;
const questions = () => page.$$eval('#card-list .list-question', (n) => n.map((x) => x.textContent));
try {
  await page.click('#tab-create');
  check('Titel zeigt die Kartenzahl', (await page.textContent('#card-counter')).trim() === '8');
  check('Kein großes Formular über der Liste', await page.isHidden('#card-sheet'));

  const headings = await page.$$eval('#card-list .register-letter', (n) => n.map((x) => x.textContent));
  check('Liste nach Buchstaben gruppiert', headings.join('') === 'ABEILM', headings.join(''));
  const q = await questions();
  check('Vorsatz „Erkläre den Begriff:“ zählt nicht', q[0].endsWith('Aufwand') && q[1].endsWith('Auszahlung'), q.slice(0, 3).join(' | '));
  const letters = await page.$$eval('#create-letters .letter', (n) => n.map((x) => [x.textContent, x.disabled]));
  check('Leiste A–Z: leere Buchstaben ausgegraut', letters.length === 27 && letters.find(([l]) => l === 'C')[1] && !letters.find(([l]) => l === 'E')[1]);

  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  check('Kein seitliches Scrollen', width <= 390, String(width));

  // Suche nach Nummer und Text
  await page.fill('#create-search', '#0007');
  await page.waitForTimeout(250);
  check('Suche nach Nummer', (await questions()).length === 1 && (await questions())[0].includes('ERP'));
  await page.fill('#create-search', 'liquid');
  await page.waitForTimeout(250);
  check('Suche nach Text (auch in der Antwort)', (await questions()).length === 2, (await questions()).join(' | '));
  check('Zähler zeigt Treffer', (await page.textContent('#card-counter')).trim() === '2 von 8');
  await page.fill('#create-search', '');
  await page.waitForTimeout(250);

  // Fach-Knopf
  await page.click('#create-fach-btn');
  await page.waitForSelector('#fach-sheet:not([hidden])');
  await page.click('#fach-sheet-list [data-key="rewe"]');
  check('Fach-Auswahl filtert die Liste', (await questions()).length === 4 && (await page.textContent('#create-fach-label')) === 'ReWe');

  // Neue Karte im Blatt; Fach wird vorgeschlagen
  await page.click('#new-card-btn');
  await page.waitForSelector('#card-sheet:not([hidden])');
  check('Neue Karte: Fach vorausgefüllt', (await page.inputValue('#input-fach')) === 'ReWe');
  await page.fill('#input-frage', 'Was ist Abschreibung?');
  await page.fill('#input-antwort', 'Verteilung des Wertverzehrs auf die Nutzungsjahre.');
  await page.click('#submit-btn');
  await page.waitForTimeout(200);
  check('Karte angelegt, Blatt bleibt für die nächste offen', !(await page.isHidden('#card-sheet')) && (await page.inputValue('#input-frage')) === '');
  await page.keyboard.press('Escape');
  check('Escape schließt das Blatt', await page.isHidden('#card-sheet'));
  check('Neue Karte unter A eingeordnet', (await questions())[0] === 'Was ist Abschreibung?', (await questions())[0]);

  // Bearbeiten öffnet das Blatt, Speichern schließt es
  await page.click('#card-list .list-item:has-text("Bilanz") [data-action="edit"]');
  await page.waitForSelector('#card-sheet:not([hidden])');
  check('Bearbeiten: Titel mit Nummer', (await page.textContent('#form-title')).includes('#0001'));
  await page.fill('#input-frage', 'Was ist eine Bilanz genau?');
  await page.click('#submit-btn');
  await page.waitForTimeout(200);
  check('Speichern schließt das Blatt', await page.isHidden('#card-sheet'));
  check('Geänderter Text in der Liste', (await questions()).includes('Was ist eine Bilanz genau?'));
  await page.click('#card-list .list-item:has-text("Bilanz") [data-action="edit"]');
  await page.keyboard.press('Escape');
  await page.click('#new-card-btn');
  check('Abbrechen per Escape beendet das Bearbeiten', (await page.textContent('#form-title')) === 'Neue Karte');
  await page.keyboard.press('Escape');

  // Wissen: Fach-Knopf und Lernstand der Merker
  await page.click('#tab-wissen');
  await page.waitForTimeout(200);
  check('Wissen: keine Chip-Leiste mehr', (await page.$('#w-chips')) === null);
  check('Merker zeigt „67 % sicher“', (await page.textContent('.merker-sicher')).includes('67 % sicher'));
  check('Fächer ohne Merker in einer Zeile', (await page.$$('.fach-group')).length === 1 && (await page.isVisible('.fach-rest')));
  await page.click('#w-fach-btn');
  await page.waitForSelector('#fach-sheet:not([hidden])');
  await page.click('#fach-sheet-list [data-key="vwl-bwl"]');
  check('Wissen: Fach gewählt', (await page.textContent('#w-fach-label')) === 'VWL/BWL' && (await page.isVisible('.fach-group-empty')));
  await page.click('#w-fach-btn');
  await page.click('#fach-sheet-list [data-key="alle"]');
  await page.click('.merker-card');
  await page.waitForTimeout(200);
  check('Merker mit einem Thema: keine Sprungmarke', (await page.$('.block-jump')) === null && (await page.$('.block-single')) !== null);

  check('Keine JavaScript-Fehler', app.errors.length === 0, app.errors.join('; '));
} catch (e) {
  check('Test lief ohne Abbruch', false, e.message.split('\n')[0]);
} finally {
  await app.close();
}
finish();
