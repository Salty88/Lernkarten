/*
 * theme-early.js – wird vor dem Stylesheet synchron geladen, damit eine fest
 * gewählte Darstellung (Hell/Dunkel) schon beim ersten Zeichnen gilt und
 * nicht kurz die Gerätefarbe aufblitzt. Alles Weitere erledigt js/theme.js.
 */
(function () {
  try {
    var choice = localStorage.getItem('lernkartei.darstellung');
    if (choice === 'light' || choice === 'dark') document.documentElement.setAttribute('data-theme', choice);
  } catch (e) {
    /* ohne Speicher: Automatisch */
  }
})();
