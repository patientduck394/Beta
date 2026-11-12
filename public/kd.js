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

  // Keydown text in, a safe <div class="kd-out"> out. Waits for the engine to load first.
  async function render(text) {
    const K = await load();
    const doc = new DOMParser().parseFromString('<!doctype html><body>' + K.render(String(text)), 'text/html');
    clean(doc.body);
    const out = document.createElement('div');
    out.className = 'kd-out';
    out.append(...doc.body.childNodes);
    return out;
  }
  window.KdLite = { load, render, clean };
})();
