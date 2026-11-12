// Beta: a microblogging site where posts live in Topics (#hashtags). A Cloudflare Worker + D1 database.
// Everything under /api is handled here; the pages themselves come from /public.

const enc = new TextEncoder();
const dec = new TextDecoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s) => new Uint8Array(s.match(/../g).map((h) => parseInt(h, 16)));
const sha256 = async (data) => hex(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? enc.encode(data) : data));

class HttpError extends Error {
  constructor(status, msg) {
    super(msg);
    this.status = status;
  }
}
const bad = (msg, status = 400) => {
  throw new HttpError(status, msg);
};
const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers },
  });

const RESERVED = new Set(['api', 'login', 'register', 'settings', 'topic', 'topics', 'search', 'post', 'u', 'admin', 'beta', 'help', 'about', 'logout', 'www']);

// ---------- small database helpers ----------
const db = (env) => ({
  first: (sql, ...p) => env.DB.prepare(sql).bind(...p).first(),
  all: async (sql, ...p) => (await env.DB.prepare(sql).bind(...p).all()).results,
  run: (sql, ...p) => env.DB.prepare(sql).bind(...p).run(),
  stmt: (sql, ...p) => env.DB.prepare(sql).bind(...p),
  batch: async (list) => {
    for (let i = 0; i < list.length; i += 40) await env.DB.batch(list.slice(i, i + 40));
  },
});

async function rate(D, key, limit, windowSec) {
  const now = Math.floor(Date.now() / 1000);
  const w = Math.floor(now / windowSec) * windowSec;
  const r = await D.first('INSERT INTO hits(key,window,n) VALUES(?,?,1) ON CONFLICT(key,window) DO UPDATE SET n=n+1 RETURNING n', key, w);
  if (r.n > limit) bad('Whoa, that is a lot! Wait a little and try again!', 429);
  if (Math.random() < 0.02) await D.run('DELETE FROM hits WHERE window < ?', now - 86400);
}

// ---------- passwords and sessions ----------
async function hashPw(pw, saltHex) {
  const salt = saltHex ? unhex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256);
  return hex(salt) + ':' + hex(bits);
}
async function checkPw(pw, stored) {
  const got = await hashPw(pw, stored.split(':')[0]);
  let diff = got.length ^ stored.length;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ (stored.charCodeAt(i) || 0);
  return diff === 0;
}
async function newSession(D, userId, kind, name) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  await D.run('INSERT INTO sessions(hash,user_id,kind,name,created,expires) VALUES(?,?,?,?,?,?)', await sha256(token), userId, kind, name || null, now, kind === 'web' ? now + 30 * 864e5 : null);
  return token;
}
async function authUser(D, req) {
  let token, kind;
  const a = req.headers.get('authorization') || '';
  if (a.startsWith('Bearer ')) {
    token = a.slice(7).trim();
    kind = 'api';
  } else {
    const m = /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.get('cookie') || '');
    if (m) {
      token = m[1];
      kind = 'web';
    }
  }
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const row = await D.first('SELECT u.id, u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.kind=? AND (s.expires IS NULL OR s.expires>?)', await sha256(token), kind, Date.now());
  return row ? { id: row.id, username: row.username, kind } : null;
}
const cookie = (req, token, maxAge) => `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}` + (new URL(req.url).protocol === 'https:' ? '; Secure' : '');

async function readJson(req, limit = 4 * 1024 * 1024) {
  const text = await req.text();
  if (text.length > limit) bad('That is too big to send at once!', 413);
  try {
    const v = JSON.parse(text || '{}');
    if (!v || typeof v !== 'object') bad('Send a JSON object!');
    return v;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    bad('That was not valid JSON!');
  }
}

// ---------- posts and topics ----------
const MAX_POST = 300;
const TOPIC_RE = /(?<![A-Za-z0-9_#&])#([A-Za-z][A-Za-z0-9_]{1,29})(?![A-Za-z0-9_])/g;
const topicsIn = (body) => [...new Set([...body.matchAll(TOPIC_RE)].map((m) => m[1].toLowerCase()))].slice(0, 5);
const cleanTopic = (t) => (/^[a-z][a-z0-9_]{1,29}$/i.test(t || '') ? t.toLowerCase() : bad('Topics are letters, numbers and _ (2 to 30), starting with a letter!'));

const POST_COLS = `p.id, p.body, p.created, p.parent_id, u.username,
  (SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id) AS likes,
  (SELECT COUNT(*) FROM posts r WHERE r.parent_id=p.id) AS replies,
  EXISTS(SELECT 1 FROM likes l WHERE l.post_id=p.id AND l.user_id=?) AS liked`;
const tidy = (r) => ({ ...r, liked: !!r.liked });

async function listPosts(D, user, where, params, before, limit) {
  const rows = await D.all(
    `SELECT ${POST_COLS} FROM posts p JOIN users u ON u.id=p.user_id
     WHERE ${where}${before ? ' AND p.id < ?' : ''} ORDER BY p.id DESC LIMIT ?`,
    user ? user.id : 0, ...params, ...(before ? [before] : []), limit
  );
  return rows.map(tidy);
}

async function route(req, env, url) {
  const D = db(env);
  const method = req.method;
  const seg = url.pathname.split('/').filter(Boolean).slice(1).map(decodeURIComponent);
  const ip = req.headers.get('cf-connecting-ip') || 'local';
  const user = await authUser(D, req);

  if (method !== 'GET' && method !== 'HEAD' && user) {
    const origin = req.headers.get('origin');
    if (!origin || origin !== url.origin) bad('That request did not come from this site!', 403);
  }
  const need = () => user || bad('Log in first!', 401);
  const intParam = (v) => (/^\d{1,15}$/.test(String(v || '')) ? parseInt(v, 10) : null);

  // --- accounts
  if (seg[0] === 'register' && method === 'POST') {
    await rate(D, 'reg:' + ip, 6, 3600);
    const b = await readJson(req, 10000);
    const name = String(b.username || '').trim();
    if (!/^[a-z0-9][a-z0-9_-]{2,19}$/i.test(name)) bad('Usernames are 3 to 20 letters, numbers, - or _!');
    if (RESERVED.has(name.toLowerCase())) bad('That name is saved for the site. Pick another!');
    const pw = String(b.password || '');
    if (pw.length < 8 || pw.length > 200) bad('Passwords need at least 8 characters!');
    if (await D.first('SELECT 1 AS x FROM users WHERE username=?', name)) bad('That username is taken!', 409);
    const r = await D.run('INSERT INTO users(username,pw,created) VALUES(?,?,?)', name, await hashPw(pw), Date.now());
    const token = await newSession(D, r.meta.last_row_id, 'web');
    return json({ user: { username: name, bio: '' } }, 200, { 'set-cookie': cookie(req, token, 2592000) });
  }
  if (seg[0] === 'login' && method === 'POST') {
    await rate(D, 'login:' + ip, 20, 600);
    const b = await readJson(req, 10000);
    const name = String(b.username || '').trim();
    await rate(D, 'loginu:' + name.toLowerCase(), 10, 600);
    const row = await D.first('SELECT id, username, bio, pw FROM users WHERE username=?', name);
    const ok = row ? await checkPw(String(b.password || ''), row.pw) : (await hashPw('x'), false);
    if (!ok) bad('That username or password is not right!', 401);
    const token = await newSession(D, row.id, 'web');
    return json({ user: { username: row.username, bio: row.bio } }, 200, { 'set-cookie': cookie(req, token, 2592000) });
  }
  if (seg[0] === 'logout' && method === 'POST') {
    const m = /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.get('cookie') || '');
    if (m) await D.run("DELETE FROM sessions WHERE hash=? AND kind='web'", await sha256(m[1]));
    return json({ ok: true }, 200, { 'set-cookie': cookie(req, '', 0) });
  }
  if (seg[0] === 'me' && method === 'GET') {
    if (!user) return json({ user: null });
    const row = await D.first('SELECT username, bio FROM users WHERE id=?', user.id);
    return json({ user: row });
  }
  if (seg[0] === 'me' && method === 'PATCH') {
    need();
    const b = await readJson(req, 5000);
    await D.run('UPDATE users SET bio=? WHERE id=?', String(b.bio || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 160), user.id);
    return json({ ok: true });
  }

  // --- posting
  if (seg[0] === 'posts' && !seg[1] && method === 'POST') {
    need();
    await rate(D, 'post:' + user.id, 10, 60);
    await rate(D, 'postday:' + user.id, 250, 86400);
    const b = await readJson(req, 5000);
    const body = String(b.body || '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim();
    if (!body) bad('Write something first!');
    if ([...body].length > MAX_POST) bad('Posts are up to ' + MAX_POST + ' characters!');
    let parent = null;
    if (b.parent != null) {
      const pid = intParam(b.parent);
      const p = pid && (await D.first('SELECT id, parent_id FROM posts WHERE id=?', pid));
      if (!p) bad('We could not find the post you are replying to!', 404);
      parent = p.parent_id || p.id; // replies all hang off the top post
    }
    const topics = topicsIn(body);
    const r = await D.run('INSERT INTO posts(user_id,body,parent_id,created) VALUES(?,?,?,?)', user.id, body, parent, Date.now());
    const id = r.meta.last_row_id;
    if (topics.length) await D.batch(topics.map((t) => D.stmt('INSERT OR IGNORE INTO post_topics(post_id,topic) VALUES(?,?)', id, t)));
    const [post] = await listPosts(D, user, 'p.id=?', [id], null, 1);
    return json({ post });
  }
  if (seg[0] === 'posts' && seg[1] && !seg[2] && method === 'GET') {
    const id = intParam(seg[1]);
    const [post] = id ? await listPosts(D, user, 'p.id=?', [id], null, 1) : [];
    if (!post) bad('We could not find that post!', 404);
    const topId = post.parent_id || post.id;
    const top = post.parent_id ? (await listPosts(D, user, 'p.id=?', [topId], null, 1))[0] : post;
    const replies = (await listPosts(D, user, 'p.parent_id=?', [topId], null, 100)).reverse();
    return json({ post: top, replies, focus: post.id });
  }
  if (seg[0] === 'posts' && seg[1] && !seg[2] && method === 'DELETE') {
    need();
    const id = intParam(seg[1]);
    const p = id && (await D.first('SELECT id, user_id FROM posts WHERE id=?', id));
    if (!p) bad('We could not find that post!', 404);
    if (p.user_id !== user.id) bad('You can only delete your own posts!', 403);
    await D.batch([
      D.stmt('DELETE FROM likes WHERE post_id IN (SELECT id FROM posts WHERE id=? OR parent_id=?)', id, id),
      D.stmt('DELETE FROM post_topics WHERE post_id IN (SELECT id FROM posts WHERE id=? OR parent_id=?)', id, id),
      D.stmt('DELETE FROM posts WHERE id=? OR parent_id=?', id, id),
    ]);
    return json({ ok: true });
  }
  if (seg[0] === 'posts' && seg[1] && seg[2] === 'like' && method === 'POST') {
    need();
    await rate(D, 'like:' + user.id, 120, 60);
    const id = intParam(seg[1]);
    if (!id || !(await D.first('SELECT 1 AS x FROM posts WHERE id=?', id))) bad('We could not find that post!', 404);
    const had = await D.first('SELECT 1 AS x FROM likes WHERE post_id=? AND user_id=?', id, user.id);
    if (had) await D.run('DELETE FROM likes WHERE post_id=? AND user_id=?', id, user.id);
    else await D.run('INSERT INTO likes(post_id,user_id) VALUES(?,?)', id, user.id);
    const n = (await D.first('SELECT COUNT(*) AS n FROM likes WHERE post_id=?', id)).n;
    return json({ liked: !had, likes: n });
  }

  // --- reading feeds
  if (seg[0] === 'feed' && method === 'GET') {
    const sp = url.searchParams;
    const before = intParam(sp.get('before'));
    const limit = Math.min(intParam(sp.get('limit')) || 25, 50);
    let where = 'p.parent_id IS NULL';
    let params = [];
    if (sp.get('topic')) {
      where += ' AND p.id IN (SELECT post_id FROM post_topics WHERE topic=?)';
      params = [cleanTopic(sp.get('topic'))];
    } else if (sp.get('user')) {
      where += ' AND u.username=?';
      params = [sp.get('user')];
    } else if (sp.get('scope') === 'home') {
      need();
      where += ` AND (p.user_id=? OR p.user_id IN (SELECT followee FROM follows WHERE follower=?)
                  OR p.id IN (SELECT post_id FROM post_topics WHERE topic IN (SELECT topic FROM topic_follows WHERE user_id=?)))`;
      params = [user.id, user.id, user.id];
    }
    const posts = await listPosts(D, user, where, params, before, limit);
    return json({ posts, more: posts.length === limit });
  }

  // --- topics
  if (seg[0] === 'topics' && !seg[1] && method === 'GET') {
    const since = Date.now() - 3 * 864e5;
    let rows = await D.all('SELECT pt.topic, COUNT(*) AS n FROM post_topics pt JOIN posts p ON p.id=pt.post_id WHERE p.created>? GROUP BY pt.topic ORDER BY n DESC, MAX(p.id) DESC LIMIT 10', since);
    if (!rows.length) rows = await D.all('SELECT pt.topic, COUNT(*) AS n FROM post_topics pt GROUP BY pt.topic ORDER BY n DESC, MAX(pt.post_id) DESC LIMIT 10');
    return json({ topics: rows });
  }
  if (seg[0] === 'topics' && seg[1] && !seg[2] && method === 'GET') {
    const t = cleanTopic(seg[1]);
    const posts = (await D.first('SELECT COUNT(*) AS n FROM post_topics WHERE topic=?', t)).n;
    const followers = (await D.first('SELECT COUNT(*) AS n FROM topic_follows WHERE topic=?', t)).n;
    const following = user ? !!(await D.first('SELECT 1 AS x FROM topic_follows WHERE topic=? AND user_id=?', t, user.id)) : false;
    return json({ topic: { name: t, posts, followers, following } });
  }
  if (seg[0] === 'topics' && seg[1] && seg[2] === 'follow' && method === 'POST') {
    need();
    const t = cleanTopic(seg[1]);
    const had = await D.first('SELECT 1 AS x FROM topic_follows WHERE topic=? AND user_id=?', t, user.id);
    if (had) await D.run('DELETE FROM topic_follows WHERE topic=? AND user_id=?', t, user.id);
    else {
      const n = (await D.first('SELECT COUNT(*) AS n FROM topic_follows WHERE user_id=?', user.id)).n;
      if (n >= 100) bad('That is 100 topics followed, which is the limit for now!');
      await D.run('INSERT INTO topic_follows(user_id,topic) VALUES(?,?)', user.id, t);
    }
    return json({ following: !had });
  }

  // --- people
  if (seg[0] === 'users' && seg[1] && !seg[2] && method === 'GET') {
    const u = await D.first('SELECT id, username, bio, created FROM users WHERE username=?', seg[1]);
    if (!u) bad('We could not find that person!', 404);
    const count = async (sql) => (await D.first(sql, u.id)).n;
    return json({
      user: {
        username: u.username,
        bio: u.bio,
        created: u.created,
        posts: await count('SELECT COUNT(*) AS n FROM posts WHERE user_id=? AND parent_id IS NULL'),
        followers: await count('SELECT COUNT(*) AS n FROM follows WHERE followee=?'),
        following: await count('SELECT COUNT(*) AS n FROM follows WHERE follower=?'),
        isFollowing: user ? !!(await D.first('SELECT 1 AS x FROM follows WHERE follower=? AND followee=?', user.id, u.id)) : false,
      },
    });
  }
  if (seg[0] === 'users' && seg[1] && seg[2] === 'follow' && method === 'POST') {
    need();
    await rate(D, 'follow:' + user.id, 60, 60);
    const u = await D.first('SELECT id FROM users WHERE username=?', seg[1]);
    if (!u) bad('We could not find that person!', 404);
    if (u.id === user.id) bad('You cannot follow yourself!');
    const had = await D.first('SELECT 1 AS x FROM follows WHERE follower=? AND followee=?', user.id, u.id);
    if (had) await D.run('DELETE FROM follows WHERE follower=? AND followee=?', user.id, u.id);
    else await D.run('INSERT INTO follows(follower,followee) VALUES(?,?)', user.id, u.id);
    return json({ following: !had });
  }

  if (seg[0] === 'search' && method === 'GET') {
    const raw = (url.searchParams.get('q') || '').trim().replace(/^[#@]+/, '').slice(0, 30);
    const like = raw.replace(/[\\%_]/g, '\\$&') + '%';
    if (!raw) return json({ users: [], topics: [] });
    const users = await D.all("SELECT username, bio FROM users WHERE username LIKE ? ESCAPE '\\' ORDER BY username LIMIT 8", like);
    const topics = await D.all("SELECT topic, COUNT(*) AS n FROM post_topics WHERE topic LIKE ? ESCAPE '\\' GROUP BY topic ORDER BY n DESC LIMIT 10", like.toLowerCase());
    return json({ users, topics });
  }

  return json({ error: 'There is nothing at that address!' }, 404);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    try {
      return await route(req, env, url);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'Something went wrong on our side. Try again!' }, 500);
    }
  },
};
