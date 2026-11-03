// Wissen › Skripte: anlegen, lesen, verlinken, suchen, bearbeiten, löschen
import { startApp, check, finish } from './harness.mjs';

const TEXT = `Fach: ReWe
Titel: Erfolgsrechnung
Teil: Teil 2

Kurzer Überblick vorweg.

## Aufwand und Ertrag (Folien 3 bis 5)
Der Aufwand mindert den Gewinn.

- erste Aussage
- zweite Aussage
### Merksatz
Nicht jede Auszahlung ist Aufwand.

## Gewinn- und Verlustrechnung
Stellt Aufwand und Ertrag einer Periode gegenüber.`;

const app = await startApp();
const { page } = app;
const skriptFiles = () => [...app.repo.files.keys()].filter((p) => p.startsWith('skripte/'));
try {
  await page.click('#tab-wissen');
  await page.click('#view-wissen .seg[data-mode="skripte"]');
  check('Bereich „Skripte“ vorhanden, zunächst leer', (await page.textContent('#w-content')).includes('Noch keine Skripte'));

  // Anlegen über das Fenster
  await page.click('#w-content >> text=＋ Skript hinzufügen');
  await page.waitForSelector('#skript-modal:not([hidden])');
  check('Leeres Fenster ohne Fehlermeldung', await page.isHidden('#skript-status'));
  await page.fill('#skript-text', 'Titel: Ohne Fach\n## A\nText');
  await page.waitForTimeout(400);
  check('Fehlendes Fach wird gemeldet', (await page.textContent('#skript-status')).includes('Fach:') && !(await page.isEnabled('#skript-save')));
  await page.fill('#skript-text', TEXT);
  await page.waitForTimeout(400);
  check('Vorschau mit Kapiteln', (await page.textContent('#skript-preview')).includes('3 Kapitel'), await page.textContent('#skript-preview'));
  await page.click('#skript-save');
  await page.waitForSelector('#skript-modal', { state: 'hidden' });
  await page.waitForTimeout(300);

  const saved = skriptFiles();
  check('Als Datei im Daten-Repository gespeichert', saved.length === 1, saved.join(', '));
  const raw = JSON.parse(app.repo.text(saved[0]));
  check('Kapitel mit Folien-Angabe', raw.kapitel[1].titel === 'Aufwand und Ertrag' && raw.kapitel[1].folien === 'Folien 3 bis 5', JSON.stringify(raw.kapitel[1]));
  check('Text vor dem ersten Kapitel wird „Überblick“', raw.kapitel[0].titel === 'Überblick');

  // Leseansicht
  check('Leseansicht mit Inhaltsverzeichnis', (await page.$$('.skript-toc-item')).length === 3);
  check('Kapitel werden angezeigt', (await page.$$('.skript-kapitel')).length === 3);
  const strong = await page.$$eval('.skript-kapitel strong', (n) => n.map((x) => x.textContent));
  check('Zwischenüberschrift fett', strong.includes('Merksatz'), strong.join(', '));
  check('Aufzählung als Liste', (await page.$$('.skript-kapitel li')).length === 2);
  check('Bekannte Begriffe verlinkt', (await page.$$('.skript-kapitel .term-link')).length > 0);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  check('Kein seitliches Scrollen', width <= 390, String(width));

  // Zurück zur Liste und Suche
  await page.click('text=‹ Alle Skripte');
  const card = await page.textContent('.skript-card');
  check('Liste zeigt das Skript', card.includes('Erfolgsrechnung') && card.includes('3 Kapitel'), card);
  await page.fill('#w-search', 'Periode gegenüber');
  await page.waitForTimeout(400);
  const results = await page.textContent('#w-content');
  check('Suche findet Text im Skript', results.includes('Skripte') && results.includes('Gewinn- und Verlustrechnung'), results.slice(0, 160));
  await page.click('#w-content .reg-row:has-text("Gewinn- und Verlustrechnung")');
  await page.waitForTimeout(300);
  check('Treffer öffnet das Skript', (await page.$$('.skript-kapitel')).length === 3);

  // Bearbeiten: Text kommt zurück, ID bleibt
  await page.click('.skript-actions >> text=Bearbeiten');
  await page.waitForSelector('#skript-modal:not([hidden])');
  const back = await page.inputValue('#skript-text');
  check('Bearbeiten zeigt den Text', back.includes('## Aufwand und Ertrag (Folien 3 bis 5)') && back.includes('### Merksatz'), back.slice(0, 120));
  await page.fill('#skript-text', back.replace('Titel: Erfolgsrechnung', 'Titel: Erfolgsrechnung kompakt'));
  await page.waitForTimeout(400);
  await page.click('#skript-save');
  await page.waitForSelector('#skript-modal', { state: 'hidden' });
  await page.waitForTimeout(300);
  const after = skriptFiles();
  check('Gleiche Datei aktualisiert', after.length === 1 && after[0] === saved[0] && JSON.parse(app.repo.text(after[0])).titel === 'Erfolgsrechnung kompakt', after.join(', '));

  // Entfernen (mit Rückfrage)
  page.once('dialog', (d) => d.accept());
  await page.click('.skript-actions .btn-ghost-danger');
  await page.waitForTimeout(400);
  check('Entfernt', skriptFiles().length === 0 && (await page.textContent('#w-content')).includes('Noch keine Skripte'));

  check('Keine JavaScript-Fehler', app.errors.length === 0, app.errors.join('; '));
} catch (e) {
  check('Test lief ohne Abbruch', false, e.message.split('\n')[0]);
} finally {
  await app.close();
}
finish();
