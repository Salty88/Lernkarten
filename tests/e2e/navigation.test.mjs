// Untere Navigation und Seite „Mehr“ (Handy 390 × 844)
import { startApp, check, finish } from './harness.mjs';

const TABS = ['practice', 'create', 'wissen', 'luecken', 'mehr'];

let app = await startApp();
const { page, repo } = app;
try {
  const labels = (await page.locator('.bottom-nav .tab').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
  check('Fünf Einträge unten', labels.length === 5 && ['Üben', 'Erstellen', 'Wissen', 'Lücken', 'Mehr'].every((l, i) => labels[i].endsWith(l)), labels.join(' | '));
  check('Kopfzeile oben entfällt', (await page.locator('.topbar').count()) === 0);

  await page.click('#tab-mehr');
  check('Mehr öffnet die Seite', await page.isVisible('#view-mehr'));

  const before = repo.log.length;
  let gets = 0;
  page.on('request', (r) => {
    if (r.url().includes('/contents/cards.json') && r.method() === 'GET') gets += 1;
  });
  await page.click('#sync-btn');
  await page.waitForTimeout(1500);
  check('Sync aus Mehr lädt neu', gets > 0, `GET cards.json: ${gets}`);
  check('Sync-Punkt zeigt gespeichert', (await page.getAttribute('#sync-dot', 'data-status')) === 'saved', await page.getAttribute('#sync-dot', 'data-status'));
  check('Sync schreibt nichts', repo.log.length === before);

  // Review Focus 1: Toast über der Navigation
  const toastBox = await page.locator('#toast').boundingBox();
  const navBox = await page.locator('.bottom-nav').boundingBox();
  check('Toast über der Navigation', toastBox && navBox && toastBox.y + toastBox.height <= navBox.y + 1, JSON.stringify({ toast: toastBox, nav: navBox }));

  await page.click('[data-theme-choice="dark"]');
  check('Darstellung aus Mehr', (await page.evaluate(() => document.documentElement.dataset.scheme)) === 'dark');
  check('Aktive Darstellung markiert', (await page.getAttribute('[data-theme-choice="dark"]', 'aria-pressed')) === 'true');
  await page.click('[data-theme-choice="auto"]');

  await page.selectOption('#practice-format', 'klassisch');
  await page.click('#tab-practice');
  await page.waitForTimeout(300);
  const progress = await page.textContent('#practice-progress');
  check('Übungsform aus Mehr wirkt', progress.trim().endsWith('Klassisch'), progress);

  await page.click('#tab-mehr');
  check('Übungsplan in Mehr', (await page.locator('#view-mehr #plan-new').count()) === 1 && (await page.locator('#view-mehr #plan-max').count()) === 1);
  check('Lernstand-Anzeige in Mehr', (await page.textContent('#mehr-learner')).includes('Salty88'), await page.textContent('#mehr-learner'));

  await page.click('#w-import');
  check('Import aus Mehr', await page.isVisible('#import-modal'));
  await page.click('#import-cancel');

  // Review Focus 3: Dialog über der Navigation
  await page.click('#open-settings');
  const covered = await page.evaluate(() => document.getElementById('settings-modal').contains(document.elementFromPoint(195, 820)));
  check('Dialog liegt über der Navigation', covered);
  await page.click('#close-settings');
  check('Dialog lässt sich schließen', !(await page.isVisible('#settings-modal')));

  // Review Focus 2: sicherer Bereich unten
  const safeArea = await page.evaluate(() => [...document.styleSheets].some((sheet) => {
    try {
      return [...sheet.cssRules].some((r) => r.selectorText === '.bottom-nav' && r.cssText.includes('safe-area-inset-bottom'));
    } catch {
      return false;
    }
  }));
  check('Navigation beachtet den sicheren Bereich', safeArea);

  for (const tab of TABS) {
    await page.click(`#tab-${tab}`);
    await page.waitForTimeout(200);
    await page.evaluate(() => window.scrollTo(0, 1e6));
    await page.waitForTimeout(100);
    const ok = await page.evaluate(() => {
      const nav = document.querySelector('.bottom-nav').getBoundingClientRect();
      const view = document.querySelector('.view:not([hidden])');
      // Inhalt zugeklappter <details> ist unsichtbar und zählt nicht
      const hiddenInDetails = (n) => n.closest('details:not([open])') && !n.closest('summary');
      const items = [...view.querySelectorAll('*')].filter((n) => n.offsetParent !== null && n.getBoundingClientRect().height > 0 && !hiddenInDetails(n));
      const lowest = Math.max(...items.map((n) => n.getBoundingClientRect().bottom));
      return { lowest, navTop: nav.top, width: document.documentElement.scrollWidth };
    });
    check(`Inhalt nicht verdeckt: ${tab}`, ok.lowest <= ok.navTop + 1, JSON.stringify(ok));
    check(`Kein seitliches Scrollen: ${tab}`, ok.width <= 390, String(ok.width));
  }
  await page.click('#tab-mehr');
  await page.click('#plan-settings > summary');
  await page.evaluate(() => window.scrollTo(0, 1e6));
  await page.waitForTimeout(150);
  const planField = await page.evaluate(() => ({ field: document.getElementById('plan-max').getBoundingClientRect().bottom, navTop: document.querySelector('.bottom-nav').getBoundingClientRect().top }));
  check('Aufgeklappter Übungsplan nicht verdeckt', planField.field <= planField.navTop, JSON.stringify(planField));
  check('Keine JavaScript-Fehler', app.errors.length === 0, app.errors.join('; '));
} catch (e) {
  check('Test lief ohne Abbruch', false, e.message.split('\n')[0]);
} finally {
  await app.close();
}

// Review Focus 5: erster Start ohne Zugangsdaten
app = await startApp({ settings: null, wait: 1500 });
try {
  check('Erster Start öffnet die Einstellungen', await app.page.isVisible('#settings-modal'));
  await app.page.click('#close-settings');
  await app.page.click('#tab-mehr');
  check('Mehr ist beim ersten Start erreichbar', await app.page.isVisible('#view-mehr'));
  check('Keine JavaScript-Fehler beim ersten Start', app.errors.length === 0, app.errors.join('; '));
} catch (e) {
  check('Erster Start lief ohne Abbruch', false, e.message.split('\n')[0]);
} finally {
  await app.close();
}
finish();
