# Etappe 2: Üben – Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Reiter „Üben“ bekommt Kopf, Karte und 👍/👎-Rückmeldung aus den Entwürfen 1 bis 5 sowie Denkzeit mit Zeitbalken, größeres Nachlesen bei Multiple Choice und „Weiter“ oben rechts (Entwürfe A bis D).

**Architecture:** Neues Modul `js/fach-sheet.js` (Fach-Liste als Blatt von unten, wiederverwendbar für Etappe 3) und `js/think-timer.js` (Denkzeit nach Uhrzeit, nicht nach Takten). `js/practice.js` behält Warteschlange, Formate und Bewertung und ändert Darstellung und Bedienung. Die klassische Karte wird zu einer Fläche ohne Drehung; Layout über CSS (Flex-Spalte, `position: sticky` oben für Kopf und „Weiter“, unten für die Bewertungsknöpfe).

**Tech Stack:** HTML, CSS, JavaScript-Module ohne Build und ohne Fremdpakete; Browser-Tests mit `playwright-core` 1.64 (`npm run test:e2e`), Zeit über `page.clock`.

**Spec:** `docs/superpowers/specs/2026-10-30-design-refresh-design.md` (Abschnitt „Etappe 2 – Üben“) und `docs/superpowers/specs/2026-10-31-ueben-denkzeit-nachlesen-design.md` (geht bei Widerspruch vor). Vorlagen: Entwürfe 1 bis 5 (30.10.) und A bis D (31.10.).

## Global Constraints

- Keine Änderung an Datenformaten, Sync-Logik, Leitner-Regeln (`record()` in `js/progress.js` bleibt unverändert), Übungsformen oder Verknüpfungslogik. Die Denkzeit wird nirgends gespeichert oder bewertet; kein automatisches „falsch“.
- Reiter „Lücken“ bleibt unverändert.
- Kein inline-JS, keine inline-Styles in `index.html`; keine Fremdpakete, kein Build.
- Safari (iPhone/iPad/Mac) und Chrome (Android/Mac); sichere Bereiche beachten (`env(safe-area-inset-*)`, `--nav-h`).
- Tastenkürzel: Klassisch Leertaste/Enter = Antwort sofort zeigen, 1 = Nochmal, 2 = Gewusst, T = Tipp; Auswahl 1 bis 4 = Antwort, Enter = Weiter; Esc schließt das Blatt.
- Fach-Wahl in „Üben“ bleibt in `lernkartei.ueben` (`pr.fach`) gemerkt und gilt nur für diesen Reiter.
- Bewerten springt sofort zur nächsten Karte; wer die Antwort kennt, muss nie warten (Antippen zeigt sofort, Bewerten jederzeit).
- Texte ohne Gedankenstriche (Em-Dash); Beschriftungen exakt wie unten angegeben.

## Review Focus

1. Denkzeit, während das Handy gesperrt, die App im Hintergrund oder ein anderer Reiter offen ist: die Zeit läuft nach Uhr weiter, beim Zurückkommen beginnt sie nicht neu, die Antwort ist sichtbar, wenn die Zeit vorbei ist.
2. Sehr lange Frage, Antwort oder Auswahltexte (bis 190 Zeichen je Option) auf kleinem Handy (375 × 667): „Weiter“ oben rechts bleibt beim Scrollen erreichbar, „Nochmal“/„Gewusst“ unten; nur Inhalt scrollt, nichts ragt seitlich heraus.
3. Daten ändern sich während Denkzeit, Blatt oder Erklärung (Sync, anderes Gerät): Denkzeit startet nicht neu, sichtbare Antwort verschwindet nicht, Zahlen im Blatt stimmen, ein verschwundenes Zusatzfach fällt auf „Alle Fächer“ zurück.
4. Blatt schließen über Esc, Hintergrund und Auswahl: Fokus zurück auf den Fach-Knopf; solange es offen ist, wirken keine Übungs-Tastenkürzel.
5. Dunkelmodus und „Bewegung reduzieren“: Rückmeldung, Blatt und Zeitbalken lesbar (Kontrast ≥ 4.5), Animationen entfallen, Denkzeit bleibt.

---

## Dateien

- Create: `js/fach-sheet.js`, `js/think-timer.js`, `tests/e2e/practice.test.mjs`
- Modify: `index.html` (Üben-Bereich, Blatt `#fach-sheet`, Zeile „Denkzeit“ unter „Mehr“)
- Modify: `js/practice.js`, `js/app.js` (`initFachSheet()`), `css/style.css`
- Modify: `tests/e2e/harness.mjs` (Optionen `clock`, `reducedMotion`), `tests/e2e/look.test.mjs`
- Außerhalb des Repos: ältere Sitzungstests im Scratchpad nutzen `#practice-fach .chip` und das Umdrehen; sie werden auf Blatt und Einblenden umgestellt (nur Tests).

---

### Task 1: Fach-Blatt und Kopf

**Files:** Create `js/fach-sheet.js`, `tests/e2e/practice.test.mjs`; Modify `index.html`, `js/practice.js` (`renderFachChips`, `renderSessionBar`, `updateDueBadge`, `handlePracticeKey`, `initPractice`), `js/app.js`, `css/style.css`, `tests/e2e/harness.mjs`

**Interfaces:**
- Produces (auch für Etappe 3):
  - `initFachSheet(): void` (einmal in `init()` von `app.js`)
  - `openFachSheet({ title: string, getOptions: () => FachOption[], current: string, onPick: (key: string) => void }): void`
  - `refreshFachSheet(): void` zeichnet neu, wenn offen, sonst nichts
  - `FachOption = { key: string, kurz: string, name: string, count: number, empty: boolean }`
  - `fachIcon(key: string): string` mit `{ __all__: '🌐', 'vwl-bwl': '📈', rewe: '🧾', 'fi-inv': '💶', mpa: '🏭', org: '🧭', pm: '👥', ikt: '💻' }`, sonst `'📁'`
  - `startApp({ clock?: boolean, reducedMotion?: 'reduce' })`: `clock` ruft `page.clock.install()` vor `goto`; `reducedMotion` geht an `newContext`.
- Markup: `#fach-sheet.modal-backdrop > .modal.sheet` mit `.sheet-grip`, `#fach-sheet-title`, `#fach-sheet-list`; Einträge `button.sheet-option[data-key]` mit `.sheet-icon`, `.sheet-name` („ReWe · Rechnungswesen“, für Alle „Alle Fächer gemischt“), `.sheet-count`; aktiv `aria-pressed="true"` + `.is-active`; leer `.is-empty` (ausgegraut, antippbar).
- Kopf `.practice-sticky` (klebt oben, eigener Hintergrund) mit `.practice-head`: `button#practice-fach-btn.fach-btn[aria-haspopup="dialog"]` (`.fach-dot`, `#practice-fach-label`, `.fach-caret` „▼“) und `#practice-mode` („Heute“ + `#due-count`, „Frei“; `data-mode` unverändert); darunter `#session-bar` mit `#session-fill`, `#session-text` = `12 / 31 · ✓ 9 · ✗ 3` und Platz rechts für `#mc-next` (Task 2).
- `#practice-fach` (Chip-Leiste) und `.practice-top` entfallen.

- [ ] **Step 1: Failing test** `tests/e2e/practice.test.mjs` (Handy, Beispieldaten):
  - `Kopf in einer Zeile`: Oberkanten von `#practice-fach-btn` und `#practice-mode` gleich (±4 px); `#practice-fach` existiert nicht.
  - `Knopf zeigt Fach`: `#practice-fach-label` = „Alle Fächer“, nach Wahl von ReWe = „ReWe“.
  - `Blatt öffnet`: Titel „Fach wählen · heute fällig“, im Modus Frei „Fach wählen · Karten“.
  - `Alle Fächer + 7 Fächer`: 8 `.sheet-option`; MPA, OrgUF, PM, IKT mit `.is-empty`.
  - `Zahl je Fach`: `.sheet-count` von ReWe = `#due-count` nach Wahl von ReWe.
  - `Auswahl schließt und filtert`: Blatt zu, `#practice-progress` beginnt mit „ReWe“, Fokus auf `#practice-fach-btn`.
  - `Wahl bleibt nach Neuladen`.
  - `Esc schließt`, `Hintergrund schließt`; bei offenem Blatt ändert Taste „2“ `#session-text` nicht.
  - `Leeres Fach`: MPA → `#practice-empty` sichtbar, `#practice-fach-btn` sichtbar und antippbar.
  - `Fortschritt kompakt`: `#session-text` passt auf `/^\d+ \/ \d+ · ✓ \d+ · ✗ \d+$/`.
  - `Zusatzfach verschwindet`: Seed mit Karte `fach: "Latein"`; Latein wählen, Karte im simulierten Repository entfernen, „Mehr“ → `#sync-btn`; zurück in Üben ist das Label „Alle Fächer“.
- [ ] **Step 2: Run** `node tests/e2e/practice.test.mjs` · Expected: FAIL („Kopf in einer Zeile“).
- [ ] **Step 3: Implement** `js/fach-sheet.js` (mit `openModal`, `closeModal`, `closeOnBackdropClick`, `el`, `button` aus `js/ui.js`), Markup, `initFachSheet()` in `app.js`, Harness-Optionen. In `practice.js` ersetzt `renderFachButton()` `renderFachChips()` (Label setzen, `refreshFachSheet()`); `getOptions` liefert Schlüssel und Zahlen wie bisher die Chips. `handlePracticeKey` liefert `false`, wenn `isAnyModalOpen()`.
- [ ] **Step 4: CSS**: `.practice-sticky` (`position: sticky; top: env(safe-area-inset-top)`, `z-index: 6`, Hintergrund `--bg`), `.fach-btn` (Pille, `--surface`, Schatten), `.sheet` (Griff 40 × 5 px, Trennlinien, Einträge ≥ 56 px, `.is-active` in `--accent`, `.is-empty` `opacity: .45`; auf ≥ 600 px mittig, `max-width: 480px`). Alte Regeln `.practice-top`, `.practice-fach`, Handy-Variante von `#practice-mode` entfernen.
- [ ] **Step 5: Run** `node tests/e2e/practice.test.mjs`, dann `npm run test:e2e` · Expected: ALLE GRÜN.
- [ ] **Step 6: Commit** `feat(üben): Fach-Knopf mit Blatt und kompakter Kopf`

### Task 2: Karte, Multiple Choice zum Nachlesen, Weiter oben rechts

**Files:** Modify `index.html`, `js/practice.js` (`renderCurrent`, `renderClassic`, `renderChoice`, `answerChoice`), `css/style.css`; Test `tests/e2e/practice.test.mjs`

**Interfaces:**
- Consumes: `.practice-sticky`, `#session-bar` (Task 1).
- Klassische Karte als **eine Fläche**: `#flashcard` (`role="button"`, `tabindex="0"`) enthält `#card-tags`, `#card-question`, `#card-answer-wrap` (Beschriftung „Antwort“, darin `#card-answer`); der Kartenfuß `#think` (Task 3) folgt direkt danach außerhalb. `#card-back`, `.flashcard-inner`, `.is-flipped` und die 3D-Drehung entfallen. Bis Task 3 gilt: `#card-answer-wrap` verborgen, Antippen zeigt sie (`data-phase` `verdeckt` → `sichtbar`).
- `renderTags(container: HTMLElement, card, format): void` füllt `#card-tags` bzw. `#mc-tags` mit `span.tag`: Fach (nur bei `pr.fach === ALL`), Nummer (`.tag-nr`), `Stufe N` oder `Neu`, `Klassisch` / `Multiple Choice` / `Begriff erkennen`.
- `#practice-progress` bleibt mit gleichem Text, nur für Screenreader (`visually-hidden`, `aria-live="polite"`).
- `#mc-next` „Weiter ›“ steht in `#session-bar` rechts (klebt mit dem Kopf oben); verborgen bis zur Antwort. Unten gibt es keinen Weiter-Knopf.
- Nach der Antwort: `#mc-area.is-answered` (größere Schrift für Frage, Optionen und `#mc-explain`); Optionen, die weder gewählt noch richtig sind, bekommen `.is-collapsed` (verborgen); `button#mc-more` zeigt `${plural(n, 'weitere Antwort', 'weitere Antworten')} ausgeblendet ▾` und klappt sie auf (danach verborgen).
- Knöpfe: `#rate-again` „👎 Nochmal“, `#rate-known` „👍 Gewusst“, klebend unten über der Navigation.

- [ ] **Step 1: Failing tests**, jeweils bei 390 × 844 und 375 × 667:
  - `Kennzeichen`: `#card-tags .tag` enthält Nummer, „Neu“, „Klassisch“; bei ReWe kein Fach-Kennzeichen, bei „Alle Fächer“ eines.
  - `Eine Fläche`: `#card-back` existiert nicht; nach Antippen sind `#card-question` und `#card-answer` gleichzeitig sichtbar.
  - `Klassisch ohne Scrollen`: `scrollY === 0`, Unterkante `#rate-buttons` ≤ Oberkante `.bottom-nav` und ≥ Oberkante minus 90 px.
  - `Karte füllt den Platz`: Höhe `#flashcard` ≥ 45 % der Fensterhöhe bei 844, ≥ 220 px bei 667.
  - `Weiter oben rechts`: Auswahlfrage falsch beantworten; `#mc-next` sichtbar, rechte Kante > 60 % der Fensterbreite, Oberkante < 160 px; nach `scrollTo(0, 1e6)` gilt beides weiter und `elementFromPoint` in seiner Mitte trifft `#mc-next`; unterhalb von `#mc-options` gibt es keinen Weiter-Knopf.
  - `Nachlesen größer`: Schriftgröße von `.mc-option` nach der Antwort > vorher; bei falscher Antwort genau 2 sichtbare Optionen und `#mc-more` = „2 weitere Antworten ausgeblendet ▾“; bei richtiger 1 sichtbare und „3 weitere Antworten ausgeblendet ▾“; Antippen von `#mc-more` zeigt alle 4.
  - `Vor der Antwort passt alles`: bei 390 × 844 liegen alle 4 Optionen über der Navigation (Beispieldaten).
  - `Lange Texte`: Seed mit Antworten zu 190 Zeichen und Frage zu 300 Zeichen; bei 375 × 667 gelten „Weiter oben rechts“ und „Klassisch ohne Scrollen“, Seitenbreite ≤ 375.
  - `Beschriftung`: „👎 Nochmal“, „👍 Gewusst“, „Weiter ›“.
- [ ] **Step 2: Run** `node tests/e2e/practice.test.mjs` · Expected: FAIL („Kennzeichen“, „Eine Fläche“, „Weiter oben rechts“).
- [ ] **Step 3: Implement** Markup, `renderTags`, Nachlesen-Zustand in `answerChoice`; `renderCurrent` setzt Zustand zurück (`is-answered`, `.is-collapsed`, `#mc-more` verborgen). Tipp-Knopf `#hint-btn` bleibt außerhalb der antippbaren Fläche (kein Knopf im Knopf), direkt unter der Karte.
- [ ] **Step 4: CSS**: `#practice-area` als Flex-Spalte; `#flashcard` `flex: 1 1 auto; min-height: 220px`, Inhalt scrollt innen; feste Höhen 340/270/210 px und alle Dreh-Regeln entfallen; `#rate-buttons` `position: sticky; bottom: calc(var(--nav-h) + 10px + env(safe-area-inset-bottom))` mit Verlauf darunter; `#mc-next` kompakte Pille in `#session-bar`; `.is-answered` erhöht Schrift (Frage ca. 1.5rem, Optionen ca. 1.12rem, Nachlesen ca. 1.06rem); `.tag` als Pille (`--surface-2`, `.tag-nr` in `--accent`).
- [ ] **Step 5: Run** `node tests/e2e/practice.test.mjs` und `npm run test:e2e` · Expected: ALLE GRÜN.
- [ ] **Step 6: Commit** `feat(üben): Karte als Fläche, Nachlesen größer, Weiter oben rechts`

### Task 3: Denkzeit mit Zeitbalken

**Files:** Create `js/think-timer.js`; Modify `index.html` (`#think` in der Karte, Zeile „Denkzeit“ unter „Mehr“), `js/practice.js` (`renderClassic`, `flipCard` wird `revealAnswer`, `refreshPractice`, `handlePracticeKey`, `loadPrefs`/`savePrefs`), `css/style.css`; Test `tests/e2e/practice.test.mjs`

**Interfaces:**
- `js/think-timer.js`:
  - `THINK_CHOICES = [0, 3, 5, 10, 20, 30]`, `THINK_DEFAULT = 5`, `FADE_MS = 2500`
  - `startThinkTimer({ startedAt: number, seconds: number, onTick: (remaining: number) => void, onDone: () => void }): { stop(): void }`: Restzeit aus `Date.now() - startedAt` (nicht aus gezählten Takten), Takt 250 ms, zusätzlich Prüfung bei `visibilitychange`; `remaining` = ganze Sekunden aufgerundet; `onDone` genau einmal.
- `pr.thinkSeconds` (Standard 5) in `lernkartei.ueben` gespeichert; `pr.current.thinkStart` wird beim ersten Zeigen der Karte gesetzt und bei Neuzeichnen (Reiterwechsel, Sync) **nicht** zurückgesetzt.
- `#flashcard[data-phase]`: `denken` → `einblenden` (Antwort von Deckkraft 0 auf 1 über `FADE_MS`) → `sichtbar`; bei Denkzeit 0: `verdeckt` → (Antippen) `sichtbar`. Antippen, Leertaste oder Enter in `denken`/`einblenden`/`verdeckt` → sofort `sichtbar` ohne Übergang.
- `#think` steht direkt unter `#flashcard`, außerhalb der antippbaren Fläche (kein Knopf im Knopf), optisch als Fuß der Karte (wie Entwurf A). Er enthält `#think-bar` (Balken, Breite = Restanteil) und `#think-label`: in `denken` „⏱ Denkzeit läuft · noch N s“, in `einblenden` „Antwort erscheint …“, in `sichtbar` leer; rechts daneben `#hint-btn` „💡 Tipp“ (Tipp hält die Zeit nicht an). Bei Denkzeit 0 sind Balken und Label verborgen, der Tipp bleibt.
- `#card-links` (Verweise) erst in Phase `sichtbar`.
- „Mehr“: Zeile „Denkzeit“ mit `select#think-seconds`, Optionen `aus`, `3 s`, `5 s`, `10 s`, `20 s`, `30 s` (Werte `0,3,5,10,20,30`); Änderung gilt ab der nächsten Karte.

- [ ] **Step 1: Failing tests** (`startApp({ clock: true })`, Übungsform Klassisch):
  - `Nur Frage zuerst`: `data-phase` = `denken`, `#card-answer-wrap` Deckkraft 0, `#think-label` = „⏱ Denkzeit läuft · noch 5 s“.
  - `Balken läuft`: nach `page.clock.runFor(2000)` Label „… noch 3 s“, Balkenbreite kleiner als vorher.
  - `Antwort blendet ein`: nach weiteren 3000 ms `data-phase` = `einblenden`; nach weiteren 2500 ms `sichtbar` und Deckkraft 1; `#card-links` erst jetzt sichtbar (sofern Verweise vorhanden).
  - `Antippen zeigt sofort`: in `denken` auf `#flashcard` tippen → `sichtbar`, Deckkraft 1.
  - `Bewerten ohne Warten`: in `denken` „👍 Gewusst“ → nächste Karte, neue Karte wieder in `denken` mit „noch 5 s“.
  - `Hintergrund` (Review Focus 1): `page.clock.fastForward(9000)` → `sichtbar`.
  - `Reiterwechsel startet nicht neu` (Review Focus 3): `runFor(3000)`, „Mehr“, zurück zu „Üben“ → Label „… noch 2 s“; ebenso nach `#sync-btn`.
  - `Einstellung`: `#think-seconds` hat Werte `0,3,5,10,20,30`, Standard `5`; auf `0` → nächste Karte `data-phase` = `verdeckt`, `#think` verborgen, Antwort erst nach Antippen; Wert bleibt nach Neuladen.
  - `Tastatur`: Leertaste in `denken` → `sichtbar`; „2“ bewertet; „T“ öffnet Tipp ohne die Zeit anzuhalten.
  - `Bewegung reduzieren`: `startApp({ clock: true, reducedMotion: 'reduce' })` → Übergangsdauer von `#card-answer-wrap` `0s`, Denkzeit läuft trotzdem.
- [ ] **Step 2: Run** · Expected: FAIL („Nur Frage zuerst“).
- [ ] **Step 3: Implement** `js/think-timer.js` und Phasen in `practice.js`; `stop()` beim Kartenwechsel und beim Verlassen der Sitzung.
- [ ] **Step 4: CSS**: `#card-answer-wrap` `transition: opacity var(--fade-ms, 2500ms) ease-in`; `[data-phase="denken"] #card-answer-wrap { opacity: 0 }`; `#think-bar` mit Akzentverlauf, Hintergrund `--surface-2`; in `prefers-reduced-motion: reduce` keine Übergänge.
- [ ] **Step 5: Run** `npm run test:e2e` · Expected: ALLE GRÜN.
- [ ] **Step 6: Commit** `feat(üben): Denkzeit mit Zeitbalken, Antwort blendet ein`

### Task 4: Rückmeldung 👍 / 👎

**Files:** Modify `index.html` (`#mc-feedback` direkt nach `.mc-question`, vor `#mc-options`; `#practice-flash`), `js/practice.js` (`answerChoice`, `grade`, `rateClassic`), `css/style.css`; Test `tests/e2e/practice.test.mjs`, `tests/e2e/look.test.mjs`

**Interfaces:**
- `grade(card, correct, { advance })` liefert `{ before, after }` (`before` aus `getEntry(card.id)` vor `record()`, kann `undefined` sein).
- `feedbackSub(before, after, correct): string`: richtig + Stufe gestiegen `Weiter in Stufe ${after.b} · wieder fällig ${when(after.f)}`; richtig + gleich `Bleibt in Stufe ${after.b} · wieder fällig ${when(after.f)}`; falsch `Richtige Antwort grün markiert · kommt ${when(after.f)} wieder`; `when(day)`: `heute` / `morgen` / `in N Tagen`.
- `#mc-feedback.feedback[data-result]` mit `.feedback-emoji` („👍“/„👎“), `.feedback-title` („Richtig!“/„Leider falsch“), `.feedback-sub`.
- `#practice-flash` (`aria-hidden="true"`, `pointer-events: none`): nach „Gewusst“/„Nochmal“ 👍 bzw. 👎 groß über der Karte für 700 ms (`is-on`, Animation `feedback-pop`); nächste Karte erscheint sofort.

- [ ] **Step 1: Failing tests**:
  - `Richtig mit 👍`: richtige Option wählen → „👍“, „Richtig!“, Sub beginnt mit „Weiter in Stufe 1“.
  - `Falsch mit 👎`: „👎“, „Leider falsch“, Sub = „Richtige Antwort grün markiert · kommt morgen wieder“.
  - `Direkt unter der Frage`: Oberkante `#mc-feedback` ≥ Unterkante `.mc-question` und < Oberkante `#mc-options`.
  - `Klassisch zeigt Emoji ohne zu warten`: „Gewusst“ → `#practice-flash` hat `is-on` und „👍“, `#practice-progress` zeigt sofort die nächste Karte; nach 900 ms ist `is-on` weg.
  - `Bewegung reduzieren`: Animation von `#mc-feedback` = `none`, Rückmeldung sichtbar.
  - `Tastatur Auswahl`: 1 bis 4 beantwortet, Enter geht weiter.
  - `look.test.mjs` je Schema: Fotos `{scheme}-practice-richtig.png`, `-falsch.png`, `-denkzeit.png`, `-antwort.png`, `{scheme}-fach-blatt.png`; Kontrast ≥ 4.5 für `.feedback-title` auf der Rückmeldung, `.sheet-name` auf `.sheet` und `#think-label` auf der Karte.
- [ ] **Step 2: Run** · Expected: FAIL („Richtig mit 👍“).
- [ ] **Step 3: Implement**; `refreshPractice` lässt eine beantwortete Auswahlfrage samt Rückmeldung stehen.
- [ ] **Step 4: CSS**: `.feedback` mit `--success-soft`/`--danger-soft` (als Tokens für Hell und Dunkel ergänzen, falls nicht vorhanden), Emoji 2.4rem; `@keyframes feedback-pop` (0.6 → 1.1 → 1, 300 ms); bei reduzierter Bewegung keine Animation.
- [ ] **Step 5: Run** `npm run test:e2e` · Expected: ALLE GRÜN.
- [ ] **Step 6: Commit** `feat(üben): Rückmeldung mit 👍 und 👎`

### Task 5: Freies Üben, Gesamtprüfung, Auslieferung

**Files:** Modify `index.html` (`#free-toolbar` unter dem Kopf), `css/style.css`; Test `tests/e2e/practice.test.mjs`

- [ ] **Step 1: Failing tests**: `Thema-Filter erreichbar` (Frei → `#free-toolbar` sichtbar, nicht verdeckt; Heute → verborgen); `Frei ohne Scrollen` (im Modus Frei gelten „Klassisch ohne Scrollen“ und Kartenhöhe ≥ 40 % bei 844).
- [ ] **Step 2: Run** · Expected: FAIL bei „Frei ohne Scrollen“, falls die Leiste zu hoch ist; sonst als Regressionstest übernehmen und im Ledger vermerken.
- [ ] **Step 3: Implement** Werkzeugleiste in einer Zeile (Auswahl `flex: 1`, „🔀 Mischen“ klein).
- [ ] **Step 4: Run** `npm run test:e2e` und die älteren Sitzungstests (umgestellt auf Blatt und Einblenden) · Expected: ALLE GRÜN, keine JavaScript-Fehler.
- [ ] **Step 5: Gesamtprüfung** durch einen frischen Prüfer (stärkstes Modell) mit Plan, beiden Specs und Review Focus; Wichtiges mit Test (erst rot, dann grün) beheben.
- [ ] **Step 6: Commit, Pull Request, Merge**; Fotos (Hell/Dunkel: Denkzeit, Antwort, Richtig, Falsch, Fach-Blatt) an den Nutzer zur Prüfung am echten Handy.
