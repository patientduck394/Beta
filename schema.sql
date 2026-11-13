-- Beta database. Safe to run again (every line says IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pw TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  name TEXT,
  created INTEGER NOT NULL,
  expires INTEGER
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
-- a post with a parent_id is a reply
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  parent_id INTEGER,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS posts_user ON posts(user_id, id);
CREATE INDEX IF NOT EXISTS posts_parent ON posts(parent_id, id);
-- the #topics found inside each post
CREATE TABLE IF NOT EXISTS post_topics (
  post_id INTEGER NOT NULL,
  topic TEXT NOT NULL,
  PRIMARY KEY (post_id, topic)
);
CREATE INDEX IF NOT EXISTS post_topics_topic ON post_topics(topic, post_id);
CREATE TABLE IF NOT EXISTS likes (
  post_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);
CREATE TABLE IF NOT EXISTS follows (
  follower INTEGER NOT NULL,
  followee INTEGER NOT NULL,
  PRIMARY KEY (follower, followee)
);
CREATE INDEX IF NOT EXISTS follows_followee ON follows(followee);
CREATE TABLE IF NOT EXISTS topic_follows (
  user_id INTEGER NOT NULL,
  topic TEXT NOT NULL,
  PRIMARY KEY (user_id, topic)
);
CREATE INDEX IF NOT EXISTS topic_follows_topic ON topic_follows(topic);
CREATE TABLE IF NOT EXISTS hits (
  key TEXT NOT NULL,
  window INTEGER NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (key, window)
);

-- ---- added in version 2 (the Worker also makes these by itself the first time it runs) ----
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS profiles (user_id INTEGER PRIMARY KEY, display_name TEXT NOT NULL DEFAULT '', website TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT 'lime', pinned INTEGER);
CREATE TABLE IF NOT EXISTS refs (post_id INTEGER PRIMARY KEY, target_id INTEGER NOT NULL, kind TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS refs_target ON refs(target_id, kind);
CREATE TABLE IF NOT EXISTS bookmarks (user_id INTEGER NOT NULL, post_id INTEGER NOT NULL, created INTEGER NOT NULL, PRIMARY KEY (user_id, post_id));
CREATE INDEX IF NOT EXISTS bookmarks_user ON bookmarks(user_id, created);
CREATE TABLE IF NOT EXISTS edits (post_id INTEGER PRIMARY KEY, edited INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS polls (post_id INTEGER PRIMARY KEY, ends INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS poll_options (post_id INTEGER NOT NULL, idx INTEGER NOT NULL, label TEXT NOT NULL, PRIMARY KEY (post_id, idx));
CREATE TABLE IF NOT EXISTS poll_votes (post_id INTEGER NOT NULL, user_id INTEGER NOT NULL, idx INTEGER NOT NULL, PRIMARY KEY (post_id, user_id));
CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, actor_id INTEGER NOT NULL, kind TEXT NOT NULL, post_id INTEGER, created INTEGER NOT NULL, read INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, id);
CREATE TABLE IF NOT EXISTS mutes (user_id INTEGER NOT NULL, target_id INTEGER NOT NULL, kind TEXT NOT NULL, PRIMARY KEY (user_id, target_id));
CREATE TABLE IF NOT EXISTS topic_mutes (user_id INTEGER NOT NULL, topic TEXT NOT NULL, PRIMARY KEY (user_id, topic));
CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, reporter_id INTEGER NOT NULL, post_id INTEGER NOT NULL, reason TEXT NOT NULL, created INTEGER NOT NULL, UNIQUE (reporter_id, post_id));
CREATE TABLE IF NOT EXISTS attachments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, post_id INTEGER, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, alt TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS attachments_post ON attachments(post_id);
CREATE INDEX IF NOT EXISTS attachments_user ON attachments(user_id);
CREATE TABLE IF NOT EXISTS attachment_chunks (attachment_id INTEGER NOT NULL, idx INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (attachment_id, idx));

-- ---- added in version 3 ----
CREATE TABLE IF NOT EXISTS settings (user_id INTEGER NOT NULL, k TEXT NOT NULL, v TEXT NOT NULL, PRIMARY KEY (user_id, k));
CREATE TABLE IF NOT EXISTS dms (id INTEGER PRIMARY KEY AUTOINCREMENT, sender_id INTEGER NOT NULL, recipient_id INTEGER NOT NULL, body TEXT NOT NULL, created INTEGER NOT NULL, read INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS dms_recipient ON dms(recipient_id, read);
CREATE INDEX IF NOT EXISTS dms_pair ON dms(sender_id, recipient_id, id);
CREATE TABLE IF NOT EXISTS lists (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS lists_user ON lists(user_id);
CREATE TABLE IF NOT EXISTS list_members (list_id INTEGER NOT NULL, user_id INTEGER NOT NULL, PRIMARY KEY (list_id, user_id));
CREATE INDEX IF NOT EXISTS list_members_user ON list_members(user_id);
CREATE TABLE IF NOT EXISTS post_cw (post_id INTEGER PRIMARY KEY, text TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bans (user_id INTEGER PRIMARY KEY, reason TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS avatars (user_id INTEGER PRIMARY KEY, file_id INTEGER NOT NULL);


-- ---- added in version 4 (Outlets) ----
CREATE TABLE IF NOT EXISTS outlets (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', rules TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT 'lime', owner_id INTEGER NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS outlet_members (outlet_id INTEGER NOT NULL, user_id INTEGER NOT NULL, role TEXT NOT NULL DEFAULT 'member', joined INTEGER NOT NULL, PRIMARY KEY (outlet_id, user_id));
CREATE INDEX IF NOT EXISTS outlet_members_user ON outlet_members(user_id);
CREATE TABLE IF NOT EXISTS subjects (id INTEGER PRIMARY KEY AUTOINCREMENT, outlet_id INTEGER NOT NULL, slug TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, UNIQUE (outlet_id, slug));
CREATE TABLE IF NOT EXISTS outlet_posts (post_id INTEGER PRIMARY KEY, outlet_id INTEGER NOT NULL, subject_id INTEGER, pinned INTEGER NOT NULL DEFAULT 0, locked INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS outlet_posts_outlet ON outlet_posts(outlet_id, post_id);
CREATE INDEX IF NOT EXISTS outlet_posts_subject ON outlet_posts(subject_id, post_id);
CREATE TABLE IF NOT EXISTS outlet_bans (outlet_id INTEGER NOT NULL, user_id INTEGER NOT NULL, PRIMARY KEY (outlet_id, user_id));
-- version 5
CREATE TABLE IF NOT EXISTS reactions (post_id INTEGER NOT NULL, user_id INTEGER NOT NULL, emoji TEXT NOT NULL, PRIMARY KEY (post_id, user_id));
CREATE TABLE IF NOT EXISTS scheduled (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, payload TEXT NOT NULL, at INTEGER NOT NULL, created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS scheduled_at ON scheduled(at);
CREATE INDEX IF NOT EXISTS scheduled_user ON scheduled(user_id);
CREATE TABLE IF NOT EXISTS word_filters (user_id INTEGER NOT NULL, word TEXT NOT NULL, PRIMARY KEY (user_id, word));
CREATE TABLE IF NOT EXISTS bookmark_folders (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS bookmark_folders_user ON bookmark_folders(user_id);
CREATE TABLE IF NOT EXISTS bookmark_folder_items (user_id INTEGER NOT NULL, post_id INTEGER NOT NULL, folder_id INTEGER NOT NULL, PRIMARY KEY (user_id, post_id));
CREATE INDEX IF NOT EXISTS bookmark_folder_items_folder ON bookmark_folder_items(folder_id);
CREATE TABLE IF NOT EXISTS badges (user_id INTEGER PRIMARY KEY, kind TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS announcements (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, created INTEGER NOT NULL, ends INTEGER);
CREATE TABLE IF NOT EXISTS profile_fields (user_id INTEGER NOT NULL, idx INTEGER NOT NULL, label TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (user_id, idx));
CREATE TABLE IF NOT EXISTS user_notes (user_id INTEGER NOT NULL, target_id INTEGER NOT NULL, note TEXT NOT NULL, PRIMARY KEY (user_id, target_id));
CREATE TABLE IF NOT EXISTS post_versions (post_id INTEGER NOT NULL, v INTEGER NOT NULL, body TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY (post_id, v));
CREATE TABLE IF NOT EXISTS reply_policy (post_id INTEGER PRIMARY KEY, policy TEXT NOT NULL);
-- version 6
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, admin TEXT NOT NULL, action TEXT NOT NULL, created INTEGER NOT NULL);
-- version 7
CREATE TABLE IF NOT EXISTS site_mods (user_id INTEGER PRIMARY KEY);
CREATE TABLE IF NOT EXISTS warnings (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, text TEXT NOT NULL, created INTEGER NOT NULL, seen INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS warnings_user ON warnings(user_id, seen);
CREATE TABLE IF NOT EXISTS ban_until (user_id INTEGER PRIMARY KEY, until INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS admin_notes (user_id INTEGER PRIMARY KEY, note TEXT NOT NULL, updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS invites (code TEXT PRIMARY KEY, note TEXT NOT NULL DEFAULT '', max INTEGER NOT NULL DEFAULT 0, uses INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, disabled INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS hidden_topics (topic TEXT PRIMARY KEY);
-- version 8
CREATE TABLE IF NOT EXISTS muted_threads (user_id INTEGER NOT NULL, post_id INTEGER NOT NULL, PRIMARY KEY (user_id, post_id));
CREATE TABLE IF NOT EXISTS saved_searches (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, q TEXT NOT NULL, created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS saved_searches_user ON saved_searches(user_id);
