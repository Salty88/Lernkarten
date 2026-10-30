# Etappe 2: Üben – Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Reiter „Üben“ bekommt den Kopf, die Karte und die 👍/👎-Rückmeldung aus den Entwürfen 1 bis 5, sodass am Handy ohne Scrollen geübt wird.

**Architecture:** Neues, wiederverwendbares Modul `js/fach-sheet.js` (Fach-Liste als Blatt von unten auf Basis der vorhandenen Dialog-Mechanik aus `js/ui.js`); Etappe 3 nutzt es für Erstellen und Wissen. `js/practice.js` behält seine Logik (Warteschlange, Formate, Bewertung) und ändert nur Darstellung und Bedienung. Layout über CSS (Flex-Spalte, `position: sticky` für den Daumenbereich).

**Tech Stack:** HTML, CSS, JavaScript-Module ohne Build und ohne Fremdpakete; Browser-Tests mit `playwright-core` (`npm run test:e2e`).

**Spec:** `docs/superpowers/specs/2026-10-30-design-refresh-design.md` (Abschnitt „Etappe 2 – Üben“, Ziele 1 bis 3). Vorlage: Entwürfe 1 bis 5 (Frage, Richtig, Falsch, Klassisch, Fach-Auswahl).

## Global Constraints

- Keine Änderung an Datenformaten, Sync-Logik, Leitner-Regeln (`record()` in `js/progress.js` bleibt unverändert), Übungsformen oder Verknüpfungslogik.
- Reiter „Lücken“ bleibt unverändert.
- Kein inline-JS, keine inline-Styles in `index.html`; keine Fremdpakete, kein Build.
- Safari (iPhone/iPad/Mac) und Chrome (Android/Mac); sichere Bereiche beachten (`env(safe-area-inset-bottom)`, `--nav-h`).
- Tastenkürzel bleiben: Leertaste/Enter umdrehen, 1 = Nochmal, 2 = Gewusst, 1 bis 4 Auswahl, T = Tipp, Enter = weiter, Esc schließt das Blatt.
- Die Fach-Wahl in „Üben“ bleibt in `lernkartei.ueben` (`pr.fach`) gemerkt; sie gilt nur für diesen Reiter (Spec-Entscheidung 3).
- Üben darf an keiner Stelle umständlicher werden (Anti-Ziel): Bewerten springt weiterhin sofort zur nächsten Karte, keine zusätzliche Bestätigung.
- Texte ohne Gedankenstriche (Em-Dash); Beschriftungen exakt wie unten angegeben.

## Review Focus

1. Sehr lange Frage, Antwort oder Auswahltexte (bis 190 Zeichen je Option) auf kleinem Handy (375 × 667): „Weiter“, „Nochmal“ und „Gewusst“ bleiben im Daumenbereich erreichbar; nur Inhalt scrollt.
2. Fach ohne Karten aus dem Blatt gewählt: Hinweis erscheint, der Fach-Knopf bleibt sichtbar, man kommt ohne Umweg zurück.
3. Daten ändern sich, während das Blatt offen ist oder nach einer Antwort (Sync, anderes Gerät): Zahlen im Blatt und im Knopf stimmen, ein verschwundenes Zusatzfach fällt auf „Alle Fächer“ zurück, die Erklärung nach einer Auswahlfrage bleibt stehen.
4. Blatt schließen über Esc, Antippen des Hintergrunds und Auswahl: Fokus kehrt zum Fach-Knopf zurück, keine Tastaturkürzel feuern, solange das Blatt offen ist.
5. Dunkelmodus und „Bewegung reduzieren“: Rückmeldung und Blatt lesbar (Kontrast ≥ 4.5), Animationen entfallen ohne Funktionsverlust.

---

## Dateien

- Create: `js/fach-sheet.js` (Blatt „Fach wählen“, wiederverwendbar)
- Create: `tests/e2e/practice.test.mjs`
- Modify: `index.html` (Üben-Bereich, neues Blatt `#fach-sheet`)
- Modify: `js/practice.js` (Kopf, Kennzeichen, Rückmeldung)
- Modify: `js/app.js` (`initFachSheet()` aufrufen)
- Modify: `css/style.css` (Kopf, Blatt, Karte, Daumenbereich, Rückmeldung; alte `.practice-top`/`.practice-fach`-Regeln entfernen)
- Modify: `tests/e2e/look.test.mjs` (Fotos der neuen Zustände, Kontrast der Rückmeldung)
- Außerhalb des Repos: die älteren Sitzungstests im Scratchpad verwenden `#practice-fach .chip`; sie werden auf das Blatt umgestellt (nur Tests).

---

### Task 1: Fach-Blatt und Kopf

**Files:**
- Create: `js/fach-sheet.js`, `tests/e2e/practice.test.mjs`
- Modify: `index.html`, `js/practice.js` (`renderFachChips`, `renderSessionBar`, `updateDueBadge`, `initPractice`), `js/app.js`, `css/style.css`

**Interfaces:**
- Produces (für Etappe 3):
  - `initFachSheet(): void` bindet Hintergrund-Klick des Blatts; einmal in `init()` von `app.js`.
  - `openFachSheet({ title: string, getOptions: () => FachOption[], current: string, onPick: (key: string) => void }): void`
  - `refreshFachSheet(): void` zeichnet die Liste neu, wenn das Blatt offen ist (sonst nichts).
  - `FachOption = { key: string, kurz: string, name: string, count: number, empty: boolean }`
  - `fachIcon(key: string): string` mit `{ __all__: '🌐', 'vwl-bwl': '📈', rewe: '🧾', 'fi-inv': '💶', mpa: '🏭', org: '🧭', pm: '👥', ikt: '💻' }`, sonst `'📁'`.
- Markup: `#fach-sheet.modal-backdrop > .modal.sheet` mit Griff `.sheet-grip`, Titel `#fach-sheet-title`, Liste `#fach-sheet-list`; je Eintrag `button.sheet-option[data-key]` mit `.sheet-icon`, `.sheet-name` („ReWe · Rechnungswesen“; für Alle: „Alle Fächer gemischt“), `.sheet-count`; aktiv: `aria-pressed="true"` und `.is-active`; leer: `.is-empty` (ausgegraut, bleibt antippbar).
- Üben-Kopf `.practice-head`: `button#practice-fach-btn.fach-btn[aria-haspopup="dialog"]` mit `.fach-dot`, `#practice-fach-label` („ReWe“ bzw. „Alle Fächer“) und `.fach-caret` „▼“; daneben `#practice-mode` mit „Heute“ + `#due-count` und „Frei“ (`data-mode` unverändert).
- Fortschritt `#session-bar`: Balken `#session-fill` und `#session-text` = `12 / 31 · ✓ 9 · ✗ 3` (Fach und Modus stehen nicht mehr im Text).
- `#practice-fach` (Chip-Leiste) und `.practice-top` entfallen.

- [ ] **Step 1: Failing test** `tests/e2e/practice.test.mjs` (Handy, Beispieldaten) mit den Prüfungen:
  - `Kopf in einer Zeile`: `#practice-fach-btn` und `#practice-mode` haben dieselbe Oberkante (±4 px), `#practice-fach` existiert nicht.
  - `Knopf zeigt Fach`: Text von `#practice-fach-label` ist „Alle Fächer“; nach Auswahl von ReWe im Blatt „ReWe“.
  - `Blatt öffnet`: Klick auf `#practice-fach-btn` → `#fach-sheet` sichtbar, Titel „Fach wählen · heute fällig“ (im Modus Frei „Fach wählen · Karten“).
  - `Alle Fächer + 7 Fächer`: 8 `.sheet-option`; MPA, OrgUF, PM, IKT haben `.is-empty` (Beispieldaten haben nur ReWe, VWL, FiInv).
  - `Zahl je Fach`: `.sheet-count` von ReWe = `#due-count` nach Wahl von ReWe.
  - `Auswahl schließt und filtert`: nach Tippen auf ReWe ist das Blatt zu, `#practice-progress` beginnt mit „ReWe“, Fokus liegt auf `#practice-fach-btn`.
  - `Wahl bleibt nach Neuladen`: `page.reload()` → Label weiterhin „ReWe“.
  - `Esc schließt`, `Hintergrund schließt`: jeweils Blatt zu; während das Blatt offen ist, ändert Taste „2“ den Text von `#session-text` nicht.
  - `Leeres Fach`: MPA wählen → `#practice-empty` sichtbar und `#practice-fach-btn` sichtbar und antippbar.
  - `Fortschritt kompakt`: `#session-text` passt auf `/^\d+ \/ \d+ · ✓ \d+ · ✗ \d+$/`.
  - `Zusatzfach verschwindet` (Review Focus 3): Seed mit einer Karte `fach: "Latein"`; Latein wählen, dann die Karte über das simulierte Repository entfernen und `#sync-btn` unter „Mehr“ auslösen; zurück in Üben ist das Label „Alle Fächer“.
- [ ] **Step 2: Run** `node tests/e2e/practice.test.mjs` · Expected: FAIL (u. a. „Kopf in einer Zeile“).
- [ ] **Step 3: Implement** `js/fach-sheet.js` (nutzt `openModal`, `closeModal`, `closeOnBackdropClick`, `el`, `button` aus `js/ui.js`; `fachLabel`/`fachName` wie in `practice.js` importiert), Markup in `index.html` (Blatt vor dem Toast), `initFachSheet()` in `app.js`. In `practice.js` ersetzt `renderFachButton()` die Funktion `renderFachChips()` (setzt Label, ruft `refreshFachSheet()`); `getOptions` liefert dieselben Schlüssel und Zahlen wie bisher die Chips (`ALL`, `FAECHER`, sortierte `x:`-Zusatzfächer; `count` je Modus wie bisher). `renderSessionBar()` schreibt den kompakten Text. Tastenkürzel: `handlePracticeKey` liefert `false`, wenn `isAnyModalOpen()`.
- [ ] **Step 4: CSS**: `.practice-head` (Flex, Knopf links, Umschalter rechts, `margin-bottom: 10px`), `.fach-btn` (Pillenform, `--surface`, Schatten wie `.card`), `.sheet` (Griff 40 × 5 px, Liste mit Trennlinien, `.sheet-option` mindestens 56 px hoch, `.is-active` in `--accent`, `.is-empty` mit `opacity: .45`), Blatt auf allen Breiten unten (auf ≥ 600 px mittig mit `max-width: 480px`). Alte Regeln für `.practice-top`, `.practice-fach` und die Handy-Variante von `#practice-mode` entfernen.
- [ ] **Step 5: Run** `node tests/e2e/practice.test.mjs` · Expected: ALLE GRÜN. Dann `npm run test:e2e` · Expected: ALLE GRÜN (Navigationstest liest `#practice-progress`, das bleibt erhalten).
- [ ] **Step 6: Commit** `feat(üben): Fach-Knopf mit Blatt und kompakter Kopf`

### Task 2: Karte mit Kennzeichen und Daumenbereich

**Files:**
- Modify: `index.html` (Kartenflächen, Knöpfe), `js/practice.js` (`renderCurrent`, `renderClassic`, `renderChoice`), `css/style.css`
- Test: `tests/e2e/practice.test.mjs`

**Interfaces:**
- Consumes: `.practice-head`, `#session-bar` aus Task 1.
- Produces: Kennzeichen-Leisten `#card-tags-front`, `#card-tags-back`, `#mc-tags` (ersetzen `#card-fach-front`, `#card-fach-back`, `#mc-fach`); je Kennzeichen `span.tag`, Nummer zusätzlich `.tag-nr`. Funktion `renderTags(container: HTMLElement, card, format): void`.
- Kennzeichen in dieser Reihenfolge: Fach (nur wenn `pr.fach === ALL`, Text `fachLabel`), Nummer (`bridge.formatNr(card.nr)`), `Stufe N` oder `Neu`, Übungsform (`Klassisch` / `Multiple Choice` / `Begriff erkennen`).
- `#practice-progress` bleibt mit unverändertem Text, ist aber nur noch für Screenreader sichtbar (Klasse `visually-hidden`, `aria-live="polite"`).
- Knöpfe: `#rate-again` „👎 Nochmal“, `#rate-known` „👍 Gewusst“, `#mc-next` „Weiter ›“.

- [ ] **Step 1: Failing tests** in `practice.test.mjs`, jeweils für 390 × 844 und 375 × 667, Übungsform über `#practice-format` gesetzt:
  - `Kennzeichen`: `#card-tags-front .tag` enthält Nummer, „Neu“ und „Klassisch“; mit Fach ReWe kein Fach-Kennzeichen, mit „Alle Fächer“ eines.
  - `Klassisch ohne Scrollen`: `scrollY === 0`, Unterkante `#rate-buttons` ≤ Oberkante `.bottom-nav`, Unterkante `#rate-buttons` ≥ Oberkante Nav minus 90 px (Daumenbereich).
  - `Karte füllt den Platz`: Höhe `#card-scene` ≥ 45 % der Fensterhöhe bei 844, ≥ 220 px bei 667.
  - `Weiter im Daumenbereich`: Auswahlfrage beantworten; `#mc-next` sichtbar, Unterkante ≤ Oberkante Nav und ≥ Oberkante Nav minus 90 px, sowohl bei `scrollY 0` als auch nach `scrollTo(0, 1e6)`.
  - `Lange Texte` (Review Focus 1): Seed mit Karten, deren Antworten 190 Zeichen lang sind und deren Frage 300 Zeichen hat; bei 375 × 667 gelten „Weiter im Daumenbereich“ und „Klassisch ohne Scrollen“ ebenfalls, kein seitliches Scrollen.
  - `Beschriftung`: `#rate-again` = „👎 Nochmal“, `#rate-known` = „👍 Gewusst“.
- [ ] **Step 2: Run** `node tests/e2e/practice.test.mjs` · Expected: FAIL bei „Kennzeichen“ und „Karte füllt den Platz“.
- [ ] **Step 3: Implement** Markup und `renderTags`; `renderCurrent` füllt die drei Leisten. Der Tipp-Knopf bleibt außerhalb der Karte (Grund: kein Knopf in der antippbaren Karte, die selbst ein Knopf ist), steht aber in einer Zeile direkt unter der Karte.
- [ ] **Step 4: CSS**: `#practice-area` als Flex-Spalte mit `min-height: calc(100dvh - var(--nav-h) - env(safe-area-inset-bottom) - <Kopfhöhe>)`; `#card-scene` `flex: 1 1 auto; min-height: 220px; height: auto` (feste Höhen 340/270/210 px entfallen), Kartenflächen scrollen innen; `#rate-buttons` und `#mc-next` `position: sticky; bottom: calc(var(--nav-h) + 10px + env(safe-area-inset-bottom)); z-index: 5` mit Hintergrund-Verlauf darunter, damit Text nicht durchscheint; `.tag` als kleine Pille (`--surface-2`, `.tag-nr` in `--accent`).
- [ ] **Step 5: Run** `node tests/e2e/practice.test.mjs` und `npm run test:e2e` · Expected: ALLE GRÜN.
- [ ] **Step 6: Commit** `feat(üben): Kennzeichen auf der Karte, Bedienung im Daumenbereich`

### Task 3: Rückmeldung 👍 / 👎

**Files:**
- Modify: `index.html` (`#mc-feedback` direkt nach `.mc-question`, vor `#mc-options`; neues `#practice-flash`), `js/practice.js` (`answerChoice`, `grade`, `rateClassic`), `css/style.css`
- Test: `tests/e2e/practice.test.mjs`, `tests/e2e/look.test.mjs`

**Interfaces:**
- `grade(card, correct, { advance })` liefert `{ before, after }` (Einträge vor und nach `record()`; `before` aus `getEntry(card.id)` vor dem Aufruf, kann `undefined` sein).
- `feedbackSub(before, after, correct): string`:
  - richtig, Stufe gestiegen: `Weiter in Stufe ${after.b} · wieder fällig ${when(after.f)}`
  - richtig, Stufe gleich: `Bleibt in Stufe ${after.b} · wieder fällig ${when(after.f)}`
  - falsch: `Richtige Antwort grün markiert · kommt ${when(after.f)} wieder`
  - `when(day)`: `heute` / `morgen` / `in N Tagen` (N = Tage ab `today()`).
- `#mc-feedback.feedback[data-result]` enthält `.feedback-emoji` („👍“ / „👎“), `.feedback-title` („Richtig!“ / „Leider falsch“), `.feedback-sub`.
- `#practice-flash` (`aria-hidden="true"`, `pointer-events: none`): nach „Gewusst“/„Nochmal“ erscheint 👍 bzw. 👎 groß über der Karte für 700 ms (Klasse `is-on`, Animation `feedback-pop`); die nächste Karte erscheint sofort (kein Warten).

- [ ] **Step 1: Failing tests**:
  - `Richtig mit 👍`: Auswahlfrage richtig beantworten (richtige Option über den Text der Antwort aus den Beispieldaten finden) → `.feedback-emoji` = „👍“, Titel „Richtig!“, Sub beginnt mit „Weiter in Stufe 1“ (neue Karte).
  - `Falsch mit 👎`: falsch beantworten → „👎“, „Leider falsch“, Sub = „Richtige Antwort grün markiert · kommt morgen wieder“.
  - `Direkt unter der Frage`: Oberkante `#mc-feedback` ≥ Unterkante `.mc-question` und < Oberkante `#mc-options`.
  - `Klassisch zeigt Emoji ohne zu warten`: „Gewusst“ antippen → `#practice-flash` hat `is-on` und Text „👍“, und `#practice-progress` zeigt sofort die nächste Karte; nach 900 ms ist `is-on` weg.
  - `Bewegung reduzieren` (Review Focus 5): Kontext mit `reducedMotion: 'reduce'` (in `startApp` als Option `reducedMotion` durchreichen) → `getComputedStyle('#mc-feedback').animationName === 'none'`, Rückmeldung trotzdem sichtbar.
  - `Tastatur`: 1 bis 4 beantwortet, Enter geht weiter, Leertaste dreht um, „2“ bewertet klassisch, „T“ öffnet den Tipp.
  - In `look.test.mjs` je Schema: Fotos `{scheme}-practice-richtig.png`, `{scheme}-practice-falsch.png`, `{scheme}-practice-klassisch.png`, `{scheme}-fach-blatt.png`; Kontrast `.feedback-title` auf Hintergrund der Rückmeldung ≥ 4.5 und `.sheet-name` auf `.sheet` ≥ 4.5.
- [ ] **Step 2: Run** `node tests/e2e/practice.test.mjs` · Expected: FAIL bei „Richtig mit 👍“.
- [ ] **Step 3: Implement** wie in Interfaces; `refreshPractice` lässt eine beantwortete Auswahlfrage samt Rückmeldung stehen (bestehendes Verhalten).
- [ ] **Step 4: CSS**: `.feedback` als Fläche mit `--success-soft`/`--danger-soft` (falls nicht vorhanden: als Token für Hell und Dunkel ergänzen), Emoji 2.4rem; `@keyframes feedback-pop` (Skalierung 0.6 → 1.1 → 1, 300 ms); in `prefers-reduced-motion: reduce` keine Animation.
- [ ] **Step 5: Run** `npm run test:e2e` · Expected: ALLE GRÜN.
- [ ] **Step 6: Commit** `feat(üben): Rückmeldung mit 👍 und 👎`

### Task 4: Freies Üben, Gesamtprüfung, Auslieferung

**Files:**
- Modify: `index.html` (`#free-toolbar` direkt unter dem Fortschritt), `css/style.css`
- Test: `tests/e2e/practice.test.mjs`

- [ ] **Step 1: Failing tests**:
  - `Thema-Filter erreichbar`: Modus „Frei“ → `#free-toolbar` sichtbar und nicht von der Navigation verdeckt; Modus „Heute“ → verborgen.
  - `Frei ohne Scrollen`: im Modus „Frei“ gelten „Klassisch ohne Scrollen“ und „Karte füllt den Platz“ (≥ 40 % bei 844).
- [ ] **Step 2: Run** · Expected: FAIL bei „Frei ohne Scrollen“, falls die Werkzeugleiste zu hoch ist; sonst als Regressionstest übernehmen und im Ledger vermerken.
- [ ] **Step 3: Implement** Werkzeugleiste kompakt in einer Zeile (Auswahl `flex: 1`, „🔀 Mischen“ als kleiner Knopf).
- [ ] **Step 4: Run** `npm run test:e2e` und die älteren Sitzungstests (nach Umstellung von `#practice-fach .chip` auf das Blatt) · Expected: ALLE GRÜN, keine JavaScript-Fehler.
- [ ] **Step 5: Gesamtprüfung** durch einen frischen Prüfer (stärkstes Modell) mit diesem Plan, der Spec und der Review Focus; Befunde nach Wirkung einstufen, Wichtiges mit Test (erst rot, dann grün) beheben.
- [ ] **Step 6: Commit, Pull Request, Merge**; Fotos (Hell/Dunkel: Frage, Richtig, Falsch, Klassisch, Fach-Blatt) an den Nutzer zur Prüfung am echten Handy.
