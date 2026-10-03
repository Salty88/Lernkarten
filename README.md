# Lernkartei

Digitale Lernkarteikarten im Browser, für Mac (Desktop) und Android (mobil).
Die App ist eine reine statische Website ohne Backend und ohne Build-Schritt. Die Karten liegen als `cards.json` in einem GitHub-Repository und werden über die GitHub REST API gelesen und geschrieben. So sehen alle Geräte denselben Datenstand.

**Funktionen**

- **Üben:** Karten als 3D-Flip-Karte, Filter nach Fach, Mischen, Bewertung mit „Nochmal“ oder „Gewusst“, Fortschrittsanzeige.
- **Erstellen:** Karten anlegen, bearbeiten und löschen (mit „Rückgängig“ im Hinweis), Fach-Vorschläge, Filter und Zähler.
- **Sync:** Änderungen werden nach ca. 1,2 Sekunden automatisch gespeichert. Hat das andere Gerät zwischenzeitlich gespeichert, lädt die App den neueren Stand und führt ihn mit den eigenen Änderungen zusammen.
- **Offline-tolerant:** Der zuletzt geladene Stand bleibt auf dem Gerät zwischengespeichert. Üben funktioniert auch ohne Verbindung; noch nicht gespeicherte Änderungen werden beim nächsten Sync übertragen.
- **Hell/Dunkel** wechselt automatisch mit der Systemeinstellung.
- **Tastatur (Mac):** Leertaste dreht die Karte, `1` = Nochmal, `2` = Gewusst, `Cmd + Enter` speichert das Formular.

## Projektstruktur

```
index.html            Markup
css/style.css         Styling (Light/Dark über CSS-Variablen)
js/app.js             UI-Logik (Tabs, Üben, Formular, Liste, Einstellungen)
js/github-sync.js     GitHub-API, Base64/UTF-8, Einstellungen, lokaler Zwischenspeicher
```

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

„Speichern & verbinden“ testet die Verbindung sofort. Diesen Schritt einmal auf dem Mac und einmal auf dem Android-Gerät durchführen. Tipp für Android: In Chrome über das Menü „Zum Startbildschirm hinzufügen“ wirkt die App wie eine eigene App.

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
