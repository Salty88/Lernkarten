# Tests

Browser-Tests mit `playwright-core` gegen ein simuliertes GitHub (`tests/e2e/fakegh.mjs`).
Die App selbst braucht weiterhin keine Pakete; `package.json` dient nur diesen Tests.

```bash
npm install
npm run test:e2e                         # mit erfundenen Beispieldaten (tests/e2e/fixtures)
DATA_DIR=../lernkarten-daten npm run test:e2e   # mit einem lokalen Klon der eigenen Daten
```

Chromium: Standardpfad `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, sonst über `CHROMIUM=/pfad/zu/chrome`.
Echte Lerndaten gehören nie ins Repository; `DATA_DIR` liest sie nur lokal.
