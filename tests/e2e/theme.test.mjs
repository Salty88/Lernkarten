// Darstellung Hell / Dunkel / Automatisch
import { startApp, check, finish } from './harness.mjs';

const LIGHT_BG = 'rgb(245, 246, 251)';
const DARK_BG = 'rgb(13, 15, 23)';
const bg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const setChoice = (page, choice) => page.evaluate(async (c) => (await import('/js/theme.js')).setThemeChoice(c), choice);

let app = await startApp({ colorScheme: 'light' });
try {
  check('Standard ist Auto (helles System → hell)', (await bg(app.page)) === LIGHT_BG, await bg(app.page));
  await app.page.emulateMedia({ colorScheme: 'dark' });
  await app.page.waitForTimeout(200);
  check('Auto reagiert live auf dunkles System', (await bg(app.page)) === DARK_BG, await bg(app.page));
  await app.page.emulateMedia({ colorScheme: 'light' });
  await setChoice(app.page, 'dark');
  await app.page.waitForTimeout(100);
  check('Wahl Dunkel bei hellem System', (await bg(app.page)) === DARK_BG && (await app.page.evaluate(() => document.documentElement.dataset.scheme)) === 'dark', await bg(app.page));
  check('theme-color folgt', (await app.page.getAttribute('meta#theme-color', 'content')) === '#0d0f17');
  await app.page.reload();
  await app.page.waitForTimeout(800);
  check('Wahl bleibt nach Neuladen', (await bg(app.page)) === DARK_BG, await bg(app.page));
  await setChoice(app.page, 'light');
  await app.page.emulateMedia({ colorScheme: 'dark' });
  await app.page.waitForTimeout(100);
  check('Wahl Hell bei dunklem System', (await bg(app.page)) === LIGHT_BG, await bg(app.page));
  check('Keine JavaScript-Fehler', app.errors.length === 0, app.errors.join('; '));
} catch (e) {
  check('Test lief ohne Abbruch', false, e.message.split('\n')[0]);
} finally {
  await app.close();
}
app = await startApp({ colorScheme: 'dark' });
try {
  check('Auto folgt dunklem System beim Start', (await bg(app.page)) === DARK_BG, await bg(app.page));
} finally {
  await app.close();
}
finish();
