# Design-Erneuerung Lernkartei (Handy zuerst)

Stand: 30.10.2026 · Status: zur Freigabe

## Absicht

Die App wird fast ausschließlich **am Handy** genutzt („hat man immer dabei, geht am leichtesten“). Die Oberfläche ist über viele Erweiterungen gewachsen und wirkt am Handy überladen: Vor der Lernkarte stehen fünf Zeilen Bedienelemente, Antworten müssen gescrollt werden, „Sync“ und „Einstellungen“ belegen den besten Platz oben. Ziel ist ein **moderneres, ruhigeres Design**, das beim täglichen Üben aus dem Weg geht – in **Hell und Dunkel** – ohne Funktionen oder Daten anzutasten.

## Ziele

1. **Üben am Handy ohne Scrollen**: Fach und Fortschritt in zwei Zeilen, Frage sofort im Blick, Bedienknöpfe im Daumenbereich unten.
2. **Rückmeldung mit Emoji**: richtig → 👍, falsch → 👎 (groß, direkt unter der Frage, kurze Animation; auch auf „Gewusst“/„Nochmal“).
3. **Fach als Auswahlknopf** („ReWe ▼“), der eine Liste von unten öffnet – nicht mehr alle Fächer ständig sichtbar.
4. **Sync und Einstellungen nach unten**: Navigation als Leiste am unteren Rand mit „Mehr“.
5. **Hell, Dunkel, Automatisch** wählbar (Standard: Automatisch nach Handy).
6. **Erstellen mit Register**: Suche und Buchstabenleiste A–Z statt einer langen Liste unter einem großen Formular.
7. **Merker mit nur einem Thema** ohne doppelten Titel und ohne Sprungmarke „A“.

## Nicht-Ziele

- Keine Änderung an Datenformaten (`cards.json`, `lernstand/<name>.json`, Merker, `lernstoff.json`), Sync-Logik, Leitner-Regeln, Übungsformen oder Verknüpfungslogik.
- **Reiter „Lücken“ bleibt funktional vollständig unverändert** (wird später separat weiterentwickelt); er bekommt nur den neuen Look.
- Keine neue Funktionalität außer den hier genannten (z. B. keine Statistik-Seite, kein Offline-App-Modus).
- Kein Ausbau für große Bildschirme; Mac/iPad sollen weiterhin ordentlich aussehen, sind aber nicht der Maßstab.

## Anti-Ziele (wäre ein Fehlschlag, selbst wenn es technisch funktioniert)

- Lernstand, Karten oder Wissen gehen verloren oder werden verändert.
- Üben wird an irgendeiner Stelle umständlicher als heute (mehr Tippen, mehr Scrollen).
- Die App ist zwischen den Etappen nicht voll benutzbar.
- Abhängigkeit von Fremdpaketen oder Build-Schritt.

## Rahmenbedingungen

- Weiterhin reines HTML/CSS/JavaScript ohne Build und ohne Fremdpakete, ausgeliefert über GitHub Pages.
- Muss in Safari (iPhone/iPad/Mac) und Chrome (Android/Mac) funktionieren; sichere Bereiche (Notch, Home-Leiste) beachten.
- Dunkelmodus hängt derzeit an vier Stellen im Stylesheet direkt an `prefers-color-scheme`; für den manuellen Schalter muss das auf ein gemeinsames Umschaltsystem umgestellt werden.
- Die bestehende Testsammlung (Browser-Tests) muss nach jeder Etappe grün sein; Tests, die sich auf alte Bedienelemente beziehen, werden angepasst.

## Vorgehen (Ansätze)

| Ansatz | Kurz | Abwägung |
|---|---|---|
| **A: Umbau in Etappen** ✅ gewählt | Bestehenden Aufbau behalten, Optik und betroffene Bereiche in drei Etappen erneuern, nach jeder Etappe ausliefern | Geringes Risiko, Nachsteuern möglich, App bleibt durchgehend benutzbar; einzelne Bereiche sehen vorübergehend noch alt aus |
| B: Alles in einem Zug neu | Gesamte Oberfläche neu, einmal ausliefern | Sofort einheitlich, aber großer Umbau mit vielen Fehlerquellen; Ergebnis erst am Ende sichtbar |
| (verworfen) Design-Baukasten einbinden | Fremdes UI-Framework | Widerspricht „ohne Fremdpakete/Build“ |

Gewählt: **A**, weil täglich mit der App gelernt wird und sie dabei stabil bleiben muss, und weil Farben/Abstände nach Etappe 1 am echten Handy geprüft werden können.

## Festgelegt (gemeinsam entschieden)

- Handy ist der Maßstab.
- Navigation unten; „Sync“ und „Einstellungen“ unten (unter „Mehr“).
- 👍 bei richtig, 👎 bei falsch.
- Fach als Auswahlknopf mit Liste („ReWe ▼“).
- Hell- und Dunkelmodus.
- Register in „Erstellen“; Merker-Fix bei einem Thema.
- „Lücken“ bleibt vollständig.
- Ansatz A in drei Etappen.
- Vorlage: Entwürfe 1–9 (Bilder im Chat vom 30.10.2026).

## Etappen

### Etappe 1 – Grundgerüst
- Neue Gestaltung (Farben, Rundungen, Schatten, Schriftgrößen) gemäß Entwürfen für **alle** Reiter, inkl. „Lücken“ (nur Optik).
- Umschaltbares Farbsystem: Hell / Dunkel / Automatisch; Auswahl pro Gerät gemerkt.
- **Navigation unten** mit fünf Einträgen: Üben · Erstellen · Wissen · Lücken · Mehr; Sync-Zustand als Punkt am „Mehr“-Symbol (grün = gespeichert, gelb = speichert, rot = Problem).
- **Seite „Mehr“**: Synchronisieren (mit „zuletzt vor …“), Darstellung (Hell/Dunkel/Auto), Übungsform, Übungsplan, Merker importieren, Lernstand von …, GitHub-Einstellungen.
- Bisherige Kopfzeile oben entfällt; Sync-Knöpfe in Üben und Wissen entfallen (nur noch unter „Mehr“).

### Etappe 2 – Üben
- Kopf: Fach-Knopf („ReWe ▼“) + Umschalter Heute/Frei; darunter Fortschrittsbalken mit „12 / 31 · ✓ 9 · ✗ 3“.
- Fach-Liste als Blatt von unten mit Anzahl je Fach; Fächer ohne Karten ausgegraut.
- Karte mit Kennzeichen (#Nummer, Stufe, Übungsform); klassische Karte füllt den freien Platz.
- Rückmeldung 👍/👎 direkt unter der Frage; „Weiter“ fest im Daumenbereich; „Gewusst 👍“/„Nochmal 👎“ unten.
- Übungsform und Übungsplan wandern nach „Mehr“; Thema-Filter (freies Üben) bleibt erreichbar.
- Tipp und Verweise bleiben erhalten.

### Etappe 3 – Erstellen und Wissen
- **Erstellen**: Titel mit Kartenzahl, Fach-Knopf, Suchfeld (Text oder Nummer), Buchstabenleiste A–Z (leere Buchstaben ausgegraut, Antippen springt), Liste nach Buchstaben gruppiert; „＋ Neue Karte“ öffnet das Formular als Blatt; Bearbeiten/Löschen wie bisher.
- **Wissen**: Kopf mit Titel, Fach-Knopf, Suche und Themen/A–Z/Eigene; Merker-Karten mit „📈 x % sicher“; Merker mit einem Thema ohne doppelten Titel/Sprungmarke.

## Meine Entscheidungen (bitte beim Lesen prüfen)

1. **Sortierung im Register nach dem eigentlichen Begriff**: Vorsätze wie „Erkläre den Begriff:“, „Was ist/sind (der/die/das)“, „Wofür steht die Abkürzung“ werden für die Einordnung ignoriert („Erkläre den Begriff: Bilanz“ → B).
2. **„📈 x % sicher“** = Anteil der Karten eines Merkers in Stufe 3 oder höher im eigenen Lernstand.
3. **Fach-Auswahl gilt je Reiter** (Üben, Erstellen, Wissen merken sich ihr Fach getrennt), weil man z. B. VWL üben, aber ReWe-Karten anlegen kann.
4. **Akzentfarbe Indigo/Violett** wie in den Entwürfen; Erfolgsgrün und Fehlerrot bleiben für 👍/👎.
5. Auf Mac/iPad wird die Inhaltsbreite begrenzt (wie bisher), die Navigation bleibt unten.
6. **„Synchronisieren“ unter „Mehr“ holt alles** (Karten, Wissen, Lernstand) – wie bisher die beiden Sync-Knöpfe zusammen. Automatisches Speichern bleibt unverändert.
7. „GitHub-Einstellungen“ und „Merker importieren“ öffnen die **bestehenden Dialoge** (nur im neuen Look); „Lernstand von …“ ist eine Anzeige, geändert wird der Name in den GitHub-Einstellungen.
8. **Tastenkürzel am Mac** (Leertaste, 1–4, T, Enter, Esc) bleiben erhalten.
9. Die Browser-Leistenfarbe (`theme-color`) folgt dem gewählten Modus.

## Dem Umsetzenden überlassen

Genaue Abstände, Animationsdauern, Symbolwahl in der Navigation, technische Aufteilung der Stylesheets, Anpassung der Testsammlung.
