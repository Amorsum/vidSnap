-- N1 的隔离存储原型；由迁移工具在事务内执行。

CREATE TABLE vidsnap_sessions (
  owner_id UUID PRIMARY KEY,
  token_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  expires_at BIGINT NOT NULL CHECK (expires_at > 0)
);

CREATE TABLE vidsnap_analyses (
  id UUID PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES vidsnap_sessions(owner_id) ON DELETE RESTRICT,
  platform TEXT NOT NULL CHECK (platform IN ('youtube', 'bilibili', 'douyin')),
  video_id TEXT NOT NULL CHECK (length(video_id) BETWEEN 1 AND 128),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'deleted')),
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
  expires_at BIGINT NOT NULL CHECK (expires_at > 0),
  content_expires_at BIGINT CHECK (content_expires_at > 0 AND content_expires_at <= expires_at),
  frames_expire_at BIGINT CHECK (frames_expire_at > 0 AND frames_expire_at <= expires_at),
  result_payload JSONB,
  evidence JSONB,
  frame_manifest JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(frame_manifest) = 'array'),
  cleanup_pending BOOLEAN NOT NULL DEFAULT FALSE CHECK (NOT cleanup_pending OR status = 'deleted'),
  CHECK (
    (status = 'completed' AND result_payload IS NOT NULL AND jsonb_typeof(result_payload) = 'object'
      AND evidence IS NOT NULL AND jsonb_typeof(evidence) = 'array' AND content_expires_at IS NOT NULL)
    OR (status <> 'completed' AND result_payload IS NULL AND evidence IS NULL)
  )
);

CREATE INDEX vidsnap_analyses_owner_video ON vidsnap_analyses(owner_id, platform, video_id)
  WHERE status = 'completed';
CREATE INDEX vidsnap_analyses_expiry ON vidsnap_analyses(expires_at);
CREATE INDEX vidsnap_analyses_cleanup ON vidsnap_analyses(id) WHERE cleanup_pending;

CREATE TABLE vidsnap_conversation_turns (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  analysis_id UUID NOT NULL REFERENCES vidsnap_analyses(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  created_at BIGINT NOT NULL CHECK (created_at > 0)
);
CREATE INDEX vidsnap_turns_analysis ON vidsnap_conversation_turns(analysis_id, id DESC);
