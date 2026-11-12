// KdLite: loads the Keydown engine only when a page needs it, and draws Keydown text as safe, inert DOM.
// Keydown's own output already escapes raw HTML; this strips anything risky from it again, just in case.
(() => {
  'use strict';
  let loading = null;
  const load = () => {
    if (window.Keydown) return Promise.resolve(window.Keydown);
    if (loading) return loading;
    loading = new Promise((ok, no) => {
      window.__KeydownNoAuto = true; // we draw things ourselves; do not let it scan the whole page
      const s = document.createElement('script');
      s.src = '/Keydown.js?v=3';
      s.onload = () => (window.Keydown ? ok(window.Keydown) : no(new Error('Keydown did not start!')));
      s.onerror = () => {
        loading = null;
        no(new Error('Could not load Keydown. Check your connection and try again!'));
      };
      document.head.append(s);
    });
    return loading;
  };

  const BAD = new Set(['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'link', 'meta', 'style', 'base', 'form', 'template', 'noscript', 'applet', 'portal', 'foreignobject', 'audio', 'video', 'source', 'track']);
  const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'poster', 'data', 'srcset']);
  const okUrl = (v) => {
    const t = String(v).replace(/[\u0000- ]+/g, '');
    return !/^[a-z][a-z0-9+.-]*:/i.test(t) || /^(https?:|mailto:|data:image\/(png|jpe?g|gif|webp);base64,)/i.test(t);
  };
  function clean(node) {
    for (const el of [...node.children]) {
      const tag = el.localName.toLowerCase();
      if (BAD.has(tag) || (tag === 'input' && el.getAttribute('type') !== 'checkbox')) {
        el.remove();
        continue;
      }
      for (const a of [...el.attributes]) {
        const n = a.name.toLowerCase();
        if (n.startsWith('on') || n === 'srcdoc' || n === 'formaction' || n === 'contenteditable') el.removeAttribute(a.name);
        else if (URL_ATTRS.has(n) && !okUrl(a.value)) el.removeAttribute(a.name);
        else if (n === 'style' && /expression\s*\(|javascript:|@import|url\s*\(\s*["']?\s*(?!data:)/i.test(a.value)) el.removeAttribute(a.name);
      }
      if (tag === 'a' && el.hasAttribute('href')) {
        el.setAttribute('rel', 'noopener noreferrer nofollow');
        if (/^https?:/i.test(el.getAttribute('href'))) el.setAttribute('target', '_blank');
      }
      if (tag === 'input') el.setAttribute('disabled', '');
      clean(el);
    }
  }


  // ---------- adaptive text colors ----------
  // Keydown chips and highlights have bright or dark backgrounds, but plain text inherits the page's text color (light on a dark page,
  // dark on a light one). Wherever that makes the text hard to read, this picks dark or light text from what is behind it.
  const NUM = '([\\d.]+)';
  const RGB = new RegExp('rgba?\\(\\s*' + NUM + '[ ,]+' + NUM + '[ ,]+' + NUM + '(?:[ ,/]+' + NUM + '(%?))?\\s*\\)', 'g');
  const SRGB = new RegExp('color\\(srgb\\s+' + NUM + '\\s+' + NUM + '\\s+' + NUM + '(?:\\s*/\\s*' + NUM + '(%?))?\\)', 'g');
  const colorsIn = (str) => {
    const out = [];
    for (const m of str.matchAll(RGB)) out.push([+m[1], +m[2], +m[3], m[4] === undefined ? 1 : m[5] ? +m[4] / 100 : +m[4]]);
    for (const m of str.matchAll(SRGB)) out.push([+m[1] * 255, +m[2] * 255, +m[3] * 255, m[4] === undefined ? 1 : m[5] ? +m[4] / 100 : +m[4]]);
    return out;
  };
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const over = (top, under) => { const a = top[3]; return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1]; };
  // what an element paints behind its own text: its background color, with the average of its gradients on top
  const layerOf = (cs) => {
    const bc = colorsIn(cs.backgroundColor)[0];
    // sparkles, dots and stripes are made with radial gradients on top of a main linear one, so the linear one says what the color is
    const gradients = (str) => {
      const found = [];
      const re = /(?:repeating-)?(linear|radial|conic)-gradient\(/g;
      let m;
      while ((m = re.exec(str))) {
        let d = 1, i = re.lastIndex;
        while (i < str.length && d) { d += (str[i] === '(') - (str[i] === ')'); i++; }
        found.push([m[1], str.slice(m.index, i)]);
        re.lastIndex = i;
      }
      return found;
    };
    const layers = cs.backgroundImage && cs.backgroundImage !== 'none' ? gradients(cs.backgroundImage) : [];
    const mainLayers = layers.some((g) => g[0] === 'linear') ? layers.filter((g) => g[0] === 'linear') : layers;
    const gs = colorsIn(mainLayers.map((g) => g[1]).join(',')).filter((c) => c[3] > 0.02);
    let layer = bc && bc[3] > 0 ? bc : null;
    if (gs.length) {
      // the average of the gradient's colors, each counted by how solid it is
      const w = gs.reduce((t, c) => t + c[3], 0);
      const avg = [0, 1, 2].map((i) => gs.reduce((t, c) => t + c[i] * c[3], 0) / w);
      avg.push(gs.some((c) => c[3] >= 0.95) ? 1 : Math.min(1, w / gs.length));
      layer = layer ? over(avg, over(layer, [255, 255, 255, 1])) : avg;
    }
    return layer;
  };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const DARK = [15, 23, 42, 1];
  const LIGHT = [248, 250, 252, 1];
  function adapt(root) {
    root.querySelectorAll('[data-kd-fix]').forEach((e) => { e.style.removeProperty('color'); e.removeAttribute('data-kd-fix'); });
    const page = colorsIn(getComputedStyle(document.body).backgroundColor)[0] || [255, 255, 255, 1];
    const base = page[3] ? [page[0], page[1], page[2], 1] : [255, 255, 255, 1];
    const backdrop = (el) => {
      const chain = [];
      for (let n = el; n && n !== root.parentNode && n !== document.body; n = n.parentElement) chain.unshift(n);
      let c = base;
      for (const n of chain) { const l = layerOf(getComputedStyle(n)); if (l) c = over(l, c); }
      return c;
    };
    for (const el of root.querySelectorAll('*')) {
      let hasText = false;
      for (const n of el.childNodes) if (n.nodeType === 3 && n.data.trim()) { hasText = true; break; }
      if (!hasText) continue;
      const fg = colorsIn(getComputedStyle(el).color)[0];
      if (!fg) continue;
      const bg = backdrop(el);
      const cs = getComputedStyle(el);
      const size = parseFloat(cs.fontSize) || 16;
      const large = size >= 24 || (size >= 18.66 && parseInt(cs.fontWeight, 10) >= 700);
      if (contrast(fg, bg) >= (large ? 3 : 4.5)) continue;
      const best = contrast(DARK, bg) >= contrast(LIGHT, bg) ? DARK : LIGHT;
      el.style.setProperty('color', 'rgb(' + best[0] + ',' + best[1] + ',' + best[2] + ')', 'important');
      el.setAttribute('data-kd-fix', '');
    }
  }
  // fix the colors again when the page changes between light and dark
  const rescan = () => document.querySelectorAll('.kd-out, .kdvisual').forEach((e) => { try { adapt(e); } catch (err) {} });
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => setTimeout(rescan, 60)); } catch (e) {}
  window.addEventListener('kd-recolor', () => setTimeout(rescan, 60));
  // for the live editor: look again a moment after the text changes
  function watch(el) {
    let t = 0;
    new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => adapt(el), 250); }).observe(el, { childList: true, subtree: true, characterData: true });
  }

  // Keydown text in, a safe <div class="kd-out"> out. Waits for the engine to load first.
  async function render(text) {
    const K = await load();
    const doc = new DOMParser().parseFromString('<!doctype html><body>' + K.render(String(text)), 'text/html');
    clean(doc.body);
    const out = document.createElement('div');
    out.className = 'kd-out';
    out.append(...doc.body.childNodes);
    // colors need a real page to be worked out, so it is set up out of sight for a moment
    const stage = document.createElement('div');
    stage.style.cssText = 'position:absolute;left:-99999px;top:0;width:720px;visibility:hidden';
    document.body.append(stage);
    stage.append(out);
    try { adapt(out); } catch (e) {}
    out.remove();
    stage.remove();
    return out;
  }
  window.KdLite = { load, render, clean, adapt, watch };
})();
