/**
 * github-sync.js
 *
 * Kapselt alles, was mit Persistenz zu tun hat:
 *  - GitHub REST API (Karten laden und speichern)
 *  - UTF-8-sichere Base64-Kodierung
 *  - Einstellungen im localStorage
 *  - lokaler Zwischenspeicher für Offline-Anzeige und noch nicht gespeicherte Änderungen
 *
 * app.js greift ausschließlich über die hier exportierten Funktionen auf diese Logik zu.
 */

const API_BASE = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const SETTINGS_KEY = 'lernkartei.settings';
const CACHE_KEY = 'lernkartei.cache';

export const DEFAULT_SETTINGS = Object.freeze({
  user: '',
  repo: '',
  branch: 'main',
  path: 'cards.json',
  token: '',
});

/**
 * Fehler mit maschinenlesbarem Code, damit die UI gezielt reagieren kann.
 * Codes: network | auth | notfound | conflict | invalid | ratelimit | http
 */
export class SyncError extends Error {
  constructor(code, message, status = null) {
    super(message);
    this.name = 'SyncError';
    this.code = code;
    this.status = status;
  }
}

/* ------------------------------------------------------------------ */
/* localStorage-Hilfen (robust gegen Private Mode / volle Speicher)    */
/* ------------------------------------------------------------------ */

function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function removeKey(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* nichts zu tun */
  }
}

/* ------------------------------------------------------------------ */
/* Einstellungen                                                       */
/* ------------------------------------------------------------------ */

/** Bereinigt Eingaben (Leerzeichen, führende Slashes, Defaults). */
export function normalizeSettings(settings) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  return {
    user: String(s.user).trim(),
    repo: String(s.repo).trim(),
    branch: String(s.branch).trim() || DEFAULT_SETTINGS.branch,
    path: String(s.path).trim().replace(/^\/+/, '') || DEFAULT_SETTINGS.path,
    token: String(s.token).trim(),
  };
}

export function loadSettings() {
  const stored = readJson(SETTINGS_KEY);
  return normalizeSettings(stored && typeof stored === 'object' ? stored : {});
}

/** Speichert die Einstellungen lokal auf diesem Gerät. Wirft bei Fehler. */
export function saveSettings(settings) {
  const clean = normalizeSettings(settings);
  if (!writeJson(SETTINGS_KEY, clean)) {
    throw new Error('Einstellungen konnten nicht lokal gespeichert werden (Browser-Speicher blockiert?).');
  }
  return clean;
}

export function clearSettings() {
  removeKey(SETTINGS_KEY);
  removeKey(CACHE_KEY);
}

export function hasValidSettings(settings) {
  return Boolean(settings && settings.user && settings.repo && settings.branch && settings.path && settings.token);
}

/** Eindeutige Kennung des Datenziels, damit Caches verschiedener Repos nie vermischt werden. */
export function settingsTarget(settings) {
  return `${settings.user}/${settings.repo}@${settings.branch}:${settings.path}`.toLowerCase();
}

/* ------------------------------------------------------------------ */
/* Lokaler Zwischenspeicher                                            */
/* ------------------------------------------------------------------ */

/**
 * Liefert den zuletzt bekannten Stand für dieses Datenziel oder null.
 * Struktur: { target, cards, sha, pending: [[id, rev], ...], rev }
 */
export function loadCache(target) {
  const cache = readJson(CACHE_KEY);
  if (!cache || cache.target !== target || !Array.isArray(cache.cards)) return null;
  return cache;
}

export function saveCache(target, data) {
  return writeJson(CACHE_KEY, { ...data, target });
}

/* ------------------------------------------------------------------ */
/* Base64 mit UTF-8 (Umlaute, ß, Emoji bleiben erhalten)               */
/* ------------------------------------------------------------------ */

export function encodeBase64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function decodeBase64Utf8(base64) {
  // GitHub liefert Base64 mit Zeilenumbrüchen
  const binary = atob(String(base64).replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/* ------------------------------------------------------------------ */
/* HTTP-Grundlagen                                                     */
/* ------------------------------------------------------------------ */

function buildHeaders(token, withBody = false) {
  const headers = {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': API_VERSION,
  };
  if (withBody) headers['Content-Type'] = 'application/json';
  return headers;
}

function repoUrl(settings) {
  return `${API_BASE}/repos/${encodeURIComponent(settings.user)}/${encodeURIComponent(settings.repo)}`;
}

function contentsUrl(settings) {
  const path = settings.path.split('/').map(encodeURIComponent).join('/');
  return `${repoUrl(settings)}/contents/${path}`;
}

/** fetch ohne Browser-Cache; Netzwerkfehler werden in SyncError übersetzt. */
async function request(url, options = {}) {
  try {
    return await fetch(url, { cache: 'no-store', ...options });
  } catch {
    throw new SyncError('network', 'Keine Verbindung zu GitHub. Bitte Internetverbindung prüfen.');
  }
}

async function readErrorMessage(response) {
  try {
    const data = await response.json();
    return data && data.message ? String(data.message) : '';
  } catch {
    return '';
  }
}

/** Übersetzt eine fehlgeschlagene Antwort in einen verständlichen SyncError. */
async function errorFromResponse(response) {
  const { status } = response;
  const detail = await readErrorMessage(response);

  if (status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
    return new SyncError('ratelimit', 'GitHub-Anfragelimit erreicht. Bitte später erneut versuchen.', status);
  }
  if (status === 401 || status === 403) {
    return new SyncError('auth', 'Zugriff verweigert, Token prüfen.', status);
  }
  if (status === 404) {
    return new SyncError('notfound', 'Nicht gefunden. Benutzername, Repository und Branch prüfen.', status);
  }
  if (status === 409) {
    return new SyncError('conflict', 'Die Datei wurde zwischenzeitlich auf einem anderen Gerät geändert.', status);
  }
  const suffix = detail ? ` (${detail})` : '';
  return new SyncError('http', `GitHub-Fehler ${status}${suffix}`, status);
}

/* ------------------------------------------------------------------ */
/* Laden                                                               */
/* ------------------------------------------------------------------ */

/**
 * Prüft nach einem 404 auf die Datei, ob wirklich nur die Datei fehlt
 * oder ob Repository bzw. Branch falsch sind (GitHub antwortet in allen Fällen mit 404).
 */
async function ensureRepoAndBranchExist(settings) {
  const headers = buildHeaders(settings.token);

  const repoRes = await request(repoUrl(settings), { headers });
  if (repoRes.status === 404) {
    throw new SyncError(
      'notfound',
      `Repository „${settings.user}/${settings.repo}“ nicht gefunden oder der Token hat keinen Zugriff darauf.`,
      404,
    );
  }
  if (!repoRes.ok) throw await errorFromResponse(repoRes);

  const branchRes = await request(`${repoUrl(settings)}/branches/${encodeURIComponent(settings.branch)}`, { headers });
  if (branchRes.ok) return;
  if (branchRes.status !== 404) throw await errorFromResponse(branchRes);

  // Ein komplett leeres Repository hat noch keinen Branch; der erste Commit legt ihn an.
  const listRes = await request(`${repoUrl(settings)}/branches?per_page=1`, { headers });
  if (listRes.ok) {
    const branches = await listRes.json();
    if (Array.isArray(branches) && branches.length === 0) return;
  }
  throw new SyncError('notfound', `Branch „${settings.branch}“ existiert in diesem Repository nicht.`, 404);
}

/** Lädt Dateien > 1 MB, für die die Contents-API keinen Inhalt mitliefert. */
async function fetchBlobContent(settings, sha) {
  const res = await request(`${repoUrl(settings)}/git/blobs/${sha}`, { headers: buildHeaders(settings.token) });
  if (!res.ok) throw await errorFromResponse(res);
  const blob = await res.json();
  return blob.content || '';
}

function parseCardsJson(text) {
  if (!text.trim()) return [];
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SyncError('invalid', 'Die Datei auf GitHub enthält kein gültiges JSON. Bitte im Repository prüfen.');
  }
  if (!Array.isArray(parsed)) {
    throw new SyncError('invalid', 'Die Datei auf GitHub enthält keine Kartenliste (JSON-Array erwartet).');
  }
  return parsed;
}

/**
 * Lädt die Karten aus dem Repository.
 * @returns {Promise<{cards: Array, sha: string|null}>} sha ist null, wenn die Datei noch nicht existiert.
 */
export async function fetchCards(settings) {
  const url = `${contentsUrl(settings)}?ref=${encodeURIComponent(settings.branch)}`;
  const res = await request(url, { headers: buildHeaders(settings.token) });

  if (res.status === 404) {
    await ensureRepoAndBranchExist(settings);
    return { cards: [], sha: null };
  }
  if (!res.ok) throw await errorFromResponse(res);

  const data = await res.json();
  if (Array.isArray(data) || data.type !== 'file') {
    throw new SyncError('invalid', 'Der Dateipfad zeigt auf einen Ordner, nicht auf eine Datei.');
  }

  const base64 = data.encoding === 'base64' ? data.content : await fetchBlobContent(settings, data.sha);
  return { cards: parseCardsJson(decodeBase64Utf8(base64 || '')), sha: data.sha };
}

/* ------------------------------------------------------------------ */
/* Speichern                                                           */
/* ------------------------------------------------------------------ */

/**
 * Schreibt die komplette Kartenliste als neuen Commit.
 * @param {string|null} sha  SHA der aktuell bekannten Dateiversion (null = Datei neu anlegen)
 * @returns {Promise<string>} SHA der neu geschriebenen Datei
 * @throws {SyncError} code "conflict", wenn ein anderes Gerät zwischenzeitlich gespeichert hat
 */
export async function saveCards(settings, cards, sha, message) {
  const body = {
    message,
    content: encodeBase64Utf8(`${JSON.stringify(cards, null, 2)}\n`),
    branch: settings.branch,
  };
  if (sha) body.sha = sha;

  const res = await request(contentsUrl(settings), {
    method: 'PUT',
    headers: buildHeaders(settings.token, true),
    body: JSON.stringify(body),
  });

  if (res.ok) {
    const data = await res.json();
    return data.content.sha;
  }
  // 422 ohne sha bedeutet: Datei wurde inzwischen von einem anderen Gerät angelegt
  if (res.status === 409 || (res.status === 422 && !sha)) {
    throw new SyncError('conflict', 'Die Datei wurde zwischenzeitlich auf einem anderen Gerät geändert.', res.status);
  }
  throw await errorFromResponse(res);
}
