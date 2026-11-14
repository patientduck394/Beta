// Sets the light or dark mode and the instance theme before the page is drawn, so nothing flashes.
// The mode choice and the last instance theme are kept in this browser.
(function () {
  try {
    var t = localStorage.getItem('beta_theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}

  // ---- instance themes: a color scheme, an icon (favicon + top-left) and a title (top-left + page title) ----
  var SVG = function (bg, inner) { return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="' + bg + '"/>' + inner + '</svg>'; };
  var W = 'fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"';
  var BUILTIN = {
    'default': { name: 'Beta (default)', accent: null, title: null, icon: null },
    ocean: { name: 'Ocean', accent: '#0ea5e9', title: 'Beta Tide', svg: SVG('#0ea5e9', '<path d="M10 28q8-8 16 0t16 0 12 0M10 42q8-8 16 0t16 0 12 0" ' + W + '/>') },
    sunset: { name: 'Sunset', accent: '#f97316', title: 'Beta Glow', svg: SVG('#f97316', '<circle cx="32" cy="36" r="11" fill="#fff"/><path d="M10 50h44M32 12v8M14 24l6 5M50 24l-6 5" ' + W + '/>') },
    grape: { name: 'Grape', accent: '#9333ea', title: 'Beta Grape', svg: SVG('#9333ea', '<g fill="#fff"><circle cx="22" cy="26" r="7"/><circle cx="38" cy="26" r="7"/><circle cx="30" cy="39" r="7"/><circle cx="46" cy="39" r="6"/></g>') },
    rose: { name: 'Rose', accent: '#e11d48', title: 'Beta Rose', svg: SVG('#e11d48', '<g fill="#fff"><circle cx="32" cy="18" r="9"/><circle cx="46" cy="30" r="9"/><circle cx="40" cy="46" r="9"/><circle cx="24" cy="46" r="9"/><circle cx="18" cy="30" r="9"/></g><circle cx="32" cy="34" r="7" fill="#e11d48"/>') },
    slate: { name: 'Slate', accent: '#64748b', title: 'Beta Slate', svg: SVG('#64748b', '<path d="M32 12l17 10v20L32 52 15 42V22z" ' + W + '/>') },
    mono: { name: 'Mono', accent: '#6b7280', mono: true, title: 'beta', svg: SVG('#27272a', '<path d="M24 12v40M24 30q0-8 9-8t9 10-9 10-9-6" ' + W + '/>') }
  };
  var hex2hsl = function (hx) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hx || ''); if (!m) return null;
    var n = parseInt(m[1], 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn, h = 0, s = 0;
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1));
      h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
    }
    return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
  };
  var hsl = function (h, s, l) { return 'hsl(' + h + ',' + Math.round(s) + '%,' + Math.round(l) + '%)'; };
  // contrast pick: dark ink or white, whichever reads better on this color
  function lum(h, sat, l) {
    sat /= 100; l /= 100;
    var a = sat * Math.min(l, 1 - l), f = function (n) { var k = (n + h / 30) % 12, v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); v = v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); return v; };
    return 0.2126 * f(0) + 0.7152 * f(8) + 0.0722 * f(4);
  }
  function onColor(h, sat, l, ts) { var L = lum(h, sat, l); return (L + 0.05) / 0.06 > 1.05 / (L + 0.05) ? hsl(h, 60 * ts, 9) : '#ffffff'; }
  function palettes(accent, mono) {
    var c = hex2hsl(accent); if (!c) return null;
    var h = c[0], s = mono ? 0 : Math.max(c[1], 35), ts = mono ? 0 : 1;
    var darkL = Math.max(c[2], 62);
    var lightL = c[2] > 55 ? c[2] : Math.max(c[2], 36);
    var light = {
      lime: hsl(h, s, lightL), d: hsl(h, s, 30), dd: hsl(h, s, 20), l: hsl(h, 70 * ts, 92), ll: hsl(h, 70 * ts, 96),
      ink: hsl(h, 40 * ts, 9), muted: hsl(h, 16 * ts, 40), line: hsl(h, 35 * ts, 86), bg: hsl(h, 45 * ts, 98), card: '#ffffff',
      av: hsl(h, 80 * ts, 80),
      on: onColor(h, s, lightL, ts)
    };
    var dk = hsl(h, Math.max(s, 55), Math.max(darkL, 64));
    var dark = {
      lime: dk, d: dk, dd: hsl(h, mono ? 0 : Math.max(s, 55), 82), l: hsl(h, 45 * ts, 15), ll: hsl(h, 45 * ts, 10),
      ink: hsl(h, 35 * ts, 92), muted: hsl(h, 15 * ts, 66), line: hsl(h, 35 * ts, 20), bg: hsl(h, 45 * ts, 6), card: hsl(h, 40 * ts, 9), av: hsl(h, 70 * ts, 74), on: hsl(h, 60 * ts, 8)
    };
    if (mono) { dark.lime = '#e4e4e7'; dark.d = '#e4e4e7'; dark.dd = '#f4f4f5'; }
    return { light: light, dark: dark };
  }
  var decl = function (p) {
    return '--lime:' + p.lime + ';--lime-d:' + p.d + ';--lime-dd:' + p.dd + ';--lime-l:' + p.l + ';--lime-ll:' + p.ll + ';--ink:' + p.ink + ';--muted:' + p.muted + ';--line:' + p.line + ';--bg:' + p.bg + ';--card:' + p.card + ';--on-lime:' + p.on + ';--av1:' + p.av + ';';
  };
  function emojiIcon(e) {
    return 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><text x="32" y="33" font-size="48" text-anchor="middle" dominant-baseline="central">' + e.replace(/[<>&]/g, '') + '</text></svg>');
  }
  // theme record -> what to show: {accent, mono, title, icon (url or null)}
  function resolve(t) {
    if (!t || typeof t !== 'object') return null;
    if (t.id === 'custom') {
      var ic = String(t.icon || '');
      return { accent: /^#[0-9a-f]{6}$/i.test(t.accent || '') ? t.accent : null, title: t.title || null, icon: !ic ? null : ic.charAt(0) === '/' ? ic : emojiIcon(ic) };
    }
    var b = BUILTIN[t.id];
    if (!b || t.id === 'default') return null;
    return { accent: b.accent, mono: !!b.mono, title: b.title, icon: 'data:image/svg+xml,' + encodeURIComponent(b.svg) };
  }
  function css(r) {
    var p = r && r.accent ? palettes(r.accent, r.mono) : null;
    if (!p) return '';
    return ':root:root{' + decl(p.light) + '}@media (prefers-color-scheme:dark){:root:root:not([data-theme="light"]){' + decl(p.dark) + '}}:root:root[data-theme="dark"]{' + decl(p.dark) + '}';
  }
  var cur = null;
  function paintBrand() {
    var im = document.querySelector('.brand img');
    if (im) { if (!im.getAttribute('data-def')) im.setAttribute('data-def', im.getAttribute('src')); im.setAttribute('src', cur && cur.icon ? cur.icon : im.getAttribute('data-def')); }
    var sp = document.querySelector('.brand span');
    if (sp && sp.firstChild && sp.firstChild.nodeType === 3) sp.firstChild.nodeValue = cur && cur.title ? cur.title : 'Beta';
  }
  function apply(t) {
    cur = resolve(t);
    var st = document.getElementById('inst-theme');
    if (!st) { st = document.createElement('style'); st.id = 'inst-theme'; document.head.appendChild(st); }
    st.textContent = css(cur);
    var link = document.querySelector('link[rel="icon"]');
    if (link) {
      if (!link.getAttribute('data-def')) link.setAttribute('data-def', link.getAttribute('href') + '|' + (link.getAttribute('type') || ''));
      var d = link.getAttribute('data-def').split('|');
      var next = document.createElement('link');
      next.rel = 'icon';
      if (cur && cur.icon) { next.href = cur.icon; if (cur.icon.indexOf('data:image/svg') === 0) next.type = 'image/svg+xml'; }
      else { next.href = d[0]; if (d[1]) next.type = d[1]; next.sizes = '64x64'; }
      next.setAttribute('data-def', link.getAttribute('data-def'));
      link.replaceWith(next);
    }
    paintBrand();
    return cur;
  }
  window.BetaTheme = { BUILTIN: BUILTIN, resolve: resolve, apply: apply, paintBrand: paintBrand, title: function () { return cur && cur.title ? cur.title : null; }, emoji: emojiIcon };
  var saved = null;
  try { saved = JSON.parse(localStorage.getItem('beta_inst_theme') || 'null'); } catch (e) {}
  if (saved) apply(saved);
  document.addEventListener('DOMContentLoaded', paintBrand);
})();
