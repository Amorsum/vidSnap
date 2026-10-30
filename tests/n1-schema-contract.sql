-- 仅对测试数据库运行；所有样本均在事务末尾回滚。
BEGIN;
INSERT INTO vidsnap_sessions(owner_id, token_hash, expires_at)
VALUES ('11111111-1111-4111-8111-111111111111', decode(repeat('01', 32), 'hex'), 10000000);
INSERT INTO vidsnap_analyses(id, owner_id, platform, video_id, status, expires_at)
VALUES ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'bilibili', 'BV1L3tA66EKt_p1', 'running', 9000000);

DO $$
BEGIN
  BEGIN
    UPDATE vidsnap_analyses SET status = 'completed', content_expires_at = 8000000,
      result_payload = '{"overall":"sample"}'::jsonb WHERE id = '22222222-2222-4222-8222-222222222222';
    RAISE EXCEPTION 'partial result unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO vidsnap_sessions(owner_id, token_hash, expires_at)
    VALUES ('33333333-3333-4333-8333-333333333333', decode('01', 'hex'), 10000000);
    RAISE EXCEPTION 'invalid token digest unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO vidsnap_analyses(id, owner_id, platform, video_id, status, expires_at)
    VALUES ('44444444-4444-4444-8444-444444444444', '33333333-3333-4333-8333-333333333333', 'youtube', 'sample', 'running', 9000000);
    RAISE EXCEPTION 'missing owner unexpectedly accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    UPDATE vidsnap_analyses SET content_expires_at = 10000000 WHERE id = '22222222-2222-4222-8222-222222222222';
    RAISE EXCEPTION 'expiry beyond analysis lifetime unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO vidsnap_sessions(owner_id, token_hash, expires_at)
    VALUES ('55555555-5555-4555-8555-555555555555', decode(repeat('01', 32), 'hex'), 10000000);
    RAISE EXCEPTION 'duplicate token digest unexpectedly accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    UPDATE vidsnap_analyses SET frame_manifest = '{}'::jsonb WHERE id = '22222222-2222-4222-8222-222222222222';
    RAISE EXCEPTION 'invalid frame manifest unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

UPDATE vidsnap_analyses SET status = 'completed', content_expires_at = 8000000,
  result_payload = '{"overall":"sample"}'::jsonb, evidence = '[{"text":"sample"}]'::jsonb, revision = revision + 1
  WHERE id = '22222222-2222-4222-8222-222222222222' AND status = 'running';
INSERT INTO vidsnap_conversation_turns(analysis_id, question, answer, created_at)
VALUES ('22222222-2222-4222-8222-222222222222', 'sample question', 'sample answer', 1);
UPDATE vidsnap_analyses SET status = 'deleted', result_payload = NULL, evidence = NULL, revision = revision + 1
  WHERE id = '22222222-2222-4222-8222-222222222222';
DO $$
DECLARE affected INTEGER;
BEGIN
  BEGIN
    UPDATE vidsnap_analyses SET result_payload = '{}'::jsonb WHERE id = '22222222-2222-4222-8222-222222222222';
    RAISE EXCEPTION 'deleted analysis retained result';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE vidsnap_analyses SET status = 'completed', result_payload = '{}'::jsonb, evidence = '[]'::jsonb
    WHERE id = '22222222-2222-4222-8222-222222222222' AND status = 'running';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'deleted analysis revived'; END IF;
END $$;
ROLLBACK;
