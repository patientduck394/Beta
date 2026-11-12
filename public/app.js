// Beta website. One small script, no libraries. Every piece of text goes in with textContent (never innerHTML), so nothing typed by a user can run as code.
(() => {
  'use strict';
  const app = document.getElementById('app');
  const side = document.getElementById('side');
  const show = (...kids) => app.replaceChildren(...kids.flat(9).filter(Boolean));
  let me = null;
  let tick = 0;

  const h = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'value' || k === 'checked' || k === 'disabled') e[k] = v;
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
      headers: opts.body ? { 'content-type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
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
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  };
  const ago = (t) => {
    const s = Math.max(1, Math.round((Date.now() - t) / 1000));
    if (s < 60) return 'now';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    if (s < 86400 * 30) return Math.floor(s / 86400) + 'd';
    return new Date(t).toLocaleDateString();
  };
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

  // text with #topics and @names turned into links (built from pieces, never as HTML)
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

  // Keydown formatting (bold, chips, quotes...) is only fetched when a post looks like it uses some
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

  function drawNav() {
    const nav = document.getElementById('nav');
    nav.replaceChildren();
    if (me) nav.append(link('/u/' + enc(me.username), me.username), h('a', { class: 'btn ghost small', href: '/settings', 'data-link': true }, 'Settings'));
    else nav.append(h('a', { class: 'btn ghost small', href: '/login', 'data-link': true }, 'Log in'), h('a', { class: 'btn small', href: '/register', 'data-link': true }, 'Sign up'));
  }

  async function drawSide() {
    try {
      const { topics } = await api('/topics');
      side.replaceChildren(h('div', { class: 'card side' }, h('h2', null, 'Trending Topics'),
        topics.length ? h('ol', null, topics.map((t) => h('li', null, link('/topic/' + enc(t.topic), h('span', { class: 'tn' }, '#' + t.topic)), h('span', { class: 'muted small' }, t.n + (t.n === 1 ? ' post' : ' posts')))))
          : h('p', { class: 'muted' }, 'No Topics yet. Add a #hashtag to a post to start one!')));
    } catch (e) {
      side.replaceChildren();
    }
  }

  // ---------- posts ----------
  function postCard(p, opts = {}) {
    const likeBtn = h('button', { class: 'act' + (p.liked ? ' liked' : ''), 'aria-label': 'Like', onclick: async () => {
      if (!me) return go('/login');
      const r = await api('/posts/' + p.id + '/like', { method: 'POST' }).catch((e) => toast(e.message));
      if (!r) return;
      p.liked = r.liked;
      p.likes = r.likes;
      draw();
    } });
    const draw = () => {
      likeBtn.className = 'act' + (p.liked ? ' liked' : '');
      likeBtn.textContent = (p.liked ? '♥ ' : '♡ ') + p.likes;
    };
    draw();
    const card = h('article', { class: 'post' + (opts.focus ? ' focus' : '') },
      h('div', { class: 'av', 'aria-hidden': 'true' }, p.username[0].toUpperCase()),
      h('div', { class: 'pb' },
        h('div', { class: 'ph' }, h('a', { class: 'who', href: '/u/' + enc(p.username), 'data-link': true }, p.username), h('a', { class: 'when', href: '/post/' + p.id, 'data-link': true }, ago(p.created))),
        bodyEl(p.body),
        h('div', { class: 'acts' },
          opts.noReplyLink ? null : h('a', { class: 'act', href: '/post/' + p.id, 'data-link': true }, '💬 ' + p.replies),
          likeBtn,
          me && me.username.toLowerCase() === p.username.toLowerCase() ? h('button', { class: 'act del', onclick: async () => {
            if (!confirm('Delete this post?')) return;
            await api('/posts/' + p.id, { method: 'DELETE' }).catch((e) => toast(e.message));
            if (opts.onDelete) opts.onDelete(card);
          } }, 'Delete') : null)));
    return card;
  }

  function composer(opts = {}) {
    const area = h('textarea', { 'aria-label': opts.label || 'Write a post', placeholder: opts.placeholder || "What's happening? Add a #topic!", value: opts.prefill || '' });
    const count = h('span', { class: 'count' });
    const btn = h('button', { class: 'btn', type: 'submit' }, opts.button || 'Post');
    const box = errBox();
    const update = () => {
      const left = 300 - [...area.value].length;
      count.textContent = String(left);
      count.className = 'count' + (left < 0 ? ' over' : '');
      btn.disabled = left < 0 || !area.value.trim();
    };
    const preview = h('div', { class: 'preview', hidden: true });
    let ptimer = 0;
    const paintPreview = () => {
      clearTimeout(ptimer);
      ptimer = setTimeout(async () => {
        if (!looksKd(area.value)) {
          preview.hidden = true;
          return;
        }
        try {
          const out = await window.KdLite.render(area.value);
          linkify(out);
          preview.replaceChildren(h('div', { class: 'muted small' }, 'Preview'), out);
          preview.hidden = false;
        } catch (e) {
          preview.hidden = true;
        }
      }, 300);
    };
    area.addEventListener('input', () => { update(); paintPreview(); });
    update();
    const form = h('form', { class: 'card compose', onsubmit: guard(box, async () => {
      btn.disabled = true;
      try {
        const r = await api('/posts', { method: 'POST', body: { body: area.value, parent: opts.parent } });
        area.value = opts.prefill || '';
        preview.hidden = true;
        update();
        if (opts.onPosted) opts.onPosted(r.post);
      } finally {
        update();
      }
    }) }, area, preview, h('div', { class: 'row' }, count, btn), h('div', { class: 'muted small' }, 'Keydown works here: **bold**, *italic*, `code`, #G#chips#'), box);
    return form;
  }

  // a list of posts that can load more
  function feed(query, opts = {}) {
    const list = h('div', { class: 'card' });
    const more = h('div', { class: 'more' });
    const wrap = h('div', null, list, more);
    let last = null;
    const empty = () => {
      if (!list.children.length) list.append(h('div', { class: 'empty' }, opts.empty || 'Nothing here yet!'));
    };
    const load = async () => {
      more.replaceChildren();
      const qsx = new URLSearchParams(query);
      if (last) qsx.set('before', last);
      const r = await api('/feed?' + qsx);
      list.querySelectorAll('.empty').forEach((e) => e.remove());
      r.posts.forEach((p) => {
        list.append(postCard(p, { onDelete: (el) => { el.remove(); empty(); } }));
        last = p.id;
      });
      empty();
      if (r.more) more.append(h('button', { class: 'btn ghost', onclick: () => load().catch((e) => toast(e.message)) }, 'Load more'));
    };
    wrap.prepend = (p) => {
      list.querySelectorAll('.empty').forEach((e) => e.remove());
      list.prepend(postCard(p, { onDelete: (el) => { el.remove(); empty(); } }));
    };
    wrap.ready = load();
    return wrap;
  }

  // ---------- pages ----------
  async function home() {
    setTitle('');
    drawSide();
    const tab = params().get('tab') || (me ? 'home' : 'all');
    const f = feed(tab === 'home' && me ? { scope: 'home' } : {}, { empty: tab === 'home' ? 'Your home feed is empty. Follow people and Topics, or look at Everyone!' : 'No posts yet. Be the first!' });
    show(
      !me ? h('section', { class: 'hero' }, h('h1', null, 'Short posts. Big conversations!'), h('p', null, 'Beta is a microblog where every post can live in a Topic. Add a #hashtag and your post joins the conversation!'), h('p', null, h('a', { class: 'btn', href: '/register', 'data-link': true }, 'Join Beta'))) : null,
      me ? composer({ onPosted: (p) => { if (tab === 'home' || tab === 'all') f.prepend(p); toast('Posted!'); drawSide(); } }) : null,
      me ? h('div', { class: 'tabs' }, h('a', { href: '/', 'data-link': true, class: tab === 'home' ? 'on' : '' }, 'Following'), h('a', { href: '/?tab=all', 'data-link': true, class: tab === 'all' ? 'on' : '' }, 'Everyone')) : null,
      f);
    await f.ready;
  }

  async function topicPage(name) {
    const { topic } = await api('/topics/' + enc(name));
    setTitle('#' + topic.name);
    drawSide();
    const stats = h('p', { class: 'muted' });
    const fbtn = h('button', { class: 'btn small' });
    const paint = () => {
      stats.textContent = topic.posts + (topic.posts === 1 ? ' post' : ' posts') + ' · ' + topic.followers + (topic.followers === 1 ? ' follower' : ' followers');
      fbtn.textContent = topic.following ? 'Following' : 'Follow Topic';
      fbtn.className = 'btn small' + (topic.following ? ' on' : '');
    };
    fbtn.addEventListener('click', async () => {
      if (!me) return go('/login');
      const r = await api('/topics/' + enc(topic.name) + '/follow', { method: 'POST' }).catch((e) => toast(e.message));
      if (!r) return;
      topic.following = r.following;
      topic.followers += r.following ? 1 : -1;
      paint();
    });
    paint();
    const f = feed({ topic: topic.name }, { empty: 'No posts in this Topic yet. Start it!' });
    show(h('div', { class: 'card topichead' }, h('h1', null, '#' + topic.name), stats, fbtn),
      me ? composer({ prefill: '#' + topic.name + ' ', onPosted: (p) => { f.prepend(p); topic.posts++; paint(); toast('Posted!'); } }) : null, f);
    await f.ready;
  }

  async function userPage(name) {
    const { user } = await api('/users/' + enc(name));
    setTitle(user.username);
    drawSide();
    const stats = h('div', { class: 'stats' });
    const fbtn = h('button', { class: 'btn' });
    const paint = () => {
      stats.replaceChildren(h('span', null, h('b', null, user.posts), ' posts'), h('span', null, h('b', null, user.followers), ' followers'), h('span', null, h('b', null, user.following), ' following'));
      fbtn.textContent = user.isFollowing ? 'Following' : 'Follow';
      fbtn.className = 'btn' + (user.isFollowing ? ' on' : '');
    };
    fbtn.addEventListener('click', async () => {
      if (!me) return go('/login');
      const r = await api('/users/' + enc(user.username) + '/follow', { method: 'POST' }).catch((e) => toast(e.message));
      if (!r) return;
      user.isFollowing = r.following;
      user.followers += r.following ? 1 : -1;
      paint();
    });
    paint();
    const mine = me && me.username.toLowerCase() === user.username.toLowerCase();
    const f = feed({ user: user.username }, { empty: 'No posts yet!' });
    show(h('div', { class: 'card profile' },
      h('div', { class: 'top2' }, h('div', { class: 'av' }, user.username[0].toUpperCase()), h('div', null, h('h1', null, user.username), h('div', { class: 'muted small' }, 'Joined ' + new Date(user.created).toLocaleDateString())), h('div', { style: null }, mine ? h('a', { class: 'btn ghost small', href: '/settings', 'data-link': true }, 'Edit profile') : fbtn)),
      user.bio ? h('p', null, rich(user.bio)) : null, stats), f);
    await f.ready;
  }

  async function postPage(id) {
    const r = await api('/posts/' + enc(id));
    setTitle(r.post.username + ': ' + r.post.body.slice(0, 40));
    drawSide();
    const replies = h('div', { class: 'card' });
    const addReply = (p) => replies.append(postCard(p, { noReplyLink: true, focus: p.id === r.focus && r.focus !== r.post.id, onDelete: (el) => el.remove() }));
    r.replies.forEach(addReply);
    show(link('/', '← Back'),
      h('div', { class: 'card' }, postCard(r.post, { noReplyLink: true, focus: r.focus === r.post.id, onDelete: () => go('/', true) })),
      h('div', { class: 'pad' }),
      me ? composer({ parent: r.post.id, placeholder: 'Reply to ' + r.post.username, button: 'Reply', label: 'Write a reply', onPosted: (p) => { addReply(p); toast('Replied!'); } }) : h('p', { class: 'muted' }, link('/login', 'Log in'), ' to reply.'),
      r.replies.length || true ? replies : null);
  }

  async function searchPage() {
    const qv = (params().get('q') || '').trim();
    document.getElementById('q').value = qv;
    setTitle('Search');
    drawSide();
    const r = qv ? await api('/search?q=' + enc(qv)) : { users: [], topics: [] };
    show(h('h1', null, qv ? 'Results for "' + qv + '"' : 'Search'),
      h('div', { class: 'card side' }, h('h2', null, 'Topics'), r.topics.length ? h('div', null, r.topics.map((t) => h('a', { class: 'chip', href: '/topic/' + enc(t.topic), 'data-link': true }, '#' + t.topic))) : h('p', { class: 'muted' }, 'No matching Topics!')),
      h('div', { class: 'pad' }),
      h('div', { class: 'card side' }, h('h2', null, 'People'), r.users.length ? h('ol', null, r.users.map((u) => h('li', null, link('/u/' + enc(u.username), h('span', { class: 'tn' }, u.username)), h('span', { class: 'muted small' }, u.bio)))) : h('p', { class: 'muted' }, 'No matching people!')));
  }

  function authPage(mode) {
    setTitle(mode === 'login' ? 'Log in' : 'Sign up');
    side.replaceChildren();
    const box = errBox();
    const user = h('input', { id: 'u', autocomplete: 'username', maxlength: 20, required: true });
    const pw = h('input', { id: 'p', type: 'password', autocomplete: mode === 'login' ? 'current-password' : 'new-password', required: true });
    show(h('form', { class: 'card formcard', onsubmit: guard(box, async () => {
      const r = await api('/' + mode, { method: 'POST', body: { username: user.value, password: pw.value } });
      me = r.user;
      drawNav();
      go('/', true);
      toast(mode === 'login' ? 'Welcome back!' : 'Welcome to Beta!');
    }) },
      h('h1', null, mode === 'login' ? 'Log in' : 'Join Beta'),
      h('label', { for: 'u' }, 'Username'), user,
      h('label', { for: 'p' }, mode === 'login' ? 'Password' : 'Password (8 or more characters)'), pw,
      box, h('p', null, h('button', { class: 'btn', type: 'submit' }, mode === 'login' ? 'Log in' : 'Sign up')),
      h('p', { class: 'muted small' }, mode === 'login' ? 'New here? ' : 'Already a member? ', link(mode === 'login' ? '/register' : '/login', mode === 'login' ? 'Join Beta' : 'Log in'))));
    user.focus();
  }

  function settings() {
    if (!me) return go('/login', true);
    setTitle('Settings');
    side.replaceChildren();
    const box = errBox();
    const bio = h('textarea', { id: 'bio', maxlength: 160, 'aria-label': 'Bio', value: me.bio || '' });
    show(h('div', { class: 'card formcard' },
      h('h1', null, 'Settings'),
      h('p', null, 'Signed in as ', h('b', null, me.username), '.'),
      h('label', { for: 'bio' }, 'Bio (up to 160 characters)'), bio,
      h('p', null, h('button', { class: 'btn', onclick: guard(box, async () => {
        await api('/me', { method: 'PATCH', body: { bio: bio.value } });
        me.bio = bio.value.trim();
        toast('Saved!');
      }) }, 'Save bio')),
      box,
      h('p', null, h('button', { class: 'btn ghost', onclick: async () => { await api('/logout', { method: 'POST' }); me = null; drawNav(); go('/'); } }, 'Log out'))));
  }

  async function render() {
    const my = ++tick;
    window.scrollTo(0, 0);
    const seg = location.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    try {
      const [a, b] = seg;
      if (!seg.length) await home();
      else if (a === 'login' && !b) authPage('login');
      else if (a === 'register' && !b) authPage('register');
      else if (a === 'settings' && !b) settings();
      else if (a === 'search' && !b) await searchPage();
      else if (a === 'topic' && b) await topicPage(b);
      else if (a === 'u' && b) await userPage(b);
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
    if (u.origin !== location.origin) return;
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
  });
})();
