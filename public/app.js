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
  const setTitle = (t) => { const bt = window.BetaTheme && window.BetaTheme.title(); return (document.title = (t ? t + ' · ' : '') + (inst.isMain ? bt || 'Beta' : inst.name + ' · ' + (bt || 'Beta'))); };
  // the instance's theme: colors, icon (favicon and top-left) and title. It is kept in this browser so the next visit paints right away.
  function applyInstTheme() {
    const t = inst.theme && inst.theme.id !== 'default' ? inst.theme : null;
    try { if (t) localStorage.setItem('beta_inst_theme', JSON.stringify(t)); else localStorage.removeItem('beta_inst_theme'); } catch (e) {}
    if (window.BetaTheme) window.BetaTheme.apply(t);
    drawBrand();
  }
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
  // the instance this address belongs to (the main Beta, or a community like garden.beta.radii-office.com)
  let inst = { slug: 'main', name: 'Beta', isMain: true, reg: 'open', description: '', rules: '' }, instInfo = null, noInstance = false;
  const BADGE_TITLES = { verified: 'Verified', staff: 'Beta staff', supporter: 'Supporter' };
  const badgeEl = (u) => (u && u.badge ? h('span', { class: 'vbadge b-' + u.badge, title: BADGE_TITLES[u.badge] || u.badge, role: 'img', 'aria-label': BADGE_TITLES[u.badge] || u.badge }, '\u2713') : null);
  const REACT = ['\u{1F602}', '\u{1F525}', '\u{1F44F}', '\u{1F62E}', '\u{1F622}', '\u{1F389}'];
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
  const KD_HINT = /\*\S|__|~\S|==[A-Z]|\/\/[A-Z]|\(\([A-Z]|=[A-Za-z]=|`|#[A-Za-z0-9]{1,12}#|@@|::|\{(?:chip|caps|wide|glow|shadow|outline|rainbow|redact|blink|flip|sc|dots|dim|tip)\b|^\s*#{1,6}\s|^\s*>|^\s*[-+]\s|\[[A-Z]\]/m;
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

  // ---------- light and dark: a button in the top bar (Settings also has "match my device") ----------
  const THEME_KEY = 'beta_theme';
  const themeStore = {
    get: () => { try { return localStorage.getItem(THEME_KEY) || ''; } catch (e) { return ''; } },
    set: (v) => { try { v ? localStorage.setItem(THEME_KEY, v) : localStorage.removeItem(THEME_KEY); } catch (e) {} },
  };
  const isDark = () => { const t = document.documentElement.getAttribute('data-theme'); return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; };
  function setTheme(t) {
    themeStore.set(t === 'auto' ? '' : t);
    if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
    window.dispatchEvent(new Event('kd-recolor'));
    document.querySelectorAll('.themebtn').forEach((b) => b.replaceWith(themeBtn()));
  }
  function themeBtn() {
    const dark = isDark();
    return h('button', { class: 'themebtn', type: 'button', title: dark ? 'Switch to light mode' : 'Switch to dark mode', 'aria-label': dark ? 'Switch to light mode' : 'Switch to dark mode', onclick: () => setTheme(isDark() ? 'light' : 'dark') }, icon(dark ? 'sun' : 'moon'));
  }
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!themeStore.get()) document.querySelectorAll('.themebtn').forEach((b) => b.replaceWith(themeBtn())); }); } catch (e) {}

  function drawNav() {
    const nav = document.getElementById('nav');
    nav.replaceChildren();
    nav.append(themeBtn());
    const badge = (n) => (n ? h('span', { class: 'badge' }, n > 99 ? '99+' : n) : null);
    if (me) {
      const menu = h('details', { class: 'menu navmenu' }, h('summary', { class: 'navbtn', 'aria-label': 'More' }, icon('more')),
        h('div', { class: 'pop right' },
          h('a', { href: '/bookmarks', 'data-link': true }, 'Saved posts'),
          h('a', { href: '/instances', 'data-link': true }, 'Instances'),
          instInfo && instInfo.canManage ? h('a', { href: '/instance/settings', 'data-link': true }, 'Instance settings') : null,
          h('a', { href: '/scheduled', 'data-link': true }, 'Scheduled posts'),
          h('a', { href: '/stats', 'data-link': true }, 'Your stats'),
          h('a', { href: '/lists', 'data-link': true }, 'Lists'),
          h('a', { href: '/settings', 'data-link': true }, 'Settings'),
          me.admin || me.mod ? h('a', { href: '/admin', 'data-link': true }, me.admin ? 'Admin' : 'Moderation') : null,
          h('button', { type: 'button', onclick: () => shortcuts() }, 'Keyboard shortcuts'),
          h('button', { type: 'button', onclick: safe(async () => { await api('/logout', { method: 'POST' }); me = null; drawNav(); go('/'); }) }, 'Log out')));
      nav.append(
        h('a', { class: 'navbtn', href: '/outlets', 'data-link': true, title: 'Outlets (g then o)', 'aria-label': 'Outlets' }, icon('forum')),
        h('a', { class: 'navbtn', href: '/explore', 'data-link': true, title: 'Explore (g then e)', 'aria-label': 'Explore' }, icon('explore')),
        h('a', { class: 'navbtn', href: '/messages', 'data-link': true, title: 'Messages (g then m)', 'aria-label': 'Messages' }, icon('mail'), badge(me.dmUnread)),
        h('a', { class: 'navbtn', href: '/notifications', 'data-link': true, title: 'Notifications (g then n)', 'aria-label': 'Notifications' }, icon('bell'), badge(me.unread)),
        h('a', { class: 'navuser', href: '/u/' + enc(me.username), 'data-link': true, title: 'Your profile' }, avatar(me), h('span', { class: 'navname' }, nameOf(me))),
        menu);
    } else nav.append(h('a', { class: 'navbtn', href: '/instances', 'data-link': true, title: 'Instances', 'aria-label': 'Instances' }, icon('users')), h('a', { class: 'navbtn', href: '/outlets', 'data-link': true, title: 'Outlets', 'aria-label': 'Outlets' }, icon('forum')), h('a', { class: 'navbtn', href: '/explore', 'data-link': true, title: 'Explore', 'aria-label': 'Explore' }, icon('explore')), h('a', { class: 'btn ghost small', href: '/login', 'data-link': true }, 'Log in'), h('a', { class: 'btn small', href: '/register', 'data-link': true }, 'Sign up'));
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
  // ---------- Friends: mutual, and separate from following ----------
  let fcache = null;
  async function loadFriends() {
    fcache = null;
    if (!me) return;
    try {
      const r = await api('/friends');
      const low = (a) => new Set(a.map((x) => String(x.username || x).toLowerCase()));
      fcache = { friends: low(r.friends), incoming: low(r.incoming), outgoing: low(r.outgoing) };
    } catch (e) { fcache = null; }
  }
  const friendStateOf = (name) => { if (!fcache) return null; const k = String(name).toLowerCase(); return fcache.friends.has(k) ? 'friends' : fcache.incoming.has(k) ? 'incoming' : fcache.outgoing.has(k) ? 'outgoing' : 'none'; };
  async function friendAct(username, action) {
    const r = await api('/users/' + enc(username) + '/friend', { method: 'POST', body: { action } });
    if (fcache) { const k = username.toLowerCase(); ['friends', 'incoming', 'outgoing'].forEach((n) => fcache[n].delete(k)); if (r.state === 'friends') fcache.friends.add(k); else if (r.state === 'outgoing') fcache.outgoing.add(k); }
    return r;
  }
  // one button that follows the state: Add friend, Requested (press to cancel), Accept, Friends (press to unfriend)
  const friendBtn = (u, state, small, onState) => {
    const wrap = h('span', { class: 'fbtns' });
    const b = h('button', { class: 'btn' + (small ? ' small' : ''), type: 'button' });
    const decline = h('button', { class: 'btn ghost' + (small ? ' small' : ''), type: 'button', hidden: true }, 'Decline');
    const paint = () => {
      b.textContent = { none: 'Add friend', outgoing: 'Requested', incoming: 'Accept', friends: 'Friends' }[state] || 'Add friend';
      b.className = 'btn' + (small ? ' small' : '') + (state === 'friends' || state === 'outgoing' ? ' on' : '');
      b.title = { none: 'Send a friend request', outgoing: 'Press to cancel your request', incoming: 'Accept their friend request', friends: 'Press to unfriend' }[state] || '';
      decline.hidden = state !== 'incoming';
    };
    const run = async (action, msg) => { const r = await friendAct(u.username, action); state = r.state; if (u.friends !== undefined && u.friends !== null) u.friends = r.friends; if (u.friendState !== undefined) u.friendState = state; paint(); if (onState) onState(state); if (msg) toast(msg(state)); };
    b.addEventListener('click', safe(async () => {
      if (!me) return go('/login');
      if (state === 'none') await run('request', (st) => (st === 'friends' ? 'You are friends now!' : 'Friend request sent!'));
      else if (state === 'outgoing') await run('cancel', () => 'Request canceled!');
      else if (state === 'incoming') await run('accept', () => 'You are friends now!');
      else if (confirm('Unfriend @' + u.username + '? Friends-only posts will be hidden from each other.')) await run('unfriend', () => 'Unfriended!');
    }));
    decline.addEventListener('click', safe(() => run('decline', () => 'Request declined!')));
    paint();
    wrap.append(b, decline);
    return wrap;
  };
  const userRow = (u, withFriend) => h('li', { class: 'urow' }, avatar(u), h('div', { class: 'ut' }, h('a', { class: 'who', href: '/u/' + enc(u.username), 'data-link': true }, nameOf(u)), h('div', { class: 'muted small' }, '@' + u.username + (u.bio ? ' · ' + u.bio : ''))), me && me.username !== u.username && u.isFollowing !== undefined ? followBtn(u, true) : null, withFriend && me && me.username !== u.username && (!u.inst_slug || u.inst_slug === inst.slug) && friendStateOf(u.username) ? friendBtn(u, friendStateOf(u.username), true) : null);

  async function drawSide() {
    try {
      const [t, s, ol] = await Promise.all([api('/topics?local=1'), api('/suggest?local=1'), me ? api('/outlets/mine') : api('/outlets?limit=5')]);
      const outletsCard = me
        ? h('nav', { class: 'card side osb', 'aria-label': 'Your Outlets' }, h('h2', null, link('/outlets', 'Outlets')),
            ol.outlets.length ? ol.outlets.map((o) => h('details', { class: 'osub' }, h('summary', null, outletBadge(o), h('span', { class: 'oname2' }, o.name)),
              h('ul', null, h('li', null, link(outletPath(o.slug), 'All of ' + o.name)), o.subjects.map((sj) => h('li', null, link(outletPath(o.slug, sj.slug), '# ' + sj.name)))))) : h('p', { class: 'muted small' }, 'You have not joined any Outlets yet.'),
            h('p', { class: 'small' }, link('/outlets', 'Browse every Outlet'), ' · ', link('/outlets/new', 'Make one')))
        : h('nav', { class: 'card side osb', 'aria-label': 'Popular Outlets' }, h('h2', null, link('/outlets', 'Outlets')), ol.outlets.length ? h('ul', { class: 'olist' }, ol.outlets.map((o) => h('li', null, outletBadge(o), link(outletPath(o.slug), o.name), h('span', { class: 'muted small' }, o.members + ' members')))) : h('p', { class: 'muted small' }, 'No Outlets yet.'));
      put(side,
        instCard(),
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
    const muteHit = !mineP && me && me.filters && me.filters.length && x.body ? me.filters.find((w) => x.body.toLowerCase().includes(w)) : null;
    const hidden = (!!x.cw || !!muteHit) && !(opts.revealed && opts.revealed.has(x.id));

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
    const react = safe(async (emoji) => {
      if (!me) return go('/login');
      const r = await api('/posts/' + x.id + '/react', { method: 'POST', body: { emoji } });
      x.reactions = r.reactions; x.myReaction = r.myReaction; redraw();
    });
    const reactMenu = h('details', { class: 'menu' }, h('summary', { class: 'act' + (x.myReaction ? ' on' : ''), 'aria-label': 'React with an emoji', title: 'React' }, x.myReaction ? h('span', { class: 'mre' }, x.myReaction) : icon('smile')),
      h('div', { class: 'pop rxpop' }, REACT.map((e) => h('button', { type: 'button', 'aria-label': 'React ' + e, onclick: (ev) => { closeMenu(ev.currentTarget); react(e); } }, e))));
    const rxBar = x.reactions && Object.keys(x.reactions).length ? h('div', { class: 'rxbar' }, Object.entries(x.reactions).sort((a, b) => b[1] - a[1]).map(([e, n]) =>
      h('button', { type: 'button', class: 'rx' + (x.myReaction === e ? ' mine' : ''), 'aria-pressed': String(x.myReaction === e), 'aria-label': e + ' ' + n, onclick: () => react(e) }, e + ' ', h('b', null, n)))) : null;
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
    if (x.edited) items.push(h('button', { type: 'button', onclick: act(async () => { const r = await api('/posts/' + x.id + '/history'); historyDialog(r.versions); }) }, 'Edit history'));
    if (me) items.push(h('button', { type: 'button', onclick: act(async () => { const r = await api('/posts/' + (x.parent_id || x.id) + '/mutethread', { method: 'POST' }); x.threadMuted = r.muted; toast(r.muted ? 'Muted! No more notifications from this thread.' : 'Unmuted!'); redraw(); }) }, x.threadMuted ? 'Unmute this thread' : 'Mute this thread'));
    if (me && x.bookmarked) items.push(h('button', { type: 'button', onclick: act(async () => { await folderPicker(x, redraw); }) }, 'Move to a folder'));
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
    const warn = hidden ? h('div', { class: 'cwbox' }, icon('warn'), h('b', null, x.cw || 'Hidden: you muted \u201C' + muteHit + '\u201D'), h('button', { class: 'btn ghost small', type: 'button', onclick: () => { (opts.revealed = opts.revealed || new Set()).add(x.id); redraw(); } }, 'Show')) : (x.cw ? h('div', { class: 'cwnote muted small' }, icon('warn'), x.cw) : null);
    const article = h('article', { class: 'post' + (opts.focus ? ' focus' : '') },
      avatar(x),
      h('div', { class: 'pb' },
        h('div', { class: 'ph' }, h('a', { class: 'who', href: '/u/' + enc(x.username), 'data-link': true }, nameOf(x)), badgeEl(x), h('span', { class: 'muted small' }, '@' + x.username), x.inst_slug && x.inst_slug !== inst.slug && !x.username.includes("@") ? h('span', { class: 'itag', title: 'From the ' + x.inst_slug + ' instance' }, x.inst_slug) : null, h('a', { class: 'when', href: '/post/' + x.id, 'data-link': true }, ago(x.created)), x.edited ? h('span', { class: 'muted small', title: 'Edited ' + new Date(x.edited).toLocaleString() }, '· edited') : null, x.vis === 'friends' ? h('span', { class: 'pinned friendsonly', title: 'Only friends can see this post' }, icon('users'), 'Friends only') : null, opts.pinned || (ol && ol.pinned) ? h('span', { class: 'pinned' }, icon('pin', 'solid'), 'Pinned') : null, ol && ol.locked ? h('span', { class: 'pinned' }, icon('lock'), 'Locked') : null),
        outletChip,
        x.replyPolicy ? h('div', { class: 'ptag muted small' }, icon('lock'), x.replyPolicy === 'following' ? ' Only people the author follows can reply' : ' Only mentioned people can reply') : null,
        warn,
        hidden ? null : bodyHolder,
        hidden ? null : (x.files.length ? filesView(x) : null),
        hidden ? null : (x.poll ? pollView(x, redraw) : null),
        hidden ? null : quoteEl,
        hidden ? null : rxBar,
        h('div', { class: 'acts' },
          opts.noReplyLink ? null : h('a', { class: 'act', href: '/post/' + x.id, 'data-link': true, 'aria-label': 'Replies' }, icon('comment'), x.replies || ''),
          repostMenu, likeBtn, reactMenu, bmBtn, shareBtn, moreMenu)));
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

    // schedule it for later, and choose who can reply
    const canPolicy = !opts.parent && !opts.quote && !opts.outlet;
    const when = h('input', { type: 'datetime-local', class: 'whenin', 'aria-label': 'When to post', hidden: true });
    const schedBtn = opts.parent || opts.quote ? null : h('button', { class: 'act txt', type: 'button', 'aria-pressed': 'false', title: 'Schedule this post for later', onclick: () => {
      when.hidden = !when.hidden;
      schedBtn.setAttribute('aria-pressed', String(!when.hidden));
      if (!when.hidden) { const d = new Date(Date.now() + 3600000); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); when.value = d.toISOString().slice(0, 16); }
      else when.value = '';
      btn.textContent = when.hidden ? (opts.button || 'Post') : 'Schedule';
    } }, 'Later');
    const repSel = canPolicy ? h('select', { class: 'subsel', 'aria-label': 'Who can reply' }, [['everyone', 'Anyone can reply'], ['following', 'People I follow can reply'], ['mentioned', 'Only people I mention can reply']].map(([v, l]) => h('option', { value: v }, l))) : null;
    // who can see it: everyone, or only your friends
    const visSel = !opts.parent && !opts.outlet && me ? h('select', { class: 'subsel', 'aria-label': 'Who can see this post' }, [['', 'Everyone can see it'], ['friends', 'Friends only']].map(([v, l]) => h('option', { value: v }, l))) : null;
    // @name suggestions
    const ac = h('div', { class: 'ac card', hidden: true, role: 'listbox' });
    let acT = 0;
    const acHide = () => { ac.hidden = true; };
    area.addEventListener('input', () => {
      clearTimeout(acT);
      const m = /(?:^|[^A-Za-z0-9_@])@([A-Za-z0-9_-]{1,29})$/.exec(area.value.slice(0, area.selectionStart));
      if (!m || !me) return acHide();
      acT = setTimeout(async () => {
        try {
          const r = await api('/mention?q=' + enc(m[1]));
          if (!r.users.length) return acHide();
          ac.replaceChildren(...r.users.map((u) => h('button', { type: 'button', role: 'option', onclick: () => {
            const at = area.selectionStart - m[1].length;
            area.setRangeText(u.username + ' ', at, area.selectionStart, 'end');
            acHide(); area.focus(); area.dispatchEvent(new Event('input'));
          } }, avatar(u), h('span', null, h('b', null, nameOf(u)), ' @' + u.username))));
          ac.hidden = false;
        } catch (e) { acHide(); }
      }, 160);
    });
    area.addEventListener('blur', () => setTimeout(acHide, 200));
    // formatting helpers: wrap the selected words, or put a ready-made block on its own line
    const wrap = (open, close, hint) => {
      const s0 = area.selectionStart, e0 = area.selectionEnd, sel = area.value.slice(s0, e0) || hint;
      area.setRangeText(open + sel + close, s0, e0, 'end');
      if (!area.value.slice(s0, e0)) area.setSelectionRange(s0 + open.length, s0 + open.length + sel.length);
      area.focus(); area.dispatchEvent(new Event('input'));
    };
    const line = (text) => {
      const at = area.selectionEnd, before = area.value.slice(0, at), lead = before && !/\n$/.test(before) ? '\n' : '';
      area.setRangeText(lead + text + '\n', at, at, 'end');
      area.focus(); area.dispatchEvent(new Event('input'));
    };
    const FORMATS = [
      ['Bold', () => wrap('**', '**', 'bold')], ['Italic', () => wrap('*', '*', 'italic')], ['Code', () => wrap('`', '`', 'code')], ['Underline', () => wrap('__', '__', 'underline')], ['Strikethrough', () => wrap('-_', '_-', 'strike')],
      ['Spoiler', () => wrap('@spoiler-1@', '@', 'hidden words')], null,
      ['ALL CAPS', () => wrap('{caps}', '{/caps}', 'loud')], ['Wide spacing', () => wrap('{wide}', '{/wide}', 'spread out')], ['Glow', () => wrap('{glow}', '{/glow}', 'shine')], ['Drop shadow', () => wrap('{shadow}', '{/shadow}', 'lifted')],
      ['Outline', () => wrap('{outline}', '{/outline}', 'outlined')], ['Rainbow', () => wrap('{rainbow}', '{/rainbow}', 'colorful')], ['Redacted', () => wrap('{redact}', '{/redact}', 'secret')], ['Mirror', () => wrap('{flip}', '{/flip}', 'mirror')], null,
      ['Chip: Pill', () => wrap('{chip blue}', '{/chip}', 'label')], ['Chip: Soft', () => wrap('{chip green soft}', '{/chip}', 'label')], ['Chip: Outline', () => wrap('{chip red outline}', '{/chip}', 'label')], ['Chip: Status dot', () => wrap('{chip orange dot}', '{/chip}', 'label')], ['Chip: Price tag', () => wrap('{chip purple tag}', '{/chip}', 'label')], ['Chip: Ticket', () => wrap('{chip teal ticket}', '{/chip}', 'label')], ['Chip: Arrow', () => wrap('{chip pink arrow}', '{/chip}', 'label')], ['Chip: Ribbon', () => wrap('{chip gold ribbon}', '{/chip}', 'label')], ['Chip: Stamp', () => wrap('{chip red stamp}', '{/chip}', 'label')], ['Chip: Sticker', () => wrap('{chip lime sticker}', '{/chip}', 'label')], ['Chip: Highlighter', () => wrap('{chip yellow marker}', '{/chip}', 'label')], ['Chip: Neon sign', () => wrap('{chip cyan neon}', '{/chip}', 'label')], ['Chip: LED display', () => wrap('{chip green led}', '{/chip}', 'label')], ['Chip: Cut corners', () => wrap('{chip slate chamfer}', '{/chip}', 'label')], null,
      ['Chip: Wax Seal', () => wrap('~~R~', '~~', 'label')], ['Chip: Pixel', () => wrap('~~O=', '~~', 'label')], ['Chip: Candy Cane', () => wrap('~~GL.', '~~', 'label')], ['Chip: Neon Tube', () => wrap('==Y=', '==', 'label')], ['Chip: Marquee', () => wrap('==L~', '==', 'label')], ['Chip: Crystal', () => wrap('==G.', '==', 'label')], ['Chip: Washi Tape', () => wrap('//TU/', '//', 'label')], ['Chip: Sticker', () => wrap('//T~', '//', 'label')], ['Chip: Holo Foil', () => wrap('//C.', '//', 'label')], ['Chip: Blueprint', () => wrap('((B(', '))', 'label')], ['Chip: Pebble', () => wrap('((PR=', '))', 'label')], ['Chip: Ticket Stub', () => wrap('((PK.', '))', 'label')], ['Chip: Glossy tape', () => wrap('==B^', '==', 'label')], null,
      ['Progress bar', () => line('::progress 70% Label')], ['Star rating', () => line('::rating 4/5 Review')], ['Countdown', () => line('::countdown ' + new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10) + ' Big day')],
      ['Steps', () => line('::steps Plan\n* [x] First\n* Next\n* Last\n::end')], ['Stat tiles', () => line('::stats Numbers\n| Visitors | 1,204 | +12% |\n| Sales | 85 | -3% |\n::end')], ['Foldout', () => line('::fold Click to open\nHidden words here.\n::end')], ['Timeline', () => line('::timeline Story\n* 2019 - Began\n* 2022 - Grew\n::end')],
    ];
    const fmtMenu = h('details', { class: 'menu' }, h('summary', { class: 'act txt', 'aria-label': 'Format text', title: 'Format text' }, 'Aa'),
      h('div', { class: 'pop fmtpop' }, FORMATS.map((f) => (f ? h('button', { type: 'button', onclick: (ev) => { closeMenuOf(ev.currentTarget); f[1](); } }, f[0]) : h('hr')))));
    function closeMenuOf(btn) { const d = btn.closest('details'); if (d) d.removeAttribute('open'); }
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
        if (repSel && repSel.value !== 'everyone') body.replies = repSel.value;
        if (visSel && visSel.value) body.vis = visSel.value;
        const sched = !when.hidden && when.value && !opts.parent && !opts.quote;
        if (sched) body.at = new Date(when.value).getTime();
        const r = sched ? await api('/scheduled', { method: 'POST', body }) : await api('/posts', { method: 'POST', body });
        if (sched) { toast('Scheduled for ' + new Date(body.at).toLocaleString() + '!'); when.value = ''; when.hidden = true; schedBtn.setAttribute('aria-pressed', 'false'); btn.textContent = opts.button || 'Post'; }
        // the rest of a thread: each one replies to the first
        if (!sched) for (const t of extras.filter((x) => x.value.trim())) await api('/posts', { method: 'POST', body: { body: t.value, parent: r.post.id } });
        extras.length = 0;
        extraBox.replaceChildren();
        if (cwOn) { cwIn.value = ''; cwBtn.click(); }
        area.value = opts.prefill || '';
        store.set(dkey, '');
        files.length = 0;
        drawTray();
        if (pollOn) { pollInputs.forEach((i) => (i.value = '')); togglePoll(); }
        preview.hidden = true;
        if (!sched && opts.onPosted) opts.onPosted(r.post);
      } finally { update(); }
    }) },
      subSel ? h('label', { class: 'small muted subrow' }, icon('forum'), ' Post in ', subSel) : null,
      area, ac, cwIn, tray, pollBox, extraBox, preview,
      schedBtn ? h('div', { class: 'schedrow' }, when) : null,
      repSel || visSel ? h('div', { class: 'small muted subrow subpair' }, repSel ? h('span', { class: 'subitem' }, icon('lock'), ' ', repSel) : null, visSel ? h('span', { class: 'subitem' }, icon('users'), ' ', visSel) : null) : null,
      opts.quote ? h('div', { class: 'quote small' }, h('b', null, nameOf(opts.quote)), ' ', '@' + opts.quote.username, h('div', { class: 'qbody' }, opts.quote.body.slice(0, 200))) : null,
      h('div', { class: 'row' }, h('div', { class: 'tools' }, imgBtn, fileBtn, fmtMenu, opts.parent || opts.noPoll ? null : pollBtn, cwBtn, emojiMenu, opts.parent || opts.quote ? null : threadBtn, schedBtn, count), btn),
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
    const tabParam = params().get('tab');
    // before you log in, the main Beta is a front door: pick where to join
    if (!me && !tabParam && inst.isMain) return landingPage();
    const tab = ['home', 'friends', 'local', 'all'].includes(tabParam) && (tabParam !== 'friends' || me) ? tabParam : 'local';
    const query = tab === 'home' && me ? { scope: 'home' } : tab === 'friends' ? { scope: 'friends' } : tab === 'local' ? { scope: 'local' } : {};
    const f = feed('/feed', query, { empty: tab === 'home' ? 'Your home feed is empty. Follow people and Topics, or look at the Local and Federated timelines!' : tab === 'friends' ? 'Nothing from friends yet! Add a few friends from their profiles, and post something Friends only!' : 'No posts yet. Be the first!' });
    const banner = h('button', { class: 'btn newposts', type: 'button', hidden: true, onclick: () => render() }, 'New posts, show them!');
    const onTab = (k, label, title) => h('a', { href: k === 'local' ? '/' : '/?tab=' + k, 'data-link': true, class: tab === k ? 'on' : '', title }, label);
    show(
      !me ? instanceHero() : null,
      me ? composer({ onPosted: (p) => { f.add(p); toast('Posted!'); drawSide(); } }) : null,
      h('div', { class: 'tabs' }, onTab('local', 'Local', 'Everyone on ' + inst.name), me ? onTab('home', 'Following', 'People and Topics you follow') : null, me ? onTab('friends', 'Friends', 'You and your friends') : null, onTab('all', 'Federated', 'Every instance together')),
      banner, f);
    await f.ready;
    timers.push(setInterval(async () => {
      try {
        const r = await api('/feed?limit=1' + (tab === 'home' && me ? '&scope=home' : tab === 'friends' ? '&scope=friends' : tab === 'local' ? '&scope=local' : ''));
        if (r.posts[0] && f.topId && r.posts[0].id > f.topId && !(me && r.posts[0].username === me.username)) banner.hidden = false;
      } catch (e) {}
    }, 45000));
  }

  // ---------- instances: communities at name.beta.radii-office.com, all part of one Beta ----------
  const REG_WORDS = { open: 'Open sign-up', invite: 'Invite only', closed: 'Not accepting members' };
  function drawBrand() {
    const b = document.querySelector('.brand span');
    if (b) put(b, (window.BetaTheme && window.BetaTheme.title()) || 'Beta', inst.isMain ? null : h('small', { class: 'instname' }, inst.name));
  }
  function noInstancePage() {
    setTitle('No such instance');
    side.replaceChildren();
    const main = location.protocol + '//' + location.hostname.replace(/^[^.]+\./, '') + (location.port ? ':' + location.port : '');
    return h('div', { class: 'card empty' }, h('h1', null, 'There is no Beta instance here!'), h('p', null, 'Nobody has made an instance at this address yet. It could be yours!'),
      h('p', null, h('a', { class: 'btn', href: main + '/instances/new' }, 'Make an instance'), ' ', h('a', { class: 'btn ghost', href: main + '/instances' }, 'See every instance')));
  }
  function themeDot(i) {
    const r = i.theme && window.BetaTheme ? window.BetaTheme.resolve(i.theme) : null;
    return r && r.icon ? h('img', { class: 'ithemeic', src: r.icon, alt: '', width: 22, height: 22 }) : null;
  }
  function instanceCard(i, opts = {}) {
    const here = i.slug === inst.slug;
    return h('article', { class: 'icard' + (i.isMain ? ' main' : '') + (here ? ' here' : '') },
      h('div', { class: 'ihead' }, themeDot(i), h('h3', null, i.name), i.isMain ? h('span', { class: 'chip small' }, 'Main') : null, here ? h('span', { class: 'chip small' }, 'You are here') : null),
      h('p', { class: 'idesc' }, i.description || (i.isMain ? 'The original Beta instance. Everyone is welcome!' : 'A Beta community.')),
      h('div', { class: 'imeta small muted' }, i.members + (i.members === 1 ? ' member' : ' members') + ' · ' + i.posts + (i.posts === 1 ? ' post' : ' posts') + ' · ' + REG_WORDS[i.reg]),
      h('div', { class: 'row2' }, i.reg === 'closed' ? null : h('a', { class: 'btn small', href: i.url + '/register' }, 'Join'), h('a', { class: 'btn ghost small', href: i.url + '/?tab=local' }, 'Look around'),
        h('span', { class: 'iurl small muted' }, i.url.replace(/^https?:\/\//, ''))));
  }
  async function landingPage() {
    side.replaceChildren();
    const r = await api('/instances');
    const grid = h('div', { class: 'igrid' });
    const draw = (list) => put(grid, list.length ? list.map((i) => instanceCard(i)) : h('p', { class: 'muted' }, 'No instance matches that. Why not make it?'));
    draw(r.instances);
    const find = h('input', { type: 'search', placeholder: 'Find an instance', 'aria-label': 'Find an instance', maxlength: 40 });
    let tm = 0;
    find.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(safe(async () => { draw((await api('/instances?q=' + enc(find.value.trim()))).instances); }), 220); });
    const step = (n, t, d) => h('div', { class: 'step3' }, h('b', { class: 'n' }, n), h('h3', null, t), h('p', { class: 'muted' }, d));
    show(h('div', { class: 'landing' },
      h('section', { class: 'lhero' }, h('img', { class: 'llogo', src: '/logo.png', alt: '', width: 56, height: 60 }),
        h('h1', null, 'Short posts. Big conversations. Your corner of the network!'),
        h('p', { class: 'lead' }, 'Beta is a microblog made of instances: friendly communities that each have their own people, rules and local timeline, all connected by one Federated timeline. Join the main instance, pick a community, or start your own!'),
        h('p', { class: 'row2c' }, h('a', { class: 'btn', href: '/register', 'data-link': true }, 'Join the main instance'), ' ', h('a', { class: 'btn ghost', href: '/login', 'data-link': true }, 'Log in'), ' ', h('a', { class: 'btn ghost', href: '/instances/new', 'data-link': true }, 'Start your own instance'))),
      h('section', null, h('div', { class: 'row' }, h('h2', null, 'Pick an instance'), find), grid),
      h('section', { class: 'how' }, step('1', 'Instances are communities', 'Each one lives at its own address, like garden.beta.radii-office.com, with its own members, rules and sign-up policy.'),
        step('2', 'One network', 'The Local timeline is just your instance. The Federated timeline shows every instance together, and you can follow and reply across them.'),
        step('3', 'Make your own', 'Pick a name and an address, choose open, invite-only or closed sign-up, and you are the admin. It takes a minute!'))));
  }
  function instanceHero() {
    return h('section', { class: 'hero' }, h('h1', null, inst.isMain ? 'Short posts. Big conversations!' : 'Welcome to ' + inst.name + '!'),
      h('p', null, inst.isMain ? 'Beta is a microblog where every post can live in a Topic. Add a #hashtag, a picture, a poll or a file, and join the conversation!' : (inst.description || 'A community on Beta.')),
      inst.rules ? h('details', { class: 'irules' }, h('summary', null, 'House rules'), h('div', { class: 'vbody' }, inst.rules)) : null,
      h('p', null, inst.reg === 'closed' ? h('span', { class: 'muted' }, 'This instance is not accepting new members right now. ') : h('a', { class: 'btn', href: '/register', 'data-link': true }, 'Join ' + (inst.isMain ? 'Beta' : inst.name)), ' ', h('a', { class: 'btn ghost', href: '/login', 'data-link': true }, 'Log in'), ' ', link('/instances', 'All instances')));
  }
  async function instancesPage() {
    setTitle('Instances');
    side.replaceChildren();
    const r = await api('/instances');
    const grid = h('div', { class: 'igrid' });
    const draw = (list) => put(grid, list.length ? list.map((i) => instanceCard(i)) : h('p', { class: 'muted' }, 'No instance matches that!'));
    draw(r.instances);
    const find = h('input', { type: 'search', placeholder: 'Find an instance', 'aria-label': 'Find an instance', maxlength: 40 });
    let tm = 0;
    find.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(safe(async () => { draw((await api('/instances?q=' + enc(find.value.trim()))).instances); }), 220); });
    show(h('div', { class: 'row' }, h('h1', null, 'Instances'), h('a', { class: 'btn small', href: '/instances/new', 'data-link': true }, 'Make an instance')),
      h('p', { class: 'muted' }, 'Every instance is its own community, and they are all part of one Beta. Your account lives on the instance where you joined!'), h('div', { class: 'row2' }, find), grid);
  }
  function newInstancePage() {
    setTitle('Make an instance');
    side.replaceChildren();
    const err = errBox();
    const name = h('input', { id: 'in', maxlength: 40, placeholder: 'Garden Club', required: true });
    const slug = h('input', { id: 'is', maxlength: 30, placeholder: 'garden', required: true, autocapitalize: 'off', spellcheck: 'false' });
    const desc = h('input', { id: 'id', maxlength: 300, placeholder: 'What is it about?' });
    const rules = h('textarea', { id: 'ir', rows: 4, maxlength: 1500, placeholder: 'Be kind. No spam. Keep it on topic.' });
    const reg = h('select', { id: 'ig' }, [['open', 'Open: anyone can join'], ['invite', 'Invite only: people need a code'], ['closed', 'Closed: nobody new for now']].map(([v, l]) => h('option', { value: v }, l)));
    const user = h('input', { id: 'iu', maxlength: 20, autocomplete: 'username', required: true });
    const pw = h('input', { id: 'ip', type: 'password', autocomplete: 'new-password', required: true });
    let touched = false;
    slug.addEventListener('input', () => { touched = true; });
    name.addEventListener('input', () => { if (!touched) slug.value = name.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30); });
    const host = location.hostname.replace(/^[^.]+\.(?=.*beta\.)/, '');
    const done = h('div');
    const form = h('form', { class: 'card formcard wide', onsubmit: guard(err, async () => {
      const r = await api('/instances', { method: 'POST', body: { name: name.value, slug: slug.value, description: desc.value, rules: rules.value, reg: reg.value, username: user.value, password: pw.value } });
      form.hidden = true;
      put(done, h('div', { class: 'card formcard wide' }, h('h1', null, 'Your instance is live!'), h('p', null, h('b', null, r.url.replace(/^https?:\/\//, ''))),
        h('p', { class: 'muted' }, 'You are its admin as @' + r.username + '. Log in there with the password you just chose!'), h('p', null, h('a', { class: 'btn', href: r.url + '/login' }, 'Go to your instance'))));
    }) },
      h('h1', null, 'Make an instance'),
      h('p', { class: 'muted' }, 'An instance is your own community inside Beta. You pick the name, the rules and who may join, and you are its admin!'),
      h('label', { for: 'in' }, 'Name'), name,
      h('label', { for: 'is' }, 'Address'), h('div', { class: 'slugrow' }, slug, h('span', { class: 'muted' }, '.' + host.replace(/^beta\./, 'beta.'))),
      h('label', { for: 'id' }, 'Description'), desc,
      h('label', { for: 'ir' }, 'House rules'), rules,
      h('label', { for: 'ig' }, 'Sign-up'), reg,
      h('h2', null, 'Your admin account'), h('p', { class: 'muted small' }, 'Accounts live on one instance, so this one is made on your new instance. Usernames are unique on each instance!'),
      h('label', { for: 'iu' }, 'Username'), user, h('label', { for: 'ip' }, 'Password (8 or more characters)'), pw,
      err, h('p', null, h('button', { class: 'btn', type: 'submit' }, 'Create the instance')));
    show(form, done);
  }
  async function instanceSettingsPage() {
    if (!me) return go('/login', true);
    const r = await api('/instance');
    inst = r.instance; instInfo = r;
    if (!r.canManage) return show(h('div', { class: 'card empty' }, h('h2', null, 'Only the instance admin can do that'), link('/', 'Back home')));
    setTitle('Instance settings');
    side.replaceChildren();
    const i = r.instance;
    const err = errBox();
    const name = h('input', { id: 'sn', maxlength: 40, value: i.name });
    const desc = h('input', { id: 'sd', maxlength: 300, value: i.description });
    const rules = h('textarea', { id: 'sr', rows: 5, maxlength: 1500, value: i.rules });
    const reg = h('select', { id: 'sg', disabled: i.isMain }, [['open', 'Open: anyone can join'], ['invite', 'Invite only: people need a code'], ['closed', 'Closed: nobody new for now']].map(([v, l]) => h('option', { value: v, selected: i.reg === v }, l)));
    const listed = h('input', { type: 'checkbox', id: 'sl', checked: i.listed, disabled: i.isMain });
    const code = h('div', { class: 'codebox' });
    const BT = window.BetaTheme;
    let th = { id: 'default', accent: '#0ea5e9', title: '', icon: '', ...(i.theme || {}) };
    const picker = h('div', { class: 'themepick', role: 'radiogroup', 'aria-label': 'Theme' });
    const custom = h('div', { class: 'themecustom' });
    const preview = () => { if (BT) BT.apply(th.id === 'default' ? null : th); drawBrand(); setTitle('Instance settings'); };
    const drawThemes = () => {
      put(picker, [...Object.keys(BT.BUILTIN), 'custom'].map((id) => {
        const b = BT.BUILTIN[id], r = id === 'custom' ? BT.resolve({ id: 'custom', accent: th.accent, icon: th.icon }) : id === 'default' ? null : BT.resolve({ id });
        const sw = id === 'default' ? h('img', { src: '/logo.png', alt: '', width: 28, height: 28 }) : r && r.icon ? h('img', { src: r.icon, alt: '', width: 28, height: 28 }) : h('span', { class: 'dotc', style: 'background:' + th.accent });
        return h('button', { type: 'button', role: 'radio', 'aria-checked': String(th.id === id), class: 'themeopt' + (th.id === id ? ' on' : ''), onclick: () => { th = { ...th, id }; drawThemes(); preview(); } }, sw, h('span', null, id === 'custom' ? 'Custom' : b.name));
      }));
      const accent = h('input', { type: 'color', id: 'tac', value: th.accent || '#0ea5e9', oninput: () => { th.accent = accent.value; preview(); } });
      const title = h('input', { id: 'tti', maxlength: 24, placeholder: 'Beta', value: th.title || '', oninput: () => { th.title = title.value; preview(); } });
      const emoji = h('input', { id: 'tem', maxlength: 8, placeholder: 'An emoji, like 🌻', value: /^\/api\//.test(th.icon || '') ? '' : th.icon || '', oninput: () => { th.icon = emoji.value.trim(); preview(); } });
      const up = h('button', { class: 'btn ghost small', type: 'button', onclick: () => { const inp = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true, onchange: safe(async () => { const f = inp.files[0]; inp.remove(); if (!f) return; const blob = await iconBlob(f); const x = await api('/instance/icon', { method: 'POST', raw: true, body: blob, headers: { 'content-type': 'application/octet-stream' } }); th.icon = x.icon; drawThemes(); preview(); toast('Icon ready, press Save!'); }) }); document.body.append(inp); inp.click(); } }, 'Upload a picture');
      put(custom, th.id === 'custom' ? [h('label', { for: 'tac' }, 'Accent color'), accent, h('label', { for: 'tti' }, 'Title (top-left and the tab, up to 24 letters)'), title, h('label', { for: 'tem' }, 'Icon (favicon and top-left)'), h('div', { class: 'row2' }, emoji, up, th.icon ? h('button', { class: 'btn ghost small', type: 'button', onclick: () => { th.icon = ''; drawThemes(); preview(); } }, 'Use the Beta icon') : null)] : null);
    };
    drawThemes();
    const drawCode = (c) => put(code, c ? h('p', null, 'Invite code: ', h('code', null, c), ' ', h('button', { class: 'btn ghost small', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(i.url + '/register?invite=' + c); toast('Invite link copied!'); } catch (e) { prompt('Copy this invite link:', i.url + '/register?invite=' + c); } } }, 'Copy invite link'), ' ',
      h('button', { class: 'btn ghost small', type: 'button', onclick: safe(async () => { const x = await api('/instance', { method: 'PATCH', body: { regen_invite: true } }); drawCode(x.inviteCode); toast('New code!'); }) }, 'Make a new code')) : null);
    drawCode(i.reg === 'invite' ? i.inviteCode : '');
    show(h('form', { class: 'card formcard wide', onsubmit: guard(err, async () => {
      const x = await api('/instance', { method: 'PATCH', body: { name: name.value, description: desc.value, rules: rules.value, ...(i.isMain ? {} : { reg: reg.value, listed: listed.checked }), theme: th.id === 'custom' ? { id: 'custom', accent: th.accent, title: th.title, icon: th.icon } : { id: th.id } } });
      drawCode(!i.isMain && reg.value === 'invite' ? x.inviteCode : '');
      inst = { ...inst, name: name.value, description: desc.value, rules: rules.value, reg: i.isMain ? inst.reg : reg.value, theme: th.id === 'custom' ? { id: 'custom', accent: th.accent, title: th.title, icon: th.icon } : { id: th.id } };
      applyInstTheme(); toast('Saved!');
    }) },
      h('h1', null, 'Instance settings'), h('p', { class: 'muted' }, h('b', null, i.url.replace(/^https?:\/\//, '')), ' · ' + i.members + ' members · ' + i.posts + ' posts'),
      h('label', { for: 'sn' }, 'Name'), name, h('label', { for: 'sd' }, 'Description'), desc, h('label', { for: 'sr' }, 'House rules'), rules,
      h('label', { for: 'sg' }, 'Sign-up'), reg, i.isMain ? h('p', { class: 'muted small' }, 'The main instance follows the site-wide sign-up switches in Admin.') : null, code,
      i.isMain ? null : h('label', { class: 'checkrow', for: 'sl' }, listed, h('span', null, h('b', null, 'Show in the instance directory'), h('div', { class: 'muted small' }, 'Turn off to keep it unlisted. People with the address can still join.'))),
      h('h2', null, 'Theme'), h('p', { class: 'muted small' }, 'Colors, icon and title for everyone who visits this instance. The default is the plain Beta look!'), picker, custom,
      err, h('p', null, h('button', { class: 'btn', type: 'submit' }, 'Save'))));
  }
  function instCard() {
    const i = instInfo ? instInfo.instance : inst;
    return h('div', { class: 'card side icardside' }, h('h2', null, i.isMain ? 'Beta' : i.name), i.description ? h('p', { class: 'muted small' }, i.description) : null,
      i.members !== undefined ? h('p', { class: 'muted small' }, i.members + (i.members === 1 ? ' member' : ' members') + ' · ' + REG_WORDS[i.reg]) : null,
      i.rules ? h('details', { class: 'irules small' }, h('summary', null, 'House rules'), h('div', { class: 'vbody' }, i.rules)) : null,
      h('p', { class: 'small' }, link('/instances', 'All instances'), instInfo && instInfo.canManage ? [' · ', link('/instance/settings', 'Manage')] : null));
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
    if (sub === 'friends') {
      const r = await api('/users/' + enc(user.username) + '/friends');
      await loadFriends();
      const mineF = me && me.username.toLowerCase() === user.username.toLowerCase();
      show(h('div', { class: 'card' }, h('div', { class: 'row pad16' }, h('h1', null, link('/u/' + enc(user.username), nameOf(user)), ' ', h('span', { class: 'muted' }, 'Friends'))),
        r.hidden ? h('div', { class: 'empty' }, 'This person keeps their friends list private!')
          : r.users.length ? h('ul', { class: 'ulist big' }, r.users.map((u) => userRow(u, true))) : h('div', { class: 'empty' }, mineF ? 'No friends yet! Open a profile and press Add friend!' : 'No friends yet!')));
      return;
    }
    if (sub === 'followers' || sub === 'following') {
      const r = await api('/users/' + enc(user.username) + '/' + sub);
      await loadFriends();
      show(h('div', { class: 'card' }, h('div', { class: 'row pad16' }, h('h1', null, link('/u/' + enc(user.username), nameOf(user)), ' ', h('span', { class: 'muted' }, sub === 'followers' ? 'Followers' : 'Following'))),
        r.users.length ? h('ul', { class: 'ulist big' }, r.users.map((u) => userRow(u, true))) : h('div', { class: 'empty' }, sub === 'followers' ? 'No followers yet!' : 'Not following anyone yet!')));
      return;
    }
    if (sub === 'lists') return listsPage(user.username);
    const tab = ['replies', 'media', 'likes'].includes(params().get('tab')) ? params().get('tab') : 'posts';
    const mineU = me && me.username.toLowerCase() === user.username.toLowerCase();
    const stats = h('div', { class: 'stats' });
    const fbtn = followBtn(user);
    const frbtn = me && !mineU && ['none', 'outgoing', 'incoming', 'friends'].includes(user.friendState) ? friendBtn(user, user.friendState, false, (st) => { user.friendState = st; paint(); }) : null;
    const paint = () => stats.replaceChildren(h('span', null, h('b', null, user.posts), ' posts'), link('/u/' + enc(user.username) + '/followers', h('b', null, user.followers), ' followers'), link('/u/' + enc(user.username) + '/following', h('b', null, user.following), ' following'), user.friends != null || mineU ? link('/u/' + enc(user.username) + '/friends', h('b', null, user.friends != null ? user.friends : ''), user.friends != null ? (user.friends === 1 ? ' friend' : ' friends') : 'Friends') : link('/u/' + enc(user.username) + '/friends', 'Friends'), user.mutualFriends ? h('span', { class: 'muted', title: 'Friends you both have' }, user.mutualFriends + (user.mutualFriends === 1 ? ' mutual friend' : ' mutual friends')) : '', link('/u/' + enc(user.username) + '/lists', 'Lists'));
    user.onChange = paint;
    paint();
    const relBtns = [];
    if (me && !mineU) {
      const mk = (kind, on, off, msg) => { const b = h('button', { class: 'btn ghost small' }); const p = () => (b.textContent = user[kind] ? off : on); b.addEventListener('click', safe(async () => { if (kind === 'blocked' && !user.blocked && !confirm('Block @' + user.username + '?')) return; const r = await api('/users/' + enc(user.username) + '/' + (kind === 'muted' ? 'mute' : 'block'), { method: 'POST' }); user.muted = !!r.muted; user.blocked = !!r.blocked; if (kind === 'blocked' && r.blocked) { user.isFollowing = false; } toast(msg(r)); render(); })); p(); return b; };
      relBtns.push(mk('muted', 'Mute', 'Unmute', (r) => (r.muted ? 'Muted!' : 'Unmuted!')), mk('blocked', 'Block', 'Unblock', (r) => (r.blocked ? 'Blocked!' : 'Unblocked!')));
      relBtns.push(h('button', { class: 'btn ghost small', type: 'button', onclick: safe(() => noteDialog(user)) }, user.hasNote ? 'Edit note' : 'Add note'));
    }
    const path = '/u/' + enc(user.username);
    const f = feed('/feed', { user: user.username, tab }, { empty: { posts: 'No posts yet!', replies: 'No replies yet!', media: 'No pictures or files yet!', likes: 'No likes yet!' }[tab], pinnedId: user.pinned ? user.pinned.id : null });
    show(h('div', { class: 'card profile' },
      h('div', { class: 'top2' }, avatar(user, true), h('div', { class: 'who2' }, h('h1', null, nameOf(user), badgeEl(user)), h('div', { class: 'muted' }, '@' + user.username, user.inst_slug && user.inst_slug !== inst.slug && !user.username.includes("@") ? h('span', { class: 'itag', title: 'From the ' + user.inst_slug + ' instance' }, user.inst_slug) : null, user.followsYou ? h('span', { class: 'chip small' }, 'Follows you') : null, user.muted ? h('span', { class: 'chip small' }, 'Muted') : null, user.blocked ? h('span', { class: 'chip small' }, 'Blocked') : null)),
        h('div', { class: 'pbtns' }, mineU ? h('a', { class: 'btn ghost small', href: '/settings', 'data-link': true }, 'Edit profile') : [fbtn, frbtn], mineU ? h('button', { class: 'btn ghost small', type: 'button', onclick: () => changePicture(() => render()) }, 'Change picture') : null, me && !mineU ? h('a', { class: 'btn ghost small', href: '/messages/' + enc(user.username), 'data-link': true, title: 'Send a message' }, icon('mail')) : null, me && !mineU ? h('button', { class: 'btn ghost small', type: 'button', title: 'Add to a list', onclick: safe(() => listPicker(user.username)) }, icon('list')) : null, h('a', { class: 'btn ghost small', href: '/rss/user/' + enc(user.username), title: 'RSS feed' }, icon('rss')))),
      user.bio ? h('p', null, rich(user.bio)) : null,
      user.fields && user.fields.length ? h('dl', { class: 'pfields' }, user.fields.map((f) => [h('dt', null, f.label), h('dd', null, /^https?:\/\/[^\s<>"']{3,100}$/i.test(f.value) ? h('a', { href: f.value, rel: 'noopener noreferrer nofollow ugc', target: '_blank' }, f.value.replace(/^https?:\/\//, '')) : f.value)])) : null,
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
    const savedBox = h('div', { class: 'savedsearch' });
    const drawSaved = (list) => put(savedBox, list.length ? h('div', { class: 'chips' }, h('span', { class: 'muted small' }, 'Saved: '), list.map((s2) => h('span', { class: 'fchip' }, link('/search?q=' + enc(s2.q), s2.q), h('button', { type: 'button', class: 'fdel', 'aria-label': 'Forget ' + s2.q, onclick: safe(async () => { await api('/me/searches/' + s2.id, { method: 'DELETE' }); drawSaved(list.filter((z) => z !== s2)); }) }, '×')))) : null);
    if (me) api('/me/searches').then((r) => drawSaved(r.searches)).catch(() => {});
    const saveBtn = me && qv ? h('button', { class: 'btn ghost small', type: 'button', onclick: safe(async () => { const r = await api('/me/searches', { method: 'POST', body: { q: qv } }); drawSaved(r.searches); toast('Search saved!'); }) }, 'Save this search') : null;
    if (!qv) return show(h('h1', null, 'Search'), h('p', { class: 'muted' }, 'Type something in the box at the top!'), savedBox, tips);
    if (tab === 'posts') {
      const f = feed('/feed', { q: qv }, { empty: 'No posts matched that!' });
      show(h('h1', null, 'Results for "' + qv + '"'), saveBtn, savedBox, tabs, tips, f);
      return f.ready;
    }
    const r = await api('/search?q=' + enc(qv));
    await loadFriends();
    show(h('h1', null, 'Results for "' + qv + '"'), saveBtn, savedBox, tabs,
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
    const text = { like: 'liked your post', reply: 'replied to your post', repost: 'reposted your post', quote: 'quoted your post', mention: 'mentioned you', follow: 'followed you', friend_request: 'wants to be your friend', friend_accept: 'accepted your friend request' };
    const load = async () => {
      more.replaceChildren();
      const r = await api('/notifications' + (cursor ? '?before=' + cursor : ''));
      list.querySelectorAll('.empty').forEach((e) => e.remove());
      r.items.forEach((n) => {
        if (n.kind === 'friend_request') {
          const row = h('div', { class: 'note frnote' + (n.read ? '' : ' unread') }, h('a', { href: '/u/' + enc(n.username), 'data-link': true }, avatar(n)),
            h('div', { class: 'nt' }, h('div', null, h('a', { class: 'who', href: '/u/' + enc(n.username), 'data-link': true }, nameOf(n)), ' wants to be your friend', h('span', { class: 'muted small' }, ' · ' + ago(n.created)))));
          const answer = (action, msg) => safe(async () => { await friendAct(n.username, action); n.fpending = false; drawAnswer(); toast(msg); });
          const drawAnswer = () => { row.querySelector('.fract')?.remove(); row.querySelector('.nt').append(n.fpending ? h('div', { class: 'row2 fract' }, h('button', { class: 'btn small', type: 'button', onclick: answer('accept', 'You are friends now!') }, 'Accept'), h('button', { class: 'btn ghost small', type: 'button', onclick: answer('decline', 'Request declined!') }, 'Decline')) : h('div', { class: 'muted small fract' }, 'Answered!')); };
          drawAnswer();
          list.append(row);
          return;
        }
        const href = n.kind === 'follow' || n.kind === 'friend_accept' ? '/u/' + enc(n.username) : '/post/' + n.post_id;
        list.append(h('a', { class: 'note' + (n.read ? '' : ' unread'), href, 'data-link': true }, avatar(n), h('div', { class: 'nt' }, h('div', null, h('b', null, nameOf(n)), ' ' + (text[n.kind] || 'did something'), h('span', { class: 'muted small' }, ' · ' + ago(n.created))), n.snippet ? h('div', { class: 'muted snip' }, n.snippet) : null)));
      });
      cursor = r.cursor;
      if (!list.children.length) list.append(h('div', { class: 'empty' }, 'Nothing yet. Likes, replies, reposts, mentions, new followers and friend requests show up here!'));
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
    let cur = params().get('folder') || '';
    const bar = h('div', { class: 'folderbar' });
    const holder = h('div');
    const draw = async () => {
      const fl = (await api('/bookmark-folders')).folders;
      const chip = (id, label, n, del) => h('span', { class: 'fchip' + (cur === id ? ' on' : '') }, h('button', { type: 'button', onclick: () => { cur = id; history.replaceState(null, '', '/bookmarks' + (id ? '?folder=' + id : '')); draw(); } }, label + (n != null ? ' (' + n + ')' : '')),
        del ? h('button', { type: 'button', class: 'fdel', 'aria-label': 'Delete folder ' + label, onclick: safe(async () => { if (!confirm('Delete the folder “' + label + '”? Your posts stay saved.')) return; await api('/bookmark-folders/' + id, { method: 'DELETE' }); if (cur === id) cur = ''; draw(); }) }, '×') : null);
      put(bar, chip('', 'All', null), chip('none', 'Unfiled', null), fl.map((f) => chip(String(f.id), f.name, f.n, true)),
        h('button', { type: 'button', class: 'btn ghost small', onclick: safe(async () => { const name = prompt('Name the new folder:'); if (!name) return; const r = await api('/bookmark-folders', { method: 'POST', body: { name } }); cur = String(r.folder.id); draw(); }) }, '+ Folder'));
      const f = feed('/bookmarks', cur ? { folder: cur } : {}, { empty: cur ? 'Nothing in here yet! Use “Move to a folder” in a saved post’s menu.' : 'Nothing saved yet. Tap the ribbon on a post to keep it here!', onUnsave: true });
      put(holder, f);
      await f.ready;
    };
    show(h('h1', null, 'Saved posts'), bar, holder);
    await draw();
  }

  function authPage(mode) {
    setTitle(mode === 'login' ? 'Log in' : 'Sign up');
    side.replaceChildren();
    const err = errBox();
    const user = h('input', { id: 'u', autocomplete: 'username', maxlength: 20, required: true });
    const pw = h('input', { id: 'p', type: 'password', autocomplete: mode === 'login' ? 'current-password' : 'new-password', required: true });
    const inv = h('input', { id: 'inv', maxlength: 20, value: params().get('invite') || '', autocomplete: 'off' });
    const invRow = h('div', { hidden: true }, h('label', { for: 'inv' }, 'Invite code'), inv);
    if (mode === 'register') { if (!inst.isMain && inst.reg === 'invite') invRow.hidden = false; else if (inst.isMain) api('/announcements').then((r) => { if (r.inviteOnly) invRow.hidden = false; }).catch(() => {}); }
    show(h('form', { class: 'card formcard', onsubmit: guard(err, async () => {
      const r = await api('/' + mode, { method: 'POST', body: { username: user.value, password: pw.value, invite: inv.value } });
      me = r.user;
      try { instInfo = await api('/instance'); } catch (e) {}
      drawNav();
      go('/', true);
      toast(mode === 'login' ? 'Welcome back!' : 'Welcome to Beta!');
    }) },
      h('h1', null, mode === 'login' ? 'Log in' : 'Join ' + (inst.isMain ? 'Beta' : inst.name)),
      mode === 'register' && !inst.isMain && inst.rules ? h('details', { class: 'irules' }, h('summary', null, 'House rules'), h('div', { class: 'vbody' }, inst.rules)) : null,
      mode === 'register' && !inst.isMain && inst.reg === 'closed' ? h('p', { class: 'cwbox' }, 'This instance is not accepting new members right now. ', link('/instances', 'Pick another instance')) : null,
      h('label', { for: 'u' }, 'Username'), user,
      h('label', { for: 'p' }, mode === 'login' ? 'Password' : 'Password (8 or more characters)'), pw,
      mode === 'register' ? invRow : null,
      err, h('p', null, h('button', { class: 'btn', type: 'submit' }, mode === 'login' ? 'Log in' : 'Sign up')),
      mode === 'login' ? h('p', { class: 'muted small' }, 'Accounts belong to the instance where they were made. Not sure where yours lives? ', link('/instances', 'Browse instances')) : null,
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
    const frSel = h('select', { id: 'frp', onchange: safe(async () => { await api('/me/settings', { method: 'PATCH', body: { friendsPrivacy: frSel.value } }); me.friendsPrivacy = frSel.value; toast('Saved!'); }) }, [['everyone', 'Everyone'], ['friends', 'Only my friends'], ['me', 'Only me']].map(([v, l]) => h('option', { value: v, selected: (me.friendsPrivacy || 'everyone') === v }, l)));
    const themeSel = h('select', { id: 'thm', onchange: () => setTheme(themeSel.value) }, [['auto', 'Match my device'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => h('option', { value: v, selected: (store.get('beta_theme') || 'auto') === v }, l)));
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
      h('label', { for: 'frp' }, 'Who can see your friends list?'), frSel,
      h('h2', null, 'How Beta looks'),
      h('label', { for: 'thm' }, 'Theme'), themeSel,
      h('label', { for: 'dns' }, 'Spacing'), densSel,
      h('h2', null, 'Muted words'), wordsBox(),
      h('h2', null, 'Profile fields'), fieldsBox(cur.username),
      h('h2', null, 'Muted and blocked'), muted,
      h('h2', null, 'Where you are signed in'), sessionsBox(),
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
    const tab = ['trending', 'media', 'topics', 'people'].includes(params().get('tab')) ? params().get('tab') : 'top';
    const wide = params().get('where') === 'all';
    const lq = wide ? '' : '?local=1';
    const tabs = h('div', { class: 'tabs' }, [['top', 'Top posts'], ['trending', 'Trending'], ['media', 'Pictures'], ['topics', 'Topics'], ['people', 'People']].map(([k, l]) => h('a', { href: '/explore' + (k === 'top' ? '' : '?tab=' + k), 'data-link': true, class: tab === k ? 'on' : '' }, l)));
    tabs.append(h('span', { class: 'scopesw small' }, h('a', { href: '/explore' + (tab === 'top' ? '' : '?tab=' + tab), 'data-link': true, class: wide ? '' : 'on' }, 'This instance'), ' · ', h('a', { href: '/explore?' + (tab === 'top' ? '' : 'tab=' + tab + '&') + 'where=all', 'data-link': true, class: wide ? 'on' : '' }, 'All instances')));
    if (tab === 'trending') {
      const t = await api('/trending' + lq);
      return show(h('h1', null, 'Explore'), tabs, h('div', { class: 'card side' }, h('h2', null, 'Trending Topics, last 24 hours'),
        t.topics.length ? h('ol', { class: 'trend' }, t.topics.map((x, i) => h('li', null, h('span', { class: 'rank' }, i + 1), h('a', { href: '/topic/' + enc(x.topic), 'data-link': true }, '#' + x.topic), h('span', { class: 'muted small' }, x.people + (x.people === 1 ? ' person' : ' people') + ', ' + x.n + (x.n === 1 ? ' post' : ' posts'))))) : h('div', { class: 'empty' }, 'Nothing is trending yet. Start a Topic!')),
        h('h2', { class: 'gap' }, 'Hot right now'), h('div', { class: 'card feed' }, t.posts.length ? t.posts.map((p) => postCard(p)) : h('div', { class: 'empty' }, 'No hot posts yet!')));
    }
    if (tab === 'topics') {
      const t = await api('/topics' + lq);
      return show(h('h1', null, 'Explore'), tabs, h('div', { class: 'card side' }, t.topics.length ? h('div', null, t.topics.map((x) => h('a', { class: 'chip', href: '/topic/' + enc(x.topic), 'data-link': true }, '#' + x.topic + ' · ' + x.n))) : h('p', { class: 'muted' }, 'No Topics yet!')));
    }
    if (tab === 'people') {
      const s2 = await api('/suggest' + lq);
      return show(h('h1', null, 'Explore'), tabs, h('div', { class: 'card' }, s2.users.length ? h('ul', { class: 'ulist big' }, s2.users.map((u) => userRow({ ...u, isFollowing: false }))) : h('div', { class: 'empty' }, 'No one new to follow right now!')));
    }
    const f = feed('/feed', tab === 'media' ? { scope: 'explore', media: '1', ...(wide ? {} : { local: '1' }) } : { scope: 'explore', ...(wide ? {} : { local: '1' }) }, { empty: 'Nothing is popular yet. Post something!' });
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
  async function adminReports() {
    const show = (...kids) => kids;
    const [rep, bans] = await Promise.all([api('/admin/reports'), api('/admin/bans')]);
    return show(h('h1', null, 'Reports'), h('div', { class: 'card' }, rep.items.length ? rep.items.map((it) => {
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

  async function adminPage() {
    if (!me || !(me.admin || me.mod)) return show(h('div', { class: 'card empty' }, h('h2', null, 'Admins only'), link('/', 'Back to Beta')));
    setTitle(me.admin ? 'Admin' : 'Moderation');
    side.replaceChildren();
    const ALL = [['overview', 'Overview'], ['reports', 'Reports'], ['people', 'People'], ['content', 'Content'], ['outlets', 'Outlets'], ['files', 'Files'], ['invites', 'Invites'], ['instances', 'Instances'], ['site', 'Site'], ['audit', 'Activity log']];
    const TABS = me.admin ? ALL : ALL.filter((t) => ['overview', 'reports', 'people', 'content', 'audit'].includes(t[0]));
    const tab = TABS.some((t) => t[0] === params().get('tab')) ? params().get('tab') : 'overview';
    const tabs = h('div', { class: 'tabs' }, TABS.map(([k, l]) => h('a', { href: '/admin' + (k === 'overview' ? '' : '?tab=' + k), 'data-link': true, class: tab === k ? 'on' : '' }, l)));
    const dismissAll = h('div', { class: 'row2' }, h('button', { class: 'btn ghost small', type: 'button', onclick: safe(async () => { if (!confirm('Dismiss every report?')) return; await api('/admin/reports/dismiss-all', { method: 'POST' }); render(); }) }, 'Dismiss all reports'));
    const body = tab === 'reports' ? [dismissAll, ...(await adminReports())] : tab === 'people' ? [adminPeople()] : tab === 'content' ? [adminContent()] : tab === 'outlets' ? [await adminOutlets()] : tab === 'files' ? [await adminFiles()]
      : tab === 'invites' ? [await adminInvites()] : tab === 'instances' ? [await adminInstances()] : tab === 'site' ? [await adminSite()] : tab === 'audit' ? [await adminAudit()] : [await adminOverview()];
    show(h('h1', null, me.admin ? 'Admin' : 'Moderation'), tabs, ...body);
  }
  async function adminOverview() {
    const s = await api('/admin/stats');
    const set = await api('/admin/settings');
    const days = (rows) => { const out = []; for (let i = 13; i >= 0; i--) { const k = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); out.push({ k, n: (rows.find((x) => x.d === k) || {}).n || 0 }); } return out; };
    const chart = (title, rows) => { const d = days(rows); const max = Math.max(1, ...d.map((x) => x.n)); return h('div', { class: 'card pad16' }, h('h2', null, title), h('div', { class: 'bars', role: 'img', 'aria-label': title }, d.map((x) => h('div', { class: 'bar', title: x.k + ': ' + x.n }, h('i', { style: 'height:' + Math.round((x.n / max) * 100) + '%' }), h('span', null, x.k.slice(8)))))); };
    const tile = (n, l, to) => h(to ? 'a' : 'div', to ? { class: 'tile', href: to, 'data-link': true } : { class: 'tile' }, h('b', null, n), h('span', null, l));
    return h('div', null,
      !set.reg_open || set.readonly ? h('div', { class: 'announce' }, h('span', null, (set.readonly ? 'Read-only mode is ON. ' : '') + (!set.reg_open ? 'New sign-ups are paused.' : '')), h('a', { class: 'btn ghost small', href: '/admin?tab=site', 'data-link': true }, 'Change')) : null,
      h('div', { class: 'tiles' }, tile(s.users, 'people'), tile(s.activeToday, 'posted today'), tile(s.posts, 'posts'), tile(s.replies, 'replies'), tile(s.outlets, 'Outlets', '/admin?tab=outlets'), tile(s.files, 'files, ' + bytes(s.bytes)), tile(s.reports, 'open reports', '/admin?tab=reports'), tile(s.bans, 'suspended', '/admin?tab=people')),
      chart('New people, last 14 days', s.signupDays), chart('Posts, last 14 days', s.postDays),
      h('div', { class: 'card pad16' }, h('h2', null, 'Newest people'), s.newest.map((u) => h('div', { class: 'urow' }, h('span', { class: 'ut' }, link('/u/' + enc(u.username), '@' + u.username)), h('span', { class: 'muted small' }, ago(u.created))))));
  }
  function adminPeople() {
    const box = h('div');
    const list = h('div', { class: 'card' });
    const more = h('div', { class: 'more' });
    const q = h('input', { type: 'search', placeholder: 'Find a person', 'aria-label': 'Find a person', maxlength: 30 });
    let cursor = null, term = '', tm = 0;
    const row = (u) => {
      const act = (label, fn, cls) => h('button', { type: 'button', class: cls || '', onclick: safe(async (e) => { const d = e.currentTarget.closest('details'); if (d) d.removeAttribute('open'); await fn(); }) }, label);
      const post = (suffix, body) => api('/admin/users/' + enc(u.username) + '/' + suffix, { method: 'POST', body });
      const items = [
        act(u.banned ? 'Lift suspension' : 'Suspend', async () => {
          if (u.banned) await post('unban');
          else {
            const why = prompt('Why? (shown to them)'); if (why === null) return;
            const hrs = prompt('For how many hours? Leave empty to keep it until you lift it.', '');
            if (hrs === null) return;
            await post('ban', { reason: why, hours: Number(hrs) || 0 });
          }
          toast('Done!'); load(true);
        }),
        act('Send a warning', async () => { const text = prompt('What should the warning say? They will see it next time they open Beta:'); if (!text) return; await post('warn', { text }); toast('Warning sent!'); }),
        act(u.note ? 'Edit the admin note' : 'Add an admin note', async () => { const note = prompt('A private note about @' + u.username + ' (only admins and moderators see it). Empty removes it:', u.note || ''); if (note === null) return; await post('note', { note }); toast('Saved!'); load(true); }),
        act('Sign out everywhere', async () => { await post('signout'); toast('Signed out everywhere!'); }),
      ];
      if (me.admin) items.push(
        act('Set a new password', async () => { const pw = prompt('New password for @' + u.username + ' (8 or more characters):'); if (!pw) return; await post('password', { password: pw }); toast('Password changed, and they were signed out!'); }),
        act('Remove all their posts', async () => { if (!confirm('Remove every post by @' + u.username + '?')) return; const r = await post('purge-posts'); toast(r.removed + ' removed!'); load(true); }, 'danger'),
        act('Delete the account', async () => { if (prompt('Type ' + u.username + ' to delete the account for good:') !== u.username) return toast('Cancelled!'); await post('delete'); toast('Deleted!'); load(true); }, 'danger'));
      const menu = u.admin ? null : h('details', { class: 'menu' }, h('summary', { class: 'btn ghost small' }, 'Actions'), h('div', { class: 'pop right' }, items));
      return h('div', { class: 'urow pad16' }, h('div', { class: 'ut' }, link('/u/' + enc(u.username), '@' + u.username), badgeEl(u), u.admin ? h('span', { class: 'chip small' }, 'Admin') : null, u.mod ? h('span', { class: 'chip small' }, 'Moderator') : null,
        u.banned ? h('span', { class: 'chip small bad' }, 'Suspended' + (u.banned_until ? ' until ' + new Date(u.banned_until).toLocaleString() : '') + (u.banned_reason ? ': ' + u.banned_reason : '')) : null,
        h('div', { class: 'muted small' }, 'Joined ' + ago(u.created) + ' · ' + u.posts + ' posts · ' + u.followers + ' followers · ' + (u.last_login ? 'signed in ' + ago(u.last_login) : 'never signed in')),
        u.note ? h('div', { class: 'anote small' }, 'Note: ' + u.note) : null), menu);
    };
    const load = safe(async (fresh) => {
      if (fresh === true) { cursor = null; list.replaceChildren(); }
      more.replaceChildren();
      const r = await api('/admin/users?q=' + enc(term) + (cursor ? '&before=' + cursor : ''));
      if (!r.users.length && !list.children.length) list.append(h('div', { class: 'empty' }, 'Nobody found!'));
      r.users.forEach((u) => list.append(row(u)));
      cursor = r.cursor;
      if (cursor) more.append(h('button', { class: 'btn ghost', type: 'button', onclick: load }, 'Load more'));
    });
    q.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => { term = q.value.trim(); load(true); }, 250); });
    put(box, h('div', { class: 'row2' }, q), list, more);
    load(true);
    return box;
  }
  function adminContent() {
    const box = h('div');
    const list = h('div');
    const more = h('div', { class: 'more' });
    const q = h('input', { type: 'search', placeholder: 'Search every post for a word', 'aria-label': 'Search posts', maxlength: 60 });
    let cursor = null, term = '', tm = 0;
    const load = safe(async (fresh) => {
      if (fresh === true) { cursor = null; list.replaceChildren(); }
      more.replaceChildren();
      const r = await api('/admin/content?q=' + enc(term) + (cursor ? '&before=' + cursor : ''));
      if (!r.posts.length && !list.children.length) list.append(h('div', { class: 'card empty' }, 'No posts found!'));
      r.posts.forEach((p) => {
        const w = h('div', { class: 'card report' }, postCard(p, { noReplyLink: true }), h('div', { class: 'row2' },
          h('button', { class: 'btn danger small', type: 'button', onclick: safe(async () => { if (!confirm('Remove this post for everyone?')) return; await api('/admin/posts/' + p.id + '/remove', { method: 'POST' }); w.remove(); toast('Removed!'); }) }, 'Remove'),
          link('/u/' + enc(p.username), 'Author: @' + p.username)));
        list.append(w);
      });
      cursor = r.cursor;
      if (r.more) more.append(h('button', { class: 'btn ghost', type: 'button', onclick: load }, 'Load more'));
    });
    q.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => { term = q.value.trim(); load(true); }, 300); });
    put(box, h('div', { class: 'row2' }, q), list, more);
    load(true);
    return box;
  }
  async function adminFiles() {
    const r = await api('/admin/files');
    const list = h('div', { class: 'card' });
    const draw = (files) => put(list, files.length ? files.map((f) => h('div', { class: 'urow pad16' },
      f.mime.startsWith('image/') ? h('img', { class: 'fthumb', src: '/api/files/' + f.id, alt: '', loading: 'lazy' }) : h('span', { class: 'fthumb ficon' }, 'FILE'),
      h('div', { class: 'ut' }, h('b', null, f.name), ' ', h('span', { class: 'muted small' }, bytes(f.size) + ' · ' + f.mime), h('div', { class: 'muted small' }, 'by @' + f.username + ' ' + ago(f.created) + (f.post_id ? ' · ' : ''), f.post_id ? link('/post/' + f.post_id, 'the post') : ' (not on a post)')),
      h('button', { class: 'btn danger small', type: 'button', onclick: safe(async () => { if (!confirm('Delete this file?')) return; await api('/admin/files/' + f.id + '/remove', { method: 'POST' }); files = files.filter((x) => x !== f); draw(files); toast('Deleted!'); }) }, 'Delete'))) : h('div', { class: 'empty' }, 'No files yet!'));
    let files = r.files;
    draw(files);
    return h('div', null, h('p', { class: 'muted' }, 'The 50 biggest files, largest first.'), list);
  }
  async function adminInvites() {
    const note = h('input', { placeholder: 'Who is it for? (a note)', maxlength: 60, 'aria-label': 'Note' });
    const max = h('input', { type: 'number', min: 0, max: 1000, placeholder: 'Uses (0 = unlimited)', 'aria-label': 'How many people can use it' });
    const list = h('div', { class: 'card' });
    const err = errBox();
    const draw = async () => {
      const r = await api('/admin/invites');
      put(list, r.invites.length ? r.invites.map((i) => { const url = location.origin + '/register?invite=' + i.code; return h('div', { class: 'urow pad16' }, h('div', { class: 'ut' }, h('code', null, i.code), i.disabled ? h('span', { class: 'chip small bad' }, 'Off') : null, ' ', h('span', { class: 'muted small' }, i.uses + ' used' + (i.max ? ' of ' + i.max : '') + (i.note ? ' · ' + i.note : ''))),
        h('button', { class: 'btn ghost small', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(url); toast('Link copied!'); } catch (e) { prompt('Copy this link:', url); } } }, 'Copy link'),
        h('button', { class: 'btn ghost small', type: 'button', onclick: safe(async () => { await api('/admin/invites/' + i.code + '/toggle', { method: 'POST' }); draw(); }) }, i.disabled ? 'Turn on' : 'Turn off'),
        h('button', { class: 'btn danger small', type: 'button', onclick: safe(async () => { await api('/admin/invites/' + i.code, { method: 'DELETE' }); draw(); }) }, 'Delete')); }) : h('div', { class: 'empty' }, 'No invites yet!'));
    };
    await draw();
    return h('div', null, h('div', { class: 'card pad16' }, h('h2', null, 'Make an invite'), h('p', { class: 'muted small' }, 'Invites only matter when invite-only sign-up is on (Site tab).'),
      h('div', { class: 'row2' }, note, max, h('button', { class: 'btn small', type: 'button', onclick: guard(err, async () => { await api('/admin/invites', { method: 'POST', body: { note: note.value, max: parseInt(max.value, 10) || 0 } }); note.value = max.value = ''; draw(); toast('Invite made!'); }) }, 'Make it')), err), list);
  }
  async function adminOutlets() {
    const r = await api('/admin/outlets');
    const list = h('div', { class: 'card' });
    const draw = (items) => put(list, items.length ? items.map((o) => h('div', { class: 'urow pad16' }, h('div', { class: 'ut' }, link('/o/' + enc(o.slug), o.name), h('div', { class: 'muted small' }, o.members + ' members · ' + o.posts + ' posts · owner ' + (o.owner ? '@' + o.owner : 'none') + ' · made ' + ago(o.created))),
      h('button', { class: 'btn danger small', type: 'button', onclick: safe(async () => { if (!confirm('Remove the Outlet “' + o.name + '” and all its posts?')) return; await api('/admin/outlets/' + enc(o.slug) + '/remove', { method: 'POST' }); items = items.filter((x) => x !== o); draw(items); toast('Removed!'); }) }, 'Remove'))) : h('div', { class: 'empty' }, 'No Outlets yet!'));
    let items = r.outlets;
    draw(items);
    return list;
  }
  async function adminInstances() {
    const r = await api('/admin/instances');
    const list = h('div', { class: 'card' });
    const draw = (items) => put(list, items.map((i) => h('div', { class: 'urow pad16' }, h('div', { class: 'ut' }, h('a', { href: i.url, target: '_blank', rel: 'noopener' }, i.name), ' ', h('code', null, i.slug), i.isMain ? h('span', { class: 'chip small' }, 'Main') : null, i.listed ? null : h('span', { class: 'chip small bad' }, 'Unlisted'),
      h('div', { class: 'muted small' }, i.members + ' members · ' + i.posts + ' posts · ' + REG_WORDS[i.reg] + (i.owner ? ' · admin @' + i.owner : '') + ' · made ' + ago(i.created))),
      i.isMain ? null : h('details', { class: 'menu' }, h('summary', { class: 'btn ghost small' }, 'Actions'), h('div', { class: 'pop right' },
        h('button', { type: 'button', onclick: safe(async (e) => { e.currentTarget.closest('details').removeAttribute('open'); await api('/admin/instances/' + enc(i.slug) + '/listed', { method: 'POST', body: { listed: !i.listed } }); i.listed = !i.listed; draw(items); toast('Done!'); }) }, i.listed ? 'Hide from the directory' : 'Show in the directory'),
        h('button', { type: 'button', class: 'danger', onclick: safe(async (e) => { e.currentTarget.closest('details').removeAttribute('open'); if (prompt('Type ' + i.slug + ' to delete this instance, its people and all their posts for good:') !== i.slug) return toast('Cancelled!'); await api('/admin/instances/' + enc(i.slug), { method: 'DELETE' }); items = items.filter((x) => x !== i); draw(items); toast('Deleted!'); }) }, 'Delete the instance'))))));
    let items = r.instances;
    draw(items);
    return list;
  }
  async function adminSite() {
    const [set, tp, mods] = await Promise.all([api('/admin/settings'), api('/admin/topics'), api('/admin/mods')]);
    const err = errBox();
    const save = (patch) => api('/admin/settings', { method: 'POST', body: patch });
    const toggle = (label, hint, on, key) => { const cb = h('input', { type: 'checkbox', checked: on, onchange: safe(async () => { await save({ [key]: cb.checked }); toast('Saved!'); }) }); return h('label', { class: 'checkrow' }, cb, h('span', null, h('b', null, label), h('div', { class: 'muted small' }, hint))); };
    const words = h('textarea', { rows: 4, 'aria-label': 'Blocked words', placeholder: 'One word or phrase per line', value: set.blocked_words.join('\n') });
    const reserved = h('textarea', { rows: 3, 'aria-label': 'Reserved usernames', placeholder: 'One name per line', value: set.reserved_names.join('\n') });
    const hiddenBox = h('div'), modBox = h('div');
    const drawHidden = (hidden) => put(hiddenBox, hidden.length ? h('div', { class: 'chips' }, hidden.map((t) => h('button', { type: 'button', class: 'chip', title: 'Show this Topic again', onclick: safe(async () => { await api('/admin/topics', { method: 'POST', body: { topic: t, hidden: false } }); drawHidden(hidden.filter((x) => x !== t)); }) }, '#' + t + ' ×'))) : h('p', { class: 'muted small' }, 'No hidden Topics.'));
    drawHidden(tp.hidden);
    const hideIn = h('input', { placeholder: 'Topic to hide', maxlength: 30, 'aria-label': 'Topic to hide' });
    const drawMods = (list) => put(modBox, list.length ? h('div', { class: 'chips' }, list.map((m) => h('button', { type: 'button', class: 'chip', title: 'Remove as moderator', onclick: safe(async () => { await api('/admin/mods/' + enc(m.username), { method: 'DELETE' }); drawMods(list.filter((x) => x !== m)); }) }, '@' + m.username + ' ×'))) : h('p', { class: 'muted small' }, 'No moderators yet.'));
    drawMods(mods.mods);
    const modIn = h('input', { placeholder: 'username', maxlength: 20, 'aria-label': 'Moderator username' });
    return h('div', null,
      h('div', { class: 'card pad16' }, h('h2', null, 'Site controls'),
        toggle('New sign-ups are open', 'Turn off to pause registrations.', set.reg_open, 'reg_open'),
        toggle('Invite-only sign-up', 'New people need an invite code (make them on the Invites tab).', set.invite_only, 'invite_only'),
        toggle('Read-only mode', 'Nobody but admins can post, like or change anything. Handy while you fix something!', set.readonly, 'readonly'),
        h('h2', { class: 'gap' }, 'Words that are not allowed in posts'), h('p', { class: 'muted small' }, 'Posts and edits with these words are refused (admins are exempt).'), words,
        h('h2', { class: 'gap' }, 'Reserved usernames'), h('p', { class: 'muted small' }, 'Nobody can sign up with these names.'), reserved, err,
        h('p', null, h('button', { class: 'btn', type: 'button', onclick: guard(err, async () => { await save({ blocked_words: words.value.split('\n'), reserved_names: reserved.value.split('\n') }); toast('Saved!'); }) }, 'Save lists'))),
      h('div', { class: 'card pad16' }, h('h2', null, 'Hidden Topics'), h('p', { class: 'muted small' }, 'Hidden Topics stay out of Trending, the Topics list and Explore. The posts still exist.'), hiddenBox,
        h('div', { class: 'row2' }, hideIn, h('button', { class: 'btn small', type: 'button', onclick: safe(async () => { if (!hideIn.value.trim()) return; await api('/admin/topics', { method: 'POST', body: { topic: hideIn.value } }); const t = hideIn.value.trim().replace(/^#/, '').toLowerCase(); hideIn.value = ''; tp.hidden.push(t); drawHidden(tp.hidden); }) }, 'Hide it')),
        tp.top.length ? h('p', { class: 'muted small' }, 'Biggest Topics: ', tp.top.slice(0, 12).map((x) => h('span', { class: 'muted' }, '#' + x.topic + ' (' + x.n + ') '))) : null),
      h('div', { class: 'card pad16' }, h('h2', null, 'Moderators'), h('p', { class: 'muted small' }, 'Moderators can read reports, remove posts, warn and suspend people, but cannot change the site or delete accounts.'), modBox,
        h('div', { class: 'row2' }, modIn, h('button', { class: 'btn small', type: 'button', onclick: safe(async () => { await api('/admin/mods', { method: 'POST', body: { username: modIn.value.trim() } }); const r = await api('/admin/mods'); drawMods(r.mods); modIn.value = ''; toast('Added!'); }) }, 'Make moderator'))),
      h('div', { class: 'card pad16' }, h('h2', null, 'Downloads'), h('div', { class: 'row2' }, h('a', { class: 'btn ghost', href: '/api/admin/export/users.csv', download: true }, 'People (CSV)'), h('a', { class: 'btn ghost', href: '/api/admin/export/audit.csv', download: true }, 'Activity log (CSV)'))),
      await adminTools());
  }
  async function adminAudit() {
    const r = await api('/admin/audit');
    return h('div', { class: 'card' }, r.items.length ? r.items.map((a) => h('div', { class: 'urow pad16' }, h('span', { class: 'ut' }, h('b', null, '@' + a.admin), ' ', h('code', null, a.action)), h('span', { class: 'muted small' }, new Date(a.created).toLocaleString()))) : h('div', { class: 'empty' }, 'Nothing yet!'));
  }

  // ---------- version 5 extras ----------
  function historyDialog(versions) {
    modal('Edit history', versions.map((v, i) => h('div', { class: 'ver' }, h('div', { class: 'muted small' }, (v.current ? 'Now' : 'Version ' + (i + 1)) + ' · ' + new Date(v.created).toLocaleString()), h('div', { class: 'vbody' }, v.body || '(no text)'))));
  }
  async function folderPicker(x, redraw) {
    const { folders } = await api('/bookmark-folders');
    const box = modal('Move to a folder');
    const pick = (fid, name) => safe(async () => { await api('/posts/' + x.id + '/folder', { method: 'POST', body: { folder: fid } }); box.remove(); toast(fid ? 'Moved to ' + name + '!' : 'Moved out of folders!'); if (location.pathname === '/bookmarks') render(); });
    box.querySelector('.sheet').append(h('div', { class: 'folderlist' }, h('button', { type: 'button', class: 'btn ghost', onclick: pick(null) }, 'No folder'), folders.map((f) => h('button', { type: 'button', class: 'btn ghost', onclick: pick(f.id, f.name) }, f.name)),
      h('button', { type: 'button', class: 'btn small', onclick: safe(async () => { const name = prompt('Name the new folder:'); if (!name) return; const r = await api('/bookmark-folders', { method: 'POST', body: { name } }); await pick(r.folder.id, r.folder.name)(); }) }, '+ New folder')));
  }
  function noteDialog(user) {
    return api('/users/' + enc(user.username) + '/note').then((r) => {
      const ta = h('textarea', { maxlength: 500, 'aria-label': 'Private note', value: r.note, placeholder: 'Only you can see this' });
      const err = errBox();
      const box = modal('Note about @' + user.username, h('p', { class: 'muted small' }, 'A private note. Only you can see it!'), ta, err,
        h('p', null, h('button', { class: 'btn', type: 'button', onclick: guard(err, async () => { await api('/users/' + enc(user.username) + '/note', { method: 'POST', body: { note: ta.value } }); user.hasNote = !!ta.value.trim(); box.remove(); toast('Saved!'); render(); }) }, 'Save')));
      ta.focus();
    });
  }
  function wordsBox() {
    const box = h('div');
    const inp = h('input', { maxlength: 40, placeholder: 'A word or phrase to hide', 'aria-label': 'Word to mute' });
    const err = errBox();
    const draw = async () => {
      const r = await api('/me/filters');
      me.filters = r.filters;
      put(box, h('p', { class: 'muted small' }, 'Posts with these words are hidden behind a button. You can still look!'),
        r.filters.length ? h('div', { class: 'chips' }, r.filters.map((w) => h('button', { type: 'button', class: 'chip', title: 'Remove', onclick: safe(async () => { await api('/me/filters/' + enc(w), { method: 'DELETE' }); draw(); }) }, w + ' ×'))) : null,
        h('div', { class: 'row2' }, inp, h('button', { class: 'btn small', type: 'button', onclick: guard(err, async () => { await api('/me/filters', { method: 'POST', body: { word: inp.value } }); inp.value = ''; draw(); }) }, 'Mute')), err);
    };
    draw().catch(() => {});
    return box;
  }
  function fieldsBox(username) {
    const box = h('div');
    const err = errBox();
    api('/users/' + enc(username)).then(({ user }) => {
      const rows = [0, 1, 2, 3].map((i) => { const f = (user.fields || [])[i] || { label: '', value: '' }; return { l: h('input', { maxlength: 20, value: f.label, placeholder: 'Label', 'aria-label': 'Field ' + (i + 1) + ' label' }), v: h('input', { maxlength: 100, value: f.value, placeholder: 'Value or link', 'aria-label': 'Field ' + (i + 1) + ' value' }) }; });
      put(box, h('p', { class: 'muted small' }, 'Up to 4 little facts on your profile, like Pronouns or Site!'), rows.map((r) => h('div', { class: 'frow' }, r.l, r.v)),
        h('p', null, h('button', { class: 'btn', type: 'button', onclick: guard(err, async () => { await api('/me/fields', { method: 'POST', body: { fields: rows.map((r) => ({ label: r.l.value, value: r.v.value })) } }); toast('Saved!'); }) }, 'Save fields')), err);
    }).catch(() => {});
    return box;
  }
  function sessionsBox() {
    const box = h('div');
    const draw = async () => {
      const r = await api('/me/sessions');
      put(box, h('ul', { class: 'ulist' }, r.sessions.map((s) => h('li', { class: 'urow' }, h('span', { class: 'ut' }, h('b', null, s.kind === 'api' ? 'App token' + (s.name ? ': ' + s.name : '') : 'Web browser'), s.current ? h('span', { class: 'chip small' }, 'This one') : null, h('div', { class: 'muted small' }, 'Signed in ' + ago(s.created))),
        s.current ? null : h('button', { class: 'btn ghost small', type: 'button', onclick: safe(async () => { await api('/me/sessions/' + s.id, { method: 'DELETE' }); draw(); }) }, 'Sign out')))),
        r.sessions.length > 1 ? h('p', null, h('button', { class: 'btn ghost small', type: 'button', onclick: safe(async () => { await api('/me/sessions/others', { method: 'POST' }); toast('Signed out everywhere else!'); draw(); }) }, 'Sign out everywhere else')) : null);
    };
    draw().catch(() => {});
    return box;
  }
  async function scheduledPage() {
    if (!me) return go('/login', true);
    setTitle('Scheduled posts');
    drawSide();
    const r = await api('/scheduled');
    const list = h('div', { class: 'card' });
    const draw = (items) => put(list, items.length ? items.map((it) => h('div', { class: 'urow pad16' }, h('div', { class: 'ut' }, h('b', null, new Date(it.at).toLocaleString()), h('div', null, it.body || '(a picture or poll)'), h('div', { class: 'muted small' }, (it.cw ? 'Content warning · ' : '') + (it.files ? it.files + ' file(s) · ' : '') + (it.poll ? 'Poll · ' : '') + (it.outlet ? 'In an Outlet' : ''))),
      h('button', { class: 'btn ghost small', type: 'button', onclick: safe(async () => { await api('/scheduled/' + it.id, { method: 'DELETE' }); items = items.filter((x) => x.id !== it.id); draw(items); toast('Cancelled!'); }) }, 'Cancel'))) : h('div', { class: 'empty' }, 'Nothing scheduled. Press Later in the composer to pick a time!'));
    let items = r.items;
    draw(items);
    show(h('h1', null, 'Scheduled posts'), h('p', { class: 'muted' }, 'These go out by themselves at the time you picked!'), list);
  }
  async function statsPage() {
    if (!me) return go('/login', true);
    setTitle('Your stats');
    drawSide();
    const s = await api('/me/stats');
    const days = [];
    for (let i = 13; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5); const k = d.toISOString().slice(0, 10); days.push({ k, n: (s.days.find((x) => x.d === k) || {}).n || 0 }); }
    const max = Math.max(1, ...days.map((d) => d.n));
    const tile = (n, l) => h('div', { class: 'tile' }, h('b', null, n), h('span', null, l));
    show(h('h1', null, 'Your stats'),
      h('div', { class: 'tiles' }, tile(s.posts, 'posts'), tile(s.replies, 'replies'), tile(s.likesGot, 'likes got'), tile(s.reactionsGot, 'reactions got'), tile(s.repostsGot, 'reposts got'), tile(s.repliesGot, 'replies got'), tile(s.followers, 'followers'), tile(s.following, 'following')),
      h('div', { class: 'card pad16' }, h('h2', null, 'Posts in the last 14 days'), h('div', { class: 'bars', role: 'img', 'aria-label': 'Posts per day for 14 days' }, days.map((d) => h('div', { class: 'bar', title: d.k + ': ' + d.n }, h('i', { style: 'height:' + Math.round((d.n / max) * 100) + '%' }), h('span', null, d.k.slice(8)))))),
      h('h2', { class: 'gap' }, 'Your top posts'), h('div', { class: 'card feed' }, s.top.length ? s.top.map((p) => postCard(p)) : h('div', { class: 'empty' }, 'Posts that get likes and reactions show up here!')));
  }
  async function adminTools() {
    const err1 = errBox(), err2 = errBox();
    const un = h('input', { placeholder: 'username', 'aria-label': 'Username', maxlength: 30 });
    const kind = h('select', { 'aria-label': 'Badge' }, [['verified', 'Verified'], ['staff', 'Beta staff'], ['supporter', 'Supporter'], ['', 'Remove badge']].map(([v, l]) => h('option', { value: v }, l)));
    const text = h('input', { placeholder: 'Announcement for everyone', maxlength: 280, 'aria-label': 'Announcement' });
    const days = h('select', { 'aria-label': 'How long' }, [['1', '1 day'], ['7', '7 days'], ['30', '30 days'], ['0', 'Until removed']].map(([v, l]) => h('option', { value: v }, l)));
    const list = h('div');
    const draw = async () => {
      const r = await api('/admin/announcements');
      put(list, r.items.map((a) => h('div', { class: 'urow' }, h('span', { class: 'ut' }, a.text, h('div', { class: 'muted small' }, ago(a.created) + (a.ends ? ', ends ' + new Date(a.ends).toLocaleDateString() : ''))), h('button', { class: 'btn ghost small', type: 'button', onclick: safe(async () => { await api('/admin/announcements/' + a.id, { method: 'DELETE' }); draw(); }) }, 'Remove'))));
    };
    await draw();
    return h('div', { class: 'card pad16 admintools' }, h('h2', null, 'Badges'), h('div', { class: 'row2' }, un, kind, h('button', { class: 'btn small', type: 'button', onclick: guard(err1, async () => { await api('/admin/badges', { method: 'POST', body: { username: un.value.trim(), kind: kind.value || null } }); toast('Done!'); un.value = ''; }) }, 'Apply')), err1,
      h('h2', null, 'Announcements'), h('div', { class: 'row2' }, text, days, h('button', { class: 'btn small', type: 'button', onclick: guard(err2, async () => { await api('/admin/announcements', { method: 'POST', body: { text: text.value, days: parseInt(days.value, 10) } }); text.value = ''; draw(); toast('Posted!'); }) }, 'Post')), err2, list);
  }
  function showWarnings() {
    if (!me || !me.warnings || !me.warnings.length) return;
    const list = me.warnings;
    const box = modal('A message from the Beta team', list.map((w) => h('div', { class: 'ver' }, h('div', { class: 'muted small' }, ago(w.created)), h('div', { class: 'vbody' }, w.text))),
      h('p', null, h('button', { class: 'btn', type: 'button', onclick: safe(async () => { await api('/me/warnings/seen', { method: 'POST' }); me.warnings = []; box.remove(); }) }, 'I understand')));
  }
  async function showAnnouncements() {
    try {
      const { items, readonly, signupsPaused } = await api('/announcements');
      let seen = [];
      try { seen = (store.get('beta_ann_seen') || '').split(',').filter(Boolean); } catch (e) {}
      const fresh = items.filter((a) => !seen.includes(String(a.id)));
      let bar = document.getElementById('banner');
      if (!bar) { bar = h('div', { id: 'banner' }); app.parentNode.insertBefore(bar, app); }
      put(bar, readonly ? h('div', { class: 'announce', role: 'status' }, h('span', null, 'Beta is read-only for a moment while we fix something. You can still read everything!')) : null, fresh.map((a) => h('div', { class: 'announce', role: 'status' }, h('span', null, a.text), h('button', { type: 'button', class: 'btn ghost small', onclick: () => { seen.push(String(a.id)); try { store.set('beta_ann_seen', seen.slice(-30).join(',')); } catch (e) {} showAnnouncements(); } }, 'Got it'))));
    } catch (e) {}
  }

  // ---------- looks: light or dark, and how roomy ----------
  function applyPrefs() {
    const t = themeStore.get() || 'auto';
    const d = store.get('beta_density') || 'comfortable';
    if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
    window.dispatchEvent(new Event('kd-recolor'));
    if (d === 'compact') document.documentElement.setAttribute('data-density', 'compact'); else document.documentElement.removeAttribute('data-density');
  }
  // a square, small copy of the picked picture for the profile picture
  async function iconBlob(file) {
    const url = await readDataUrl(file);
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
    const side2 = Math.min(img.width, img.height);
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    c.getContext('2d').drawImage(img, (img.width - side2) / 2, (img.height - side2) / 2, side2, side2, 0, 0, 128, 128);
    const toBlob = (type, q) => new Promise((ok) => c.toBlob(ok, type, q));
    let b = await toBlob('image/png');
    if (!b) b = await toBlob('image/jpeg', 0.9);
    return b;
  }
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
      if (noInstance) show(noInstancePage());
      else if (!seg.length) await home();
      else if (a === 'login' && !b) authPage('login');
      else if (a === 'register' && !b) authPage('register');
      else if (a === 'settings' && !b) await settingsPage();
      else if (a === 'search' && !b) await searchPage();
      else if (a === 'notifications' && !b) await notificationsPage();
      else if (a === 'bookmarks' && !b) await bookmarksPage();
      else if (a === 'explore' && !b) await explorePage();
      else if (a === 'instances' && !b) await instancesPage();
      else if (a === 'instances' && b === 'new') newInstancePage();
      else if (a === 'instance' && b === 'settings') await instanceSettingsPage();
      else if (a === 'scheduled' && !b) await scheduledPage();
      else if (a === 'stats' && !b) await statsPage();
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
  api('/instance').then((r) => { inst = r.instance; instInfo = r; applyInstTheme(); }).catch((e) => { if (e.status === 404) noInstance = true; }).then(() => api('/me')).then((r) => { me = r.user; }).catch(() => {}).then(() => {
    drawBrand();
    drawNav();
    render();
    showAnnouncements();
    showWarnings();
    setInterval(refreshUnread, 60000);
  });
})();
