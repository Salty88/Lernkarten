// Start-Hilfen für die Browser-Tests: lokaler Webserver, simuliertes GitHub, Chromium.
//
// Daten: ohne `seed` werden die JSON-Dateien aus DATA_DIR (Klon des privaten
// Daten-Repositorys) gelesen, sonst die erfundenen Beispieldaten aus fixtures/.

import { chromium } from 'playwright-core';
import { spawn } from 'child_process';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRepo } from './fakegh.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '../..');
const CHROMIUM = process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export const DEFAULT_SETTINGS = { user: 'Salty88', repo: 'daten', branch: 'main', path: 'cards.json', token: 'good' };
export const PHONE = { width: 390, height: 844 };

let failed = 0;

/** Ergebnis einer Prüfung ausgeben und merken. */
export function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` | ${detail}` : ''}`);
  if (!ok) failed += 1;
}

/** Zusammenfassung und Exit-Code (1 bei Fehlschlägen). */
export function finish() {
  console.log(failed ? `\n${failed} FEHLGESCHLAGEN` : '\nALLE GRÜN');
  process.exit(failed ? 1 : 0);
}

function readJsonFiles(dir, prefix = '') {
  const result = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    const rel = prefix + entry.name;
    if (entry.isDirectory()) Object.assign(result, readJsonFiles(full, `${rel}/`));
    else if (entry.name.endsWith('.json')) result[rel] = fs.readFileSync(full, 'utf8');
  }
  return result;
}

/** Standarddaten: DATA_DIR oder Beispieldaten. */
export function defaultSeed() {
  if (process.env.DATA_DIR) return readJsonFiles(process.env.DATA_DIR);
  const fx = path.join(here, 'fixtures');
  return {
    'cards.json': fs.readFileSync(path.join(fx, 'cards.json'), 'utf8'),
    'lernstoff.json': fs.readFileSync(path.join(fx, 'lernstoff.json'), 'utf8'),
    'merker/rewe-beispiel.json': fs.readFileSync(path.join(fx, 'merker-beispiel.json'), 'utf8'),
  };
}

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForServer(port) {
  for (let i = 0; i < 50; i++) {
    const ok = await new Promise((resolve) => {
      const socket = net.connect(port, '127.0.0.1', () => {
        socket.end();
        resolve(true);
      });
      socket.on('error', () => resolve(false));
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Webserver startet nicht');
}

/**
 * Startet die App in Chromium.
 * @param {object} [o]
 * @param {object} [o.seed]         Dateien des simulierten Repositorys (Pfad → Text)
 * @param {object} [o.repo]         bereits erzeugtes Repository (für mehrere Geräte)
 * @param {object} [o.viewport]     Standard: Handy 390 × 844
 * @param {'light'|'dark'} [o.colorScheme]
 * @param {object|null} [o.settings] gespeicherte Einstellungen; null = erster Start
 * @param {number} [o.wait]         Wartezeit nach dem Laden in ms
 * @returns {Promise<{page, repo, errors: string[], url: string, close: Function}>}
 */
export async function startApp(o = {}) {
  const repo = o.repo || createRepo(o.seed || defaultSeed());
  const port = await freePort();
  const server = spawn('python3', ['-m', 'http.server', String(port), '-d', appRoot, '--bind', '127.0.0.1'], { stdio: 'ignore' });
  await waitForServer(port);
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  const viewport = o.viewport || PHONE;
  const mobile = viewport.width < 500;
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, colorScheme: o.colorScheme || 'light' });
  const settings = o.settings === undefined ? DEFAULT_SETTINGS : o.settings;
  if (settings) {
    await context.addInitScript((s) => {
      if (!localStorage.getItem('test-init')) {
        localStorage.setItem('lernkartei.settings', JSON.stringify(s));
        localStorage.setItem('test-init', '1');
      }
    }, settings);
  }
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('console', (m) => {
    if (['error', 'warning'].includes(m.type()) && !m.text().includes('Failed to load resource')) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
  await page.route('https://api.github.com/**', repo.handler);
  const url = `http://127.0.0.1:${port}/`;
  await page.goto(url);
  await page.waitForTimeout(o.wait ?? 2500);
  return {
    page,
    repo,
    errors,
    url,
    async close() {
      await browser.close();
      server.kill();
    },
  };
}
