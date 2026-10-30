// Smoke-Test: App lädt mit eingebautem Datensatz ohne Fehler
import { startApp, check, finish } from './harness.mjs';

const app = await startApp();
try {
  await app.page.click('#tab-create');
  check('Karten geladen', (await app.page.textContent('#card-counter')).includes('3'));
  check('Keine JavaScript-Fehler', app.errors.length === 0, app.errors.join('; '));
} finally {
  await app.close();
}
finish();
