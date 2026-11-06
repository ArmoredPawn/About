// Home page only: each section and card swings up into place in 3-D as it scrolls into view.
// The hidden starting pose is in site.css under html.reveal-on, which the page head sets.
window.__reveal = true;

(function () {
  if (!document.documentElement.classList.contains('reveal-on')) return;

  var items = [];
  document.querySelectorAll('.home .intro, .home .section > h2, .home .section-note').forEach(function (el) {
    items.push(el);
  });
  // Cards in a grid follow one another a moment apart
  document.querySelectorAll('.home .cards').forEach(function (grid) {
    Array.prototype.forEach.call(grid.children, function (el, i) {
      if (i) el.style.setProperty('--d', Math.min(i, 6) * 70 + 'ms');
      items.push(el);
    });
  });

  function finish(el) {
    el.classList.add('revealed');
    el.classList.remove('in');
  }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      var el = entry.target;
      io.unobserve(el);
      el.classList.add('in');
      var delay = parseFloat(el.style.getPropertyValue('--d')) || 0;
      var timer = setTimeout(function () { finish(el); }, 1200 + delay);
      el.addEventListener('transitionend', function done(e) {
        if (e.target !== el || e.propertyName !== 'transform') return;
        el.removeEventListener('transitionend', done);
        clearTimeout(timer);
        finish(el);
      });
    });
  });

  items.forEach(function (el) { io.observe(el); });
})();
