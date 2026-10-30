// Befunde aus der Gesamtprüfung von Etappe 1
import { startApp, check, finish } from './harness.mjs';

// 1. Buchstabenleiste im Register klebt direkt oben (keine Lücke der früheren Kopfzeile)
let app = await startApp();
try {
  await app.page.click('#tab-wissen');
  await app.page.click('.seg[data-mode=register]');
  await app.page.waitForTimeout(300);
  const m = await app.page.evaluate(() => ({
    top: parseFloat(getComputedStyle(document.querySelector('.letter-bar')).top),
    margin: parseFloat(getComputedStyle(document.querySelector('.register-letter')).scrollMarginTop),
  }));
  check('Buchstabenleiste klebt oben (≤ 16px)', m.top <= 16, JSON.stringify(m));
  check('Sprung zum Buchstaben landet unter der Leiste (≤ 80px)', m.margin <= 80, JSON.stringify(m));
  check('Keine JavaScript-Fehler (Register)', app.errors.length === 0, app.errors.join('; '));
} catch (e) {
  check('Register-Test lief ohne Abbruch', false, e.message.split('\n')[0]);
} finally {
  await app.close();
}

// 2. Gewählte Darstellung gilt schon vor dem ersten Zeichnen (kein Aufblitzen)
app = await startApp({ colorScheme: 'light' });
try {
  await app.page.evaluate(() => localStorage.setItem('lernkartei.darstellung', 'dark'));
  await app.page.addInitScript(() => {
    new MutationObserver((_, obs) => {
      if (document.body) {
        window.__themeAtBody = document.documentElement.dataset.theme || 'keins';
        obs.disconnect();
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await app.page.reload();
  await app.page.waitForTimeout(500);
  const early = await app.page.evaluate(() => window.__themeAtBody);
  check('Dunkel ist gesetzt, bevor die Seite gezeichnet wird', early === 'dark', early);
  check('Keine JavaScript-Fehler (Darstellung)', app.errors.length === 0, app.errors.join('; '));
} catch (e) {
  check('Darstellungs-Test lief ohne Abbruch', false, e.message.split('\n')[0]);
} finally {
  await app.close();
}
finish();
