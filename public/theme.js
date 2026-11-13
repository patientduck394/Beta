// Sets the light or dark theme before the page is drawn, so nothing flashes. The choice is kept in this browser.
(function () {
  try {
    var t = localStorage.getItem('beta_theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();
