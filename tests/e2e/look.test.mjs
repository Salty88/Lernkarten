// Neuer Look: jeder Reiter hell und dunkel; Fotos in tests/e2e/out/
import fs from 'fs';
import { startApp, check, finish, defaultSeed } from './harness.mjs';

const OUT = new URL('./out/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const TABS = ['practice', 'create', 'wissen', 'luecken', 'mehr'];

/** Kontrast nach WCAG zwischen zwei CSS-Farben (rgb/rgba). */
function contrast(a, b) {
  const lum = (c) => {
    const [r, g, bl] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

for (const scheme of ['light', 'dark']) {
  const app = await startApp({ colorScheme: scheme });
  const { page } = app;
  try {
    for (const tab of TABS) {
      await page.click(`#tab-${tab}`);
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${OUT}${scheme}-${tab}.png` });
      const m = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        const probe = document.createElement('div');
        probe.style.background = 'var(--surface)';
        probe.style.color = 'var(--muted)';
        document.body.append(probe);
        const r = { text: getComputedStyle(document.body).color, bg: getComputedStyle(document.body).backgroundColor, surface: getComputedStyle(probe).backgroundColor, muted: getComputedStyle(probe).color, width: document.documentElement.scrollWidth };
        probe.remove();
        return r;
      });
      check(`${scheme}/${tab}: kein seitliches Scrollen`, m.width <= 390, String(m.width));
      check(`${scheme}/${tab}: Text auf Fläche ≥ 4.5`, contrast(m.text, m.surface) >= 4.5, contrast(m.text, m.surface).toFixed(2));
      check(`${scheme}/${tab}: Nebentext auf Fläche ≥ 4.5`, contrast(m.muted, m.surface) >= 4.5, contrast(m.muted, m.surface).toFixed(2));
    }
    await page.click('#tab-mehr');
    const cut = await page.evaluate(() => [...document.querySelectorAll('#view-mehr .settings-label')].filter((n) => n.scrollWidth > n.clientWidth + 1).map((n) => n.textContent));
    check(`${scheme}: Beschriftungen in „Mehr“ nicht abgeschnitten`, cut.length === 0, cut.join(', '));
    const overflow = await page.evaluate(() => {
      return [...document.querySelectorAll('#view-mehr .settings-row > *')].filter((n) => n.getBoundingClientRect().right > n.parentElement.getBoundingClientRect().right + 1).map((n) => n.className || n.tagName);
    });
    check(`${scheme}: nichts ragt aus den Zeilen in „Mehr“`, overflow.length === 0, overflow.join(', '));
    await page.click('#tab-practice');
    const dotFilter = await page.evaluate(() => {
      for (let n = document.getElementById('sync-dot'); n; n = n.parentElement) if (getComputedStyle(n).filter !== 'none') return n.className;
      return '';
    });
    check(`${scheme}: Sync-Punkt behält seine Farbe`, dotFilter === '', dotFilter);
    const dot = await page.evaluate(() => {
      const d = document.getElementById('sync-dot');
      return { status: d.dataset.status, visible: getComputedStyle(d).display !== 'none' };
    });
    check(`${scheme}: Sync-Punkt nur mit Zustand sichtbar`, dot.status !== 'idle' || !dot.visible, JSON.stringify(dot));
    const primary = await page.evaluate(() => getComputedStyle(document.querySelector('.btn-primary')).backgroundImage);
    check(`${scheme}: Hauptknopf mit Farbverlauf`, primary.includes('linear-gradient'), primary);
    check(`${scheme}: keine JavaScript-Fehler`, app.errors.length === 0, app.errors.join('; '));
  } catch (e) {
    check(`${scheme}: Test lief ohne Abbruch`, false, e.message.split('\n')[0]);
  } finally {
    await app.close();
  }
}
// Etappe 2: Üben (Denkzeit, Antwort, Richtig, Falsch, Fach-Blatt)
const A = ['Gegenüberstellung von Vermögen und Kapital zum Stichtag.', 'Verteilung des Wertverzehrs auf die Nutzungsjahre.', 'Erlöse abzüglich variabler Kosten je Stück.', 'Menge, ab der beide Alternativen gleich viel kosten.', 'Kosten, die unabhängig von der Ausbringung anfallen.', 'Kosten, die sich mit der Ausbringung verändern.'];
const CARDS = Array.from({ length: 12 }, (_, i) => ({ id: `k${i + 1}`, nr: i + 1, fach: 'ReWe', frage: `Frage ${i + 1}: Was beschreibt diesen Begriff?`, antwort: A[i % A.length] }));
const bg = (page, sel) => page.$eval(sel, (n) => {
  for (let e = n; e; e = e.parentElement) {
    const c = getComputedStyle(e).backgroundColor;
    if (c && !c.startsWith('rgba(0, 0, 0, 0)') && c !== 'transparent') return c;
  }
  return getComputedStyle(document.body).backgroundColor;
});
const fg = (page, sel) => page.$eval(sel, (n) => getComputedStyle(n).color);
for (const scheme of ['light', 'dark']) {
  const app = await startApp({ colorScheme: scheme, seed: { ...defaultSeed(), 'cards.json': JSON.stringify(CARDS) } });
  const { page } = app;
  try {
    await page.click('#tab-mehr');
    await page.selectOption('#practice-format', 'klassisch');
    await page.click('#tab-practice');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}${scheme}-denkzeit.png` });
    check(`${scheme}: Denkzeit-Text lesbar`, contrast(await fg(page, '#think-label'), await bg(page, '#think-label')) >= 4.5, contrast(await fg(page, '#think-label'), await bg(page, '#think-label')).toFixed(2));
    await page.click('#flashcard');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}${scheme}-antwort.png` });
    await page.click('#practice-fach-btn');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}${scheme}-fach-blatt.png` });
    check(`${scheme}: Fach-Blatt lesbar`, contrast(await fg(page, '.sheet-name'), await bg(page, '.sheet-name')) >= 4.5);
    await page.keyboard.press('Escape');
    await page.click('#tab-mehr');
    await page.selectOption('#practice-format', 'mc');
    await page.click('#tab-practice');
    await page.waitForTimeout(300);
    for (const result of ['richtig', 'falsch']) {
      const prompt = (await page.textContent('#mc-prompt')).trim();
      const right = CARDS.find((c) => c.frage === prompt).antwort;
      const texts = await page.$$eval('#mc-options .mc-text', (n) => n.map((x) => x.textContent));
      await page.click(`#mc-options .mc-option >> nth=${texts.findIndex((t) => (t === right) === (result === 'richtig'))}`);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}${scheme}-practice-${result}.png` });
      const c = contrast(await fg(page, '.feedback-title'), await bg(page, '.feedback-title'));
      check(`${scheme}: Rückmeldung „${result}“ lesbar`, c >= 4.5, c.toFixed(2));
      await page.click('#mc-next');
      await page.waitForTimeout(300);
    }
    check(`${scheme}: keine JavaScript-Fehler (Üben)`, app.errors.length === 0, app.errors.join('; '));
  } catch (e) {
    check(`${scheme}: Üben-Fotos ohne Abbruch`, false, e.message.split('\n')[0]);
  } finally {
    await app.close();
  }
}
finish();
