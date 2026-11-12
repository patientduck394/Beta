// Beta website. One small script, no libraries. Every piece of text goes in with textContent (never innerHTML),
// so nothing typed by a user can run as code.
(() => {
  'use strict';
  const app = document.getElementById('app');
  const side = document.getElementById('side');
  const show = (...kids) => app.replaceChildren(...kids.flat(9).filter(Boolean));
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
      const err = new Error(data.error || 'Something went wrong!');
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
  const avatar = (u, big) => h('span', { class: 'av c-' + (u.color || 'lime') + (big ? ' big' : ''), 'aria-hidden': 'true' }, (nameOf(u)[0] || '?').toUpperCase());
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) {} },
  };

  // ---------- little drawings ----------
  const PATHS = {
    comment: 'M2 3h12v8H8l-3 3v-3H2z',
    repost: 'M3 8V6a2 2 0 0 1 2-2h6V2l3 3-3 3V6H5v2zM13 8v2a2 2 0 0 1-2 2H5v2l-3-3 3-3v2h6V8z',
    heart: 'M8 14S1.500 10 1.500 5.800A3 3 0 0 1 8 4.300 3 3 0 0 1 14.500 5.800C14.500 10 8 14 8 14z',
    bookmark: 'M4 2h8v12l-4-3-4 3z',
    share: 'M8 1l4 4H9v6H7V5H4zM3 10h2v3h6v-3h2v5H3z',
    more: 'M2 7h2.500v2H2zM6.750 7h2.500v2h-2.500zM11.500 7H14v2h-2.500z',
    image: 'M2 3h12v10H2zm1.500 1.500v7h9v-7zM5 10l2-2.500L8.500 9l1.500-2 2 3z',
    poll: 'M2 9h3v5H2zM6.500 2h3v12h-3zM11 6h3v8h-3z',
    file: 'M3 2.500A1.500 1.500 0 0 1 4.500 1H9l4 4v8.500A1.500 1.500 0 0 1 11.500 15h-7A1.500 1.500 0 0 1 3 13.500z',
    bell: 'M8 1a4 4 0 0 0-4 4v3l-2 3v1h12v-1l-2-3V5a4 4 0 0 0-4-4zM6.500 13a1.500 1.500 0 0 0 3 0z',
    x: 'M4 2.600 8 6.600l4-4L13.400 4 9.400 8l4 4-1.400 1.400-4-4-4 4L2.600 12l4-4-4-4z',
    pin: 'M9 1l6 6-2 1-2-1-2 2v3l-1 1-3-3-3 3-1-1 3-3-3-3 1-1h3l2-2z',
    rss: 'M2 2v2.500A9.500 9.500 0 0 1 11.500 14H14A12 12 0 0 0 2 2zm0 4.500V9a5 5 0 0 1 5 5h2.500A7.500 7.500 0 0 0 2 6.500zM3.500 11a1.500 1.500 0 1 0 0 3 1.500 1.500 0 0 0 0-3z',
  };
  const NS = 'http://www.w3.org/2000/svg';
  const icon = (name, cls) => {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 16 16');
    s.setAttribute('class', 'ic' + (cls ? ' ' + cls : ''));
    s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', PATHS[name]);
    p.setAttribute('fill-rule', 'evenodd');
    s.append(p);
    return s;
  };

  // ---------- text: #topics, @names, and Keydown formatting (only fetched when a post looks like it uses some) ----------
  const RICH = /(?<![A-Za-z0-9_#&@])([#@])([A-Za-z][A-Za-z0-9_-]{1,29})(?![A-Za-z0-9_])/g;
  function rich(text) {
    const out = [];
    let last = 0;
    for (const m of text.matchAll(RICH)) {
      if (m[1] === '@' && m[2].length < 3) continue;
      out.push(text.slice(last, m.index));
      out.push(link(m[1] === '#' ? '/topic/' + enc(m[2].toLowerCase()) : '/u/' + enc(m[2]), m[0]));
      last = m.index + m[0].length;
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
    if (me) {
      const bell = h('a', { class: 'navbtn', href: '/notifications', 'data-link': true, title: 'Notifications (g then n)', 'aria-label': 'Notifications' }, icon('bell'), me.unread ? h('span', { class: 'badge' }, me.unread > 99 ? '99+' : me.unread) : null);
      nav.append(
        bell,
        h('a', { class: 'navbtn', href: '/bookmarks', 'data-link': true, title: 'Saved posts (g then b)', 'aria-label': 'Saved posts' }, icon('bookmark')),
        h('a', { class: 'navuser', href: '/u/' + enc(me.username), 'data-link': true, title: 'Your profile' }, avatar(me), h('span', { class: 'navname' }, nameOf(me))),
        h('a', { class: 'btn ghost small', href: '/settings', 'data-link': true }, 'Settings')
      );
    } else nav.append(h('a', { class: 'btn ghost small', href: '/login', 'data-link': true }, 'Log in'), h('a', { class: 'btn small', href: '/register', 'data-link': true }, 'Sign up'));
  }
  async function refreshUnread() {
    if (!me) return;
    try {
      const r = await api('/notifications/count');
      if (r.unread !== me.unread) {
        me.unread = r.unread;
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
      const [t, s] = await Promise.all([api('/topics'), api('/suggest')]);
      side.replaceChildren(
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
    const mineP = me && me.username.toLowerCase() === x.username.toLowerCase();
    const canEdit = mineP && !rp && Date.now() - x.created < 15 * 60 * 1000;
    const gone = () => { wrap.remove(); if (opts.onDelete) opts.onDelete(wrap); };
    const bodyHolder = h('div');
    const showBody = () => bodyHolder.replaceChildren(x.body ? bodyEl(x.body) : null);
    showBody();

    const startEdit = () => {
      const area = h('textarea', { 'aria-label': 'Edit your post', value: x.body });
      const err = errBox();
      const count = h('span', { class: 'count' });
      const upd = () => { const left = 300 - [...area.value].length; count.textContent = String(left); count.className = 'count' + (left < 0 ? ' over' : ''); };
      area.addEventListener('input', upd);
      upd();
      bodyHolder.replaceChildren(h('div', { class: 'editbox' }, area, h('div', { class: 'row' }, count, h('span', null,
        h('button', { class: 'btn ghost small', type: 'button', onclick: showBody }, 'Cancel'), ' ',
        h('button', { class: 'btn small', type: 'button', onclick: guard(err, async () => { const r = await api('/posts/' + x.id, { method: 'PATCH', body: { body: area.value } }); Object.assign(x, r.post); redraw(); toast('Saved!'); }) }, 'Save'))), err));
      area.focus();
    };

    const likeBtn = h('button', { class: 'act' + (x.liked ? ' liked' : ''), type: 'button', 'aria-pressed': String(x.liked), 'aria-label': 'Like', onclick: safe(async () => {
      if (!me) return go('/login');
      const r = await api('/posts/' + x.id + '/like', { method: 'POST' });
      x.liked = r.liked; x.likes = r.likes; redraw();
    }) }, icon('heart'), x.likes || '');
    const bmBtn = h('button', { class: 'act' + (x.bookmarked ? ' on' : ''), type: 'button', 'aria-pressed': String(x.bookmarked), 'aria-label': 'Save for later', title: 'Save for later', onclick: safe(async () => {
      if (!me) return go('/login');
      const r = await api('/posts/' + x.id + '/bookmark', { method: 'POST' });
      x.bookmarked = r.bookmarked; redraw();
      if (opts.onUnsave && !r.bookmarked) { wrap.remove(); opts.onUnsave(); }
    }) }, icon('bookmark'));
    const canRepost = !x.parent_id;
    const closeMenu = (btn) => { const d = btn.closest('details'); if (d) d.removeAttribute('open'); };
    const repostMenu = canRepost ? h('details', { class: 'menu' }, h('summary', { class: 'act' + (x.reposted ? ' on' : ''), 'aria-label': 'Repost or quote' }, icon('repost'), (x.reposts + x.quotes) || ''),
      h('div', { class: 'pop' },
        h('button', { type: 'button', onclick: safe(async (e) => { closeMenu(e.currentTarget); if (!me) return go('/login'); const r = await api('/posts/' + x.id + '/repost', { method: 'POST' }); x.reposted = r.reposted; x.reposts = r.reposts; redraw(); toast(r.reposted ? 'Reposted!' : 'Repost removed!'); }) }, x.reposted ? 'Undo repost' : 'Repost'),
        h('button', { type: 'button', onclick: (e) => { closeMenu(e.currentTarget); if (!me) return go('/login'); quoteDialog(x); } }, 'Quote'))) : null;
    const shareBtn = h('button', { class: 'act', type: 'button', 'aria-label': 'Copy link', title: 'Copy link', onclick: async () => { try { await navigator.clipboard.writeText(location.origin + '/post/' + x.id); toast('Link copied!'); } catch (e) { toast('Copy it from the address bar after opening the post!'); } } }, icon('share'));
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
    const moreMenu = h('details', { class: 'menu' }, h('summary', { class: 'act', 'aria-label': 'More' }, icon('more')), h('div', { class: 'pop right' }, items));

    const quoteEl = x.quote ? h('a', { class: 'quote', href: '/post/' + x.quote.id, 'data-link': true }, h('div', { class: 'ph' }, avatar(x.quote, false), h('span', { class: 'who' }, nameOf(x.quote)), h('span', { class: 'muted small' }, '@' + x.quote.username + ' · ' + ago(x.quote.created))), h('div', { class: 'qbody' }, x.quote.body.slice(0, 200)), x.quote.files && x.quote.files[0] && x.quote.files[0].image ? h('img', { class: 'qimg', src: '/api/files/' + x.quote.files[0].id, alt: x.quote.files[0].alt || '', loading: 'lazy' }) : null)
      : x.quoteGone ? h('div', { class: 'quote gone muted small' }, 'This post was deleted.') : null;

    const article = h('article', { class: 'post' + (opts.focus ? ' focus' : '') },
      avatar(x),
      h('div', { class: 'pb' },
        h('div', { class: 'ph' }, h('a', { class: 'who', href: '/u/' + enc(x.username), 'data-link': true }, nameOf(x)), h('span', { class: 'muted small' }, '@' + x.username), h('a', { class: 'when', href: '/post/' + x.id, 'data-link': true }, ago(x.created)), x.edited ? h('span', { class: 'muted small', title: 'Edited ' + new Date(x.edited).toLocaleString() }, '· edited') : null, opts.pinned ? h('span', { class: 'pinned' }, icon('pin'), 'Pinned') : null),
        bodyHolder,
        x.files.length ? filesView(x) : null,
        x.poll ? pollView(x, redraw) : null,
        quoteEl,
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
    const files = [];
    const tray = h('div', { class: 'tray' });
    const preview = h('div', { class: 'preview', hidden: true });
    let busy = 0;

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
      btn.disabled = left < 0 || !hasThing || busy > 0 || (opts.quote && !area.value.trim());
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
        const body = { body: area.value, parent: opts.parent, quote: opts.quote ? opts.quote.id : undefined, files: files.filter((f) => f.id).map((f) => ({ id: f.id, alt: f.alt || '' })) };
        if (pollOn) body.poll = { options: pollInputs.map((i) => i.value).filter((v) => v.trim()), hours: parseInt(dur.value, 10) };
        const r = await api('/posts', { method: 'POST', body });
        area.value = opts.prefill || '';
        store.set(dkey, '');
        files.length = 0;
        drawTray();
        if (pollOn) { pollInputs.forEach((i) => (i.value = '')); togglePoll(); }
        preview.hidden = true;
        if (opts.onPosted) opts.onPosted(r.post);
      } finally { update(); }
    }) },
      area, tray, pollBox, preview,
      opts.quote ? h('div', { class: 'quote small' }, h('b', null, nameOf(opts.quote)), ' ', '@' + opts.quote.username, h('div', { class: 'qbody' }, opts.quote.body.slice(0, 200))) : null,
      h('div', { class: 'row' }, h('div', { class: 'tools' }, imgBtn, fileBtn, opts.parent || opts.noPoll ? null : pollBtn, count), btn),
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
      r.posts.forEach((p) => list.append(postCard(p, { pinned: opts.pinnedId === p.id, onDelete: empty, onUnsave: opts.onUnsave && empty })));
      cursor = r.cursor;
      empty();
      if (r.more) more.append(h('button', { class: 'btn ghost', type: 'button', onclick: safe(load) }, 'Load more'));
      wrap.topId = wrap.topId || (r.posts[0] && r.posts[0].id);
    };
    wrap.add = (p) => { list.querySelectorAll('.empty').forEach((e) => e.remove()); list.prepend(postCard(p, { onDelete: empty })); };
    wrap.ready = load();
    return wrap;
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
    const tab = ['replies', 'media', 'likes'].includes(params().get('tab')) ? params().get('tab') : 'posts';
    const mineU = me && me.username.toLowerCase() === user.username.toLowerCase();
    const stats = h('div', { class: 'stats' });
    const fbtn = followBtn(user);
    const paint = () => stats.replaceChildren(h('span', null, h('b', null, user.posts), ' posts'), link('/u/' + enc(user.username) + '/followers', h('b', null, user.followers), ' followers'), link('/u/' + enc(user.username) + '/following', h('b', null, user.following), ' following'));
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
        h('div', { class: 'pbtns' }, mineU ? h('a', { class: 'btn ghost small', href: '/settings', 'data-link': true }, 'Edit profile') : fbtn, h('a', { class: 'btn ghost small', href: '/rss/user/' + enc(user.username), title: 'RSS feed' }, icon('rss')))),
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
    const addReply = (p) => replies.append(postCard(p, { noReplyLink: true, focus: p.id === r.focus && r.focus !== r.post.id, onDelete: () => {} }));
    r.replies.forEach(addReply);
    show(link('/', '← Back'),
      h('div', { class: 'card feed' }, postCard(r.post, { noReplyLink: true, focus: r.focus === r.post.id, onDelete: () => go('/', true) })),
      h('div', { class: 'pad' }),
      me ? composer({ parent: r.post.id, placeholder: 'Reply to ' + nameOf(r.post), button: 'Reply', label: 'Write a reply', onPosted: (p) => { addReply(p); toast('Replied!'); } }) : h('p', { class: 'muted' }, link('/login', 'Log in'), ' to reply.'),
      replies);
  }

  async function searchPage() {
    const qv = (params().get('q') || '').trim();
    const tab = ['people', 'topics'].includes(params().get('tab')) ? params().get('tab') : 'posts';
    document.getElementById('q').value = qv;
    setTitle('Search');
    drawSide();
    const tabs = h('div', { class: 'tabs' }, [['posts', 'Posts'], ['people', 'People'], ['topics', 'Topics']].map(([k, l]) => h('a', { href: '/search?q=' + enc(qv) + '&tab=' + k, 'data-link': true, class: tab === k ? 'on' : '' }, l)));
    if (!qv) return show(h('h1', null, 'Search'), h('p', { class: 'muted' }, 'Type something in the box at the top!'));
    if (tab === 'posts') {
      const f = feed('/feed', { q: qv }, { empty: 'No posts matched that!' });
      show(h('h1', null, 'Results for "' + qv + '"'), tabs, f);
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
    const muted = h('div');
    api('/mutes').then((m) => {
      muted.replaceChildren(
        m.users.length ? h('ul', { class: 'ulist' }, m.users.map((u) => h('li', { class: 'urow' }, h('span', { class: 'ut' }, link('/u/' + enc(u.username), '@' + u.username), ' ', h('span', { class: 'chip small' }, u.kind === 'block' ? 'Blocked' : 'Muted')), h('button', { class: 'btn ghost small', type: 'button', onclick: safe(async (e) => { await api('/users/' + enc(u.username) + '/' + (u.kind === 'block' ? 'block' : 'mute'), { method: 'POST' }); e.target.closest('li').remove(); }) }, 'Undo')))) : h('p', { class: 'muted' }, 'No muted or blocked people.'),
        m.topics.length ? h('p', null, 'Muted Topics: ', m.topics.map((t) => h('a', { class: 'chip', href: '/topic/' + enc(t), 'data-link': true }, '#' + t))) : null);
    }).catch(() => {});
    show(h('div', { class: 'card formcard wide' },
      h('h1', null, 'Settings'),
      h('p', null, 'Signed in as ', h('b', null, cur.username), '. ', h('button', { class: 'btn ghost small', onclick: async () => { await api('/logout', { method: 'POST' }); me = null; drawNav(); go('/'); } }, 'Log out')),
      h('h2', null, 'Your profile'),
      h('label', { for: 'dn' }, 'Display name'), dn,
      h('label', { for: 'bio' }, 'Bio (up to 160 characters)'), bio,
      h('label', { for: 'web' }, 'Website'), web,
      h('label', null, 'Avatar color'), sw,
      h('p', null, h('button', { class: 'btn', onclick: guard(err1, async () => { await api('/me', { method: 'PATCH', body: { display_name: dn.value, bio: bio.value, website: web.value, color } }); Object.assign(me, { display_name: dn.value.trim(), bio: bio.value.trim(), color }); drawNav(); toast('Saved!'); }) }, 'Save profile')), err1,
      h('h2', null, 'Muted and blocked'), muted,
      h('h2', null, 'Change your password'),
      h('label', { for: 'op' }, 'Current password'), oldPw, h('label', { for: 'np' }, 'New password (8 or more characters)'), newPw,
      h('p', null, h('button', { class: 'btn', onclick: guard(err2, async () => { await api('/me/password', { method: 'POST', body: { old: oldPw.value, new: newPw.value } }); oldPw.value = newPw.value = ''; toast('Password changed! You were signed out everywhere else.'); }) }, 'Change password')), err2,
      h('h2', null, 'Delete your account'),
      h('p', { class: 'muted' }, 'This removes your posts, pictures, likes and follows for good. Type your password to confirm.'),
      delPw,
      h('p', null, h('button', { class: 'btn danger', onclick: guard(err3, async () => { if (!confirm('Really delete your Beta account? This cannot be undone.')) return; await api('/me/delete', { method: 'POST', body: { password: delPw.value } }); me = null; drawNav(); go('/'); toast('Your account is deleted. Goodbye!'); }) }, 'Delete my account')), err3));
  }

  function shortcuts() {
    const rows = [['n', 'Write a new post'], ['/', 'Search'], ['g then h', 'Go home'], ['g then n', 'Notifications'], ['g then b', 'Saved posts'], ['?', 'Show this list'], ['Esc', 'Close pictures and menus']];
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
      const to = { h: '/', n: '/notifications', b: '/bookmarks' }[e.key];
      if (to) { e.preventDefault(); go(to); }
      return;
    }
    if (e.key === 'g') gPending = Date.now();
    else if (e.key === 'n') { const a = document.querySelector('.compose textarea'); if (a) { e.preventDefault(); a.focus(); } }
    else if (e.key === '/') { e.preventDefault(); document.getElementById('q').focus(); }
    else if (e.key === '?') shortcuts();
  });
  // a menu closes when you click anywhere else
  document.addEventListener('click', (e) => document.querySelectorAll('details.menu[open]').forEach((d) => { if (!d.contains(e.target)) d.removeAttribute('open'); }));

  // ---------- the router ----------
  async function render() {
    const my = ++tick;
    timers.forEach(clearInterval);
    timers = [];
    document.querySelectorAll('.lightbox').forEach((l) => l.remove());
    window.scrollTo(0, 0);
    const seg = location.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    try {
      const [a, b, c] = seg;
      if (!seg.length) await home();
      else if (a === 'login' && !b) authPage('login');
      else if (a === 'register' && !b) authPage('register');
      else if (a === 'settings' && !b) await settingsPage();
      else if (a === 'search' && !b) await searchPage();
      else if (a === 'notifications' && !b) await notificationsPage();
      else if (a === 'bookmarks' && !b) await bookmarksPage();
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

  api('/me').then((r) => { me = r.user; }).catch(() => {}).then(() => {
    drawNav();
    render();
    setInterval(refreshUnread, 60000);
  });
})();
