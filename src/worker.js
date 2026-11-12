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

// ---------- the newer tables: made automatically the first time the Worker runs after a deploy ----------
// (schema.sql has the same list, for starting a brand new database by hand)
const SCHEMA_VERSION = 2;
const DDL = [
  'CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)',
  "CREATE TABLE IF NOT EXISTS profiles (user_id INTEGER PRIMARY KEY, display_name TEXT NOT NULL DEFAULT '', website TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT 'lime', pinned INTEGER)",
  // a repost is a post row with no text; a quote is a post with text. refs says which post they point at.
  'CREATE TABLE IF NOT EXISTS refs (post_id INTEGER PRIMARY KEY, target_id INTEGER NOT NULL, kind TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS refs_target ON refs(target_id, kind)',
  'CREATE TABLE IF NOT EXISTS bookmarks (user_id INTEGER NOT NULL, post_id INTEGER NOT NULL, created INTEGER NOT NULL, PRIMARY KEY (user_id, post_id))',
  'CREATE INDEX IF NOT EXISTS bookmarks_user ON bookmarks(user_id, created)',
  'CREATE TABLE IF NOT EXISTS edits (post_id INTEGER PRIMARY KEY, edited INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS polls (post_id INTEGER PRIMARY KEY, ends INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS poll_options (post_id INTEGER NOT NULL, idx INTEGER NOT NULL, label TEXT NOT NULL, PRIMARY KEY (post_id, idx))',
  'CREATE TABLE IF NOT EXISTS poll_votes (post_id INTEGER NOT NULL, user_id INTEGER NOT NULL, idx INTEGER NOT NULL, PRIMARY KEY (post_id, user_id))',
  'CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, actor_id INTEGER NOT NULL, kind TEXT NOT NULL, post_id INTEGER, created INTEGER NOT NULL, read INTEGER NOT NULL DEFAULT 0)',
  'CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, id)',
  "CREATE TABLE IF NOT EXISTS mutes (user_id INTEGER NOT NULL, target_id INTEGER NOT NULL, kind TEXT NOT NULL, PRIMARY KEY (user_id, target_id))",
  'CREATE TABLE IF NOT EXISTS topic_mutes (user_id INTEGER NOT NULL, topic TEXT NOT NULL, PRIMARY KEY (user_id, topic))',
  'CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, reporter_id INTEGER NOT NULL, post_id INTEGER NOT NULL, reason TEXT NOT NULL, created INTEGER NOT NULL, UNIQUE (reporter_id, post_id))',
  // pictures and files. They are cut into pieces (base64 text) so each database row stays small.
  "CREATE TABLE IF NOT EXISTS attachments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, post_id INTEGER, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, alt TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL)",
  'CREATE INDEX IF NOT EXISTS attachments_post ON attachments(post_id)',
  'CREATE INDEX IF NOT EXISTS attachments_user ON attachments(user_id)',
  'CREATE TABLE IF NOT EXISTS attachment_chunks (attachment_id INTEGER NOT NULL, idx INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (attachment_id, idx))',
];
let schemaReady = null;
function ensureSchema(env) {
  if (!schemaReady) {
    schemaReady = (async () => {
      let v = 0;
      try {
        const r = await env.DB.prepare("SELECT v FROM meta WHERE k='schema'").first();
        v = r ? parseInt(r.v, 10) || 0 : 0;
      } catch (e) {
        v = 0; // no meta table yet
      }
      if (v >= SCHEMA_VERSION) return;
      for (let i = 0; i < DDL.length; i += 10) await env.DB.batch(DDL.slice(i, i + 10).map((q) => env.DB.prepare(q)));
      await env.DB.prepare("INSERT INTO meta(k,v) VALUES('schema',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(String(SCHEMA_VERSION)).run();
    })().catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}

// ---------- small helpers ----------
const MAX_POST = 300;
const MAX_IMAGE = 2 * 1024 * 1024;
const MAX_FILE = 4 * 1024 * 1024;
const QUOTA = 40 * 1024 * 1024; // per person
const CHUNK = 600 * 1024;
const EDIT_WINDOW = 15 * 60 * 1000;
const COLORS = ['lime', 'mint', 'sky', 'sun', 'rose', 'violet', 'slate'];
const TOPIC_RE = /(?<![A-Za-z0-9_#&])#([A-Za-z][A-Za-z0-9_]{1,29})(?![A-Za-z0-9_])/g;
const MENTION_RE = /(?<![A-Za-z0-9_@])@([A-Za-z0-9][A-Za-z0-9_-]{2,19})(?![A-Za-z0-9_-])/g;
const topicsIn = (body) => [...new Set([...body.matchAll(TOPIC_RE)].map((m) => m[1].toLowerCase()))].slice(0, 5);
const mentionsIn = (body) => [...new Set([...body.matchAll(MENTION_RE)].map((m) => m[1].toLowerCase()))].slice(0, 5);
const cleanTopic = (t) => (/^[a-z][a-z0-9_]{1,29}$/i.test(t || '') ? t.toLowerCase() : bad('Topics are letters, numbers and _ (2 to 30), starting with a letter!'));
const ph = (n) => Array(n).fill('?').join(',');
const intParam = (v) => (/^\d{1,15}$/.test(String(v ?? '')) ? parseInt(v, 10) : null);
const cleanBody = (v) => String(v || '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim();
const cleanLine = (v, n) => String(v || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

function toB64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(out);
}
function fromB64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
// what a file really is, judged by its first bytes (never by what the sender claims)
function sniffImage(b) {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

async function blockedBetween(D, a, b) {
  return !!(await D.first("SELECT 1 AS x FROM mutes WHERE kind='block' AND ((user_id=? AND target_id=?) OR (user_id=? AND target_id=?))", a, b, b, a));
}
async function notify(D, userId, actorId, kind, postId) {
  if (!userId || userId === actorId) return;
  if (await D.first("SELECT 1 AS x FROM mutes WHERE user_id=? AND target_id=? AND kind IN ('block','mute')", userId, actorId)) return;
  await D.run(
    'INSERT INTO notifications(user_id,actor_id,kind,post_id,created) SELECT ?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM notifications WHERE user_id=? AND actor_id=? AND kind=? AND COALESCE(post_id,0)=COALESCE(?,0))',
    userId, actorId, kind, postId ?? null, Date.now(), userId, actorId, kind, postId ?? null
  );
}
const unnotify = (D, userId, actorId, kind, postId) => D.run('DELETE FROM notifications WHERE user_id=? AND actor_id=? AND kind=? AND COALESCE(post_id,0)=COALESCE(?,0)', userId, actorId, kind, postId ?? null);

// ---------- reading posts: one base query, then counts for all of them at once ----------
const BASE = `SELECT p.id, p.body, p.created, p.parent_id, p.user_id, u.username,
  COALESCE(pr.display_name,'') AS display_name, COALESCE(pr.color,'lime') AS color, r.target_id, r.kind AS rkind
  FROM posts p JOIN users u ON u.id=p.user_id LEFT JOIN profiles pr ON pr.user_id=p.user_id LEFT JOIN refs r ON r.post_id=p.id`;

async function metrics(env, viewerId, ids) {
  const M = {};
  ids.forEach((id) => (M[id] = { likes: 0, liked: false, replies: 0, reposts: 0, quotes: 0, reposted: false, bookmarked: false, edited: null, poll: null, files: [] }));
  if (!ids.length) return M;
  const P = ph(ids.length);
  const v = viewerId || 0;
  const q = (sql, ...extra) => env.DB.prepare(sql).bind(...extra, ...ids);
  const res = (
    await env.DB.batch([
      q(`SELECT post_id k, COUNT(*) n FROM likes WHERE post_id IN (${P}) GROUP BY post_id`),
      q(`SELECT post_id k FROM likes WHERE user_id=? AND post_id IN (${P})`, v),
      q(`SELECT parent_id k, COUNT(*) n FROM posts WHERE parent_id IN (${P}) GROUP BY parent_id`),
      q(`SELECT target_id k, kind, COUNT(*) n FROM refs WHERE target_id IN (${P}) GROUP BY target_id, kind`),
      q(`SELECT r.target_id k FROM refs r JOIN posts p ON p.id=r.post_id WHERE r.kind='repost' AND p.user_id=? AND r.target_id IN (${P})`, v),
      q(`SELECT post_id k FROM bookmarks WHERE user_id=? AND post_id IN (${P})`, v),
      q(`SELECT post_id k, edited FROM edits WHERE post_id IN (${P})`),
      q(`SELECT post_id k, ends FROM polls WHERE post_id IN (${P})`),
      q(`SELECT post_id k, idx, label FROM poll_options WHERE post_id IN (${P}) ORDER BY idx`),
      q(`SELECT post_id k, idx, COUNT(*) n FROM poll_votes WHERE post_id IN (${P}) GROUP BY post_id, idx`),
      q(`SELECT post_id k, idx FROM poll_votes WHERE user_id=? AND post_id IN (${P})`, v),
      q(`SELECT post_id k, id, name, mime, size, alt FROM attachments WHERE post_id IN (${P}) ORDER BY id`),
    ])
  ).map((x) => x.results);
  res[0].forEach((r) => (M[r.k].likes = r.n));
  res[1].forEach((r) => (M[r.k].liked = true));
  res[2].forEach((r) => (M[r.k].replies = r.n));
  res[3].forEach((r) => (M[r.k][r.kind === 'repost' ? 'reposts' : 'quotes'] = r.n));
  res[4].forEach((r) => (M[r.k].reposted = true));
  res[5].forEach((r) => (M[r.k].bookmarked = true));
  res[6].forEach((r) => (M[r.k].edited = r.edited));
  const polls = {};
  res[7].forEach((r) => (polls[r.k] = { options: [], total: 0, ends: r.ends, ended: r.ends < Date.now(), myVote: null }));
  res[8].forEach((r) => polls[r.k] && polls[r.k].options.push({ label: r.label, votes: 0 }));
  res[9].forEach((r) => {
    const p = polls[r.k];
    if (p && p.options[r.idx]) {
      p.options[r.idx].votes = r.n;
      p.total += r.n;
    }
  });
  res[10].forEach((r) => polls[r.k] && (polls[r.k].myVote = r.idx));
  Object.keys(polls).forEach((k) => (M[k].poll = polls[k]));
  res[11].forEach((r) => M[r.k].files.push({ id: r.id, name: r.name, mime: r.mime, size: r.size, alt: r.alt, image: r.mime.startsWith('image/') }));
  return M;
}

async function hydrate(env, D, user, rows) {
  if (!rows.length) return [];
  const have = new Set(rows.map((r) => r.id));
  const need = [...new Set(rows.filter((r) => r.target_id && !have.has(r.target_id)).map((r) => r.target_id))];
  const extra = need.length ? await D.all(`${BASE} WHERE p.id IN (${ph(need.length)})`, ...need) : [];
  const all = [...rows, ...extra];
  const ids = [...new Set(all.map((r) => r.id))];
  const M = await metrics(env, user && user.id, ids);
  const shape = (r) => ({ id: r.id, body: r.body, created: r.created, parent_id: r.parent_id, username: r.username, display_name: r.display_name, color: r.color, ...M[r.id] });
  const by = {};
  all.forEach((r) => (by[r.id] = shape(r)));
  const out = [];
  for (const r of rows) {
    if (r.rkind === 'repost') {
      const t = by[r.target_id];
      if (t) out.push({ id: r.id, kind: 'repost', created: r.created, username: r.username, display_name: r.display_name, color: r.color, target: t });
    } else if (r.rkind === 'quote') {
      const t = by[r.target_id];
      out.push({ ...by[r.id], quote: t ? { id: t.id, body: t.body, created: t.created, username: t.username, display_name: t.display_name, color: t.color, files: t.files } : null, quoteGone: !t });
    } else out.push(by[r.id]);
  }
  return out;
}

async function listPosts(env, D, user, where, params, { before, limit = 25, order = 'p.id DESC' } = {}) {
  const rows = await D.all(`${BASE} WHERE ${where}${before ? ' AND p.id < ?' : ''} ORDER BY ${order} LIMIT ?`, ...params, ...(before ? [before] : []), limit);
  return { posts: await hydrate(env, D, user, rows), cursor: rows.length ? rows[rows.length - 1].id : null, count: rows.length };
}
const onePost = async (env, D, user, id) => (await listPosts(env, D, user, 'p.id=?', [id], { limit: 1 })).posts[0];

// delete posts and everything hanging off them (replies, reposts, likes, pictures...)
async function purgePosts(D, startIds) {
  let ids = [...new Set(startIds)];
  for (let i = 0; i < ids.length; i += 60) {
    const part = ids.slice(i, i + 60);
    const P = ph(part.length);
    const kids = await D.all(`SELECT id FROM posts WHERE parent_id IN (${P}) UNION SELECT post_id AS id FROM refs WHERE kind='repost' AND target_id IN (${P})`, ...part, ...part);
    ids.push(...kids.map((k) => k.id));
  }
  ids = [...new Set(ids)];
  for (let i = 0; i < ids.length; i += 60) {
    const part = ids.slice(i, i + 60);
    const P = ph(part.length);
    const del = (t, col = 'post_id') => D.stmt(`DELETE FROM ${t} WHERE ${col} IN (${P})`, ...part);
    await D.batch([
      D.stmt(`DELETE FROM attachment_chunks WHERE attachment_id IN (SELECT id FROM attachments WHERE post_id IN (${P}))`, ...part),
      del('attachments'), del('likes'), del('post_topics'), del('edits'), del('polls'), del('poll_options'), del('poll_votes'), del('bookmarks'), del('notifications'), del('reports'), del('refs'),
      D.stmt(`UPDATE profiles SET pinned=NULL WHERE pinned IN (${P})`, ...part),
      del('posts', 'id'),
    ]);
  }
  return ids.length;
}

async function rssFeed(env, D, url, title, link, where, params) {
  const { posts } = await listPosts(env, D, null, where, params, { limit: 30 });
  const items = posts.filter((p) => p.kind !== 'repost').map((p) => `<item><title>${esc((p.display_name || p.username) + ': ' + p.body.slice(0, 70))}</title><link>${url.origin}/post/${p.id}</link><guid isPermaLink="true">${url.origin}/post/${p.id}</guid><pubDate>${new Date(p.created).toUTCString()}</pubDate><description>${esc(p.body)}</description></item>`).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${esc(title)}</title><link>${esc(url.origin + link)}</link><description>${esc(title)} on Beta</description>${items}</channel></rss>`;
  return new Response(xml, { headers: { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff' } });
}

// ---------- the routes ----------
async function route(req, env, url) {
  const D = db(env);
  const method = req.method;
  const ip = req.headers.get('cf-connecting-ip') || 'local';

  // RSS feeds live outside /api so feed readers can use them
  if (url.pathname.startsWith('/rss/') && method === 'GET') {
    const [, , kind, name] = url.pathname.split('/');
    if (kind === 'topic' && name) {
      const t = cleanTopic(decodeURIComponent(name));
      return rssFeed(env, D, url, '#' + t, '/topic/' + t, 'p.parent_id IS NULL AND p.id IN (SELECT post_id FROM post_topics WHERE topic=?)', [t]);
    }
    if (kind === 'user' && name) {
      const n = decodeURIComponent(name);
      return rssFeed(env, D, url, n, '/u/' + n, 'p.parent_id IS NULL AND u.username=?', [n]);
    }
    return json({ error: 'There is nothing at that address!' }, 404);
  }

  const seg = url.pathname.split('/').filter(Boolean).slice(1).map(decodeURIComponent);
  const user = await authUser(D, req);

  // pictures and files are public to read (every post is public)
  if (seg[0] === 'files' && seg[1] && method === 'GET') {
    const id = intParam(seg[1]);
    const a = id && (await D.first('SELECT id, name, mime, size FROM attachments WHERE id=? AND post_id IS NOT NULL', id));
    if (!a) bad('We could not find that file!', 404);
    const chunks = await D.all('SELECT data FROM attachment_chunks WHERE attachment_id=? ORDER BY idx', id);
    const out = new Uint8Array(a.size);
    let off = 0;
    for (const c of chunks) {
      const b = fromB64(c.data);
      out.set(b, off);
      off += b.length;
    }
    const isImg = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(a.mime);
    return new Response(out, {
      headers: {
        'content-type': isImg ? a.mime : 'application/octet-stream',
        'content-disposition': (isImg ? 'inline' : 'attachment') + "; filename*=UTF-8''" + encodeURIComponent(a.name),
        'cache-control': 'public, max-age=86400',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
      },
    });
  }

  if (method !== 'GET' && method !== 'HEAD' && user) {
    const origin = req.headers.get('origin');
    if (!origin || origin !== url.origin) bad('That request did not come from this site!', 403);
  }
  const need = () => user || bad('Log in first!', 401);
  const theme = async (u) => (await D.first('SELECT display_name, website, color FROM profiles WHERE user_id=?', u)) || { display_name: '', website: '', color: 'lime' };

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
    return json({ user: { username: name, bio: '', display_name: '', color: 'lime', unread: 0 } }, 200, { 'set-cookie': cookie(req, token, 2592000) });
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
    const t = await theme(row.id);
    return json({ user: { username: row.username, bio: row.bio, display_name: t.display_name, color: t.color, unread: 0 } }, 200, { 'set-cookie': cookie(req, token, 2592000) });
  }
  if (seg[0] === 'logout' && method === 'POST') {
    const m = /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.get('cookie') || '');
    if (m) await D.run("DELETE FROM sessions WHERE hash=? AND kind='web'", await sha256(m[1]));
    return json({ ok: true }, 200, { 'set-cookie': cookie(req, '', 0) });
  }
  if (seg[0] === 'me' && !seg[1] && method === 'GET') {
    if (!user) return json({ user: null });
    const row = await D.first('SELECT username, bio FROM users WHERE id=?', user.id);
    const t = await theme(user.id);
    const unread = (await D.first('SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND read=0', user.id)).n;
    return json({ user: { ...row, display_name: t.display_name, website: t.website, color: t.color, unread } });
  }
  if (seg[0] === 'me' && !seg[1] && method === 'PATCH') {
    need();
    const b = await readJson(req, 5000);
    const cur = await theme(user.id);
    const bio = b.bio === undefined ? null : cleanLine(b.bio, 160);
    const display = b.display_name === undefined ? cur.display_name : cleanLine(b.display_name, 40);
    const website = b.website === undefined ? cur.website : String(b.website || '').trim();
    if (website && !/^https?:\/\/[^\s<>"']{3,200}$/i.test(website)) bad('The website needs to start with http:// or https://!');
    const color = b.color === undefined ? cur.color : b.color;
    if (!COLORS.includes(color)) bad('Pick one of the listed colors!');
    if (bio !== null) await D.run('UPDATE users SET bio=? WHERE id=?', bio, user.id);
    await D.run('INSERT INTO profiles(user_id,display_name,website,color) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET display_name=excluded.display_name, website=excluded.website, color=excluded.color', user.id, display, website, color);
    return json({ ok: true });
  }
  if (seg[0] === 'me' && seg[1] === 'password' && method === 'POST') {
    need();
    await rate(D, 'pw:' + user.id, 8, 3600);
    const b = await readJson(req, 5000);
    const row = await D.first('SELECT pw FROM users WHERE id=?', user.id);
    if (!(await checkPw(String(b.old || ''), row.pw))) bad('That is not your current password!', 403);
    const pw = String(b.new || '');
    if (pw.length < 8 || pw.length > 200) bad('Passwords need at least 8 characters!');
    await D.run('UPDATE users SET pw=? WHERE id=?', await hashPw(pw), user.id);
    await D.run("DELETE FROM sessions WHERE user_id=? AND kind='web'", user.id); // sign out everywhere, then back in here
    const token = await newSession(D, user.id, 'web');
    return json({ ok: true }, 200, { 'set-cookie': cookie(req, token, 2592000) });
  }
  if (seg[0] === 'me' && seg[1] === 'delete' && method === 'POST') {
    need();
    await rate(D, 'del:' + user.id, 5, 3600);
    const b = await readJson(req, 5000);
    const row = await D.first('SELECT pw FROM users WHERE id=?', user.id);
    if (!(await checkPw(String(b.password || ''), row.pw))) bad('That is not your password!', 403);
    const mine = (await D.all('SELECT id FROM posts WHERE user_id=?', user.id)).map((r) => r.id);
    await purgePosts(D, mine);
    const u = user.id;
    await D.batch([
      D.stmt('DELETE FROM likes WHERE user_id=?', u), D.stmt('DELETE FROM follows WHERE follower=? OR followee=?', u, u), D.stmt('DELETE FROM topic_follows WHERE user_id=?', u),
      D.stmt('DELETE FROM bookmarks WHERE user_id=?', u), D.stmt('DELETE FROM mutes WHERE user_id=? OR target_id=?', u, u), D.stmt('DELETE FROM topic_mutes WHERE user_id=?', u),
      D.stmt('DELETE FROM notifications WHERE user_id=? OR actor_id=?', u, u), D.stmt('DELETE FROM poll_votes WHERE user_id=?', u), D.stmt('DELETE FROM reports WHERE reporter_id=?', u),
      D.stmt('DELETE FROM attachment_chunks WHERE attachment_id IN (SELECT id FROM attachments WHERE user_id=?)', u), D.stmt('DELETE FROM attachments WHERE user_id=?', u),
      D.stmt('DELETE FROM profiles WHERE user_id=?', u), D.stmt('DELETE FROM sessions WHERE user_id=?', u), D.stmt('DELETE FROM users WHERE id=?', u),
    ]);
    return json({ ok: true }, 200, { 'set-cookie': cookie(req, '', 0) });
  }

  // --- uploads: the browser sends the raw bytes
  if (seg[0] === 'upload' && !seg[1] && method === 'POST') {
    need();
    await rate(D, 'upload:' + user.id, 30, 3600);
    const len = parseInt(req.headers.get('content-length') || '0', 10);
    if (len > MAX_FILE + 1000) bad('That file is too big. The limit is 4 MB (2 MB for pictures)!', 413);
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (!bytes.length) bad('That file is empty!');
    if (bytes.length > MAX_FILE) bad('That file is too big. The limit is 4 MB (2 MB for pictures)!', 413);
    const mime = sniffImage(bytes);
    if (mime && bytes.length > MAX_IMAGE) bad('Pictures can be up to 2 MB. Try a smaller one!', 413);
    const used = (await D.first('SELECT COALESCE(SUM(size),0) AS n FROM attachments WHERE user_id=?', user.id)).n;
    if (used + bytes.length > QUOTA) bad('You have used up your 40 MB of files. Delete some posts with files to make room!', 413);
    let name = 'file';
    try { name = decodeURIComponent(req.headers.get('x-file-name') || 'file'); } catch (e) {}
    name = cleanLine(name.split(/[\\/]/).pop(), 100) || 'file';
    const r = await D.run('INSERT INTO attachments(user_id,post_id,name,mime,size,created) VALUES(?,NULL,?,?,?,?)', user.id, name, mime || 'application/octet-stream', bytes.length, Date.now());
    const id = r.meta.last_row_id;
    const stmts = [];
    for (let i = 0, n = 0; i < bytes.length; i += CHUNK, n++) stmts.push(D.stmt('INSERT INTO attachment_chunks(attachment_id,idx,data) VALUES(?,?,?)', id, n, toB64(bytes.subarray(i, i + CHUNK))));
    await D.batch(stmts);
    if (Math.random() < 0.05) { // tidy up uploads nobody posted
      const old = await D.all('SELECT id FROM attachments WHERE post_id IS NULL AND created < ?', Date.now() - 864e5);
      for (const o of old) await D.batch([D.stmt('DELETE FROM attachment_chunks WHERE attachment_id=?', o.id), D.stmt('DELETE FROM attachments WHERE id=?', o.id)]);
    }
    return json({ id, name, mime: mime || 'application/octet-stream', size: bytes.length, image: !!mime });
  }
  if (seg[0] === 'upload' && seg[1] && method === 'DELETE') {
    need();
    const id = intParam(seg[1]);
    await D.batch([D.stmt('DELETE FROM attachment_chunks WHERE attachment_id IN (SELECT id FROM attachments WHERE id=? AND user_id=? AND post_id IS NULL)', id, user.id), D.stmt('DELETE FROM attachments WHERE id=? AND user_id=? AND post_id IS NULL', id, user.id)]);
    return json({ ok: true });
  }

  // --- posting
  if (seg[0] === 'posts' && !seg[1] && method === 'POST') {
    need();
    await rate(D, 'post:' + user.id, 10, 60);
    await rate(D, 'postday:' + user.id, 250, 86400);
    const b = await readJson(req, 12000);
    const body = cleanBody(b.body);
    if ([...body].length > MAX_POST) bad('Posts are up to ' + MAX_POST + ' characters!');
    const files = Array.isArray(b.files) ? b.files.slice(0, 4) : [];
    const pollIn = b.poll && typeof b.poll === 'object' ? b.poll : null;
    if (!body && !files.length && !pollIn) bad('Write something first!');
    let parent = null, quote = null, parentAuthor = null, quoteAuthor = null;
    if (b.parent != null) {
      const pid = intParam(b.parent);
      const p = pid && (await D.first('SELECT id, user_id, parent_id FROM posts WHERE id=?', pid));
      if (!p) bad('We could not find the post you are replying to!', 404);
      parent = p.parent_id || p.id;
      parentAuthor = p.parent_id ? (await D.first('SELECT user_id FROM posts WHERE id=?', p.parent_id)).user_id : p.user_id;
      if (await blockedBetween(D, user.id, parentAuthor)) bad('You cannot reply to this person!', 403);
    }
    if (b.quote != null) {
      if (parent) bad('A reply cannot also be a quote!');
      const qid = intParam(b.quote);
      const t = qid && (await D.first('SELECT p.id, p.user_id, r.kind FROM posts p LEFT JOIN refs r ON r.post_id=p.id WHERE p.id=?', qid));
      if (!t || t.kind === 'repost') bad('We could not find the post you are quoting!', 404);
      if (!body) bad('Add a few words to your quote!');
      if (await blockedBetween(D, user.id, t.user_id)) bad('You cannot quote this person!', 403);
      quote = t.id;
      quoteAuthor = t.user_id;
    }
    let poll = null;
    if (pollIn) {
      if (parent) bad('Polls go in new posts, not replies!');
      const opts = (Array.isArray(pollIn.options) ? pollIn.options : []).map((o) => cleanLine(o, 40)).filter(Boolean);
      if (opts.length < 2 || opts.length > 4 || new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) bad('A poll needs 2 to 4 different choices!');
      const hours = [1, 6, 24, 72, 168].includes(pollIn.hours) ? pollIn.hours : 24;
      poll = { opts, ends: Date.now() + hours * 3600000 };
    }
    const mine = [];
    for (const f of files) {
      const fid = intParam(f && f.id);
      const a = fid && (await D.first('SELECT id FROM attachments WHERE id=? AND user_id=? AND post_id IS NULL', fid, user.id));
      if (!a) bad('One of the files is not there any more. Add it again!');
      mine.push({ id: fid, alt: cleanLine(f.alt, 200) });
    }
    const r = await D.run('INSERT INTO posts(user_id,body,parent_id,created) VALUES(?,?,?,?)', user.id, body, parent, Date.now());
    const id = r.meta.last_row_id;
    const stmts = topicsIn(body).map((t) => D.stmt('INSERT OR IGNORE INTO post_topics(post_id,topic) VALUES(?,?)', id, t));
    if (quote) stmts.push(D.stmt("INSERT INTO refs(post_id,target_id,kind) VALUES(?,?,'quote')", id, quote));
    if (poll) {
      stmts.push(D.stmt('INSERT INTO polls(post_id,ends) VALUES(?,?)', id, poll.ends));
      poll.opts.forEach((o, i) => stmts.push(D.stmt('INSERT INTO poll_options(post_id,idx,label) VALUES(?,?,?)', id, i, o)));
    }
    mine.forEach((f) => stmts.push(D.stmt('UPDATE attachments SET post_id=?, alt=? WHERE id=? AND user_id=? AND post_id IS NULL', id, f.alt, f.id, user.id)));
    if (stmts.length) await D.batch(stmts);
    // tell the right people
    const told = new Set([user.id]);
    const tell = async (uid, kind) => { if (uid && !told.has(uid)) { told.add(uid); await notify(D, uid, user.id, kind, id); } };
    await tell(parentAuthor, 'reply');
    await tell(quoteAuthor, 'quote');
    const names = mentionsIn(body);
    if (names.length) {
      const found = await D.all(`SELECT id FROM users WHERE username IN (${ph(names.length)})`, ...names);
      for (const f of found) if (!(await blockedBetween(D, user.id, f.id))) await tell(f.id, 'mention');
    }
    return json({ post: await onePost(env, D, user, id) });
  }
  if (seg[0] === 'posts' && seg[1] && !seg[2] && method === 'GET') {
    const id = intParam(seg[1]);
    const post = id && (await onePost(env, D, user, id));
    if (!post) bad('We could not find that post!', 404);
    const topId = post.parent_id || post.id;
    const top = post.parent_id ? await onePost(env, D, user, topId) : post;
    const rep = await listPosts(env, D, user, 'p.parent_id=?', [topId], { limit: 40, order: 'p.id ASC' });
    return json({ post: top, replies: rep.posts, focus: post.id });
  }
  if (seg[0] === 'posts' && seg[1] && !seg[2] && method === 'DELETE') {
    need();
    const id = intParam(seg[1]);
    const p = id && (await D.first('SELECT id, user_id FROM posts WHERE id=?', id));
    if (!p) bad('We could not find that post!', 404);
    if (p.user_id !== user.id) bad('You can only delete your own posts!', 403);
    await purgePosts(D, [id]);
    return json({ ok: true });
  }
  if (seg[0] === 'posts' && seg[1] && !seg[2] && method === 'PATCH') {
    need();
    const id = intParam(seg[1]);
    const p = id && (await D.first('SELECT p.id, p.user_id, p.created, r.kind FROM posts p LEFT JOIN refs r ON r.post_id=p.id WHERE p.id=?', id));
    if (!p) bad('We could not find that post!', 404);
    if (p.user_id !== user.id) bad('You can only edit your own posts!', 403);
    if (p.kind === 'repost') bad('Reposts cannot be edited!');
    if (Date.now() - p.created > EDIT_WINDOW) bad('Posts can only be edited in the first 15 minutes!', 403);
    const b = await readJson(req, 5000);
    const body = cleanBody(b.body);
    const hasFiles = (await D.first('SELECT 1 AS x FROM attachments WHERE post_id=?', id)) || (await D.first('SELECT 1 AS x FROM polls WHERE post_id=?', id));
    if (!body && !hasFiles) bad('Write something first!');
    if ([...body].length > MAX_POST) bad('Posts are up to ' + MAX_POST + ' characters!');
    await D.batch([
      D.stmt('UPDATE posts SET body=? WHERE id=?', body, id),
      D.stmt('DELETE FROM post_topics WHERE post_id=?', id),
      ...topicsIn(body).map((t) => D.stmt('INSERT OR IGNORE INTO post_topics(post_id,topic) VALUES(?,?)', id, t)),
      D.stmt('INSERT INTO edits(post_id,edited) VALUES(?,?) ON CONFLICT(post_id) DO UPDATE SET edited=excluded.edited', id, Date.now()),
    ]);
    return json({ post: await onePost(env, D, user, id) });
  }
  if (seg[0] === 'posts' && seg[1] && seg[2] && method === 'POST') {
    need();
    const id = intParam(seg[1]);
    const target = id && (await D.first('SELECT p.id, p.user_id, p.parent_id, r.kind FROM posts p LEFT JOIN refs r ON r.post_id=p.id WHERE p.id=?', id));
    if (!target) bad('We could not find that post!', 404);
    const act = seg[2];
    if (['like', 'repost', 'bookmark', 'vote', 'pin', 'report'].includes(act)) await rate(D, 'act:' + user.id, 120, 60);
    if (act === 'like') {
      if (await blockedBetween(D, user.id, target.user_id)) bad('You cannot interact with this person!', 403);
      const had = await D.first('SELECT 1 AS x FROM likes WHERE post_id=? AND user_id=?', id, user.id);
      if (had) { await D.run('DELETE FROM likes WHERE post_id=? AND user_id=?', id, user.id); await unnotify(D, target.user_id, user.id, 'like', id); }
      else { await D.run('INSERT INTO likes(post_id,user_id) VALUES(?,?)', id, user.id); await notify(D, target.user_id, user.id, 'like', id); }
      return json({ liked: !had, likes: (await D.first('SELECT COUNT(*) AS n FROM likes WHERE post_id=?', id)).n });
    }
    if (act === 'bookmark') {
      const had = await D.first('SELECT 1 AS x FROM bookmarks WHERE post_id=? AND user_id=?', id, user.id);
      if (had) await D.run('DELETE FROM bookmarks WHERE post_id=? AND user_id=?', id, user.id);
      else await D.run('INSERT INTO bookmarks(user_id,post_id,created) VALUES(?,?,?)', user.id, id, Date.now());
      return json({ bookmarked: !had });
    }
    if (act === 'repost') {
      if (target.parent_id || target.kind === 'repost') bad('Only new posts can be reposted!');
      if (await blockedBetween(D, user.id, target.user_id)) bad('You cannot interact with this person!', 403);
      const had = await D.first("SELECT p.id FROM refs r JOIN posts p ON p.id=r.post_id WHERE r.kind='repost' AND r.target_id=? AND p.user_id=?", id, user.id);
      if (had) { await purgePosts(D, [had.id]); await unnotify(D, target.user_id, user.id, 'repost', id); }
      else {
        const r = await D.run("INSERT INTO posts(user_id,body,parent_id,created) VALUES(?,'',NULL,?)", user.id, Date.now());
        await D.run("INSERT INTO refs(post_id,target_id,kind) VALUES(?,?,'repost')", r.meta.last_row_id, id);
        await notify(D, target.user_id, user.id, 'repost', id);
      }
      return json({ reposted: !had, reposts: (await D.first("SELECT COUNT(*) AS n FROM refs WHERE kind='repost' AND target_id=?", id)).n });
    }
    if (act === 'vote') {
      const b = await readJson(req, 1000);
      const poll = await D.first('SELECT ends FROM polls WHERE post_id=?', id);
      if (!poll) bad('That post has no poll!');
      if (poll.ends < Date.now()) bad('That poll has ended!');
      const idx = Number.isInteger(b.option) ? b.option : -1;
      if (!(await D.first('SELECT 1 AS x FROM poll_options WHERE post_id=? AND idx=?', id, idx))) bad('Pick one of the choices!');
      if (await blockedBetween(D, user.id, target.user_id)) bad('You cannot interact with this person!', 403);
      if (await D.first('SELECT 1 AS x FROM poll_votes WHERE post_id=? AND user_id=?', id, user.id)) bad('You already voted in this poll!', 409);
      await D.run('INSERT INTO poll_votes(post_id,user_id,idx) VALUES(?,?,?)', id, user.id, idx);
      return json({ post: await onePost(env, D, user, id) });
    }
    if (act === 'pin') {
      if (target.user_id !== user.id || target.parent_id || target.kind) bad('You can only pin your own new posts!', 403);
      const cur = await D.first('SELECT pinned FROM profiles WHERE user_id=?', user.id);
      const next = cur && cur.pinned === id ? null : id;
      await D.run('INSERT INTO profiles(user_id,pinned) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET pinned=excluded.pinned', user.id, next);
      return json({ pinned: next === id });
    }
    if (act === 'report') {
      await rate(D, 'report:' + user.id, 10, 3600);
      const b = await readJson(req, 2000);
      await D.run('INSERT OR IGNORE INTO reports(reporter_id,post_id,reason,created) VALUES(?,?,?,?)', user.id, id, cleanLine(b.reason || 'No reason given', 200), Date.now());
      return json({ ok: true });
    }
  }

  // --- reading feeds
  if (seg[0] === 'feed' && method === 'GET') {
    const sp = url.searchParams;
    const before = intParam(sp.get('before'));
    const limit = Math.min(intParam(sp.get('limit')) || 25, 40);
    let where = 'p.parent_id IS NULL';
    let params = [];
    let hide = true; // leave out people and topics I muted
    let opts = { before, limit };
    if (sp.get('topic')) {
      const t = cleanTopic(sp.get('topic'));
      where += ' AND p.id IN (SELECT post_id FROM post_topics WHERE topic=?)';
      params = [t];
      if (sp.get('sort') === 'top') {
        where += ' AND p.created > ?';
        params.push(Date.now() - 30 * 864e5);
        opts = { limit: 30, order: '((SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id) * 2 + (SELECT COUNT(*) FROM posts r WHERE r.parent_id=p.id)) DESC, p.id DESC' };
      }
    } else if (sp.get('user')) {
      hide = false;
      const tab = sp.get('tab') || 'posts';
      if (tab === 'replies') { where = 'p.parent_id IS NOT NULL AND u.username=?'; params = [sp.get('user')]; }
      else if (tab === 'likes') { where = 'p.id IN (SELECT post_id FROM likes WHERE user_id=(SELECT id FROM users WHERE username=?))'; params = [sp.get('user')]; }
      else if (tab === 'media') { where += ' AND u.username=? AND p.id IN (SELECT post_id FROM attachments WHERE post_id IS NOT NULL)'; params = [sp.get('user')]; }
      else { where += ' AND u.username=?'; params = [sp.get('user')]; }
    } else if (sp.get('scope') === 'home') {
      need();
      where += ` AND (p.user_id=? OR p.user_id IN (SELECT followee FROM follows WHERE follower=?)
                  OR p.id IN (SELECT post_id FROM post_topics WHERE topic IN (SELECT topic FROM topic_follows WHERE user_id=?)))`;
      params = [user.id, user.id, user.id];
    } else if (sp.get('q')) {
      const q = cleanLine(sp.get('q'), 60).replace(/[\\%_]/g, '\\$&');
      if (q.length < 2) return json({ posts: [], more: false, cursor: null });
      where += " AND p.body LIKE ? ESCAPE '\\'";
      params = ['%' + q + '%'];
    }
    if (hide && user) {
      where += " AND p.user_id NOT IN (SELECT target_id FROM mutes WHERE user_id=?)";
      params.push(user.id);
      if (!sp.get('topic')) {
        where += ' AND p.id NOT IN (SELECT post_id FROM post_topics WHERE topic IN (SELECT topic FROM topic_mutes WHERE user_id=?))';
        params.push(user.id);
      }
    }
    const r = await listPosts(env, D, user, where, params, opts);
    return json({ posts: r.posts, more: !opts.order && r.count === limit, cursor: r.cursor });
  }
  if (seg[0] === 'bookmarks' && method === 'GET') {
    need();
    const before = intParam(url.searchParams.get('before'));
    const rows = await D.all(`SELECT post_id, created FROM bookmarks WHERE user_id=? ${before ? 'AND created < ?' : ''} ORDER BY created DESC LIMIT 25`, user.id, ...(before ? [before] : []));
    if (!rows.length) return json({ posts: [], more: false, cursor: null });
    const got = await listPosts(env, D, user, `p.id IN (${ph(rows.length)})`, rows.map((r) => r.post_id), { limit: 40 });
    const order = new Map(rows.map((r, i) => [r.post_id, i]));
    got.posts.sort((a, b) => (order.get(a.kind === 'repost' ? a.target.id : a.id) ?? 99) - (order.get(b.kind === 'repost' ? b.target.id : b.id) ?? 99));
    return json({ posts: got.posts, more: rows.length === 25, cursor: rows[rows.length - 1].created });
  }

  // --- notifications
  if (seg[0] === 'notifications' && !seg[1] && method === 'GET') {
    need();
    const before = intParam(url.searchParams.get('before'));
    const rows = await D.all(
      `SELECT n.id, n.kind, n.post_id, n.created, n.read, u.username, COALESCE(pr.display_name,'') AS display_name, COALESCE(pr.color,'lime') AS color
       FROM notifications n JOIN users u ON u.id=n.actor_id LEFT JOIN profiles pr ON pr.user_id=n.actor_id
       WHERE n.user_id=? ${before ? 'AND n.id < ?' : ''} ORDER BY n.id DESC LIMIT 30`,
      user.id, ...(before ? [before] : [])
    );
    const pids = [...new Set(rows.map((r) => r.post_id).filter(Boolean))];
    const snip = {};
    if (pids.length) (await D.all(`SELECT id, body FROM posts WHERE id IN (${ph(pids.length)})`, ...pids)).forEach((p) => (snip[p.id] = p.body.slice(0, 120)));
    if (Math.random() < 0.02) await D.run('DELETE FROM notifications WHERE created < ?', Date.now() - 60 * 864e5);
    return json({ items: rows.map((r) => ({ ...r, read: !!r.read, snippet: snip[r.post_id] ?? null })), more: rows.length === 30, cursor: rows.length ? rows[rows.length - 1].id : null });
  }
  if (seg[0] === 'notifications' && seg[1] === 'count' && method === 'GET') {
    if (!user) return json({ unread: 0 });
    return json({ unread: (await D.first('SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND read=0', user.id)).n });
  }
  if (seg[0] === 'notifications' && seg[1] === 'read' && method === 'POST') {
    need();
    await D.run('UPDATE notifications SET read=1 WHERE user_id=? AND read=0', user.id);
    return json({ ok: true });
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
    const muted = user ? !!(await D.first('SELECT 1 AS x FROM topic_mutes WHERE topic=? AND user_id=?', t, user.id)) : false;
    return json({ topic: { name: t, posts, followers, following, muted } });
  }
  if (seg[0] === 'topics' && seg[1] && (seg[2] === 'follow' || seg[2] === 'mute') && method === 'POST') {
    need();
    const t = cleanTopic(seg[1]);
    const table = seg[2] === 'follow' ? 'topic_follows' : 'topic_mutes';
    const had = await D.first(`SELECT 1 AS x FROM ${table} WHERE topic=? AND user_id=?`, t, user.id);
    if (had) await D.run(`DELETE FROM ${table} WHERE topic=? AND user_id=?`, t, user.id);
    else {
      const n = (await D.first(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id=?`, user.id)).n;
      if (n >= 100) bad('That is 100 topics, which is the limit for now!');
      await D.run(`INSERT INTO ${table}(user_id,topic) VALUES(?,?)`, user.id, t);
    }
    return json({ [seg[2] === 'follow' ? 'following' : 'muted']: !had });
  }

  // --- people
  if (seg[0] === 'users' && seg[1] && !seg[2] && method === 'GET') {
    const u = await D.first('SELECT id, username, bio, created FROM users WHERE username=?', seg[1]);
    if (!u) bad('We could not find that person!', 404);
    const count = async (sql) => (await D.first(sql, u.id)).n;
    const t = await theme(u.id);
    const pr = await D.first('SELECT pinned FROM profiles WHERE user_id=?', u.id);
    const rel = user ? await D.first('SELECT kind FROM mutes WHERE user_id=? AND target_id=?', user.id, u.id) : null;
    return json({
      user: {
        username: u.username, bio: u.bio, created: u.created, display_name: t.display_name, website: t.website, color: t.color,
        posts: await count('SELECT COUNT(*) AS n FROM posts WHERE user_id=? AND parent_id IS NULL'),
        followers: await count('SELECT COUNT(*) AS n FROM follows WHERE followee=?'),
        following: await count('SELECT COUNT(*) AS n FROM follows WHERE follower=?'),
        isFollowing: user ? !!(await D.first('SELECT 1 AS x FROM follows WHERE follower=? AND followee=?', user.id, u.id)) : false,
        followsYou: user ? !!(await D.first('SELECT 1 AS x FROM follows WHERE follower=? AND followee=?', u.id, user.id)) : false,
        muted: !!rel && rel.kind === 'mute', blocked: !!rel && rel.kind === 'block',
        pinned: pr && pr.pinned ? await onePost(env, D, user, pr.pinned) : null,
      },
    });
  }
  if (seg[0] === 'users' && seg[1] && (seg[2] === 'followers' || seg[2] === 'following') && method === 'GET') {
    const u = await D.first('SELECT id FROM users WHERE username=?', seg[1]);
    if (!u) bad('We could not find that person!', 404);
    const [me, other] = seg[2] === 'followers' ? ['followee', 'follower'] : ['follower', 'followee'];
    const rows = await D.all(
      `SELECT x.username, x.bio, COALESCE(pr.display_name,'') AS display_name, COALESCE(pr.color,'lime') AS color,
        EXISTS(SELECT 1 FROM follows f2 WHERE f2.follower=? AND f2.followee=x.id) AS isFollowing
       FROM follows f JOIN users x ON x.id=f.${other} LEFT JOIN profiles pr ON pr.user_id=x.id WHERE f.${me}=? ORDER BY x.username LIMIT 200`,
      user ? user.id : 0, u.id
    );
    return json({ users: rows.map((r) => ({ ...r, isFollowing: !!r.isFollowing })) });
  }
  if (seg[0] === 'users' && seg[1] && seg[2] === 'follow' && method === 'POST') {
    need();
    await rate(D, 'follow:' + user.id, 60, 60);
    const u = await D.first('SELECT id FROM users WHERE username=?', seg[1]);
    if (!u) bad('We could not find that person!', 404);
    if (u.id === user.id) bad('You cannot follow yourself!');
    if (await blockedBetween(D, user.id, u.id)) bad('You cannot follow this person!', 403);
    const had = await D.first('SELECT 1 AS x FROM follows WHERE follower=? AND followee=?', user.id, u.id);
    if (had) { await D.run('DELETE FROM follows WHERE follower=? AND followee=?', user.id, u.id); await unnotify(D, u.id, user.id, 'follow', null); }
    else { await D.run('INSERT INTO follows(follower,followee) VALUES(?,?)', user.id, u.id); await notify(D, u.id, user.id, 'follow', null); }
    return json({ following: !had });
  }
  if (seg[0] === 'users' && seg[1] && (seg[2] === 'mute' || seg[2] === 'block') && method === 'POST') {
    need();
    const u = await D.first('SELECT id FROM users WHERE username=?', seg[1]);
    if (!u) bad('We could not find that person!', 404);
    if (u.id === user.id) bad('That would be a little odd!');
    const kind = seg[2];
    const had = await D.first('SELECT kind FROM mutes WHERE user_id=? AND target_id=?', user.id, u.id);
    if (had && had.kind === kind) await D.run('DELETE FROM mutes WHERE user_id=? AND target_id=?', user.id, u.id);
    else {
      await D.run('INSERT INTO mutes(user_id,target_id,kind) VALUES(?,?,?) ON CONFLICT(user_id,target_id) DO UPDATE SET kind=excluded.kind', user.id, u.id, kind);
      if (kind === 'block') await D.run('DELETE FROM follows WHERE (follower=? AND followee=?) OR (follower=? AND followee=?)', user.id, u.id, u.id, user.id);
    }
    return json({ [kind === 'mute' ? 'muted' : 'blocked']: !(had && had.kind === kind) });
  }
  if (seg[0] === 'mutes' && method === 'GET') {
    need();
    return json({
      users: await D.all('SELECT u.username, m.kind FROM mutes m JOIN users u ON u.id=m.target_id WHERE m.user_id=? ORDER BY u.username', user.id),
      topics: (await D.all('SELECT topic FROM topic_mutes WHERE user_id=? ORDER BY topic', user.id)).map((r) => r.topic),
    });
  }
  if (seg[0] === 'suggest' && method === 'GET') {
    const me = user ? user.id : 0;
    const rows = await D.all(
      `SELECT x.username, x.bio, COALESCE(pr.display_name,'') AS display_name, COALESCE(pr.color,'lime') AS color,
        (SELECT COUNT(*) FROM follows f WHERE f.followee=x.id) AS fans
       FROM users x LEFT JOIN profiles pr ON pr.user_id=x.id
       WHERE x.id != ? AND x.id NOT IN (SELECT followee FROM follows WHERE follower=?) AND x.id NOT IN (SELECT target_id FROM mutes WHERE user_id=?)
         AND EXISTS (SELECT 1 FROM posts p WHERE p.user_id=x.id)
       ORDER BY fans DESC, x.id DESC LIMIT 5`,
      me, me, me
    );
    return json({ users: rows });
  }

  if (seg[0] === 'search' && method === 'GET') {
    const raw = cleanLine(url.searchParams.get('q'), 30).replace(/^[#@]+/, '');
    const like = raw.replace(/[\\%_]/g, '\\$&') + '%';
    if (!raw) return json({ users: [], topics: [] });
    const users = await D.all("SELECT x.username, x.bio, COALESCE(pr.display_name,'') AS display_name, COALESCE(pr.color,'lime') AS color FROM users x LEFT JOIN profiles pr ON pr.user_id=x.id WHERE x.username LIKE ? ESCAPE '\\' OR pr.display_name LIKE ? ESCAPE '\\' ORDER BY x.username LIMIT 8", like, like);
    const topics = await D.all("SELECT topic, COUNT(*) AS n FROM post_topics WHERE topic LIKE ? ESCAPE '\\' GROUP BY topic ORDER BY n DESC LIMIT 10", like.toLowerCase());
    return json({ users, topics });
  }

  return json({ error: 'There is nothing at that address!' }, 404);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    try {
      await ensureSchema(env);
      return await route(req, env, url);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'Something went wrong on our side. Try again!' }, 500);
    }
  },
};
