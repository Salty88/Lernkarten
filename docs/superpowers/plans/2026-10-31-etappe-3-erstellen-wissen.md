# Etappe 3: Erstellen und Wissen – Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** „Erstellen“ wird ein Register (Titel mit Kartenzahl, Fach-Knopf, Suche, Buchstabenleiste A–Z, Liste nach Buchstaben, „＋ Neue Karte“ als Blatt) und „Wissen“ bekommt Kopf mit Fach-Knopf, „📈 x % sicher“ je Merker und eine ruhige Ansicht für Merker mit nur einem Thema (Entwürfe 6 bis 8).

**Architecture:** Neues Modul `js/register.js` (reine Funktionen: Sortierbegriff und Buchstabe einer Frage). `js/app.js` baut die Kartenliste als Register und verlegt das bestehende Formular `#card-form` in ein Blatt `#card-sheet` (gleiche Dialog-Mechanik wie Etappe 2). Beide Reiter nutzen `openFachSheet` aus `js/fach-sheet.js` (Etappe 2) und merken ihr Fach getrennt. `js/wissen.js` ersetzt die Fach-Chips durch den Knopf, ergänzt den Anteil „sicher“ aus dem Lernstand (`getEntry` aus `js/progress.js`) und rendert Ein-Thema-Merker ohne Sprungleiste und Blocktitel.

**Tech Stack:** HTML, CSS, JavaScript-Module ohne Build und ohne Fremdpakete; Browser-Tests mit `playwright-core` (`npm run test:e2e`).

**Spec:** `docs/superpowers/specs/2026-10-30-design-refresh-design.md` (Abschnitt „Etappe 3 – Erstellen und Wissen“, Entscheidungen 1, 2, 3, 7). Vorlage: Entwürfe 6 (Erstellen-Register), 7 (Wissen), 8 (Merker mit einem Thema).

## Global Constraints

- Keine Änderung an Datenformaten (`cards.json`, Merker, `lernstoff.json`, `lernstand/<name>.json`), Sync-Logik, Leitner-Regeln oder Verknüpfungslogik.
- Reiter „Lücken“ bleibt unverändert.
- Kein inline-JS, keine inline-Styles in `index.html`; keine Fremdpakete, kein Build.
- Bearbeiten und Löschen wie bisher (Löschen ohne Rückfrage mit „Rückgängig“ im Toast; Bearbeiten einer Wissens-Karte mit geändertem Text setzt „eigene Fassung“).
- Fach-Wahl je Reiter getrennt gemerkt: Erstellen in `lernkartei.erstellen` (`{ fach }`), Wissen weiter in `lernkartei.wissen.prefs`.
- IDs, die Tests und ältere Sitzungstests nutzen, bleiben: `#card-form`, `#input-fach`, `#input-frage`, `#input-antwort`, `#submit-btn`, `#cancel-edit-btn`, `#card-list`, `#card-counter`, `#w-search`, `#w-content`, `#view-wissen .seg`.
- Texte ohne Gedankenstriche (Em-Dash); Beschriftungen exakt wie unten angegeben.

## Review Focus

1. Großer Bestand (1.500 Karten, echte Daten): Register baut sich flüssig auf, Buchstabe antippen springt ohne Ruckeln, Suche reagiert beim Tippen ohne Hänger.
2. Bearbeiten aus einer gefilterten oder durchsuchten Liste: nach dem Speichern bleiben Fach, Suchtext und Position erhalten; die Karte wandert in den richtigen Buchstaben, falls sich der Sortierbegriff geändert hat.
3. Blatt „Neue Karte“ versehentlich geschlossen (Hintergrund, Esc): bereits getippter Text ist beim erneuten Öffnen noch da; „Abbrechen“ verwirft bewusst. Beim Bearbeiten verwirft Schließen die Änderung.
4. Handy-Tastatur offen im Blatt: Speichern-Knopf bleibt erreichbar (Blatt scrollt, nichts unter der Tastatur verloren).
5. „📈 % sicher“ für Merker ohne erzeugte Karten oder für eine andere Person (Name in den Einstellungen): kein irreführender Wert, eigener Lernstand zählt.

---

## Dateien

- Create: `js/register.js`, `tests/e2e/create.test.mjs`, `tests/e2e/wissen.test.mjs`
- Modify: `index.html` (Erstellen-Kopf, Blatt `#card-sheet`, Wissen-Kopf), `js/app.js` (Liste, Formular-Blatt, Fach-Knopf), `js/wissen.js` (Kopf, Merker-Karte, Ein-Thema-Ansicht), `css/style.css`, `tests/e2e/look.test.mjs`
- Außerhalb des Repos: ältere Sitzungstests nutzen `#list-filter`, `#w-chips .chip`, das Formular oben im Reiter; sie werden umgestellt (nur Tests).

---

### Task 1: Register in „Erstellen“

**Files:** Create `js/register.js`, `tests/e2e/create.test.mjs`; Modify `index.html`, `js/app.js` (`renderSubjects`, `renderCardList`, `buildCardListItem`, Bindungen), `css/style.css`

**Interfaces:**
- `js/register.js`:
  - `registerKey(frage: string): string`: entfernt am Anfang (ohne Groß/Klein) „Erkläre den Begriff:“, „Was ist/sind (der|die|das|ein|eine)“, „Wofür steht die Abkürzung“, „Was bedeutet“, „Was versteht man unter“, „Formuliere in Managementsprache:“, „Ordne zu:“, „Was ist die Kernaussage zu“, „Feynman:“; danach führende Anführungszeichen/Klammern (`„"“(`) und Leerzeichen, am Ende `?`, `“`, `"`. Leeres Ergebnis → ursprüngliche Frage.
  - `registerLetter(frage: string): string`: erster Buchstabe von `norm(registerKey(frage))` groß (`norm` aus `js/ui.js`, Ä→A usw.), sonst `'#'`.
  - `LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('')`
- Kopf `#view-create .create-head`: `h2.view-title` „Karten“, darunter `#card-counter` = `${n} Karten · ${m} mit Wissen verknüpft` (bei gewähltem Fach: Zahlen dieses Fachs); rechts `button#create-fach-btn.fach-btn` mit `#create-fach-label` (wie `#practice-fach-btn`). Darunter `input#card-search` (type search, Platzhalter „🔍 Karte suchen (Text oder Nummer)“), dann `nav#create-letters.letter-bar` mit allen 27 Zeichen aus `LETTERS` als `button.letter[data-letter]`; Buchstaben ohne Karten `disabled` (ausgegraut).
- Liste `#card-list`: Gruppen `h3.register-letter#create-reg-X` + Einträge `li.list-item` (Inhalt wie bisher: Nummer, Fach, Status, Frage, Antwort-Vorschau, Verknüpfung, „✎ Bearbeiten“, „🗑 Löschen“). Sortierung innerhalb der Gruppe nach `registerKey` (deutsch, ohne Groß/Klein), dann Nummer. Alle Treffer werden gezeigt (kein „Weitere anzeigen“; `#list-more` entfällt); Einträge mit `content-visibility: auto`.
- Suche: Text (ohne Groß/Klein, `norm`) in Frage, Antwort und Fach; reine Zahl oder `#Zahl` findet die Karte mit dieser Nummer. Verzögerung 150 ms.
- Fach-Knopf öffnet `openFachSheet({ title: 'Fach wählen · Karten', getOptions, current, onPick })`; Optionen: „Alle Fächer gemischt“, 7 Fächer, Zusatzfächer; Zahl = Karten je Fach; Wahl in `lernkartei.erstellen` gespeichert. `#list-filter` entfällt.

- [ ] **Step 1: Failing tests** `tests/e2e/create.test.mjs`:
  - `Sortierbegriff`: per `page.evaluate(import('/js/register.js'))`: `registerKey('Erkläre den Begriff: Bilanz') === 'Bilanz'`, `registerKey('Was ist eine Bilanz?') === 'Bilanz'`, `registerKey('Wofür steht die Abkürzung „BA“?') === 'BA'`, `registerLetter('Erkläre den Begriff: Ökonomisches Prinzip') === 'O'`, `registerLetter('Formuliere in Managementsprache: „Läuft nicht“') === 'L'`, `registerLetter('42 Regeln') === '#'`.
  - `Kopf`: `.view-title` = „Karten“; `#card-counter` = „3 Karten · 0 mit Wissen verknüpft“ (Beispieldaten).
  - `Gruppen`: Seed mit „Erkläre den Begriff: Bilanz“, „Was ist Abschreibung?“, „Erkläre den Begriff: Beleg“ → Überschriften „A“, „B“ in dieser Reihenfolge; unter „B“ zuerst Beleg, dann Bilanz.
  - `Leere Buchstaben ausgegraut`: `#create-letters [data-letter="Z"]` ist `disabled`, `[data-letter="B"]` nicht.
  - `Buchstabe springt`: bei 40 Karten über A bis W Antippen von „W“ → `#create-reg-W` liegt im sichtbaren Bereich unterhalb des Kopfs.
  - `Suche Text`, `Suche Nummer`: „bilanz“ → nur Bilanz; „#0002“ und „2“ → nur Karte Nr. 2; leere Suche → alle.
  - `Fach-Knopf`: Wahl „ReWe“ → nur ReWe-Karten, Zähler mit Zahlen des Fachs, Label „ReWe“; nach Neuladen weiter „ReWe“; „Üben“ behält sein eigenes Fach.
  - `Großer Bestand` (Review Focus 1): Seed mit 1.500 Karten; Zeit von Klick auf `#tab-create` bis Liste sichtbar < 1.500 ms; Tippen von „bil“ in die Suche aktualisiert in < 500 ms.
- [ ] **Step 2: Run** `node tests/e2e/create.test.mjs` · Expected: FAIL („Sortierbegriff“).
- [ ] **Step 3: Implement** `js/register.js`, Markup, Liste und Fach-Knopf in `app.js`.
- [ ] **Step 4: CSS**: `.create-head` (Titel links, Fach-Knopf rechts), `#card-search` volle Breite, `#create-letters` nutzt `.letter-bar` (klebt oben wie im Wissen-Register), `.letter:disabled { opacity: .35 }`, `#card-list .list-item { content-visibility: auto; contain-intrinsic-size: auto 140px; }`.
- [ ] **Step 5: Run** `node tests/e2e/create.test.mjs` und `npm run test:e2e` · Expected: ALLE GRÜN (Smoke-Test liest `#card-counter`, enthält „3“).
- [ ] **Step 6: Commit** `feat(erstellen): Register mit Suche, A–Z und Fach-Knopf`

### Task 2: „＋ Neue Karte“ als Blatt

**Files:** Modify `index.html` (`#card-form` wandert in `#card-sheet`), `js/app.js` (`enterEditMode`, `exitEditMode`, `addCard`, `updateCard`, neue `openCardSheet`), `css/style.css`; Test `tests/e2e/create.test.mjs`

**Interfaces:**
- `#card-sheet.modal-backdrop.sheet-backdrop > .modal.sheet` enthält `#card-form` unverändert (Titel `#form-title`, Felder, `#submit-btn`, `#cancel-edit-btn`).
- `button#new-card-btn.btn.btn-primary.fab` „＋ Neue Karte“: unten rechts über der Navigation (`position: fixed; bottom: calc(var(--nav-h) + 14px + env(safe-area-inset-bottom))`), nur im Reiter Erstellen sichtbar.
- `openCardSheet(): void`: öffnet das Blatt; bei neuer Karte ist `#input-fach` mit dem gewählten Fach vorbelegt (Kürzel, z. B. „ReWe“), sofern ein Fach gewählt und das Feld leer ist.
- Neue Karte: nach „Karte hinzufügen“ bleibt das Blatt offen, Fach bleibt, Frage und Antwort leer, Fokus auf Frage (wie bisher); Toast „Karte #0004 hinzugefügt“.
- Schließen über Hintergrund/Esc: neue Karte behält getippten Text (Entwurf), Bearbeiten verwirft (`exitEditMode`). `#cancel-edit-btn` „Abbrechen“ ist immer sichtbar und verwirft und schließt.
- „✎ Bearbeiten“ in der Liste öffnet das Blatt mit Titel „Karte #0412 bearbeiten“; nach „Änderungen speichern“ schließt das Blatt, Suche, Fach und Scrollposition der Liste bleiben.

- [ ] **Step 1: Failing tests**:
  - `Formular nicht mehr oben`: `#card-form` ist beim Öffnen des Reiters nicht sichtbar; `#new-card-btn` sichtbar, Unterkante ≤ Oberkante `.bottom-nav`.
  - `Neue Karte`: Blatt öffnen, Felder füllen, „Karte hinzufügen“ → Zähler +1, Blatt bleibt offen, Frage leer, Fach unverändert.
  - `Fach vorbelegt`: mit Fach ReWe → `#input-fach` = „ReWe“.
  - `Entwurf bleibt` (Review Focus 3): Frage tippen, Esc, wieder öffnen → Text noch da; „Abbrechen“ → leer und zu.
  - `Bearbeiten im Blatt` (Review Focus 2): Suche „bilanz“, Bearbeiten, Frage ändern zu „Erkläre den Begriff: Zahlungsbilanz“, speichern → Blatt zu, Suchtext noch „bilanz“, Karte jetzt unter „Z“.
  - `Bearbeiten verwerfen`: Bearbeiten öffnen, Text ändern, Esc → Karte unverändert, erneutes „＋ Neue Karte“ zeigt leeres Formular mit Titel „Neue Karte“.
  - `Löschen wie bisher`: „🗑 Löschen“ → Toast mit „Rückgängig“, Rückgängig stellt her.
  - `Tastatur offen` (Review Focus 4, 390 × 500 als Ersatz für offene Tastatur): `#submit-btn` durch Scrollen im Blatt erreichbar (`scrollIntoViewIfNeeded`, dann `elementFromPoint` trifft ihn).
- [ ] **Step 2: Run** · Expected: FAIL („Formular nicht mehr oben“).
- [ ] **Step 3: Implement**; `enterEditMode` öffnet das Blatt statt zum Formular zu scrollen; `exitEditMode` schließt es.
- [ ] **Step 4: CSS**: `.fab` (Pille, Schatten, `z-index: 30`, unter Dialogen), Blatt mit `max-height: 92dvh; overflow-y: auto`.
- [ ] **Step 5: Run** `npm run test:e2e` · Expected: ALLE GRÜN.
- [ ] **Step 6: Commit** `feat(erstellen): Neue Karte und Bearbeiten als Blatt`

### Task 3: Wissen – Kopf, Fach-Knopf, „📈 % sicher“

**Files:** Create `tests/e2e/wissen.test.mjs`; Modify `index.html` (`.wissen-head`), `js/wissen.js` (`renderChips` → `renderFachButton`, `renderMerkerList`, `initWissen`), `css/style.css`

**Interfaces:**
- Kopf: `h2.view-title` „Wissen“ links, `button#wissen-fach-btn.fach-btn` mit `#wissen-fach-label` rechts; darunter `#w-search` (Platzhalter unverändert) und der Umschalter Themen/A–Z/Eigene (`#view-wissen .seg`, unverändert). `#w-chips` entfällt.
- Fach-Knopf: `openFachSheet({ title: 'Fach wählen · Wissen', … })`; Zahl = Begriffe plus eigene Einträge je Fach (wie bisher die Chips); Schlüssel „Alle“ = `'alle'` (bestehendes `ALL` in `wissen.js`).
- `merkerSicher(merkerId: string): number | null` in `wissen.js`: Karten aus `cards()` mit `quelle` beginnend mit `m:${merkerId}|`; `null`, wenn keine; sonst `Math.round(100 * anteil)` mit `anteil` = Karten mit `getEntry(id)?.b >= 3` geteilt durch Anzahl.
- Merker-Karte `.merker-card`: Titel, Teil, darunter `.merker-card-chips` mit `span.mchip.mchip-accent` „N Themen“, `span.mchip` „N Begriffe“, `span.mchip` „📈 N % sicher“ (fehlt, wenn `merkerSicher` `null` ist).
- Hinweis unter der Liste: „Import und Sync findest du unter „Mehr“.“ (`p.muted.small.wissen-hint`).
- Der Lernstand ändert sich → Wissen zeigt die neuen Prozente beim nächsten Zeichnen (Aufruf `renderWissen()` aus `refreshAfterDataChange`, falls Reiter Wissen sichtbar).

- [ ] **Step 1: Failing tests** `tests/e2e/wissen.test.mjs` (Beispiel-Merker aus den Fixtures):
  - `Kopf`: `.view-title` „Wissen“, `#wissen-fach-btn` sichtbar, `#w-chips` existiert nicht.
  - `Fach-Knopf`: Wahl eines Fachs filtert die Merker-Liste; Label zeigt das Fach; Erstellen und Üben behalten ihr eigenes Fach.
  - `Chips am Merker`: „N Themen“ und „N Begriffe“ entsprechen `merkerStats`.
  - `Sicher-Anteil`: Seed mit 4 Karten zum Beispiel-Merker und Lernstand `lernstand/salty88.json`, in dem 1 Karte Stufe 3 hat → „📈 25 % sicher“.
  - `Ohne Karten kein Wert` (Review Focus 5): Merker ohne verknüpfte Karten → kein „📈“.
  - `Andere Person`: Einstellung Name „Andy“ (eigener, leerer Lernstand) → „📈 0 % sicher“.
  - `Hinweis`: Text „Import und Sync findest du unter „Mehr“.“ sichtbar.
- [ ] **Step 2: Run** · Expected: FAIL („Kopf“).
- [ ] **Step 3: Implement**; Fach-Wechsel schließt einen offenen Merker eines anderen Fachs (bestehendes Verhalten der Chips übernehmen).
- [ ] **Step 4: CSS**: `.view-title` (gemeinsam für Erstellen und Wissen, 1.9rem, 800), `.mchip` Pillen (`--surface-2`, `.mchip-accent` in `--accent` auf hellem Akzentgrund).
- [ ] **Step 5: Run** `npm run test:e2e` · Expected: ALLE GRÜN.
- [ ] **Step 6: Commit** `feat(wissen): Kopf mit Fach-Knopf und Anteil sicher`

### Task 4: Merker mit nur einem Thema

**Files:** Modify `js/wissen.js` (`renderMerkerView`, `renderBlock`), `css/style.css`; Test `tests/e2e/wissen.test.mjs`

**Interfaces:**
- Gilt, wenn `merker.bloecke.length === 1`: keine Sprungleiste `.block-jump`; der Block wird ohne `<details>`/`<summary>` gezeigt (kein Blocktitel, keine Kennung „A“), die Kernaussage steht als hervorgehobener Kasten `.block-teaser.block-teaser-solo` direkt unter dem Merker-Kopf; die Bezüge (Praxisbezug, Glossar, …) folgen direkt in der gewohnten Reihenfolge und Öffnung.
- Merker mit 2 und mehr Blöcken: unverändert.
- `openMerker(id, blockId)` für einen Ein-Thema-Merker scrollt zum Inhalt statt zu einem Block-Element.

- [ ] **Step 1: Failing tests**:
  - `Ein Thema ohne Sprungmarke`: Seed-Merker mit einem Block → `.block-jump` fehlt, kein `.block-summary`, `.merker-title` genau einmal, Glossar sichtbar.
  - `Mehrere Themen unverändert`: Beispiel-Merker mit mehreren Blöcken → `.block-jump` mit je einem Chip pro Block.
  - `Sprung aus der Suche`: Begriff aus dem Ein-Thema-Merker suchen und öffnen → „Im Wissen ansehen“ führt in den Merker ohne Fehler.
- [ ] **Step 2: Run** · Expected: FAIL („Ein Thema ohne Sprungmarke“).
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** `npm run test:e2e` · Expected: ALLE GRÜN.
- [ ] **Step 5: Commit** `feat(wissen): Merker mit einem Thema ohne doppelten Titel`

### Task 5: Fotos, Gesamtprüfung, Auslieferung

**Files:** Modify `tests/e2e/look.test.mjs`

- [ ] **Step 1: Tests**: je Schema Fotos `{scheme}-erstellen.png`, `{scheme}-neue-karte.png`, `{scheme}-wissen.png`, `{scheme}-merker-ein-thema.png`; Kontrast ≥ 4.5 für `.mchip`, `.letter` (aktiv) und `#card-counter`; kein seitliches Scrollen bei 390 und 375.
- [ ] **Step 2: Run** `npm run test:e2e` und die älteren Sitzungstests (umgestellt auf Fach-Knopf, Blatt „Neue Karte“) · Expected: ALLE GRÜN, keine JavaScript-Fehler.
- [ ] **Step 3: Gesamtprüfung** durch einen frischen Prüfer (stärkstes Modell) mit Plan, Spec und Review Focus; Wichtiges mit Test (erst rot, dann grün) beheben.
- [ ] **Step 4: Commit, Pull Request, Merge**; Fotos (Hell/Dunkel) an den Nutzer zur Prüfung am echten Handy.
