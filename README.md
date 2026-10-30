# Lernkartei

Lernkarten und Nachschlagewerk im Browser, für Mac, iPad und Android.
Die App ist eine reine statische Website ohne Backend und ohne Build-Schritt. Alle Daten liegen in einem privaten GitHub-Repository und werden über die GitHub REST API gelesen und geschrieben. So sehen alle Geräte denselben Datenstand.

**Funktionen**

- **Üben:**
  - **Fach als Schwerpunkt:** Leiste mit allen Fächern (VWL/BWL, ReWe, FiInv, MPA, OrgUF, PM, IKT) samt Anzahl; „Alle Fächer“ mischt. Das Fach steht bei jeder Karte und in der Fortschrittsleiste.
  - **Heute fällig** (Leitner-System): fällige Karten plus neue Karten bis zum Tageslimit, innerhalb der Auswahl bewusst nach Themen gemischt. Richtig: eine Stufe weiter (wieder fällig nach 1, 2, 4, 8, 16 Tagen). Falsch: zurück in Stufe 1, morgen erneut und in der Sitzung am Ende noch einmal.
  - **Freies Üben** mit zusätzlichem Themenfilter.
  - **Übungsformen:** Multiple Choice (Begriff → Erklärung), Begriff erkennen (Erklärung → Begriff), Klassisch (umdrehen, selbst bewerten). „Gemischt“ wählt je nach Lernstand: neue Karten eher Multiple Choice, sichere eher klassisch. Falsche Antwortmöglichkeiten stammen aus demselben Thema.
  - **Übungsplan:** neue Karten pro Tag und Karten pro Sitzung einstellbar (pro Gerät).
- **Erstellen:** Karten anlegen, bearbeiten und löschen (mit „Rückgängig“ im Hinweis), Fach-Vorschläge, Filter und Zähler.
- **Wissen (Nachschlagewerk):**
  - **Themen:** Merker je Fach mit Miniblöcken und den sechs Bezügen (Praxisbezug, Glossar, Prüfungsbezug, Managementsprache, Abschluss, Abweichungen).
  - **A–Z:** Register aller Begriffe und eigenen Einträge.
  - **Eigene:** eigene Einträge mit Erklärung, Beispiel und Bildern; Entwürfe sammeln sich unter „Offen“.
  - **Suche** über Begriffe, Kürzel, Themen, Musterantworten und Managementsprache. Gibt es einen Begriff noch nicht, lässt er sich direkt als Entwurf anlegen.
  - **Automatische Verlinkung:** Bekannte Begriffe und Kürzel (z. B. KLR, GuV) sind im Text unterstrichen; Antippen zeigt Kurzerklärung, Funktionsweise und Fundstelle.
  - **Herkunfts-Markierungen** aus den Merkern werden farbig angezeigt: Folie und Gesetz neutral, Ergänzung blau, Nicht belegt und Fiktiv gelb, Korrektur rot.
  - **Import** von Merkern als JSON-Datei.
- **Lücken:** Begriff oder Frage eintragen und prüfen.
  - Wissen und Lernkarte vorhanden: Erklärung und Verknüpfung werden als Text angezeigt (z. B. „Lernkarte #0042 ↔ ReWe › … › Aufwand“).
  - Nur Wissen vorhanden: Lernkarte daraus erstellen und verknüpfen.
  - Nichts vorhanden: Wissenseintrag und verknüpfte Lernkarte anlegen; ohne Erklärung bleibt es eine offene Lücke.
  - Fehlende Lernkarten zu vorhandenem Wissen lassen sich mit einem Tipp erzeugen.
- **Lernkarten-Nummern:** Jede Karte hat eine fortlaufende, eindeutige Nummer (#0001, #0002, …). Legen zwei Geräte offline gleichzeitig Karten an, bekommt beim Zusammenführen die später gespeicherte Karte die nächste freie Nummer.
- **Tipps und Verweise beim Üben:** „💡 Tipp“ (Taste `T`) zeigt Thema und Schlüsselbegriffe, ohne die Antwort zu verraten. Auf der Rückseite sind Begriffe antippbar; darunter stehen Fundstelle („Im Wissen ansehen“) und verwandte Begriffe. Verlinkt wird nur innerhalb desselben Fachs, Abkürzungen gelten fachübergreifend.
- **Fächer** werden zusammengefasst, auch Varianten wie „VWL - Rechtsformen“ oder „Rechnungswesen - ReWe“.
- **Verknüpfte Lernkarten** zeigen immer den aktuellen Text aus dem Wissen. Wird eine solche Karte bearbeitet, wird sie zur „eigenen Fassung“ und behält ihren Text.
- **Lernstand pro Person:** Karten, Wissen und Lücken sind gemeinsam; der Lernstand liegt je Person in `lernstand/<name>.json`. Der Name kommt aus dem Feld „Name (wer lernt)“ in den Einstellungen (z. B. Andy, Julian); bleibt es leer, gilt der GitHub-Name des Tokens. Die Trennung ist eine Absprache, kein Zugriffsschutz. Im Feld „Repository-Besitzer“ tragen alle den Besitzer des gemeinsamen Daten-Repositorys ein.
- **Sync:** Änderungen an Karten werden nach ca. 1,2 Sekunden automatisch gespeichert, Antworten beim Üben nach ca. 3 Sekunden in der kleinen Lernstand-Datei der Person (nicht mehr in `cards.json`). Hat ein anderes Gerät zwischenzeitlich gespeichert, wird zusammengeführt statt überschrieben.
- **Offline-tolerant:** Der zuletzt geladene Stand von Karten und Wissen bleibt auf dem Gerät zwischengespeichert und ist ohne Verbindung lesbar.
- **Hell/Dunkel** wechselt automatisch mit der Systemeinstellung.
- **Tastatur (Mac):** Leertaste dreht die Karte, `1` = Nochmal, `2` = Gewusst, `Cmd + Enter` speichert das Formular, `Esc` schließt Fenster.

## Projektstruktur

```
index.html            Markup
css/style.css         Styling (Light/Dark über CSS-Variablen)
js/app.js             Tabs, Üben, Karten-Formular und -Liste, Einstellungen
js/wissen.js          Oberfläche des Nachschlagewerks (Themen, Register, Eigene, Suche, Import)
js/luecken.js         Reiter „Lücken“: prüfen, Lernkarte erstellen oder verknüpfen, offene Lücken
js/practice.js        Reiter „Üben“: Tagesauswahl, Mischen, Übungsformen, Tipps und Verweise
js/progress.js        Lernstand (Leitner) in lernstand.json, konfliktsicher über mehrere Geräte
js/wissen-data.js     Fächer, Laden und Prüfen der Merker, Begriffsverzeichnis, Verlinkung, Suche
js/richtext.js        Textdarstellung: Absätze, Aufzählungen, fett, Herkunfts-Markierungen
js/ui.js              Gemeinsame Bausteine: Elemente, Toasts, Dialoge
js/github-sync.js     GitHub-API, Base64/UTF-8, Einstellungen, lokaler Zwischenspeicher
```

## Aufbau des Daten-Repositorys

```
cards.json            Lernkarten (mit Nummer "nr" und optionaler Verknüpfung "quelle")
lernstoff.json        Eigene Einträge im Nachschlagewerk
lernstand/<name>.json Lernstand je Person: je Karte Stufe, fällig am, richtig/falsch; Tageszähler je Gerät
lernstand.json        (alt) gemeinsamer Lernstand der ersten Version; wird beim Besitzer einmalig übernommen
merker/<id>.json      Ein Merker pro Datei (z. B. merker/rewe-1-externes-rechnungswesen.json)
images/               Bilder der eigenen Einträge
```

### Merker-Format (Kurzfassung)

```json
{
  "schema": 1,
  "id": "rewe-1-externes-rechnungswesen",
  "fach": "rewe",
  "titel": "Externes Rechnungswesen: Finanzbuchhaltung",
  "teil": "Teil 1 von 2",
  "abkuerzungen": [{ "kurz": "KLR", "lang": "Kosten- und Leistungsrechnung" }],
  "bloecke": [
    {
      "id": "A",
      "titel": "…",
      "folien": "Folien 2 bis 4",
      "praxis": { "wann": "…", "wofuer": "…", "warum": "…", "verknuepfung": "…" },
      "glossar": [{ "begriff": "…", "kurz": "…", "funktion": "…", "synonyme": [], "kuerzel": [] }],
      "pruefung": { "text": "…", "zuordnung": [{ "frage": "…", "antwort": "…" }], "tabelle": null, "nachtrag": "" },
      "management": { "aussagen": [], "uebersetzungen": [{ "halle": "…", "management": "…" }], "musterantwort": { "frage": "…", "hinweis": "…", "antwort": "…" } },
      "abschluss": { "kernaussage": "…", "feynman": { "aufgabe": "…", "muss": [] } },
      "abweichungen": [{ "typ": "Lücke", "text": "…" }]
    }
  ],
  "korrekturen": [{ "id": "K2", "text": "…" }],
  "quellen": [{ "text": "HGB § 252", "url": "https://…" }]
}
```

Fach-IDs: `vwl-bwl`, `rewe`, `fi-inv`, `mpa`, `org`, `pm`, `ikt`. Herkunfts-Markierungen stehen direkt im Text, z. B. `(Folie 9)`, `[Gesetz: § 252 HGB]`, `[Ergänzung: IHK München]`, `[Nicht belegt: …]`, `[Fiktiv]`. `**fett**` wird fett dargestellt.

## Einrichtung

### 1. Daten-Repository anlegen

Lege auf GitHub ein **eigenes, privates Repository** für die Kartendaten an, z. B. `lernkarten-daten`.
Es darf leer sein; die Datei `cards.json` wird beim ersten Speichern automatisch angelegt.

> Empfehlung: Daten und App getrennt halten. Liegen die Karten im App-Repository, sind sie bei einer öffentlichen GitHub-Pages-Seite öffentlich lesbar, und jedes Speichern löst einen neuen Pages-Build aus.

### 2. Fine-grained Personal Access Token erstellen

1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**
   (direkt: <https://github.com/settings/personal-access-tokens/new>)
2. **Repository access:** „Only select repositories“ und nur das Daten-Repository auswählen.
3. **Permissions → Repository permissions → Contents:** „Read and write“. Alle anderen Berechtigungen bleiben aus.
4. Ablaufdatum wählen, Token erzeugen und kopieren.

Der Token wird nur im `localStorage` des jeweiligen Browsers gespeichert und niemals ins Repository geschrieben. Wer Zugriff auf das entsperrte Gerät hat, kann ihn allerdings auslesen. Deshalb den Token unbedingt auf das eine Daten-Repository beschränken. Über „Zugangsdaten von diesem Gerät entfernen“ im Einstellungen-Dialog lässt er sich wieder löschen.

### 3. App über GitHub Pages veröffentlichen

1. Die Dateien dieses Repositorys auf den Branch `main` pushen.
2. Im App-Repository: **Settings → Pages → Build and deployment**
   - Source: „Deploy from a branch“
   - Branch: `main`, Ordner `/ (root)` → **Save**
3. Nach ca. einer Minute ist die App unter `https://<benutzername>.github.io/<repository>/` erreichbar.

Ein Build-Schritt ist nicht nötig. Für einen lokalen Test reicht ein einfacher Webserver (ES-Module funktionieren nicht über `file://`):

```bash
python3 -m http.server 8000
# dann http://localhost:8000 öffnen
```

### 4. Erster Start auf jedem Gerät

Beim ersten Öffnen erscheint automatisch der Dialog **GitHub-Einstellungen**:

| Feld                 | Beispiel            |
| -------------------- | ------------------- |
| GitHub-Benutzername  | `deinname`          |
| Repository-Name      | `lernkarten-daten`  |
| Branch               | `main`              |
| Dateipfad            | `cards.json`        |
| Personal Access Token| `github_pat_…`      |

„Speichern & verbinden“ testet die Verbindung sofort. Diesen Schritt auf jedem Gerät einmal durchführen (Mac, iPad, Android). Tipp für Android: In Chrome über das Menü „Zum Startbildschirm hinzufügen“ wirkt die App wie eine eigene App.

## Datenformat

`cards.json` enthält ein Array von Karten:

```json
[
  {
    "id": "lq2k8x1a-4f9c2b",
    "fach": "VWL",
    "frage": "Was ist Inflation?",
    "antwort": "Ein anhaltender Anstieg des allgemeinen Preisniveaus.",
    "status": "neu",
    "wiederholungen": 0,
    "letzteUebung": null
  }
]
```

`status` ist `neu`, `lernen` oder `gelernt`. Jede Änderung erzeugt einen Commit im Daten-Repository, ältere Stände lassen sich daher jederzeit über die Git-Historie wiederherstellen.

## Hinweise zur Synchronisation

- Gespeichert wird immer die komplette Kartenliste. Bei gleichzeitigen Änderungen auf zwei Geräten gewinnt pro Karte die zuletzt gespeicherte Version; Karten, die nur auf einem Gerät geändert wurden, bleiben erhalten.
- Schlägt das Speichern fehl (z. B. offline), bleiben die Änderungen auf dem Gerät erhalten. Die App versucht es beim nächsten Sync, bei der nächsten Änderung oder sobald die Verbindung zurück ist erneut, aber nicht in einer Endlosschleife.
