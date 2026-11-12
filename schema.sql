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
