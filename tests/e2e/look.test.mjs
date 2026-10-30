// Neuer Look: jeder Reiter hell und dunkel; Fotos in tests/e2e/out/
import fs from 'fs';
import { startApp, check, finish } from './harness.mjs';

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
finish();
