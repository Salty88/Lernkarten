# Etappe 1 – Grundgerüst: Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Neue Optik für alle Reiter, umschaltbares Hell/Dunkel/Auto, Navigation am unteren Rand und eine Seite „Mehr“ mit Sync, Darstellung, Übungsform, Übungsplan, Import, Lernstand-Anzeige und GitHub-Einstellungen.

**Architecture:** Bestehende Bedienelemente werden mit **unveränderten IDs** an ihren neuen Ort verschoben (z. B. `#sync-btn`, `#open-settings`, `#practice-format`, `#plan-new`, `#plan-max`, `#plan-learner`, `#w-import` nach „Mehr“), damit vorhandene Logik in `app.js`, `practice.js`, `wissen.js` weiterläuft. Dunkelmodus wird von `@media (prefers-color-scheme)` auf Token-Blöcke umgestellt, die über `html[data-theme]` geschaltet werden; ein neues Modul `js/theme.js` verwaltet die Wahl.

**Tech Stack:** HTML, CSS (Custom Properties), Vanilla-JS-Module; Tests mit `playwright-core` (nur Entwicklung) gegen ein simuliertes GitHub.

**Spec:** `docs/superpowers/specs/2026-10-30-design-refresh-design.md`

## Global Constraints

- Kein Build-Schritt, keine Laufzeit-Abhängigkeiten; `index.html` ohne Inline-Styles und ohne Inline-JavaScript.
- Datenformate, Sync-Logik, Leitner-Regeln, Übungsformen, Verknüpfungen bleiben unverändert.
- Reiter „Lücken“: nur Optik, keine Funktionsänderung.
- Safari (iPhone/iPad/Mac) und Chrome (Android/Mac); sichere Bereiche über `env(safe-area-inset-bottom)`.
- Handy (390 × 844) ist der Maßstab.
- Darstellung „Automatisch“ ist Standard; Wahl pro Gerät gemerkt.
- Testsammlung muss am Ende grün sein.

## Review Focus

1. **Meldungen (Toast) über der unteren Navigation** – ein Hinweis darf nie hinter der Leiste verschwinden.
2. **iPhone-Home-Leiste** – die Navigation darf nicht unter der Home-Leiste liegen (sicherer Bereich unten).
3. **Dialoge über der Navigation** – Einstellungen, Import, Begriff-Fenster und Editor liegen vollständig über der Leiste und sind schließbar.
4. **„Automatisch“ reagiert live** – stellt das Handy während der Nutzung auf Dunkel um, wechselt die App ohne Neuladen.
5. **Erster Start ohne Zugangsdaten** – der Einstellungen-Dialog öffnet sich weiterhin automatisch; „Mehr“ ist erreichbar.

Jede Zeile hat unten einen Test in der zuständigen Aufgabe.

---

## Dateistruktur

| Datei | Verantwortung |
|---|---|
| `js/theme.js` (neu) | Darstellung wählen, anwenden, merken; live auf System reagieren; `theme-color` setzen |
| `css/style.css` | Neue Token (Farben, Rundungen, Schatten); Dunkel-Token als zwei Blöcke; Komponenten-Feinschliff; untere Navigation; Seite „Mehr“ |
| `index.html` | Kopfzeile entfällt; `<nav class="bottom-nav">` mit fünf `.tab`; `<section id="view-mehr">`; verschobene Bedienelemente |
| `js/app.js` | `views.mehr`; Sync-Status zusätzlich als Punkt `#sync-dot` und Zeitangabe; Darstellung initialisieren |
| `js/wissen.js` | `#w-sync` entfällt (Zugriffe absichern bzw. entfernen) |
| `tests/e2e/` (neu) | Test-Grundlage im Repository: simuliertes GitHub, Start-Hilfen, Tests dieser Etappe |
| `package.json` (neu) | nur `devDependencies: { "playwright-core": "^1.56.0" }`, `"private": true`, Skript `test:e2e` |

---

### Task 1: Test-Grundlage im Repository

**Files:**
- Create: `tests/e2e/fakegh.mjs` (Inhalt aus der bisherigen Sitzungsdatei: simuliertes Repository, Tokens `token good` → `Salty88`, `token other` → `Kollege`, `/user`, Contents GET/PUT/DELETE, Ordnerlisten)
- Create: `tests/e2e/harness.mjs`
- Create: `tests/e2e/smoke.test.mjs`
- Create: `package.json`, `tests/README.md`

**Interfaces:**
- Produces: `startApp({ seed, viewport, colorScheme, settings }) → { page, repo, errors, close }` in `harness.mjs`. `seed` ist ein Objekt Pfad → Text; ohne `seed` liest `harness.mjs` die JSON-Dateien aus `process.env.DATA_DIR` (Klon des Daten-Repositorys), sonst ein kleiner eingebauter Datensatz (3 Karten, 1 Merker aus `tests/e2e/fixtures/`). Startet `python3 -m http.server` auf einem freien Port; Chromium über `process.env.CHROMIUM` oder `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
- Produces: `check(name, ok, detail)` und `finish()` (Exit-Code 1 bei Fehlschlägen).

- [ ] **Step 1: Smoke-Test schreiben** – `smoke.test.mjs`: App lädt mit eingebautem Datensatz; `check('Keine JavaScript-Fehler', errors.length === 0)`; `check('Karten geladen', (await page.textContent('#card-counter')).includes('3'))`.
- [ ] **Step 2: Ausführen, Fehlschlag sehen** – `node tests/e2e/smoke.test.mjs` → FAIL (Module fehlen).
- [ ] **Step 3: `harness.mjs`, `fakegh.mjs`, Fixtures anlegen.** Fixtures enthalten nur erfundene Beispieldaten, keine Inhalte aus dem privaten Daten-Repository.
- [ ] **Step 4: Ausführen** – `node tests/e2e/smoke.test.mjs` → alle PASS, Exit 0.
- [ ] **Step 5: Commit** – `test: Browser-Test-Grundlage ins Repository`

### Task 2: Darstellung Hell/Dunkel/Auto und neue Farbwelt

**Files:**
- Create: `js/theme.js`
- Modify: `css/style.css` (alle fünf `prefers-color-scheme`-Stellen, Token-Block oben)
- Modify: `index.html` (zwei `theme-color`-Meta → eines mit `id="theme-color"`)
- Modify: `js/app.js` (Aufruf `initTheme()` in `init()`)
- Test: `tests/e2e/theme.test.mjs`

**Interfaces:**
- Produces in `theme.js`: `initTheme(): void`, `setThemeChoice(choice: 'auto'|'light'|'dark'): void`, `getThemeChoice(): 'auto'|'light'|'dark'`. Speicher-Schlüssel `lernkartei.darstellung`. `auto` entfernt `data-theme` von `<html>`; `light`/`dark` setzt `data-theme`. Wirkliches Schema steht immer in `html.dataset.scheme = 'light'|'dark'` (für Tests und `theme-color`). Ereignis `theme:changed` auf `document`.
- CSS-Regel: Dunkel-Token stehen genau zweimal: `:root[data-theme="dark"] { … }` und `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }`. Komponentenregeln, die heute in Dunkel-Media-Blöcken stehen (`.btn-known`-Textfarbe, `.mc-option`-Schlüssel, Hover-Helligkeit), werden auf Token umgestellt: `--on-success`, `--on-danger`, `--hover-brightness`.
- Neue Token-Werte (aus den Entwürfen): Hell `--bg:#f5f6fb; --surface:#ffffff; --surface-2:#f0f2f8; --text:#121521; --muted:#6b7084; --accent:#5b5bf0; --accent-2:#8b6cf6; --border:#e6e8f0; --success:#12a150; --danger:#e0384b; --radius:22px; --radius-sm:14px`. Dunkel `--bg:#0d0f17; --surface:#171a26; --surface-2:#1f2333; --text:#eef0f7; --muted:#9096ab; --accent:#8f8cff; --accent-2:#b59bff; --border:#272b3b; --success:#3ddc84; --danger:#ff6b7a`. `theme-color`: Hell `#f5f6fb`, Dunkel `#0d0f17`.

- [ ] **Step 1: Test schreiben** – `theme.test.mjs` mit:
  - `Standard ist Auto` → `getComputedStyle(body).backgroundColor === 'rgb(245, 246, 251)'` bei `colorScheme: 'light'`
  - `Auto folgt dunklem System` → `rgb(13, 15, 23)` bei `colorScheme: 'dark'`
  - `Wahl Dunkel bei hellem System` → nach `setThemeChoice('dark')` (über `page.evaluate` auf `import('/js/theme.js')`) `rgb(13, 15, 23)` und `html.dataset.scheme === 'dark'`
  - `Wahl bleibt nach Neuladen` → nach `reload()` weiterhin `rgb(13, 15, 23)`
  - `theme-color folgt` → `meta#theme-color.content === '#0d0f17'`
  - **Review Focus 4:** `Auto reagiert live` → bei Auto `page.emulateMedia({ colorScheme: 'dark' })` ohne Neuladen → `rgb(13, 15, 23)`
- [ ] **Step 2: Ausführen** → FAIL (`theme.js` fehlt, Farben alt).
- [ ] **Step 3: `theme.js` und CSS-Umstellung umsetzen.** Live-Reaktion über `matchMedia('(prefers-color-scheme: dark)').addEventListener('change', …)`.
- [ ] **Step 4: Ausführen** → alle PASS; zusätzlich `node tests/e2e/smoke.test.mjs` PASS.
- [ ] **Step 5: Commit** – `feat: Darstellung Hell/Dunkel/Auto und neue Farbwelt`

### Task 3: Untere Navigation und Seite „Mehr“

**Files:**
- Modify: `index.html` (Kopfzeile `.topbar` entfernen; `<nav class="bottom-nav" role="tablist">` mit fünf `<button class="tab" id="tab-…" data-tab="…">` für `practice`, `create`, `wissen`, `luecken`, `mehr`, jeweils Symbol + Beschriftung; `<section class="view" id="view-mehr">`)
- Modify: `css/style.css` (Navigation fest unten, `padding-bottom: calc(8px + env(safe-area-inset-bottom))`; `.container` unten so viel Abstand wie Navigation hoch ist; Toast `bottom` über der Navigation; Dialoge `z-index` über der Navigation)
- Modify: `js/app.js` (`views.mehr`; `setSyncStatus` setzt zusätzlich `#sync-dot[data-status]` und `#sync-time` = „zuletzt HH:MM“ bei `saved`)
- Modify: `js/wissen.js` (`#w-sync` und seine Zugriffe entfernen; Sync läuft über `#sync-btn` → `syncFromRemote`, das `syncWissen` bereits aufruft)
- Test: `tests/e2e/navigation.test.mjs`

**Interfaces:**
- Consumes: `setThemeChoice`, `getThemeChoice`, Ereignis `theme:changed` (Task 2).
- Seite „Mehr“ enthält in dieser Reihenfolge, als Zeilen: Synchronisieren (`#sync-btn`, `#sync-status`, `#sync-time`), Darstellung (drei Knöpfe `[data-theme-choice="light|dark|auto"]`, aktiver mit `aria-pressed="true"`), Übungsform (`#practice-format`, verschoben), Übungsplan (`#plan-new`, `#plan-max`, `#plan-learner`, verschoben, Erklärtext bleibt), Merker importieren (`#w-import`, verschoben), Lernstand von (`#mehr-learner`, gleicher Text wie `#plan-learner`), GitHub-Einstellungen (`#open-settings`, verschoben).
- Navigation: Punkt `#sync-dot` am Eintrag „Mehr“ mit `data-status` = Sync-Status (`saved` grün, `saving|loading|dirty` gelb, `error|offline|unconfigured` rot).

- [ ] **Step 1: Test schreiben** – `navigation.test.mjs` (Handy 390 × 844):
  - `Fünf Einträge unten` → `.bottom-nav .tab` Anzahl 5, Beschriftungen „Üben, Erstellen, Wissen, Lücken, Mehr“; `.topbar` existiert nicht
  - `Mehr öffnet die Seite` → Klick `#tab-mehr` → `#view-mehr` sichtbar
  - `Sync aus Mehr lädt neu` → Klick `#sync-btn` → das simulierte GitHub erhält eine neue GET-Anfrage auf `cards.json`; `#sync-dot` danach `data-status="saved"`
  - `Darstellung aus Mehr` → Klick `[data-theme-choice="dark"]` → `html.dataset.scheme === 'dark'`
  - `Übungsform aus Mehr wirkt` → `#practice-format` auf `klassisch`, zurück zu Üben → `#practice-progress` endet auf „Klassisch“
  - `Import aus Mehr` → Klick `#w-import` → `#import-modal` sichtbar
  - **Review Focus 3:** `Dialog über Navigation` → Klick `#open-settings` → `elementFromPoint(195, 820)` liegt innerhalb `#settings-modal`; Schließen per `#close-settings` → Dialog weg
  - **Review Focus 1:** `Toast über Navigation` → Toast auslösen (Sync mit `announce`) → `toast.getBoundingClientRect().bottom <= nav.getBoundingClientRect().top`
  - **Review Focus 2:** `Sicherer Bereich` → die CSS-Regel für `.bottom-nav` enthält `env(safe-area-inset-bottom)` (aus `document.styleSheets` gelesen); zusätzlich manuelle Prüfung am iPhone nach Auslieferung
  - `Inhalt nicht verdeckt` → in jedem Reiter nach `scrollTo(0, 1e6)`: unterstes sichtbares Element von `.view:not([hidden])` endet über der Navigation
  - `Kein seitliches Scrollen` → `document.documentElement.scrollWidth <= 390` in allen fünf Reitern
  - **Review Focus 5:** `Erster Start` → ohne gespeicherte Einstellungen öffnet sich `#settings-modal`; nach Schließen ist `#tab-mehr` klickbar und zeigt `#view-mehr`
  - `Keine JavaScript-Fehler`
- [ ] **Step 2: Ausführen** → FAIL.
- [ ] **Step 3: Markup verschieben, Navigation und „Mehr“ gestalten, `setSyncStatus` erweitern, `#w-sync` entfernen.**
- [ ] **Step 4: Ausführen** → alle PASS; `theme.test.mjs`, `smoke.test.mjs` PASS.
- [ ] **Step 5: Commit** – `feat: Navigation unten und Seite „Mehr“`

### Task 4: Feinschliff aller Reiter im neuen Look

**Files:**
- Modify: `css/style.css` (Karten, Knöpfe, Chips, Segment-Umschalter, Listen, Eingabefelder, Dialoge als Blatt von unten am Handy, Abstände; Vorbild: Entwürfe 1–9 aus dem Chat vom 30.10.2026, Werte über die Token aus Task 2)
- Test: `tests/e2e/look.test.mjs`

**Interfaces:**
- Consumes: Token aus Task 2, Layout aus Task 3.

- [ ] **Step 1: Test schreiben** – `look.test.mjs`: für jeden Reiter in Hell und Dunkel Bildschirmfoto nach `tests/e2e/out/` und Prüfungen: `Kein seitliches Scrollen`, `Kontrast Text/Fläche ≥ 4.5` (berechnet aus `getComputedStyle(body).color` und `--surface`), `Keine JavaScript-Fehler`.
- [ ] **Step 2: Ausführen** → Kontrast-/Layoutprüfungen zeigen den Ausgangsstand (Fotos dienen dem Vorher-Nachher).
- [ ] **Step 3: Feinschliff umsetzen.**
- [ ] **Step 4: Ausführen** → PASS; Fotos ansehen und mit den Entwürfen vergleichen.
- [ ] **Step 5: Commit** – `style: neuer Look für alle Reiter`

### Task 5: Gesamtprüfung und Auslieferung

- [ ] **Step 1:** Alle Tests ausführen: `for f in tests/e2e/*.test.mjs; do node $f || exit 1; done` sowie die bisherigen Sitzungstests mit `DATA_DIR` (Wissen, Lücken, Üben, Personen); veraltete Selektoren (`#w-sync`, Kopfzeile) anpassen.
- [ ] **Step 2:** README: Abschnitt „Bedienung“ (Navigation unten, „Mehr“, Darstellung) und „Tests“ (`npm i && npm run test:e2e`).
- [ ] **Step 3:** Commit, Pull Request, Merge; Fotos (Hell/Dunkel) an den Nutzer zur Prüfung am echten Handy.
