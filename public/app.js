// Beta website. One small script, no libraries. Every piece of text goes in with textContent (never innerHTML),
// so nothing typed by a user can run as code.
(() => {
  'use strict';
  const app = document.getElementById('app');
  const side = document.getElementById('side');
  const put = (el, ...kids) => el.replaceChildren(...kids.flat(9).filter(Boolean));
  const show = (...kids) => put(app, ...kids);
  let me = null;
  let tick = 0;
  let timers = [];

  // ---------- small helpers ----------
  const h = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') e[k] = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(9)) {
      if (kid == null || kid === false) continue;
      e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return e;
  };
  const enc = encodeURIComponent;
  async function api(path, opts = {}) {
    const res = await fetch('/api' + path, {
      method: opts.method || 'GET',
      headers: { ...(opts.body && !opts.raw ? { 'content-type': 'application/json' } : {}), ...(opts.headers || {}) },
      body: opts.body ? (opts.raw ? opts.body : JSON.stringify(opts.body)) : undefined,
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Something went wrong! (the server said ' + res.status + ' for ' + path.split('?')[0] + ')');
      err.status = res.status;
      throw err;
    }
    return data;
  }
  let toastTimer;
  const toast = (msg) => {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
  };
  const ago = (t) => {
    const s = Math.max(1, Math.round((Date.now() - t) / 1000));
    if (s < 60) return 'now';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    if (s < 86400 * 30) return Math.floor(s / 86400) + 'd';
    return new Date(t).toLocaleDateString();
  };
  const until = (t) => {
    const s = Math.round((t - Date.now()) / 1000);
    if (s < 60) return 'less than a minute left';
    if (s < 3600) return Math.floor(s / 60) + ' minutes left';
    if (s < 86400) return Math.floor(s / 3600) + ' hours left';
    return Math.floor(s / 86400) + ' days left';
  };
  const bytes = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
  const go = (url, replace) => {
    history[replace ? 'replaceState' : 'pushState'](null, '', url);
    render();
  };
  const link = (href, ...kids) => h('a', { href, 'data-link': true }, ...kids);
  const params = () => new URLSearchParams(location.search);
  const setTitle = (t) => (document.title = t ? t + ' · Beta' : 'Beta');
  const errBox = () => h('div', { class: 'err', role: 'alert' });
  const guard = (box, fn) => async (e) => {
    e && e.preventDefault && e.preventDefault();
    box.textContent = '';
    try {
      await fn();
    } catch (err) {
      box.textContent = err.message;
    }
  };
  const safe = (fn) => (...a) => Promise.resolve(fn(...a)).catch((e) => toast(e.message));
  const nameOf = (u) => u.display_name || u.username;
  const avatar = (u, big) => (u.avatar
    ? h('img', { class: 'av img' + (big ? ' big' : ''), src: '/api/files/' + u.avatar, alt: '', loading: 'lazy' })
    : h('span', { class: 'av c-' + (u.color || 'lime') + (big ? ' big' : ''), 'aria-hidden': 'true' }, (nameOf(u)[0] || '?').toUpperCase()));
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) {} },
  };

  // ---------- little drawings ----------
  // icons come from Vadivam (MIT, https://github.com/praveenjuge/vadivam) in vadivam-icons.js; add the class "solid" for the filled version
  const NS = 'http://www.w3.org/2000/svg';
  const icon = (name, cls) => {
    const spec = (window.__VADIVAM || {})[name];
    const filled = !!(spec && spec.s && cls && /(^| )solid( |$)/.test(cls));
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('class', ('ic' + (cls ? ' ' + cls : '')).split(' ').filter((c) => c !== 'solid' || filled).join(' '));
    s.setAttribute('aria-hidden', 'true');
    if (!spec) return s;
    for (const [tag, attrs] of filled ? spec.s : spec.o) {
      const el = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      s.append(el);
    }
    return s;
  };

  // ---------- text: #topics, @names, and Keydown formatting (only fetched when a post looks like it uses some) ----------
  const RICH = /(https?:\/\/[^\s<>"']+)|(?<![A-Za-z0-9_#&@\/.])([#@])([A-Za-z][A-Za-z0-9_-]{1,29})(?![A-Za-z0-9_])/g;
  function rich(text) {
    const out = [];
    let last = 0;
    for (const m of text.matchAll(RICH)) {
      if (m[1]) {
        const url = m[1].replace(/[.,;:!?)\]}]+$/, '');
        out.push(text.slice(last, m.index));
        out.push(h('a', { href: url, target: '_blank', rel: 'noopener noreferrer nofollow ugc' }, url.length > 48 ? url.slice(0, 45) + '...' : url));
        last = m.index + url.length;
        continue;
      }
      if (m[2] === '@' && m[3].length < 3) continue;
      out.push(text.slice(last, m.index));
      out.push(link(m[2] === '#' ? '/topic/' + enc(m[3].toLowerCase()) : '/u/' + enc(m[3]), m[2] + m[3]));
      last = m.index + 1 + m[3].length;
    }
    out.push(text.slice(last));
    return out;
  }
  const KD_HINT = /\*\S|__|~\S|=[A-Za-z]=|`|#[A-Za-z0-9]{1,12}#|@@|::|^\s*#{1,6}\s|^\s*>|^\s*[-+]\s|\[[A-Z]\]/m;
  const looksKd = (t) => KD_HINT.test(t);
  function linkify(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement && n.parentElement.closest('a, code, pre') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((n) => {
      if (!/[#@]/.test(n.data)) return;
      n.replaceWith(...rich(n.data).map((x) => (typeof x === 'string' ? document.createTextNode(x) : x)));
    });
  }
  function bodyEl(text) {
    const el = h('div', { class: 'body' }, rich(text));
    if (looksKd(text)) {
      window.KdLite.render(text).then((out) => {
        linkify(out);
        el.className = 'body kd';
        el.replaceChildren(out);
      }).catch(() => {});
    }
    return el;
  }

  // ---------- the top bar and the side column ----------
  function drawNav() {
    const nav = document.getElementById('nav');
    nav.replaceChildren();
    const badge = (n) => (n ? h('span', { class: 'badge' }, n > 99 ? '99+' : n) : null);
    if (me) {
      const menu = h('details', { class: 'menu navmenu' }, h('summary', { class: 'navbtn', 'aria-label': 'More' }, icon('more')),
        h('div', { class: 'pop right' },
          h('a', { href: '/bookmarks', 'data-link': true }, 'Saved posts'),
          h('a', { href: '/lists', 'data-link': true }, 'Lists'),
          h('a', { href: '/settings', 'data-link': true }, 'Settings'),
          me.admin ? h('a', { href: '/admin', 'data-link': true }, 'Admin') : null,
          h('button', { type: 'button', onclick: () => shortcuts() }, 'Keyboard shortcuts'),
          h('button', { type: 'button', onclick: safe(async () => { await api('/logout', { method: 'POST' }); me = null; drawNav(); go('/'); }) }, 'Log out')));
      nav.append(
        h('a', { class: 'navbtn', href: '/outlets', 'data-link': true, title: 'Outlets (g then o)', 'aria-label': 'Outlets' }, icon('forum')),
        h('a', { class: 'navbtn', href: '/explore', 'data-link': true, title: 'Explore (g then e)', 'aria-label': 'Explore' }, icon('explore')),
        h('a', { class: 'navbtn', href: '/messages', 'data-link': true, title: 'Messages (g then m)', 'aria-label': 'Messages' }, icon('mail'), badge(me.dmUnread)),
        h('a', { class: 'navbtn', href: '/notifications', 'data-link': true, title: 'Notifications (g then n)', 'aria-label': 'Notifications' }, icon('bell'), badge(me.unread)),
        h('a', { class: 'navuser', href: '/u/' + enc(me.username), 'data-link': true, title: 'Your profile' }, avatar(me), h('span', { class: 'navname' }, nameOf(me))),
        menu);
    } else nav.append(h('a', { class: 'navbtn', href: '/outlets', 'data-link': true, title: 'Outlets', 'aria-label': 'Outlets' }, icon('forum')), h('a', { class: 'navbtn', href: '/explore', 'data-link': true, title: 'Explore', 'aria-label': 'Explore' }, icon('explore')), h('a', { class: 'btn ghost small', href: '/login', 'data-link': true }, 'Log in'), h('a', { class: 'btn small', href: '/register', 'data-link': true }, 'Sign up'));
  }
  async function refreshUnread() {
    if (!me) return;
    try {
      const r = await api('/notifications/count');
      if (r.unread !== me.unread || r.dmUnread !== me.dmUnread) {
        me.unread = r.unread;
        me.dmUnread = r.dmUnread;
        drawNav();
      }
    } catch (e) {}
  }

  const followBtn = (u, small) => {
    const b = h('button', { class: 'btn' + (small ? ' small' : '') });
    const paint = () => {
      b.textContent = u.isFollowing ? 'Following' : 'Follow';
      b.className = 'btn' + (small ? ' small' : '') + (u.isFollowing ? ' on' : '');
    };
    b.addEventListener('click', safe(async () => {
      if (!me) return go('/login');
      const r = await api('/users/' + enc(u.username) + '/follow', { method: 'POST' });
      u.isFollowing = r.following;
      if (u.followers !== undefined) u.followers += r.following ? 1 : -1;
      paint();
      if (u.onChange) u.onChange();
    }));
    paint();
    return b;
  };
  const userRow = (u) => h('li', { class: 'urow' }, avatar(u), h('div', { class: 'ut' }, h('a', { class: 'who', href: '/u/' + enc(u.username), 'data-link': true }, nameOf(u)), h('div', { class: 'muted small' }, '@' + u.username + (u.bio ? ' · ' + u.bio : ''))), me && me.username !== u.username && u.isFollowing !== undefined ? followBtn(u, true) : null);

  async function drawSide() {
    try {
      const [t, s, ol] = await Promise.all([api('/topics'), api('/suggest'), me ? api('/outlets/mine') : api('/outlets?limit=5')]);
      const outletsCard = me
        ? h('nav', { class: 'card side osb', 'aria-label': 'Your Outlets' }, h('h2', null, link('/outlets', 'Outlets')),
            ol.outlets.length ? ol.outlets.map((o) => h('details', { class: 'osub' }, h('summary', null, outletBadge(o), h('span', { class: 'oname2' }, o.name)),
              h('ul', null, h('li', null, link(outletPath(o.slug), 'All of ' + o.name)), o.subjects.map((sj) => h('li', null, link(outletPath(o.slug, sj.slug), '# ' + sj.name)))))) : h('p', { class: 'muted small' }, 'You have not joined any Outlets yet.'),
            h('p', { class: 'small' }, link('/outlets', 'Browse every Outlet'), ' · ', link('/outlets/new', 'Make one')))
        : h('nav', { class: 'card side osb', 'aria-label': 'Popular Outlets' }, h('h2', null, link('/outlets', 'Outlets')), ol.outlets.length ? h('ul', { class: 'olist' }, ol.outlets.map((o) => h('li', null, outletBadge(o), link(outletPath(o.slug), o.name), h('span', { class: 'muted small' }, o.members + ' members')))) : h('p', { class: 'muted small' }, 'No Outlets yet.'));
      put(side,
        outletsCard,
        h('div', { class: 'card side' }, h('h2', null, 'Trending Topics'),
          t.topics.length ? h('ol', null, t.topics.map((x) => h('li', null, link('/topic/' + enc(x.topic), h('span', { class: 'tn' }, '#' + x.topic)), h('span', { class: 'muted small' }, x.n + (x.n === 1 ? ' post' : ' posts')))))
            : h('p', { class: 'muted' }, 'No Topics yet. Add a #hashtag to a post to start one!')),
        s.users.length ? h('div', { class: 'card side' }, h('h2', null, 'Who to follow'), h('ul', { class: 'ulist' }, s.users.map((u) => userRow({ ...u, isFollowing: false })))) : null,
        h('p', { class: 'muted small foot' }, 'Press ', h('kbd', null, '?'), ' for keyboard shortcuts')
      );
    } catch (e) {
      side.replaceChildren();
    }
  }

  // ---------- pictures: shrink them before sending, so they are quick to upload and kind to storage ----------
  async function prepImage(file) {
    if (file.type === 'image/gif') return file;
    if (!/^image\/(png|jpeg|webp|bmp)$/.test(file.type)) return file;
    const url = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(file); });
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
    const max = 1600;
    const k = Math.min(1, max / Math.max(img.width, img.height));
    if (k === 1 && file.size <= 1.5 * 1048576) return file;
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k);
    c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const toBlob = (type, q) => new Promise((ok) => c.toBlob(ok, type, q));
    for (const q of [0.88, 0.75, 0.6, 0.45]) {
      let b = await toBlob('image/webp', q);
      if (!b || b.type !== 'image/webp') b = await toBlob('image/jpeg', q);
      if (b && b.size <= 1.9 * 1048576) return new File([b], file.name.replace(/\.\w+$/, '') + (b.type === 'image/webp' ? '.webp' : '.jpg'), { type: b.type });
    }
    return file;
  }
  const readDataUrl = (file) => new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => ok(''); r.readAsDataURL(file); });

  function lightbox(list, start) {
    let i = start;
    const img = h('img', { alt: '' });
    const cap = h('div', { class: 'lbcap' });
    const close = () => { box.remove(); document.removeEventListener('keydown', onKey, true); };
    const paint = () => { img.src = '/api/files/' + list[i].id; img.alt = list[i].alt || ''; cap.textContent = list[i].alt || ''; };
    const step = (d) => { i = (i + d + list.length) % list.length; paint(); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      else if (e.key === 'ArrowRight' && list.length > 1) step(1);
      else if (e.key === 'ArrowLeft' && list.length > 1) step(-1);
    };
    const box = h('div', { class: 'lightbox', role: 'dialog', 'aria-label': 'Picture', onclick: (e) => { if (e.target === box) close(); } },
      h('button', { class: 'lbx', 'aria-label': 'Close', onclick: close }, icon('x')), list.length > 1 ? h('button', { class: 'lbn prev', 'aria-label': 'Previous', onclick: () => step(-1) }, '‹') : null, img, list.length > 1 ? h('button', { class: 'lbn next', 'aria-label': 'Next', onclick: () => step(1) }, '›') : null, cap);
    paint();
    document.body.append(box);
    document.addEventListener('keydown', onKey, true);
  }

  // ---------- one post ----------
  function filesView(x) {
    const imgs = x.files.filter((f) => f.image);
    const others = x.files.filter((f) => !f.image);
    return h('div', { class: 'attach' },
      imgs.length ? h('div', { class: 'media n' + imgs.length }, imgs.map((f, i) => h('button', { class: 'thumb', type: 'button', 'aria-label': f.alt ? 'Open picture: ' + f.alt : 'Open picture', onclick: () => lightbox(imgs, i) }, h('img', { src: '/api/files/' + f.id, alt: f.alt || '', loading: 'lazy' })))) : null,
      others.map((f) => h('a', { class: 'filechip', href: '/api/files/' + f.id, download: f.name }, icon('file'), h('span', { class: 'fn' }, f.name), h('span', { class: 'muted small' }, bytes(f.size)))));
  }

  function pollView(x, redraw) {
    const poll = x.poll;
    const canVote = me && !poll.ended && poll.myVote === null;
    const results = !canVote;
    return h('div', { class: 'poll' },
      poll.options.map((o, i) => {
        const pct = poll.total ? Math.round((o.votes * 100) / poll.total) : 0;
        if (!results) return h('button', { class: 'pollopt', type: 'button', onclick: safe(async () => { const r = await api('/posts/' + x.id + '/vote', { method: 'POST', body: { option: i } }); Object.assign(x, r.post); redraw(); }) }, o.label);
        const bar = h('div', { class: 'pollbar' + (poll.myVote === i ? ' mine' : '') });
        bar.style.setProperty('--pct', pct + '%');
        return h('div', { class: 'pollres' }, bar, h('span', { class: 'pl' }, o.label + (poll.myVote === i ? ' ✓' : '')), h('span', { class: 'pp' }, pct + '%'));
      }),
      h('div', { class: 'muted small' }, poll.total + (poll.total === 1 ? ' vote' : ' votes') + ' · ' + (poll.ended ? 'Final results' : until(poll.ends)), !me && !poll.ended ? [' · ', link('/login', 'Log in to vote')] : null));
  }

  function build(p, opts, redraw, wrap) {
    const rp = p.kind === 'repost' ? p : null;
    const x = rp ? rp.target : p;
    const ol = x.outlet;
    const mineP = me && me.username.toLowerCase() === x.username.toLowerCase();
    const canEdit = mineP && !rp && Date.now() - x.created < 15 * 60 * 1000;
    const gone = () => { wrap.remove(); if (opts.onDelete) opts.onDelete(wrap); };
    const bodyHolder = h('div');
    const showBody = () => put(bodyHolder, x.body ? bodyEl(x.body) : null);
    showBody();
    // a content warning hides the post until you ask to see it
    const hidden = !!x.cw && !(opts.revealed && opts.revealed.has(x.id));

    const startEdit = () => {
      if (hidden) { (opts.revealed = opts.revealed || new Set()).add(x.id); redraw(); toast('Press Edit again!'); return; }
      const area = h('textarea', { 'aria-label': 'Edit your post', value: x.body });
      const cwIn = h('input', { placeholder: 'Content warning (optional)', maxlength: 80, value: x.cw || '', 'aria-label': 'Content warning' });
      const err = errBox();
      const count = h('span', { class: 'count' });
      const upd = () => { const left = 300 - [...area.value].length; count.textContent = String(left); count.className = 'count' + (left < 0 ? ' over' : ''); };
      area.addEventListener('input', upd);
      upd();
      bodyHolder.replaceChildren(h('div', { class: 'editbox' }, area, cwIn, h('div', { class: 'row' }, count, h('span', null,
        h('button', { class: 'btn ghost small', type: 'button', onclick: showBody }, 'Cancel'), ' ',
        h('button', { class: 'btn small', type: 'button', onclick: guard(err, async () => { const r = await api('/posts/' + x.id, { method: 'PATCH', body: { body: area.value, cw: cwIn.value } }); Object.assign(x, r.post); redraw(); toast('Saved!'); }) }, 'Save'))), err));
      area.focus();
    };

    const likeBtn = h('button', { class: 'act' + (x.liked ? ' liked' : ''), type: 'button', 'aria-pressed': String(x.liked), 'aria-label': 'Like', onclick: safe(async () => {
      if (!me) return go('/login');
      const r = await api('/posts/' + x.id + '/like', { method: 'POST' });
      x.liked = r.liked; x.likes = r.likes; redraw();
    }) }, icon('heart', x.liked ? 'solid' : ''), x.likes || '');
    const bmBtn = h('button', { class: 'act' + (x.bookmarked ? ' on' : ''), type: 'button', 'aria-pressed': String(x.bookmarked), 'aria-label': 'Save for later', title: 'Save for later', onclick: safe(async () => {
      if (!me) return go('/login');
      const r = await api('/posts/' + x.id + '/bookmark', { method: 'POST' });
      x.bookmarked = r.bookmarked; redraw();
      if (opts.onUnsave && !r.bookmarked) { wrap.remove(); opts.onUnsave(); }
    }) }, icon('bookmark', x.bookmarked ? 'solid' : ''));
    const canRepost = !x.parent_id;
    const closeMenu = (btn) => { const d = btn.closest('details'); if (d) d.removeAttribute('open'); };
    const repostMenu = canRepost ? h('details', { class: 'menu' }, h('summary', { class: 'act' + (x.reposted ? ' on' : ''), 'aria-label': 'Repost or quote' }, icon('repost'), (x.reposts + x.quotes) || ''),
      h('div', { class: 'pop' },
        h('button', { type: 'button', onclick: safe(async (e) => { closeMenu(e.currentTarget); if (!me) return go('/login'); const r = await api('/posts/' + x.id + '/repost', { method: 'POST' }); x.reposted = r.reposted; x.reposts = r.reposts; redraw(); toast(r.reposted ? 'Reposted!' : 'Repost removed!'); }) }, x.reposted ? 'Undo repost' : 'Repost'),
        h('button', { type: 'button', onclick: (e) => { closeMenu(e.currentTarget); if (!me) return go('/login'); quoteDialog(x); } }, 'Quote'))) : null;
    const shareBtn = h('button', { class: 'act', type: 'button', 'aria-label': 'Share', title: 'Share', onclick: async () => {
      const u = location.origin + '/post/' + x.id;
      if (navigator.share) { try { await navigator.share({ title: nameOf(x) + ' on Beta', url: u }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
      try { await navigator.clipboard.writeText(u); toast('Link copied!'); } catch (e) { toast('Copy it from the address bar after opening the post!'); }
    } }, icon('share'));
    const act = (fn) => safe(async (e) => { closeMenu(e.currentTarget); await fn(); });
    const items = [];
    if (mineP) {
      if (canEdit) items.push(h('button', { type: 'button', onclick: (e) => { closeMenu(e.currentTarget); startEdit(); } }, 'Edit (first 15 minutes)'));
      if (!x.parent_id && !rp) items.push(h('button', { type: 'button', onclick: act(async () => { const r = await api('/posts/' + x.id + '/pin', { method: 'POST' }); toast(r.pinned ? 'Pinned to your profile!' : 'Unpinned!'); }) }, 'Pin to profile / unpin'));
      items.push(h('button', { type: 'button', class: 'danger', onclick: act(async () => { if (!confirm('Delete this post?')) return; await api('/posts/' + x.id, { method: 'DELETE' }); toast('Deleted!'); gone(); }) }, 'Delete'));
    } else {
      items.push(
        h('button', { type: 'button', onclick: act(async () => { if (!me) return go('/login'); const r = await api('/users/' + enc(x.username) + '/mute', { method: 'POST' }); toast(r.muted ? 'Muted @' + x.username + '. You will not see their posts in feeds!' : 'Unmuted!'); }) }, 'Mute @' + x.username),
        h('button', { type: 'button', onclick: act(async () => { if (!me) return go('/login'); if (!confirm('Block @' + x.username + '? They will not be able to follow, reply to or like your posts.')) return; const r = await api('/users/' + enc(x.username) + '/block', { method: 'POST' }); toast(r.blocked ? 'Blocked!' : 'Unblocked!'); }) }, 'Block @' + x.username),
        h('button', { type: 'button', onclick: act(async () => { if (!me) return go('/login'); const reason = prompt('What is wrong with this post? (a few words)'); if (reason === null) return; await api('/posts/' + x.id + '/report', { method: 'POST', body: { reason } }); toast('Thanks, we will take a look!'); }) }, 'Report'));
    }
    if (x.likes) items.unshift(h('button', { type: 'button', onclick: act(async () => { const r = await api('/posts/' + x.id + '/likes'); peopleDialog('Liked by', r.users); }) }, 'See who liked'));
    if (me && !mineP) items.push(h('button', { type: 'button', onclick: act(async () => { listPicker(x.username); }) }, 'Add @' + x.username + ' to a list'));
    // Outlet moderators
    const modSlug = ol && ol.canMod ? ol.slug : opts.modOutlet;
    if (modSlug) {
      const base = '/outlets/' + enc(modSlug) + '/posts/' + x.id;
      if (ol && !x.parent_id) {
        items.push(h('button', { type: 'button', onclick: act(async () => { const r = await api(base + (ol.pinned ? '/unpin' : '/pin'), { method: 'POST' }); ol.pinned = r.pinned; redraw(); toast(r.pinned ? 'Pinned in the Outlet!' : 'Unpinned!'); }) }, ol.pinned ? 'Unpin from the Outlet' : 'Pin to the Outlet'));
        items.push(h('button', { type: 'button', onclick: act(async () => { const r = await api(base + (ol.locked ? '/unlock' : '/lock'), { method: 'POST' }); ol.locked = r.locked; redraw(); toast(r.locked ? 'Locked: only moderators can reply!' : 'Unlocked!'); }) }, ol.locked ? 'Unlock replies' : 'Lock replies'));
        items.push(h('button', { type: 'button', onclick: act(async () => { await moveDialog(modSlug, x, () => render()); }) }, 'Move to a Subject'));
      }
      if (!mineP) items.push(h('button', { type: 'button', class: 'danger', onclick: act(async () => { if (!confirm('Remove this ' + (x.parent_id ? 'reply' : 'post and its replies') + ' as a moderator?')) return; await api(base, { method: 'DELETE' }); toast('Removed!'); gone(); }) }, 'Remove (moderator)'));
    }
    const moreMenu = h('details', { class: 'menu' }, h('summary', { class: 'act', 'aria-label': 'More' }, icon('more')), h('div', { class: 'pop right' }, items));

    const quoteEl = x.quote ? h('a', { class: 'quote', href: '/post/' + x.quote.id, 'data-link': true }, h('div', { class: 'ph' }, avatar(x.quote, false), h('span', { class: 'who' }, nameOf(x.quote)), h('span', { class: 'muted small' }, '@' + x.quote.username + ' · ' + ago(x.quote.created))), h('div', { class: 'qbody' }, x.quote.body.slice(0, 200)), x.quote.files && x.quote.files[0] && x.quote.files[0].image ? h('img', { class: 'qimg', src: '/api/files/' + x.quote.files[0].id, alt: x.quote.files[0].alt || '', loading: 'lazy' }) : null)
      : x.quoteGone ? h('div', { class: 'quote gone muted small' }, 'This post was deleted.') : null;

    const outletChip = ol && !opts.hideOutlet ? h('a', { class: 'ochip c-' + ol.color, href: outletPath(ol.slug, ol.subject), 'data-link': true }, icon('forum'), ol.name + (ol.subject_name ? ' \u203A ' + ol.subject_name : '')) : null;
    const warn = hidden ? h('div', { class: 'cwbox' }, icon('warn'), h('b', null, x.cw), h('button', { class: 'btn ghost small', type: 'button', onclick: () => { (opts.revealed = opts.revealed || new Set()).add(x.id); redraw(); } }, 'Show')) : (x.cw ? h('div', { class: 'cwnote muted small' }, icon('warn'), x.cw) : null);
    const article = h('article', { class: 'post' + (opts.focus ? ' focus' : '') },
      avatar(x),
      h('div', { class: 'pb' },
        h('div', { class: 'ph' }, h('a', { class: 'who', href: '/u/' + enc(x.username), 'data-link': true }, nameOf(x)), h('span', { class: 'muted small' }, '@' + x.username), h('a', { class: 'when', href: '/post/' + x.id, 'data-link': true }, ago(x.created)), x.edited ? h('span', { class: 'muted small', title: 'Edited ' + new Date(x.edited).toLocaleString() }, '· edited') : null, opts.pinned || (ol && ol.pinned) ? h('span', { class: 'pinned' }, icon('pin', 'solid'), 'Pinned') : null, ol && ol.locked ? h('span', { class: 'pinned' }, icon('lock'), 'Locked') : null),
        outletChip,
        warn,
        hidden ? null : bodyHolder,
        hidden ? null : (x.files.length ? filesView(x) : null),
        hidden ? null : (x.poll ? pollView(x, redraw) : null),
        hidden ? null : quoteEl,
        h('div', { class: 'acts' },
          opts.noReplyLink ? null : h('a', { class: 'act', href: '/post/' + x.id, 'data-link': true, 'aria-label': 'Replies' }, icon('comment'), x.replies || ''),
          repostMenu, likeBtn, bmBtn, shareBtn, moreMenu)));
    return [rp ? h('div', { class: 'reposthead' }, icon('repost'), link('/u/' + enc(rp.username), nameOf(rp)), ' reposted') : null, article];
  }
  function postCard(p, opts = {}) {
    const wrap = h('div', { class: 'postwrap' });
    const redraw = () => wrap.replaceChildren(...build(p, opts, redraw, wrap).filter(Boolean));
    redraw();
    return wrap;
  }
  function quoteDialog(post) {
    const box = h('div', { class: 'modal', role: 'dialog', 'aria-label': 'Quote this post', onclick: (e) => { if (e.target === box) box.remove(); } },
      h('div', { class: 'card sheet' }, h('div', { class: 'row' }, h('h2', null, 'Quote'), h('button', { class: 'btn ghost small', type: 'button', onclick: () => box.remove() }, 'Close')),
        composer({ quote: post, placeholder: 'Add your thoughts...', button: 'Post', draftKey: 'quote', noPoll: true, onPosted: () => { box.remove(); toast('Posted!'); if (location.pathname === '/') render(); } })));
    document.body.append(box);
    const t = box.querySelector('textarea');
    if (t) t.focus();
  }

  // ---------- writing a post ----------
  function composer(opts = {}) {
    const dkey = 'beta_draft_' + (opts.draftKey || (opts.parent ? 'reply' + opts.parent : 'main'));
    const area = h('textarea', { 'aria-label': opts.label || 'Write a post', placeholder: opts.placeholder || "What's happening? Add a #topic!", value: opts.prefill || store.get(dkey) || '' });
    const count = h('span', { class: 'count' });
    const btn = h('button', { class: 'btn', type: 'submit' }, opts.button || 'Post');
    const err = errBox();
    const subSel = opts.outlet ? h('select', { class: 'subsel', 'aria-label': 'Subject' }, h('option', { value: '' }, 'No Subject'), (opts.subjects || []).map((sj) => h('option', { value: sj.slug, selected: sj.slug === opts.subject }, sj.name))) : null;
    const files = [];
    const tray = h('div', { class: 'tray' });
    const preview = h('div', { class: 'preview', hidden: true });
    let busy = 0;

    // content warning
    let cwOn = false;
    const cwIn = h('input', { class: 'cwin', placeholder: 'Content warning: what should the post hide behind?', maxlength: 80, 'aria-label': 'Content warning', hidden: true });
    const cwBtn = h('button', { class: 'act', type: 'button', 'aria-pressed': 'false', 'aria-label': 'Add a content warning', title: 'Content warning', onclick: () => { cwOn = !cwOn; cwIn.hidden = !cwOn; cwBtn.setAttribute('aria-pressed', String(cwOn)); if (cwOn) cwIn.focus(); } }, icon('warn'));

    // more posts after this one make a thread
    const extras = [];
    const extraBox = h('div', { class: 'extras' });
    const threadBtn = h('button', { class: 'act', type: 'button', 'aria-label': 'Add another post to a thread', title: 'Add another post (a thread)', onclick: () => {
      if (extras.length >= 4) return toast('A thread can have 5 posts!');
      const ta = h('textarea', { 'aria-label': 'Next post in the thread', placeholder: 'Next post...' });
      const row = h('div', { class: 'xrow' }, ta, h('button', { class: 'act', type: 'button', 'aria-label': 'Remove this post', onclick: () => { extras.splice(extras.indexOf(ta), 1); row.remove(); update(); } }, icon('x')));
      extras.push(ta);
      extraBox.append(row);
      ta.addEventListener('input', update);
      ta.focus();
      update();
    } }, '+');

    // emoji
    const EMOJI = ['😀', '😂', '😍', '🥳', '😎', '🤔', '😭', '😡', '👍', '👎', '👏', '🙏', '💪', '🎉', '🔥', '✨', '💯', '❤️', '💚', '💙', '🌟', '🌈', '☀️', '🌙', '🍕', '🍔', '🍰', '☕', '🎵', '🎮', '📚', '💻', '🚀', '🐶', '🐱', '🦊', '🐢', '🌱', '🌸', '🍀'];
    const emojiMenu = h('details', { class: 'menu' }, h('summary', { class: 'act', 'aria-label': 'Add an emoji', title: 'Emoji' }, icon('smile')),
      h('div', { class: 'pop emoji' }, EMOJI.map((e) => h('button', { type: 'button', onclick: (ev) => { area.setRangeText(e, area.selectionStart, area.selectionEnd, 'end'); area.focus(); area.dispatchEvent(new Event('input')); ev.currentTarget.closest('details').removeAttribute('open'); } }, e))));

    // poll builder
    let pollOn = false;
    const pollBox = h('div', { class: 'pollbuilder', hidden: true });
    const pollInputs = [];
    const dur = h('select', { 'aria-label': 'Poll length' }, [[1, '1 hour'], [6, '6 hours'], [24, '1 day'], [72, '3 days'], [168, '7 days']].map(([v, l]) => h('option', { value: v, selected: v === 24 }, l)));
    const addOpt = () => {
      if (pollInputs.length >= 4) return;
      const i = h('input', { placeholder: 'Choice ' + (pollInputs.length + 1), maxlength: 40, 'aria-label': 'Poll choice ' + (pollInputs.length + 1) });
      pollInputs.push(i);
      pollBox.insertBefore(i, addBtn);
      if (pollInputs.length >= 4) addBtn.hidden = true;
      update();
    };
    const addBtn = h('button', { class: 'btn ghost small', type: 'button', onclick: addOpt }, '+ Add a choice');
    pollBox.append(addBtn, h('label', { class: 'small muted' }, 'Poll length ', dur));
    const togglePoll = () => {
      pollOn = !pollOn;
      pollBox.hidden = !pollOn;
      pollBtn.setAttribute('aria-pressed', String(pollOn));
      if (pollOn && !pollInputs.length) { addOpt(); addOpt(); }
      update();
    };

    const update = () => {
      const left = 300 - [...area.value].length;
      count.textContent = String(left);
      count.className = 'count' + (left < 0 ? ' over' : '');
      const hasThing = area.value.trim() || files.length || (pollOn && pollInputs.filter((i) => i.value.trim()).length >= 2);
      const over = extras.some((t) => [...t.value].length > 300);
      btn.disabled = left < 0 || over || !hasThing || busy > 0 || (opts.quote && !area.value.trim());
    };
    const drawTray = () => {
      tray.replaceChildren(...files.map((f) => h('div', { class: 'tfile' + (f.id ? '' : ' wait') },
        f.image ? h('img', { src: f.preview || '', alt: '' }) : h('span', { class: 'ficon' }, icon('file')),
        h('div', { class: 'tinfo' }, h('div', { class: 'fn' }, f.name), f.image ? h('input', { placeholder: 'Describe the picture (for people who cannot see it)', maxlength: 200, value: f.alt || '', 'aria-label': 'Picture description', oninput: (e) => (f.alt = e.target.value) }) : h('div', { class: 'muted small' }, f.id ? bytes(f.size) : 'Uploading...')),
        h('button', { class: 'act', type: 'button', 'aria-label': 'Remove', onclick: () => { files.splice(files.indexOf(f), 1); if (f.id) api('/upload/' + f.id, { method: 'DELETE' }).catch(() => {}); drawTray(); update(); } }, icon('x'))
      )));
    };
    const addFiles = async (list) => {
      for (const file of [...list]) {
        if (files.length >= 4) { toast('Up to 4 pictures or files in one post!'); break; }
        const f = { name: file.name || 'file', image: false, size: file.size };
        files.push(f);
        busy++;
        drawTray();
        update();
        try {
          const blob = await prepImage(file);
          f.image = /^image\/(png|jpeg|webp|gif)$/.test(blob.type);
          if (f.image) f.preview = await readDataUrl(blob);
          drawTray();
          const r = await api('/upload', { method: 'POST', raw: true, body: blob, headers: { 'x-file-name': enc(f.name), 'content-type': 'application/octet-stream' } });
          f.id = r.id; f.size = r.size; f.image = r.image; f.name = r.name;
        } catch (e) {
          files.splice(files.indexOf(f), 1);
          toast(e.message);
        }
        busy--;
        drawTray();
        update();
      }
    };
    const pick = (accept) => {
      const inp = h('input', { type: 'file', multiple: true, accept, hidden: true, onchange: () => { addFiles(inp.files); inp.remove(); } });
      document.body.append(inp);
      inp.click();
    };
    const imgBtn = h('button', { class: 'act', type: 'button', 'aria-label': 'Add pictures', title: 'Add pictures', onclick: () => pick('image/*') }, icon('image'));
    const fileBtn = h('button', { class: 'act', type: 'button', 'aria-label': 'Add a file', title: 'Add a file', onclick: () => pick('') }, icon('file'));
    const pollBtn = h('button', { class: 'act', type: 'button', 'aria-pressed': 'false', 'aria-label': 'Add a poll', title: 'Add a poll', onclick: togglePoll }, icon('poll'));

    let ptimer = 0;
    const paintPreview = () => {
      clearTimeout(ptimer);
      ptimer = setTimeout(async () => {
        if (!looksKd(area.value)) { preview.hidden = true; return; }
        try {
          const out = await window.KdLite.render(area.value);
          linkify(out);
          preview.replaceChildren(h('div', { class: 'muted small' }, 'Preview'), out);
          preview.hidden = false;
        } catch (e) { preview.hidden = true; }
      }, 300);
    };
    area.addEventListener('input', () => { store.set(dkey, area.value); update(); paintPreview(); });
    area.addEventListener('paste', (e) => {
      const imgs = [...(e.clipboardData ? e.clipboardData.files : [])].filter((f) => f.type.startsWith('image/'));
      if (imgs.length) { e.preventDefault(); addFiles(imgs); }
    });
    ['dragover', 'drop'].forEach((ev) => area.addEventListener(ev, (e) => {
      if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
      if (ev === 'drop') addFiles(e.dataTransfer.files);
    }));
    update();
    if (area.value) paintPreview();

    const form = h('form', { class: 'card compose', onsubmit: guard(err, async () => {
      btn.disabled = true;
      try {
        const body = { body: area.value, parent: opts.parent, quote: opts.quote ? opts.quote.id : undefined, outlet: opts.outlet, subject: subSel && subSel.value ? subSel.value : undefined, cw: cwOn ? cwIn.value : undefined, files: files.filter((f) => f.id).map((f) => ({ id: f.id, alt: f.alt || '' })) };
        if (pollOn) body.poll = { options: pollInputs.map((i) => i.value).filter((v) => v.trim()), hours: parseInt(dur.value, 10) };
        const r = await api('/posts', { method: 'POST', body });
        // the rest of a thread: each one replies to the first
        for (const t of extras.filter((x) => x.value.trim())) await api('/posts', { method: 'POST', body: { body: t.value, parent: r.post.id } });
        extras.length = 0;
        extraBox.replaceChildren();
        if (cwOn) { cwIn.value = ''; cwBtn.click(); }
        area.value = opts.prefill || '';
        store.set(dkey, '');
        files.length = 0;
        drawTray();
        if (pollOn) { pollInputs.forEach((i) => (i.value = '')); togglePoll(); }
        preview.hidden = true;
        if (opts.onPosted) opts.onPosted(r.post);
      } finally { update(); }
    }) },
      subSel ? h('label', { class: 'small muted subrow' }, icon('forum'), ' Post in ', subSel) : null,
      area, cwIn, tray, pollBox, extraBox, preview,
      opts.quote ? h('div', { class: 'quote small' }, h('b', null, nameOf(opts.quote)), ' ', '@' + opts.quote.username, h('div', { class: 'qbody' }, opts.quote.body.slice(0, 200))) : null,
      h('div', { class: 'row' }, h('div', { class: 'tools' }, imgBtn, fileBtn, opts.parent || opts.noPoll ? null : pollBtn, cwBtn, emojiMenu, opts.parent || opts.quote ? null : threadBtn, count), btn),
      h('div', { class: 'muted small' }, 'Keydown works here: **bold**, *italic*, `code`, #G#chips#'), err);
    return form;
  }

  // a list of posts that can load more
  function feed(path, query, opts = {}) {
    const list = h('div', { class: 'card feed' });
    const more = h('div', { class: 'more' });
    const wrap = h('div', null, list, more);
    let cursor = null;
    const empty = () => { if (!list.querySelector('.postwrap')) list.append(h('div', { class: 'empty' }, opts.empty || 'Nothing here yet!')); };
    const load = async () => {
      more.replaceChildren();
      const qsx = new URLSearchParams(query);
      if (cursor) qsx.set('before', cursor);
      const r = await api(path + '?' + qsx);
      list.querySelectorAll('.empty').forEach((e) => e.remove());
      r.posts.forEach((p) => list.append(postCard(p, { pinned: opts.pinnedId === p.id, onDelete: empty, onUnsave: opts.onUnsave && empty, hideOutlet: opts.hideOutlet })));
      cursor = r.cursor;
      empty();
      if (r.more) more.append(h('button', { class: 'btn ghost', type: 'button', onclick: safe(load) }, 'Load more'));
      wrap.topId = wrap.topId || (r.posts[0] && r.posts[0].id);
    };
    wrap.add = (p) => { list.querySelectorAll('.empty').forEach((e) => e.remove()); list.prepend(postCard(p, { onDelete: empty, hideOutlet: opts.hideOutlet })); };
    wrap.ready = load();
    return wrap;
  }


  // ---------- Outlets: forums with Subjects ----------
  const outletBadge = (o) => h('span', { class: 'obadge c-' + (o.color || 'lime') }, (o.name || '?')[0].toUpperCase());
  const outletPath = (slug, subject) => '/o/' + enc(slug) + (subject ? '/s/' + enc(subject) : '');
  const joinBtn = (o, after) => {
    const b = h('button', { class: 'btn small' });
    const paint = () => { b.textContent = o.role === 'owner' ? 'You run this' : o.joined ? 'Joined' : 'Join'; b.className = 'btn small' + (o.joined ? ' on' : ''); b.disabled = o.role === 'owner' || !!o.banned; };
    b.addEventListener('click', safe(async () => {
      if (!me) return go('/login');
      const r = await api('/outlets/' + enc(o.slug) + (o.joined ? '/leave' : '/join'), { method: 'POST' });
      o.joined = r.joined;
      if (o.members !== undefined) o.members += r.joined ? 1 : -1;
      paint();
      if (after) after();
      drawSide();
    }));
    paint();
    return b;
  };

  async function outletsPage() {
    setTitle('Outlets');
    drawSide();
    const sort = params().get('sort') === 'new' ? 'new' : 'popular';
    const qv = (params().get('q') || '').trim();
    const r = await api('/outlets?sort=' + sort + (qv ? '&q=' + enc(qv) : ''));
    const search = h('form', { class: 'row2', onsubmit: (e) => { e.preventDefault(); go('/outlets?sort=' + sort + (search.q.value.trim() ? '&q=' + enc(search.q.value.trim()) : '')); } },
      h('input', { name: 'q', value: qv, placeholder: 'Find an Outlet...', 'aria-label': 'Find an Outlet', maxlength: 40 }), h('button', { class: 'btn small', type: 'submit' }, 'Search'));
    show(h('div', { class: 'orow' }, h('h1', null, 'Outlets'), me ? h('a', { class: 'btn', href: '/outlets/new', 'data-link': true }, '+ Make an Outlet') : null),
      h('p', { class: 'muted' }, 'Outlets are forums for one kind of talk. Each has Subjects inside it, so you can read only what you care about!'),
      search,
      h('div', { class: 'tabs' }, h('a', { href: '/outlets', 'data-link': true, class: sort === 'popular' ? 'on' : '' }, 'Popular'), h('a', { href: '/outlets?sort=new', 'data-link': true, class: sort === 'new' ? 'on' : '' }, 'New')),
      r.outlets.length ? h('div', { class: 'ogrid' }, r.outlets.map((o) => {
        const j = { ...o };
        return h('div', { class: 'card ocard' }, h('div', { class: 'otop' }, outletBadge(o), h('div', { class: 'ot' }, h('a', { class: 'oname', href: outletPath(o.slug), 'data-link': true }, o.name), h('div', { class: 'muted small' }, o.members + (o.members === 1 ? ' member' : ' members') + ' · ' + o.posts + (o.posts === 1 ? ' post' : ' posts')))),
          h('p', { class: 'muted odesc' }, o.description || 'No description yet.'), joinBtn(j));
      })) : h('div', { class: 'card empty' }, qv ? 'No Outlet matched that!' : 'No Outlets yet. Make the first one!'));
  }

  function newOutletPage() {
    if (!me) return go('/login', true);
    setTitle('Make an Outlet');
    side.replaceChildren();
    const err = errBox();
    const name = h('input', { id: 'on', maxlength: 40, required: true, autocomplete: 'off', placeholder: 'Garden Club' });
    const slug = h('input', { id: 'os', maxlength: 30, autocomplete: 'off', placeholder: 'garden-club' });
    const desc = h('input', { id: 'od', maxlength: 200, autocomplete: 'off', placeholder: 'What is this Outlet for?' });
    const rules = h('textarea', { id: 'or', maxlength: 1500, placeholder: 'A few ground rules (optional)' });
    let color = 'lime';
    let slugTouched = false;
    slug.addEventListener('input', () => (slugTouched = true));
    name.addEventListener('input', () => { if (!slugTouched) slug.value = name.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30); });
    const sw = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Color' });
    const paintSw = () => put(sw, ['lime', 'mint', 'sky', 'sun', 'rose', 'violet', 'slate'].map((c) => h('button', { type: 'button', class: 'sw c-' + c + (color === c ? ' sel' : ''), role: 'radio', 'aria-checked': String(color === c), 'aria-label': c, onclick: () => { color = c; paintSw(); } })));
    paintSw();
    show(h('form', { class: 'card formcard wide', onsubmit: guard(err, async () => { const r = await api('/outlets', { method: 'POST', body: { name: name.value, slug: slug.value, description: desc.value, rules: rules.value, color } }); toast('Outlet made!'); drawSide(); go(outletPath(r.slug)); }) },
      h('h1', null, 'Make an Outlet'),
      h('p', { class: 'muted' }, 'It starts with one Subject called General. You can add more Subjects after!'),
      h('label', { for: 'on' }, 'Name'), name, h('label', { for: 'os' }, 'Address (letters, numbers and dashes)'), slug, h('label', { for: 'od' }, 'Description'), desc, h('label', { for: 'or' }, 'Rules'), rules, h('label', null, 'Color'), sw, err,
      h('p', null, h('button', { class: 'btn', type: 'submit' }, 'Make Outlet'))));
    name.focus();
  }

  async function outletPage(slug, subSlug, sub2) {
    const r = await api('/outlets/' + enc(slug));
    const o = r.outlet;
    setTitle(o.name);
    drawSide();
    if (subSlug === 'settings') return outletSettings(r);
    const path = outletPath(o.slug);
    const onAbout = subSlug === 'about';
    const curSub = subSlug === 's' ? sub2 : null;
    const subj = curSub ? r.subjects.find((s) => s.slug === curSub) : null;
    if (curSub && curSub !== 'none' && !subj) throw Object.assign(new Error('We could not find that Subject!'), { status: 404 });
    const info = { slug: o.slug, joined: o.joined, role: o.role, members: o.members, banned: o.banned };
    const memberCount = h('span');
    const refreshCount = () => (memberCount.textContent = info.members + (info.members === 1 ? ' member' : ' members'));
    refreshCount();
    const head = h('div', { class: 'card ohead' }, h('div', { class: 'oband c-' + o.color }),
      h('div', { class: 'otop pad16' }, outletBadge(o), h('div', { class: 'ot' }, h('h1', null, o.name), h('div', { class: 'muted small' }, memberCount, ' · ' + o.posts + (o.posts === 1 ? ' post' : ' posts') + ' · ' + r.subjects.length + (r.subjects.length === 1 ? ' Subject' : ' Subjects'))),
        h('div', { class: 'pbtns' }, joinBtn(info, refreshCount), isModRole(o.role) ? h('a', { class: 'btn ghost small', href: path + '/settings', 'data-link': true }, icon('gear'), o.role === 'owner' ? 'Manage' : 'Moderate') : null)),
      o.description ? h('p', { class: 'pad16nb' }, o.description) : null,
      o.banned ? h('p', { class: 'err pad16nb' }, 'You have been banned from this Outlet.') : null);
    const subjectChips = h('div', { class: 'subs', role: 'navigation', 'aria-label': 'Subjects' },
      h('a', { class: 'chip' + (!curSub && !onAbout ? ' on' : ''), href: path, 'data-link': true }, 'All'),
      r.subjects.map((s) => h('a', { class: 'chip' + (curSub === s.slug ? ' on' : ''), href: outletPath(o.slug, s.slug), 'data-link': true, title: s.description || '' }, s.name, h('span', { class: 'cnt' }, s.posts))),
      o.uncategorized ? h('a', { class: 'chip' + (curSub === 'none' ? ' on' : ''), href: outletPath(o.slug, 'none'), 'data-link': true }, 'No Subject', h('span', { class: 'cnt' }, o.uncategorized)) : null);
    const tabs = h('div', { class: 'tabs' }, h('a', { href: path, 'data-link': true, class: !onAbout ? 'on' : '' }, 'Posts'), h('a', { href: path + '/about', 'data-link': true, class: onAbout ? 'on' : '' }, 'About & rules'));
    if (onAbout) {
      const mem = await api('/outlets/' + enc(o.slug) + '/members');
      return show(head, tabs, h('div', { class: 'card pad16' }, h('h2', null, 'Rules'), o.rules ? h('div', { class: 'body' }, ...rich(o.rules)) : h('p', { class: 'muted' }, 'No rules written yet.'), h('h2', { class: 'gap' }, 'Moderators'),
        h('ul', { class: 'ulist' }, r.mods.map((m) => h('li', { class: 'urow' }, h('div', { class: 'ut' }, link('/u/' + enc(m.username), h('b', null, m.username)), ' ', h('span', { class: 'chip small' }, m.role === 'owner' ? 'Owner' : 'Moderator'))))),
        h('h2', { class: 'gap' }, 'Members (' + mem.users.length + ')'), h('ul', { class: 'ulist' }, mem.users.map((u) => userRow({ ...u, isFollowing: undefined }))), h('p', { class: 'muted small' }, 'Started ' + new Date(o.created).toLocaleDateString())));
    }
    const f = feed('/feed', curSub ? { outlet: o.slug, subject: curSub } : { outlet: o.slug }, { hideOutlet: true, empty: curSub ? 'Nothing in this Subject yet. Start the talk!' : 'Nothing here yet. Start the talk!' });
    const pinnedBox = !curSub && r.pinned.length ? h('div', { class: 'card feed pinnedbox' }, r.pinned.map((p) => postCard(p, { hideOutlet: true, onDelete: () => render() }))) : null;
    const canPost = me && !o.banned;
    show(head, subjectChips, tabs,
      canPost ? composer({ outlet: o.slug, subjects: r.subjects, subject: curSub && curSub !== 'none' ? curSub : '', draftKey: 'outlet-' + o.slug, placeholder: 'Start a conversation in ' + o.name + '...', onPosted: (p) => { f.add(p); toast('Posted!'); } }) : (!me ? h('p', { class: 'muted' }, link('/login', 'Log in'), ' to post here.') : null),
      pinnedBox, f);
    await f.ready;
  }
  const isModRole = (role) => role === 'owner' || role === 'mod';

  async function outletSettings(r) {
    const o = r.outlet;
    if (!isModRole(o.role)) return show(h('div', { class: 'card empty' }, h('h2', null, 'Moderators only'), link(outletPath(o.slug), 'Back to the Outlet')));
    setTitle('Manage ' + o.name);
    const owner = o.role === 'owner';
    const base = '/outlets/' + enc(o.slug);
    const err = errBox(), err2 = errBox(), err3 = errBox();
    const name = h('input', { id: 'sn', value: o.name, maxlength: 40 });
    const desc = h('input', { id: 'sd', value: o.description, maxlength: 200 });
    const rules = h('textarea', { id: 'sr', maxlength: 1500, value: o.rules });
    let color = o.color;
    const sw = h('div', { class: 'swatches' });
    const paintSw = () => put(sw, ['lime', 'mint', 'sky', 'sun', 'rose', 'violet', 'slate'].map((c) => h('button', { type: 'button', class: 'sw c-' + c + (color === c ? ' sel' : ''), 'aria-label': c, onclick: () => { color = c; paintSw(); } })));
    paintSw();
    const subBox = h('div', { class: 'card' });
    const drawSubs = (list) => put(subBox, list.length ? list.map((s) => {
      const nm = h('input', { value: s.name, maxlength: 40, 'aria-label': 'Subject name' });
      return h('div', { class: 'row pad16nb srow' }, nm, h('span', { class: 'muted small' }, s.posts + ' posts'),
        h('button', { class: 'btn ghost small', type: 'button', onclick: safe(async () => { await api(base + '/subjects/' + enc(s.slug), { method: 'PATCH', body: { name: nm.value } }); toast('Renamed!'); drawSide(); }) }, 'Rename'),
        h('button', { class: 'btn danger small', type: 'button', onclick: safe(async () => { if (!confirm('Delete the Subject "' + s.name + '"? Its posts stay in the Outlet with no Subject.')) return; await api(base + '/subjects/' + enc(s.slug), { method: 'DELETE' }); render(); drawSide(); }) }, 'Delete'));
    }) : h('div', { class: 'empty' }, 'No Subjects yet.'));
    drawSubs(r.subjects);
    const newSub = h('input', { placeholder: 'New Subject name', maxlength: 40, 'aria-label': 'New Subject name' });
    const modName = h('input', { placeholder: 'Username', maxlength: 20, 'aria-label': 'Username to make a moderator' });
    const banName = h('input', { placeholder: 'Username', maxlength: 20, 'aria-label': 'Username to ban' });
    const bansBox = h('div');
    const drawBans = async () => { const b = await api(base + '/bans'); put(bansBox, b.users.length ? b.users.map((u) => h('div', { class: 'row pad16nb' }, link('/u/' + enc(u.username), '@' + u.username), h('span', { class: 'grow' }), h('button', { class: 'btn ghost small', type: 'button', onclick: safe(async () => { await api(base + '/bans/' + enc(u.username), { method: 'DELETE' }); drawBans(); }) }, 'Unban'))) : h('p', { class: 'muted' }, 'Nobody is banned.')); };
    drawBans().catch(() => {});
    show(h('div', { class: 'row2' }, link(outletPath(o.slug), '← Back to ' + o.name)),
      h('div', { class: 'card formcard wide' }, h('h1', null, owner ? 'Manage ' + o.name : 'Moderate ' + o.name),
        owner ? [h('h2', null, 'Details'), h('label', { for: 'sn' }, 'Name'), name, h('label', { for: 'sd' }, 'Description'), desc, h('label', { for: 'sr' }, 'Rules'), rules, h('label', null, 'Color'), sw,
          h('p', null, h('button', { class: 'btn', type: 'button', onclick: guard(err, async () => { await api(base, { method: 'PATCH', body: { name: name.value, description: desc.value, rules: rules.value, color } }); toast('Saved!'); drawSide(); }) }, 'Save details')), err] : null,
        h('h2', null, 'Subjects'), h('p', { class: 'muted' }, 'Subjects sort the talk inside this Outlet.'), subBox,
        h('div', { class: 'row2' }, newSub, h('button', { class: 'btn small', type: 'button', onclick: guard(err2, async () => { await api(base + '/subjects', { method: 'POST', body: { name: newSub.value } }); newSub.value = ''; toast('Subject added!'); render(); drawSide(); }) }, 'Add Subject')), err2,
        owner ? [h('h2', null, 'Moderators'), h('ul', { class: 'ulist' }, r.mods.map((m) => h('li', { class: 'urow' }, h('div', { class: 'ut' }, '@' + m.username, ' ', h('span', { class: 'chip small' }, m.role === 'owner' ? 'Owner' : 'Moderator')), m.role === 'mod' ? h('button', { class: 'btn ghost small', type: 'button', onclick: safe(async () => { await api(base + '/mods/' + enc(m.username), { method: 'DELETE' }); render(); }) }, 'Remove') : null))),
          h('div', { class: 'row2' }, modName, h('button', { class: 'btn small', type: 'button', onclick: guard(err3, async () => { await api(base + '/mods', { method: 'POST', body: { username: modName.value } }); modName.value = ''; render(); }) }, 'Make moderator')), err3] : null,
        h('h2', null, 'Banned people'), bansBox,
        h('div', { class: 'row2' }, banName, h('button', { class: 'btn danger small', type: 'button', onclick: safe(async () => { const u = banName.value.trim().replace(/^@/, ''); if (!u) return; await api(base + '/bans/' + enc(u), { method: 'POST' }); banName.value = ''; drawBans(); toast('Banned!'); }) }, 'Ban')),
        owner ? [h('h2', null, 'Delete this Outlet'), h('p', { class: 'muted' }, 'This removes the Outlet, its Subjects and every post in it for good.'),
          h('button', { class: 'btn danger', type: 'button', onclick: safe(async () => { if (!confirm('Delete the Outlet "' + o.name + '" and all its posts? This cannot be undone.')) return; await api(base, { method: 'DELETE' }); toast('Outlet deleted!'); drawSide(); go('/outlets'); }) }, 'Delete Outlet')] : null));
  }

  // choose a Subject for a post (moderators)
  async function moveDialog(slug, x, after) {
    const r = await api('/outlets/' + enc(slug));
    const box = modal('Move to a Subject', h('div', { class: 'liclist' }, [h('button', { type: 'button', onclick: go1(null) }, 'No Subject'), ...r.subjects.map((s) => h('button', { type: 'button', onclick: go1(s.slug) }, s.name))]));
    function go1(sl) { return safe(async () => { await api('/outlets/' + enc(slug) + '/posts/' + x.id + '/move', { method: 'POST', body: { subject: sl } }); box.remove(); toast('Moved!'); if (after) after(); }); }
  }

  // ---------- pages ----------
  async function home() {
    setTitle('');
    drawSide();
    const tab = params().get('tab') || (me ? 'home' : 'all');
    const f = feed('/feed', tab === 'home' && me ? { scope: 'home' } : {}, { empty: tab === 'home' ? 'Your home feed is empty. Follow people and Topics, or look at Everyone!' : 'No posts yet. Be the first!' });
    const banner = h('button', { class: 'btn newposts', type: 'button', hidden: true, onclick: () => render() }, 'New posts, show them!');
    show(
      !me ? h('section', { class: 'hero' }, h('h1', null, 'Short posts. Big conversations!'), h('p', null, 'Beta is a microblog where every post can live in a Topic. Add a #hashtag, a picture, a poll or a file, and join the conversation!'), h('p', null, h('a', { class: 'btn', href: '/register', 'data-link': true }, 'Join Beta'))) : null,
      me ? composer({ onPosted: (p) => { f.add(p); toast('Posted!'); drawSide(); } }) : null,
      me ? h('div', { class: 'tabs' }, h('a', { href: '/', 'data-link': true, class: tab === 'home' ? 'on' : '' }, 'Following'), h('a', { href: '/?tab=all', 'data-link': true, class: tab === 'all' ? 'on' : '' }, 'Everyone')) : null,
      banner, f);
    await f.ready;
    timers.push(setInterval(async () => {
      try {
        const r = await api('/feed?limit=1' + (tab === 'home' && me ? '&scope=home' : ''));
        if (r.posts[0] && f.topId && r.posts[0].id > f.topId && !(me && r.posts[0].username === me.username)) banner.hidden = false;
      } catch (e) {}
    }, 45000));
  }

  async function topicPage(name) {
    const { topic } = await api('/topics/' + enc(name));
    setTitle('#' + topic.name);
    drawSide();
    const sort = params().get('sort') === 'top' ? 'top' : 'latest';
    const stats = h('p', { class: 'muted' });
    const fbtn = h('button', { class: 'btn small' });
    const mbtn = h('button', { class: 'btn ghost small' });
    const paint = () => {
      stats.textContent = topic.posts + (topic.posts === 1 ? ' post' : ' posts') + ' · ' + topic.followers + (topic.followers === 1 ? ' follower' : ' followers');
      fbtn.textContent = topic.following ? 'Following' : 'Follow Topic';
      fbtn.className = 'btn small' + (topic.following ? ' on' : '');
      mbtn.textContent = topic.muted ? 'Unmute Topic' : 'Mute Topic';
    };
    fbtn.addEventListener('click', safe(async () => { if (!me) return go('/login'); const r = await api('/topics/' + enc(topic.name) + '/follow', { method: 'POST' }); topic.following = r.following; topic.followers += r.following ? 1 : -1; paint(); }));
    mbtn.addEventListener('click', safe(async () => { if (!me) return go('/login'); const r = await api('/topics/' + enc(topic.name) + '/mute', { method: 'POST' }); topic.muted = r.muted; paint(); toast(r.muted ? 'Muted! Its posts are hidden from your home feed and Everyone.' : 'Unmuted!'); }));
    paint();
    const f = feed('/feed', sort === 'top' ? { topic: topic.name, sort: 'top' } : { topic: topic.name }, { empty: 'No posts in this Topic yet. Start it!' });
    show(h('div', { class: 'card topichead' }, h('h1', null, '#' + topic.name), stats, h('div', { class: 'row2' }, fbtn, mbtn, h('a', { class: 'btn ghost small', href: '/rss/topic/' + enc(topic.name), title: 'RSS feed' }, icon('rss'), 'RSS'))),
      me ? composer({ prefill: '#' + topic.name + ' ', draftKey: 'topic', onPosted: (p) => { f.add(p); topic.posts++; paint(); toast('Posted!'); } }) : null,
      h('div', { class: 'tabs' }, h('a', { href: '/topic/' + enc(topic.name), 'data-link': true, class: sort === 'latest' ? 'on' : '' }, 'Latest'), h('a', { href: '/topic/' + enc(topic.name) + '?sort=top', 'data-link': true, class: sort === 'top' ? 'on' : '' }, 'Top')),
      f);
    await f.ready;
  }

  async function userPage(name, sub) {
    const { user } = await api('/users/' + enc(name));
    setTitle(nameOf(user));
    drawSide();
    if (sub === 'followers' || sub === 'following') {
      const r = await api('/users/' + enc(user.username) + '/' + sub);
      show(h('div', { class: 'card' }, h('div', { class: 'row pad16' }, h('h1', null, link('/u/' + enc(user.username), nameOf(user)), ' ', h('span', { class: 'muted' }, sub === 'followers' ? 'Followers' : 'Following'))),
        r.users.length ? h('ul', { class: 'ulist big' }, r.users.map(userRow)) : h('div', { class: 'empty' }, sub === 'followers' ? 'No followers yet!' : 'Not following anyone yet!')));
      return;
    }
    if (sub === 'lists') return listsPage(user.username);
    const tab = ['replies', 'media', 'likes'].includes(params().get('tab')) ? params().get('tab') : 'posts';
    const mineU = me && me.username.toLowerCase() === user.username.toLowerCase();
    const stats = h('div', { class: 'stats' });
    const fbtn = followBtn(user);
    const paint = () => stats.replaceChildren(h('span', null, h('b', null, user.posts), ' posts'), link('/u/' + enc(user.username) + '/followers', h('b', null, user.followers), ' followers'), link('/u/' + enc(user.username) + '/following', h('b', null, user.following), ' following'), link('/u/' + enc(user.username) + '/lists', 'Lists'));
    user.onChange = paint;
    paint();
    const relBtns = [];
    if (me && !mineU) {
      const mk = (kind, on, off, msg) => { const b = h('button', { class: 'btn ghost small' }); const p = () => (b.textContent = user[kind] ? off : on); b.addEventListener('click', safe(async () => { if (kind === 'blocked' && !user.blocked && !confirm('Block @' + user.username + '?')) return; const r = await api('/users/' + enc(user.username) + '/' + (kind === 'muted' ? 'mute' : 'block'), { method: 'POST' }); user.muted = !!r.muted; user.blocked = !!r.blocked; if (kind === 'blocked' && r.blocked) { user.isFollowing = false; } toast(msg(r)); render(); })); p(); return b; };
      relBtns.push(mk('muted', 'Mute', 'Unmute', (r) => (r.muted ? 'Muted!' : 'Unmuted!')), mk('blocked', 'Block', 'Unblock', (r) => (r.blocked ? 'Blocked!' : 'Unblocked!')));
    }
    const path = '/u/' + enc(user.username);
    const f = feed('/feed', { user: user.username, tab }, { empty: { posts: 'No posts yet!', replies: 'No replies yet!', media: 'No pictures or files yet!', likes: 'No likes yet!' }[tab], pinnedId: user.pinned ? user.pinned.id : null });
    show(h('div', { class: 'card profile' },
      h('div', { class: 'top2' }, avatar(user, true), h('div', { class: 'who2' }, h('h1', null, nameOf(user)), h('div', { class: 'muted' }, '@' + user.username, user.followsYou ? h('span', { class: 'chip small' }, 'Follows you') : null, user.muted ? h('span', { class: 'chip small' }, 'Muted') : null, user.blocked ? h('span', { class: 'chip small' }, 'Blocked') : null)),
        h('div', { class: 'pbtns' }, mineU ? h('a', { class: 'btn ghost small', href: '/settings', 'data-link': true }, 'Edit profile') : fbtn, mineU ? h('button', { class: 'btn ghost small', type: 'button', onclick: () => changePicture(() => render()) }, 'Change picture') : null, me && !mineU ? h('a', { class: 'btn ghost small', href: '/messages/' + enc(user.username), 'data-link': true, title: 'Send a message' }, icon('mail')) : null, me && !mineU ? h('button', { class: 'btn ghost small', type: 'button', title: 'Add to a list', onclick: safe(() => listPicker(user.username)) }, icon('list')) : null, h('a', { class: 'btn ghost small', href: '/rss/user/' + enc(user.username), title: 'RSS feed' }, icon('rss')))),
      user.bio ? h('p', null, rich(user.bio)) : null,
      h('p', { class: 'muted small' }, user.website ? [h('a', { href: user.website, rel: 'noopener noreferrer nofollow ugc', target: '_blank' }, user.website.replace(/^https?:\/\//, '')), ' · '] : null, 'Joined ' + new Date(user.created).toLocaleDateString()),
      stats, relBtns.length ? h('div', { class: 'row2' }, relBtns) : null),
      h('div', { class: 'tabs' }, [['posts', 'Posts'], ['replies', 'Replies'], ['media', 'Media'], ['likes', 'Likes']].map(([k, l]) => h('a', { href: path + (k === 'posts' ? '' : '?tab=' + k), 'data-link': true, class: tab === k ? 'on' : '' }, l))),
      tab === 'posts' && user.pinned ? h('div', { class: 'card feed' }, postCard(user.pinned, { pinned: true, onDelete: () => render() })) : null,
      f);
    await f.ready;
  }

  async function postPage(id) {
    const r = await api('/posts/' + enc(id));
    const top = r.post.kind === 'repost' ? r.post.target : r.post;
    setTitle(nameOf(top) + ': ' + top.body.slice(0, 40));
    drawSide();
    const replies = h('div', { class: 'card feed' });
    const topOl = (r.post.kind === 'repost' ? r.post.target : r.post).outlet;
    const addReply = (p) => replies.append(postCard(p, { noReplyLink: true, focus: p.id === r.focus && r.focus !== r.post.id, onDelete: () => {}, modOutlet: topOl && topOl.canMod ? topOl.slug : null }));
    r.replies.forEach(addReply);
    show(link('/', '← Back'),
      h('div', { class: 'card feed' }, postCard(r.post, { noReplyLink: true, focus: r.focus === r.post.id, onDelete: () => go('/', true) })),
      h('div', { class: 'pad' }),
      topOl && topOl.locked && !topOl.canMod ? h('p', { class: 'muted' }, icon('lock'), ' This thread is locked. Only moderators can reply.') : me ? composer({ parent: r.post.id, placeholder: 'Reply to ' + nameOf(r.post), button: 'Reply', label: 'Write a reply', onPosted: (p) => { addReply(p); toast('Replied!'); } }) : h('p', { class: 'muted' }, link('/login', 'Log in'), ' to reply.'),
      replies);
  }

  async function searchPage() {
    const qv = (params().get('q') || '').trim();
    const tab = ['people', 'topics'].includes(params().get('tab')) ? params().get('tab') : 'posts';
    document.getElementById('q').value = qv;
    setTitle('Search');
    drawSide();
    const tabs = h('div', { class: 'tabs' }, [['posts', 'Posts'], ['people', 'People'], ['topics', 'Topics']].map(([k, l]) => h('a', { href: '/search?q=' + enc(qv) + '&tab=' + k, 'data-link': true, class: tab === k ? 'on' : '' }, l)));
    const tips = h('p', { class: 'muted small' }, 'Tips: ', h('code', null, 'from:name'), ' ', h('code', null, '#topic'), ' ', h('code', null, 'has:image'), ' ', h('code', null, 'has:file'), ' ', h('code', null, 'has:poll'), ' work together with words!');
    if (!qv) return show(h('h1', null, 'Search'), h('p', { class: 'muted' }, 'Type something in the box at the top!'), tips);
    if (tab === 'posts') {
      const f = feed('/feed', { q: qv }, { empty: 'No posts matched that!' });
      show(h('h1', null, 'Results for "' + qv + '"'), tabs, tips, f);
      return f.ready;
    }
    const r = await api('/search?q=' + enc(qv));
    show(h('h1', null, 'Results for "' + qv + '"'), tabs,
      tab === 'topics' ? h('div', { class: 'card side' }, r.topics.length ? h('div', null, r.topics.map((t) => h('a', { class: 'chip', href: '/topic/' + enc(t.topic), 'data-link': true }, '#' + t.topic))) : h('p', { class: 'muted' }, 'No matching Topics!'))
        : h('div', { class: 'card' }, r.users.length ? h('ul', { class: 'ulist big' }, r.users.map((u) => userRow({ ...u }))) : h('div', { class: 'empty' }, 'No matching people!')));
  }

  async function notificationsPage() {
    if (!me) return go('/login', true);
    setTitle('Notifications');
    drawSide();
    const list = h('div', { class: 'card feed' });
    const more = h('div', { class: 'more' });
    let cursor = null;
    const text = { like: 'liked your post', reply: 'replied to your post', repost: 'reposted your post', quote: 'quoted your post', mention: 'mentioned you', follow: 'followed you' };
    const load = async () => {
      more.replaceChildren();
      const r = await api('/notifications' + (cursor ? '?before=' + cursor : ''));
      list.querySelectorAll('.empty').forEach((e) => e.remove());
      r.items.forEach((n) => {
        const href = n.kind === 'follow' ? '/u/' + enc(n.username) : '/post/' + n.post_id;
        list.append(h('a', { class: 'note' + (n.read ? '' : ' unread'), href, 'data-link': true }, avatar(n), h('div', { class: 'nt' }, h('div', null, h('b', null, nameOf(n)), ' ' + (text[n.kind] || 'did something'), h('span', { class: 'muted small' }, ' · ' + ago(n.created))), n.snippet ? h('div', { class: 'muted snip' }, n.snippet) : null)));
      });
      cursor = r.cursor;
      if (!list.children.length) list.append(h('div', { class: 'empty' }, 'Nothing yet. Likes, replies, reposts, mentions and new followers show up here!'));
      if (r.more) more.append(h('button', { class: 'btn ghost', type: 'button', onclick: safe(load) }, 'Load more'));
    };
    show(h('h1', null, 'Notifications'), list, more);
    await load();
    if (me.unread) { await api('/notifications/read', { method: 'POST' }).catch(() => {}); me.unread = 0; drawNav(); }
  }

  async function bookmarksPage() {
    if (!me) return go('/login', true);
    setTitle('Saved posts');
    drawSide();
    const f = feed('/bookmarks', {}, { empty: 'Nothing saved yet. Tap the ribbon on a post to keep it here!', onUnsave: true });
    show(h('h1', null, 'Saved posts'), f);
    await f.ready;
  }

  function authPage(mode) {
    setTitle(mode === 'login' ? 'Log in' : 'Sign up');
    side.replaceChildren();
    const err = errBox();
    const user = h('input', { id: 'u', autocomplete: 'username', maxlength: 20, required: true });
    const pw = h('input', { id: 'p', type: 'password', autocomplete: mode === 'login' ? 'current-password' : 'new-password', required: true });
    show(h('form', { class: 'card formcard', onsubmit: guard(err, async () => {
      const r = await api('/' + mode, { method: 'POST', body: { username: user.value, password: pw.value } });
      me = r.user;
      drawNav();
      go('/', true);
      toast(mode === 'login' ? 'Welcome back!' : 'Welcome to Beta!');
    }) },
      h('h1', null, mode === 'login' ? 'Log in' : 'Join Beta'),
      h('label', { for: 'u' }, 'Username'), user,
      h('label', { for: 'p' }, mode === 'login' ? 'Password' : 'Password (8 or more characters)'), pw,
      err, h('p', null, h('button', { class: 'btn', type: 'submit' }, mode === 'login' ? 'Log in' : 'Sign up')),
      h('p', { class: 'muted small' }, mode === 'login' ? 'New here? ' : 'Already a member? ', link(mode === 'login' ? '/register' : '/login', mode === 'login' ? 'Join Beta' : 'Log in'))));
    user.focus();
  }

  async function settingsPage() {
    if (!me) return go('/login', true);
    setTitle('Settings');
    side.replaceChildren();
    const cur = (await api('/me')).user;
    me = { ...me, ...cur };
    const err1 = errBox(), err2 = errBox(), err3 = errBox();
    const dn = h('input', { id: 'dn', maxlength: 40, value: cur.display_name || '', placeholder: cur.username });
    const bio = h('textarea', { id: 'bio', maxlength: 160, value: cur.bio || '' });
    const web = h('input', { id: 'web', maxlength: 200, value: cur.website || '', placeholder: 'https://' });
    let color = cur.color || 'lime';
    const sw = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Avatar color' });
    const paintSw = () => sw.replaceChildren(...['lime', 'mint', 'sky', 'sun', 'rose', 'violet', 'slate'].map((c) => h('button', { type: 'button', class: 'sw c-' + c + (color === c ? ' sel' : ''), role: 'radio', 'aria-checked': String(color === c), 'aria-label': c, onclick: () => { color = c; paintSw(); } })));
    paintSw();
    const oldPw = h('input', { id: 'op', type: 'password', autocomplete: 'current-password' });
    const newPw = h('input', { id: 'np', type: 'password', autocomplete: 'new-password' });
    const delPw = h('input', { id: 'dp', type: 'password', autocomplete: 'current-password' });
    const dmSel = h('select', { id: 'dmp', onchange: safe(async () => { await api('/me/settings', { method: 'PATCH', body: { dm: dmSel.value } }); me.dm = dmSel.value; toast('Saved!'); }) }, [['all', 'Everyone'], ['following', 'People I follow'], ['none', 'Nobody']].map(([v, l]) => h('option', { value: v, selected: (cur.dm || 'all') === v }, l)));
    const themeSel = h('select', { id: 'thm', onchange: () => { store.set('beta_theme', themeSel.value === 'auto' ? '' : themeSel.value); applyPrefs(); } }, [['auto', 'Match my device'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => h('option', { value: v, selected: (store.get('beta_theme') || 'auto') === v }, l)));
    const densSel = h('select', { id: 'dns', onchange: () => { store.set('beta_density', densSel.value === 'comfortable' ? '' : densSel.value); applyPrefs(); } }, [['comfortable', 'Comfortable'], ['compact', 'Compact']].map(([v, l]) => h('option', { value: v, selected: (store.get('beta_density') || 'comfortable') === v }, l)));
    const muted = h('div');
    api('/mutes').then((m) => {
      put(muted,
        m.users.length ? h('ul', { class: 'ulist' }, m.users.map((u) => h('li', { class: 'urow' }, h('span', { class: 'ut' }, link('/u/' + enc(u.username), '@' + u.username), ' ', h('span', { class: 'chip small' }, u.kind === 'block' ? 'Blocked' : 'Muted')), h('button', { class: 'btn ghost small', type: 'button', onclick: safe(async (e) => { await api('/users/' + enc(u.username) + '/' + (u.kind === 'block' ? 'block' : 'mute'), { method: 'POST' }); e.target.closest('li').remove(); }) }, 'Undo')))) : h('p', { class: 'muted' }, 'No muted or blocked people.'),
        m.topics.length ? h('p', null, 'Muted Topics: ', m.topics.map((t) => h('a', { class: 'chip', href: '/topic/' + enc(t), 'data-link': true }, '#' + t))) : null);
    }).catch(() => {});
    show(h('div', { class: 'card formcard wide' },
      h('h1', null, 'Settings'),
      h('p', null, 'Signed in as ', h('b', null, cur.username), '. ', h('button', { class: 'btn ghost small', onclick: async () => { await api('/logout', { method: 'POST' }); me = null; drawNav(); go('/'); } }, 'Log out')),
      h('h2', null, 'Your profile'),
      h('div', { class: 'avrow' }, avatar(me, true), h('div', null,
        h('button', { class: 'btn ghost small', type: 'button', onclick: () => { const inp = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: safe(async () => { const f = inp.files[0]; inp.remove(); if (!f) return; const blob = await avatarBlob(f); const r = await api('/me/avatar', { method: 'POST', raw: true, body: blob, headers: { 'content-type': 'application/octet-stream' } }); me.avatar = r.avatar; drawNav(); toast('Profile picture saved!'); render(); }) }); document.body.append(inp); inp.click(); } }, 'Change picture'), ' ',
        me.avatar ? h('button', { class: 'btn ghost small', type: 'button', onclick: safe(async () => { await api('/me/avatar', { method: 'DELETE' }); me.avatar = null; drawNav(); toast('Picture removed!'); render(); }) }, 'Remove') : null,
        h('div', { class: 'muted small' }, 'It is cropped to a square. Without one, you get a colored circle!'))),
      h('label', { for: 'dn' }, 'Display name'), dn,
      h('label', { for: 'bio' }, 'Bio (up to 160 characters)'), bio,
      h('label', { for: 'web' }, 'Website'), web,
      h('label', null, 'Avatar color'), sw,
      h('p', null, h('button', { class: 'btn', onclick: guard(err1, async () => { await api('/me', { method: 'PATCH', body: { display_name: dn.value, bio: bio.value, website: web.value, color } }); Object.assign(me, { display_name: dn.value.trim(), bio: bio.value.trim(), color }); drawNav(); toast('Saved!'); }) }, 'Save profile')), err1,
      h('h2', null, 'Messages'),
      h('label', { for: 'dmp' }, 'Who can send you messages?'), dmSel,
      h('h2', null, 'How Beta looks'),
      h('label', { for: 'thm' }, 'Theme'), themeSel,
      h('label', { for: 'dns' }, 'Spacing'), densSel,
      h('h2', null, 'Muted and blocked'), muted,
      h('h2', null, 'Change your password'),
      h('label', { for: 'op' }, 'Current password'), oldPw, h('label', { for: 'np' }, 'New password (8 or more characters)'), newPw,
      h('p', null, h('button', { class: 'btn', onclick: guard(err2, async () => { await api('/me/password', { method: 'POST', body: { old: oldPw.value, new: newPw.value } }); oldPw.value = newPw.value = ''; toast('Password changed! You were signed out everywhere else.'); }) }, 'Change password')), err2,
      h('h2', null, 'Your data'),
      h('p', { class: 'muted' }, 'Download your posts, follows, lists and more as a file.'), h('p', null, h('a', { class: 'btn ghost', href: '/api/me/export', download: true }, 'Download my data')),
      h('h2', null, 'Delete your account'),
      h('p', { class: 'muted' }, 'This removes your posts, pictures, likes and follows for good. Type your password to confirm.'),
      delPw,
      h('p', null, h('button', { class: 'btn danger', onclick: guard(err3, async () => { if (!confirm('Really delete your Beta account? This cannot be undone.')) return; await api('/me/delete', { method: 'POST', body: { password: delPw.value } }); me = null; drawNav(); go('/'); toast('Your account is deleted. Goodbye!'); }) }, 'Delete my account')), err3));
  }

  // pick a picture, crop it square, and save it as your profile picture
  function changePicture(after) {
    const inp = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: safe(async () => {
      const f = inp.files[0];
      inp.remove();
      if (!f) return;
      const blob = await avatarBlob(f);
      const r = await api('/me/avatar', { method: 'POST', raw: true, body: blob, headers: { 'content-type': 'application/octet-stream' } });
      me.avatar = r.avatar;
      drawNav();
      toast('Profile picture saved!');
      if (after) after();
    }) });
    document.body.append(inp);
    inp.click();
  }

  function shortcuts() {
    const rows = [['n', 'Write a new post'], ['/', 'Search'], ['g then h', 'Go home'], ['g then n', 'Notifications'], ['g then b', 'Saved posts'], ['g then e', 'Explore'], ['g then o', 'Outlets'], ['g then m', 'Messages'], ['?', 'Show this list'], ['Esc', 'Close pictures and menus']];
    const box = h('div', { class: 'modal', role: 'dialog', 'aria-label': 'Keyboard shortcuts', onclick: (e) => { if (e.target === box) box.remove(); } },
      h('div', { class: 'card sheet' }, h('div', { class: 'row' }, h('h2', null, 'Keyboard shortcuts'), h('button', { class: 'btn ghost small', type: 'button', onclick: () => box.remove() }, 'Close')), h('table', null, rows.map(([k, d]) => h('tr', null, h('td', null, h('kbd', null, k)), h('td', null, d))))));
    document.body.append(box);
  }
  let gPending = 0;
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (e.metaKey || e.ctrlKey || e.altKey || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return;
    if (e.key === 'Escape') { document.querySelectorAll('.modal').forEach((m) => m.remove()); document.querySelectorAll('details.menu[open]').forEach((d) => d.removeAttribute('open')); return; }
    if (gPending && Date.now() - gPending < 1500) {
      gPending = 0;
      const to = { h: '/', n: '/notifications', b: '/bookmarks', e: '/explore', m: '/messages', o: '/outlets' }[e.key];
      if (to) { e.preventDefault(); go(to); }
      return;
    }
    if (e.key === 'g') gPending = Date.now();
    else if (e.key === 'n') { const a = document.querySelector('.compose textarea'); if (a) { e.preventDefault(); a.focus(); } }
    else if (e.key === '/') { e.preventDefault(); document.getElementById('q').focus(); }
    else if (e.key === '?') shortcuts();
  });
  // a menu closes when you click anywhere else
  document.addEventListener('click', (e) => document.querySelectorAll('details.menu[open]').forEach((d) => { if (!d.contains(e.target) || (e.target.closest && e.target.closest('.pop a'))) d.removeAttribute('open'); }));


  // ---------- little windows ----------
  function modal(title, ...kids) {
    const box = h('div', { class: 'modal', role: 'dialog', 'aria-label': title, onclick: (e) => { if (e.target === box) box.remove(); } },
      h('div', { class: 'card sheet' }, h('div', { class: 'row' }, h('h2', null, title), h('button', { class: 'btn ghost small', type: 'button', onclick: () => box.remove() }, 'Close')), ...kids));
    document.body.append(box);
    return box;
  }
  function peopleDialog(title, users) {
    modal(title, users.length ? h('ul', { class: 'ulist' }, users.map((u) => userRow({ ...u, isFollowing: undefined }))) : h('p', { class: 'muted' }, 'Nobody yet!'));
  }
  async function listPicker(username) {
    const r = await api('/lists?has=' + enc(username));
    const body = h('div');
    const draw = (lists) => body.replaceChildren(...[
      lists.length ? lists.map((l) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: l.has, onchange: safe(async (e) => {
        if (e.target.checked) await api('/lists/' + l.id + '/members', { method: 'POST', body: { username } });
        else await api('/lists/' + l.id + '/members/' + enc(username), { method: 'DELETE' });
        l.has = e.target.checked;
      }) }), ' ' + l.name)) : h('p', { class: 'muted' }, 'You have no lists yet. Make one below!'),
      h('form', { class: 'row2', onsubmit: safe(async (e) => { e.preventDefault(); const i = e.target.elements.n; if (!i.value.trim()) return; const c = await api('/lists', { method: 'POST', body: { name: i.value } }); await api('/lists/' + c.id + '/members', { method: 'POST', body: { username } }); const again = await api('/lists?has=' + enc(username)); draw(again.lists); toast('List made!'); }) },
        h('input', { name: 'n', placeholder: 'New list name', maxlength: 40, 'aria-label': 'New list name' }), h('button', { class: 'btn small', type: 'submit' }, 'Make list'))].flat());
    draw(r.lists);
    modal('Add @' + username + ' to a list', body);
  }

  // ---------- Explore ----------
  async function explorePage() {
    setTitle('Explore');
    drawSide();
    const tab = ['media', 'topics', 'people'].includes(params().get('tab')) ? params().get('tab') : 'top';
    const tabs = h('div', { class: 'tabs' }, [['top', 'Top posts'], ['media', 'Pictures'], ['topics', 'Topics'], ['people', 'People']].map(([k, l]) => h('a', { href: '/explore' + (k === 'top' ? '' : '?tab=' + k), 'data-link': true, class: tab === k ? 'on' : '' }, l)));
    if (tab === 'topics') {
      const t = await api('/topics');
      return show(h('h1', null, 'Explore'), tabs, h('div', { class: 'card side' }, t.topics.length ? h('div', null, t.topics.map((x) => h('a', { class: 'chip', href: '/topic/' + enc(x.topic), 'data-link': true }, '#' + x.topic + ' · ' + x.n))) : h('p', { class: 'muted' }, 'No Topics yet!')));
    }
    if (tab === 'people') {
      const s2 = await api('/suggest');
      return show(h('h1', null, 'Explore'), tabs, h('div', { class: 'card' }, s2.users.length ? h('ul', { class: 'ulist big' }, s2.users.map((u) => userRow({ ...u, isFollowing: false }))) : h('div', { class: 'empty' }, 'No one new to follow right now!')));
    }
    const f = feed('/feed', tab === 'media' ? { scope: 'explore', media: '1' } : { scope: 'explore' }, { empty: 'Nothing is popular yet. Post something!' });
    show(h('h1', null, 'Explore'), h('p', { class: 'muted' }, tab === 'media' ? 'The most popular posts with pictures or files this week.' : 'The most popular posts this week.'), tabs, f);
    await f.ready;
  }

  // ---------- Messages ----------
  async function messagesPage(peer) {
    if (!me) return go('/login', true);
    side.replaceChildren();
    if (!peer) {
      setTitle('Messages');
      const r = await api('/dm');
      const to = h('input', { placeholder: 'Start a conversation with... (username)', 'aria-label': 'Username to message', maxlength: 20 });
      show(h('h1', null, 'Messages'),
        h('form', { class: 'card compose', onsubmit: (e) => { e.preventDefault(); const v = to.value.trim().replace(/^@/, ''); if (v) go('/messages/' + enc(v)); } }, h('div', { class: 'row' }, to, h('button', { class: 'btn', type: 'submit' }, 'Message'))),
        h('div', { class: 'card' }, r.conversations.length ? r.conversations.map((c) => h('a', { class: 'note' + (c.unread ? ' unread' : ''), href: '/messages/' + enc(c.username), 'data-link': true }, avatar(c), h('div', { class: 'nt' }, h('div', null, h('b', null, nameOf(c)), h('span', { class: 'muted small' }, ' @' + c.username + ' · ' + ago(c.last.created)), c.unread ? h('span', { class: 'chip small' }, c.unread + ' new') : null), h('div', { class: 'muted snip' }, (c.last.mine ? 'You: ' : '') + c.last.body)))) : h('div', { class: 'empty' }, 'No messages yet. Start one above, or tap Message on someone\'s profile!')));
      timers.push(setInterval(refreshUnread, 15000));
      return;
    }
    const r = await api('/dm/' + enc(peer));
    setTitle('Messages with ' + nameOf(r.peer));
    me.dmUnread = 0;
    drawNav();
    const list = h('div', { class: 'thread', role: 'log', 'aria-live': 'polite' });
    let lastId = 0;
    const paint = (msgs) => {
      const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
      list.replaceChildren(...(msgs.length ? msgs.map((m) => h('div', { class: 'bub ' + (m.mine ? 'mine' : 'theirs') },
        h('div', { class: 'btext' }, ...rich(m.body)),
        h('div', { class: 'bmeta' }, ago(m.created), m.mine ? [' · ', h('button', { class: 'linkbtn', type: 'button', onclick: safe(async () => { await api('/dm/msg/' + m.id, { method: 'DELETE' }); refresh(); }) }, 'Delete')] : null))) : [h('div', { class: 'empty' }, 'Say hello!')]));
      if (nearBottom || !lastId) list.scrollTop = list.scrollHeight;
      lastId = msgs.length ? msgs[msgs.length - 1].id : 0;
    };
    const refresh = async () => { const x = await api('/dm/' + enc(peer)); if (!x.messages.length || x.messages[x.messages.length - 1].id !== lastId || x.messages.length !== list.querySelectorAll('.bub').length) paint(x.messages); };
    const area = h('textarea', { 'aria-label': 'Write a message', placeholder: 'Write a message...', maxlength: 1000, disabled: !r.canSend });
    const err = errBox();
    const send = guard(err, async () => { if (!area.value.trim()) return; await api('/dm/' + enc(peer), { method: 'POST', body: { body: area.value } }); area.value = ''; await refresh(); });
    area.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    show(h('div', { class: 'row2' }, link('/messages', '← All messages')),
      h('div', { class: 'card' }, h('div', { class: 'row pad16 dmhead' }, avatar(r.peer), h('div', null, h('b', null, link('/u/' + enc(r.peer.username), nameOf(r.peer))), h('div', { class: 'muted small' }, '@' + r.peer.username))), list,
        r.canSend ? h('form', { class: 'dmform', onsubmit: send }, area, h('button', { class: 'btn', type: 'submit' }, 'Send')) : h('p', { class: 'muted pad16' }, r.why), err));
    paint(r.messages);
    timers.push(setInterval(() => refresh().catch(() => {}), 8000));
  }

  // ---------- Lists ----------
  async function listsPage(owner) {
    if (!owner && !me) return go('/login', true);
    setTitle('Lists');
    drawSide();
    const r = await api('/lists' + (owner ? '?user=' + enc(owner) : ''));
    const mineL = !owner || (me && me.username.toLowerCase() === owner.toLowerCase());
    const err = errBox();
    const name = h('input', { placeholder: 'New list name', maxlength: 40, 'aria-label': 'New list name' });
    const desc = h('input', { placeholder: 'What is it for? (optional)', maxlength: 120, 'aria-label': 'List description' });
    show(h('h1', null, owner ? '@' + owner + "'s lists" : 'Your lists'),
      mineL ? h('form', { class: 'card compose', onsubmit: guard(err, async () => { const c = await api('/lists', { method: 'POST', body: { name: name.value, description: desc.value } }); go('/list/' + c.id); }) }, name, desc, h('div', { class: 'row' }, h('span', { class: 'muted small' }, 'A list is a group of people with its own feed!'), h('button', { class: 'btn', type: 'submit' }, 'Make list')), err) : null,
      h('div', { class: 'card' }, r.lists.length ? r.lists.map((l) => h('a', { class: 'note', href: '/list/' + l.id, 'data-link': true }, icon('list'), h('div', { class: 'nt' }, h('b', null, l.name), h('div', { class: 'muted small' }, l.members + (l.members === 1 ? ' person' : ' people') + (l.description ? ' · ' + l.description : ''))))) : h('div', { class: 'empty' }, 'No lists yet!')));
  }
  async function listPage(id) {
    const r = await api('/lists/' + enc(id));
    setTitle(r.list.name);
    drawSide();
    const tab = params().get('tab') === 'people' ? 'people' : 'posts';
    const path = '/list/' + r.list.id;
    const tabs = h('div', { class: 'tabs' }, h('a', { href: path, 'data-link': true, class: tab === 'posts' ? 'on' : '' }, 'Posts'), h('a', { href: path + '?tab=people', 'data-link': true, class: tab === 'people' ? 'on' : '' }, 'People (' + r.members.length + ')'));
    const head = h('div', { class: 'card topichead' }, h('h1', null, r.list.name), h('p', { class: 'muted' }, 'A list by ', link('/u/' + enc(r.list.owner), '@' + r.list.owner), r.list.description ? ' · ' + r.list.description : ''),
      r.list.isOwner ? h('div', { class: 'row2' }, h('button', { class: 'btn danger small', type: 'button', onclick: safe(async () => { if (!confirm('Delete this list?')) return; await api('/lists/' + r.list.id, { method: 'DELETE' }); toast('List deleted!'); go('/lists'); }) }, 'Delete list')) : null);
    if (tab === 'people') {
      const err = errBox();
      const add = h('input', { placeholder: 'Add someone by username', maxlength: 20, 'aria-label': 'Username to add' });
      return show(head, tabs, r.list.isOwner ? h('form', { class: 'card compose', onsubmit: guard(err, async () => { await api('/lists/' + r.list.id + '/members', { method: 'POST', body: { username: add.value.trim().replace(/^@/, '') } }); render(); }) }, h('div', { class: 'row' }, add, h('button', { class: 'btn', type: 'submit' }, 'Add')), err) : null,
        h('div', { class: 'card' }, r.members.length ? h('ul', { class: 'ulist big' }, r.members.map((u) => h('li', { class: 'urow' }, avatar(u), h('div', { class: 'ut' }, link('/u/' + enc(u.username), h('b', null, nameOf(u))), h('div', { class: 'muted small' }, '@' + u.username)), r.list.isOwner ? h('button', { class: 'btn ghost small', type: 'button', onclick: safe(async () => { await api('/lists/' + r.list.id + '/members/' + enc(u.username), { method: 'DELETE' }); render(); }) }, 'Remove') : null))) : h('div', { class: 'empty' }, 'Nobody in this list yet!')));
    }
    const f = feed('/feed', { list: r.list.id }, { empty: r.members.length ? 'No posts from this list yet!' : 'Add some people on the People tab to see their posts here!' });
    show(head, tabs, f);
    await f.ready;
  }

  // ---------- for the people who run the site ----------
  async function adminPage() {
    if (!me || !me.admin) return show(h('div', { class: 'card empty' }, h('h2', null, 'Admins only'), link('/', 'Back to Beta')));
    setTitle('Admin');
    side.replaceChildren();
    const [rep, bans] = await Promise.all([api('/admin/reports'), api('/admin/bans')]);
    show(h('h1', null, 'Reports'), h('div', { class: 'card' }, rep.items.length ? rep.items.map((it) => {
      const row = h('div', { class: 'report' },
        h('div', { class: 'muted small' }, 'Reported by @' + it.reporter + ' ' + ago(it.created) + ': ', h('b', null, it.reason)),
        it.post ? postCard(it.post, { noReplyLink: true }) : h('p', { class: 'muted' }, 'This post is gone.'),
        h('div', { class: 'row2' },
          it.post ? h('button', { class: 'btn danger small', type: 'button', onclick: safe(async () => { if (!confirm('Remove this post for everyone?')) return; await api('/admin/posts/' + it.post_id + '/remove', { method: 'POST' }); row.remove(); toast('Removed!'); }) }, 'Remove post') : null,
          it.post ? h('button', { class: 'btn danger small', type: 'button', onclick: safe(async () => { const who = (it.post.kind === 'repost' ? it.post.target : it.post).username; const why = prompt('Suspend @' + who + '? Why? (shown when they try to log in)'); if (why === null) return; await api('/admin/users/' + enc(who) + '/ban', { method: 'POST', body: { reason: why } }); toast('Suspended!'); render(); }) }, 'Suspend author') : null,
          h('button', { class: 'btn ghost small', type: 'button', onclick: safe(async () => { await api('/admin/reports/' + it.id + '/dismiss', { method: 'POST' }); row.remove(); }) }, 'Dismiss')));
      return row;
    }) : h('div', { class: 'empty' }, 'No reports. All calm!')),
      h('h2', { class: 'gap' }, 'Suspended people'), h('div', { class: 'card' }, bans.bans.length ? bans.bans.map((b) => h('div', { class: 'urow pad16' }, h('div', { class: 'ut' }, link('/u/' + enc(b.username), '@' + b.username), h('span', { class: 'muted small' }, ' ' + (b.reason || ''))), h('button', { class: 'btn ghost small', type: 'button', onclick: safe(async () => { await api('/admin/users/' + enc(b.username) + '/unban', { method: 'POST' }); render(); }) }, 'Unsuspend'))) : h('div', { class: 'empty' }, 'Nobody is suspended.')));
  }

  // ---------- looks: light or dark, and how roomy ----------
  function applyPrefs() {
    const t = store.get('beta_theme') || 'auto';
    const d = store.get('beta_density') || 'comfortable';
    if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
    window.dispatchEvent(new Event('kd-recolor'));
    if (d === 'compact') document.documentElement.setAttribute('data-density', 'compact'); else document.documentElement.removeAttribute('data-density');
  }
  // a square, small copy of the picked picture for the profile picture
  async function avatarBlob(file) {
    const url = await readDataUrl(file);
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
    const side2 = Math.min(img.width, img.height);
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    c.getContext('2d').drawImage(img, (img.width - side2) / 2, (img.height - side2) / 2, side2, side2, 0, 0, 256, 256);
    const toBlob = (type, q) => new Promise((ok) => c.toBlob(ok, type, q));
    let b = await toBlob('image/webp', 0.85);
    if (!b || b.type !== 'image/webp') b = await toBlob('image/jpeg', 0.85);
    return b;
  }

  // ---------- the router ----------
  async function render() {
    const my = ++tick;
    timers.forEach(clearInterval);
    timers = [];
    document.querySelectorAll('.lightbox').forEach((l) => l.remove());
    window.scrollTo(0, 0);
    const seg = location.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    try {
      const [a, b, c, d] = seg;
      if (!seg.length) await home();
      else if (a === 'login' && !b) authPage('login');
      else if (a === 'register' && !b) authPage('register');
      else if (a === 'settings' && !b) await settingsPage();
      else if (a === 'search' && !b) await searchPage();
      else if (a === 'notifications' && !b) await notificationsPage();
      else if (a === 'bookmarks' && !b) await bookmarksPage();
      else if (a === 'explore' && !b) await explorePage();
      else if (a === 'outlets' && !b) await outletsPage();
      else if (a === 'outlets' && b === 'new') newOutletPage();
      else if (a === 'o' && b) await outletPage(b, c, d);
      else if (a === 'messages') await messagesPage(b);
      else if (a === 'lists' && !b) await listsPage();
      else if (a === 'list' && b) await listPage(b);
      else if (a === 'admin' && !b) await adminPage();
      else if (a === 'topic' && b) await topicPage(b);
      else if (a === 'u' && b) await userPage(b, c);
      else if (a === 'post' && b) await postPage(b);
      else throw Object.assign(new Error('There is nothing here!'), { status: 404 });
    } catch (e) {
      if (my !== tick) return;
      show(h('div', { class: 'card empty' }, h('h2', null, e.status === 404 ? 'Not found' : 'Oops'), h('p', null, e.message), link('/', 'Back to Beta')));
    }
  }

  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || a.hasAttribute('download') || a.target) return;
    const u = new URL(a.href, location.href);
    if (u.origin !== location.origin || u.pathname.startsWith('/rss/') || u.pathname.startsWith('/api/')) return;
    e.preventDefault();
    go(u.pathname + u.search);
  });
  window.addEventListener('popstate', render);
  document.getElementById('search').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = document.getElementById('q').value.trim();
    go('/search' + (v ? '?q=' + enc(v) : ''));
  });

  applyPrefs();
  api('/me').then((r) => { me = r.user; }).catch(() => {}).then(() => {
    drawNav();
    render();
    setInterval(refreshUnread, 60000);
  });
})();
