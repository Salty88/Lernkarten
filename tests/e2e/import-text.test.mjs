// Merker aus Text: Textvorlage einfügen, prüfen, importieren
import { startApp, check, finish } from './harness.mjs';

const app = await startApp();
const { page } = app;
try {
  await page.click('#tab-mehr');
  await page.click('#w-import');
  await page.waitForSelector('#import-modal:not([hidden])');
  await page.click('#import-template');
  await page.waitForTimeout(100);
  check('Textvorlage eingefügt', (await page.inputValue('#import-text')).startsWith('Fach: ReWe'));
  check('Text erkannt und geprüft', (await page.textContent('#import-status')).includes('Aus Text erstellt und geprüft'), await page.textContent('#import-status'));
  check('Vorschau zeigt Themen und Begriffe', (await page.textContent('#import-preview')).includes('2 Themen, 3 Begriffe'), await page.textContent('#import-preview'));
  check('Importieren freigegeben', await page.isEnabled('#import-confirm'));

  // Fehler und Hinweise
  await page.fill('#import-text', 'Titel: Ohne Fach\nBegriffe:\n- A: B');
  await page.waitForTimeout(400);
  check('Fehlendes Fach wird gemeldet', (await page.textContent('#import-status')).includes('Fach:') && !(await page.isEnabled('#import-confirm')));
  await page.fill('#import-text', 'Fach: PM\nTitel: Führung\nLose Zeile ohne Feld\n## Stile\nBegriffe:\n- Kooperativ: Mitarbeitende entscheiden mit.');
  await page.waitForTimeout(400);
  check('Nicht zugeordnete Zeile wird genannt', (await page.textContent('#import-status')).includes('Lose Zeile ohne Feld'));
  check('Trotzdem importierbar', await page.isEnabled('#import-confirm'));

  await page.click('#import-confirm');
  await page.waitForSelector('#import-modal', { state: 'hidden' });
  await page.waitForTimeout(300);
  const saved = [...app.repo.files.keys()].filter((p) => p.startsWith('merker/pm-'));
  check('Merker im Daten-Repository gespeichert', saved.length === 1 && JSON.parse(app.repo.text(saved[0])).titel === 'Führung', saved.join(', '));
  check('Merker wird angezeigt', (await page.textContent('#w-content')).includes('Kooperativ'));
  check('Keine JavaScript-Fehler', app.errors.length === 0, app.errors.join('; '));
} catch (e) {
  check('Test lief ohne Abbruch', false, e.message.split('\n')[0]);
} finally {
  await app.close();
}
finish();
