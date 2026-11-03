// Wissen › Skripte: Formular mit Kapiteln, PDF-Text aufräumen, strukturierte Anzeige, Bearbeiten, Löschen
import { startApp, check, finish } from './harness.mjs';

// So kommt Text typischerweise aus einem PDF: harte Umbrüche, Aufzählungszeichen, fehlende Leerzeichen
const PDF = `Wirtschaftspolitik

Geldpolitik
• Steuerung der Geldmenge &
Zinssätze
• Aufgabe der Zentralbank (z.B.EZB)
Beispiel: Zinssenkung zur Ankurbelung von
Investitionen

Sozialpolitik
-Schutz benachteiligter Gruppen
- Beispiel: Einführung von Mindestlöhnen

##Wirtschaftspolitik greift in Märkte ein.`;

const app = await startApp();
const { page } = app;
const skriptFiles = () => [...app.repo.files.keys()].filter((p) => p.startsWith('skripte/'));
const paste = (selector, text) =>
  page.evaluate(
    ([sel, t]) => {
      const area = [...document.querySelectorAll(sel)].pop();
      const dt = new DataTransfer();
      dt.setData('text/plain', t);
      area.focus();
      area.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    },
    [selector, text],
  );

try {
  await page.click('#tab-wissen');
  await page.click('#view-wissen .seg[data-mode="skripte"]');
  check('Bereich „Skripte“ zunächst leer', (await page.textContent('#w-content')).includes('Noch keine Skripte'));

  // Neues Skript im Formular
  await page.click('#w-content >> text=＋ Skript hinzufügen');
  await page.waitForSelector('#skript-modal:not([hidden])');
  check('Formular mit einem leeren Kapitel', (await page.$$('.sk-ed-kapitel')).length === 1);
  await page.click('#skript-save');
  check('Ohne Titel: Hinweis statt Speichern', (await page.textContent('#skript-status')).includes('Titel') && skriptFiles().length === 0);

  await page.fill('#skript-titel', 'Wirtschaftssysteme');
  await page.selectOption('#skript-fach', 'vwl-bwl');
  await paste('.sk-ed-text', PDF);
  await page.waitForTimeout(150);
  const cleaned = await page.inputValue('.sk-ed-text');
  check('Eingefügter PDF-Text aufgeräumt', cleaned.includes('- Steuerung der Geldmenge & Zinssätze') && cleaned.includes('(z. B. EZB)') && cleaned.includes('Beispiel: Zinssenkung zur Ankurbelung von Investitionen'), cleaned);
  check('Zwischenüberschriften erkannt', cleaned.includes('### Geldpolitik') && cleaned.includes('### Sozialpolitik'));
  check('„##Text“ wird Merksatz', cleaned.includes('Merksatz: Wirtschaftspolitik greift in Märkte ein.'));
  check('Erste Zeile wird Kapitel-Titel', (await page.inputValue('.sk-ed-titel')) === 'Wirtschaftspolitik');
  check('Hinweis mit „Original einfügen“', (await page.textContent('#toast')).includes('Original einfügen'));

  // Zweites Kapitel davor schieben
  await page.click('#skript-add-kapitel');
  await page.fill('.sk-ed-kapitel:nth-child(2) .sk-ed-titel', 'Volkswirtschaftslehre');
  await page.fill('.sk-ed-kapitel:nth-child(2) .sk-ed-text', 'Die VWL untersucht die gesamte Wirtschaft.');
  await page.click('.sk-ed-kapitel:nth-child(2) [aria-label="Nach oben"]');
  check('Kapitel verschoben', (await page.inputValue('.sk-ed-kapitel:nth-child(1) .sk-ed-titel')) === 'Volkswirtschaftslehre');

  // Werkzeug: Zeile zur Zwischenüberschrift machen
  await page.click('.sk-ed-kapitel:nth-child(1) .sk-ed-text');
  await page.click('.sk-ed-kapitel:nth-child(1) .sk-ed-tool:has-text("Merksatz")');
  await page.keyboard.type('VWL betrachtet das Ganze.');
  check('Werkzeug „Merksatz“ fügt Zeile ein', (await page.inputValue('.sk-ed-kapitel:nth-child(1) .sk-ed-text')).endsWith('\nMerksatz: VWL betrachtet das Ganze.'));

  await page.click('#skript-save');
  await page.waitForSelector('#skript-modal', { state: 'hidden' });
  await page.waitForTimeout(300);
  const saved = skriptFiles();
  check('Ein Skript gespeichert', saved.length === 1, saved.join(', '));
  const raw = JSON.parse(app.repo.text(saved[0]));
  check('Zwei Kapitel in richtiger Reihenfolge', raw.kapitel.map((k) => k.titel).join(' | ') === 'Volkswirtschaftslehre | Wirtschaftspolitik');

  // Anzeige mit Struktur
  check('Abschnitte als Kästen', (await page.$$('.sk-section')).length === 2);
  check('Beispiele hervorgehoben', (await page.$$('.sk-example')).length === 2);
  check('Merksätze hervorgehoben', (await page.$$('.sk-note')).length === 2);
  check('Merksatz am Kapitelende unter den Kästen', (await page.$$('.sk-tail .sk-note')).length === 1);
  check('Inhaltsverzeichnis', (await page.$$('.skript-toc-item')).length === 2);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  check('Kein seitliches Scrollen', width <= 390, String(width));

  // „＋ Kapitel“ hängt an
  await page.click('.skript-actions >> text=＋ Kapitel');
  await page.waitForSelector('#skript-modal:not([hidden])');
  check('Neues Kapitel angehängt', (await page.$$('.sk-ed-kapitel')).length === 3);
  await page.fill('.sk-ed-kapitel:nth-child(3) .sk-ed-titel', 'Finanzwissenschaften');
  await page.fill('.sk-ed-kapitel:nth-child(3) .sk-ed-text', 'Einnahmen und Ausgaben des Staates.');
  await page.click('#skript-save');
  await page.waitForSelector('#skript-modal', { state: 'hidden' });
  await page.waitForTimeout(300);
  check('Gleiche Datei, drei Kapitel', skriptFiles().length === 1 && JSON.parse(app.repo.text(saved[0])).kapitel.length === 3);

  // Gleicher Titel als neues Skript: Kapitel werden angehängt statt eines zweiten Skripts
  await page.click('text=‹ Alle Skripte');
  await page.click('#w-content >> text=＋ Skript hinzufügen');
  await page.fill('#skript-titel', 'Wirtschaftssysteme');
  await page.selectOption('#skript-fach', 'vwl-bwl');
  await page.fill('.sk-ed-titel', 'Märkte');
  await page.fill('.sk-ed-text', 'Angebot trifft Nachfrage.');
  page.once('dialog', (d) => d.accept());
  await page.click('#skript-save');
  await page.waitForSelector('#skript-modal', { state: 'hidden' });
  await page.waitForTimeout(300);
  const merged = JSON.parse(app.repo.text(saved[0]));
  check('Gleicher Titel: an vorhandenes Skript angehängt', skriptFiles().length === 1 && merged.kapitel.length === 4 && merged.kapitel[3].titel === 'Märkte');

  // Kapitel direkt bearbeiten (Stift)
  await page.click('.skript-kapitel:nth-of-type(2) .skript-kapitel-edit, #skript-vwl-bwl-wirtschaftssysteme-k2 .skript-kapitel-edit');
  await page.waitForSelector('#skript-modal:not([hidden])');
  const focused = await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('sk-ed-text') && document.activeElement.value.includes('Geldpolitik'));
  check('Stift öffnet das Kapitel zum Bearbeiten', focused);

  // Als Text und zurück
  await page.click('#skript-mode .seg[data-mode="text"]');
  const asText = await page.inputValue('#skript-text');
  check('Ansicht „Als Text“', asText.startsWith('Fach: VWL') && asText.includes('## Wirtschaftspolitik') && asText.includes('### Geldpolitik'), asText.slice(0, 80));
  await page.fill('#skript-text', asText.replace('## Märkte', '## Märkte und Preise'));
  await page.click('#skript-mode .seg[data-mode="form"]');
  check('Zurück ins Formular übernimmt Änderungen', (await page.inputValue('.sk-ed-kapitel:nth-child(4) .sk-ed-titel')) === 'Märkte und Preise');
  await page.keyboard.press('Escape');

  // Weiterlesen merkt sich das Kapitel
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(400);
  await page.click('text=‹ Alle Skripte');
  check('Übersicht bietet „Weiterlesen“', (await page.textContent('.skript-card')).includes('Weiterlesen: 4. Märkte'), await page.textContent('.skript-card'));

  // Suche
  await page.fill('#w-search', 'Zentralbank');
  await page.waitForTimeout(400);
  check('Suche findet Text im Skript', (await page.textContent('#w-content')).includes('Wirtschaftspolitik'));
  await page.fill('#w-search', '');
  await page.waitForTimeout(300);

  // Löschen
  await page.click('.skript-card-main');
  page.once('dialog', (d) => d.accept());
  await page.click('.skript-delete');
  await page.waitForTimeout(400);
  check('Gelöscht', skriptFiles().length === 0 && (await page.textContent('#w-content')).includes('Noch keine Skripte'));

  check('Keine JavaScript-Fehler', app.errors.length === 0, app.errors.join('; '));
} catch (e) {
  check('Test lief ohne Abbruch', false, e.message.split('\n')[0]);
} finally {
  await app.close();
}
finish();
