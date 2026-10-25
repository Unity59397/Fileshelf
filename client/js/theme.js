// Runs before the page paints, so a saved dark-mode choice does not flash light first.
(function () {
  try {
    var t = localStorage.getItem('fileshelf-theme');
    if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();
