# Üben: Denkzeit, Nachlesen, Weiter oben rechts

Stand: 31.10.2026 · Status: zur Freigabe · Ergänzt `2026-10-30-design-refresh-design.md`, Abschnitt „Etappe 2 – Üben“. Wo sich beide widersprechen, gilt dieses Dokument.

## Absicht

Zwei Probleme aus dem täglichen Üben am Handy:

1. **Multiple Choice:** Nach dem Antippen einer Antwort wird sie markiert, darunter erscheint die Erklärung. „Weiter“ rutscht aus dem Bild, man muss bei jeder Frage scrollen. Außerdem soll man Frage und Antwort danach in Ruhe und gut lesbar nachlesen können.
2. **Lernkarte (klassisch):** Üben soll an **Zeitdruck wie in der Prüfung** gewöhnen (dort ca. 2 Minuten je Aufgabe). Deshalb gibt es eine sichtbare Denkzeit, nach der die Antwort von selbst erscheint.

Vorlage: Entwürfe A (Denkzeit), B (Antwort blendet ein), C (Nachlesen bei Multiple Choice), D (Weiter oben, hier: rechts) vom 31.10.2026.

## Ziele

1. **Lernkarte:** Zuerst nur die Frage, darunter in der Karte ein ablaufender Zeitbalken mit Restzeit („⏱ Denkzeit läuft · noch 3 s“). Ist die Zeit abgelaufen, erscheint die Antwort **unter der Frage** und wird über etwa 2 bis 3 Sekunden von unsichtbar zu voll lesbar.
2. Antippen der Karte zeigt die Antwort jederzeit sofort (kein Warten, wenn man sie schon weiß).
3. „👎 Nochmal“ und „👍 Gewusst“ stehen während der ganzen Zeit fest unten und sind sofort nutzbar.
4. **Denkzeit unter „Mehr“ einstellbar:** aus, 3, 5, 10, 20, 30 Sekunden; Standard 5 Sekunden. „Aus“ zeigt Frage und Antwort wie bisher erst nach Antippen, ohne Balken.
5. **Multiple Choice nach dem Antworten:** größere Schrift für Frage, Antworten und „Zum Nachlesen“; nur die gewählte (rot, falls falsch) und die richtige Antwort (grün) bleiben sichtbar, die übrigen sind eingeklappt („2 weitere Antworten ausgeblendet ▾“, antippbar zum Aufklappen).
6. **„Weiter“ oben rechts**, in der Zeile des Fortschrittsbalkens, und bleibt beim Scrollen dort stehen; unten gibt es keinen Weiter-Knopf.

## Nicht-Ziele

- Keine Wartezeit bei Multiple Choice und „Begriff erkennen“; vor dem Antworten bleibt die Ansicht wie in Entwurf 1.
- Keine Änderung an Lernstand, Stufen, Fälligkeit oder Datenformaten; die Denkzeit wird nirgends gespeichert oder bewertet.
- Kein Zeitlimit, das automatisch als „falsch“ bewertet.

## Anti-Ziele

- Üben wird langsamer für jemanden, der die Antwort kennt (deshalb: Antippen zeigt sofort, Bewerten jederzeit möglich).
- Der Weiter-Knopf ist beim Nachlesen wieder außer Reichweite (deshalb: bleibt beim Scrollen stehen).

## Festgelegt (gemeinsam entschieden)

- Denkzeit nur bei der klassischen Lernkarte, mit sichtbarem Zeitbalken; Zweck: Gewöhnung an Prüfungsdruck.
- Antwort erscheint unter der Frage, langsam ansteigende Deckkraft.
- Dauer unter „Mehr“ einstellbar.
- Multiple Choice: größere Schrift, Nachlesen wie Entwurf C.
- „Weiter“ nur oben rechts (Grund des Nutzers: Rechtshänder, rechts mit dem Daumen erreichbar). Hinweis aus der Beratung: unten wäre für den Daumen noch näher; der Nutzer hat sich bewusst für oben rechts entschieden.
- Umsetzung als Teil von Etappe 2 (Weg 1), nicht vorab.

## Vorgehen (Ansätze)

| Ansatz | Abwägung |
|---|---|
| **Weg 1: in Etappe 2 einbauen** ✅ gewählt | Ein Umbau, eine Prüfrunde; Scroll-Problem bleibt bis Etappe 2 fertig ist |
| Weg 2: vorab im heutigen Bildschirm, danach Etappe 2 | Schneller sichtbar, aber Kopf und Karte werden doppelt gebaut, zwei Prüfrunden |

## Meine Entscheidungen (bitte beim Lesen prüfen)

1. **Die klassische Karte dreht sich nicht mehr um**; Frage und Antwort stehen auf einer Fläche. Die 3D-Drehung entfällt. Erneutes Antippen nach dem Einblenden ändert nichts (kein Zurückdrehen).
2. **Tastatur am Mac:** Leertaste/Enter zeigt die Antwort sofort (statt umdrehen); 1/2 bewerten wie bisher; bei Multiple Choice Enter = Weiter.
3. **„💡 Tipp“** steht rechts neben der Restzeit unter dem Balken (wie Entwurf A). Tippen auf „Tipp“ hält die Denkzeit nicht an.
4. **Verweise** (Wissen-Links) erscheinen bei der Lernkarte erst, wenn die Antwort sichtbar ist, wie bisher nach dem Umdrehen.
5. **Bewegung reduzieren** (Systemeinstellung): Balken und Antwort erscheinen ohne Animation; die Denkzeit selbst bleibt.
6. Läuft die Denkzeit und die App geht in den Hintergrund oder man wechselt den Reiter, **beginnt die Denkzeit für diese Karte beim Zurückkommen nicht neu**; die Antwort ist dann sichtbar, sobald die Zeit vorbei ist.
7. Größere Schrift bei Multiple Choice gilt erst **nach** dem Antworten; vorher bleibt die Größe wie im Entwurf 1, damit alle vier Antworten ohne Scrollen passen.

## Dem Umsetzenden überlassen

Genaue Schriftgrößen, Animationskurve, Farben des Zeitbalkens im Dunkelmodus, technische Umsetzung des Einblendens und des stehenbleibenden Weiter-Knopfs, Anpassung der Tests.
