-- Row-level security and job functions for the Integrations Marketplace (migration 0024).
--  * Members of a workspace can see its connections and mappings. Credentials are readable by
--    members only in sealed form (AES-256-GCM under a server key that never reaches the database),
--    so a member can use a connection (import from Drive) without ever seeing a token.
--  * Connecting, configuring and disconnecting needs 'integrations.manage'.
--  * The Activity & Sync Log is visible to members who manage integrations or view the audit log.
--  * The background worker has no signed-in member. It works only through the SECURITY DEFINER
--    functions below, which queue, claim and record jobs.
GRANT SELECT, INSERT, UPDATE, DELETE ON "integration_credentials" TO st_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "integration_mappings", "integration_jobs" TO st_app;
--> statement-breakpoint

-- OAuth connections need only 'integrations.manage'. Partner connections additionally issue an
-- API key, which the API key policies already gate on 'api.manage'.
DROP POLICY IF EXISTS integration_connections_insert ON "integration_connections";
--> statement-breakpoint
CREATE POLICY integration_connections_insert ON "integration_connections" FOR INSERT
  WITH CHECK (st_has_permission(workspace_id, 'integrations.manage'));
--> statement-breakpoint

ALTER TABLE "integration_credentials" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "integration_credentials" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY integration_credentials_select ON "integration_credentials" FOR SELECT
  USING (st_is_member(workspace_id));
--> statement-breakpoint
CREATE POLICY integration_credentials_insert ON "integration_credentials" FOR INSERT
  WITH CHECK (st_has_permission(workspace_id, 'integrations.manage'));
--> statement-breakpoint
-- Any member may store refreshed tokens (a refresh can happen during a member's import).
CREATE POLICY integration_credentials_update ON "integration_credentials" FOR UPDATE
  USING (st_is_member(workspace_id)) WITH CHECK (st_is_member(workspace_id));
--> statement-breakpoint
CREATE POLICY integration_credentials_delete ON "integration_credentials" FOR DELETE
  USING (st_has_permission(workspace_id, 'integrations.manage'));
--> statement-breakpoint

ALTER TABLE "integration_mappings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "integration_mappings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY integration_mappings_select ON "integration_mappings" FOR SELECT
  USING (st_is_member(workspace_id));
--> statement-breakpoint
CREATE POLICY integration_mappings_insert ON "integration_mappings" FOR INSERT
  WITH CHECK (st_has_permission(workspace_id, 'documents.create'));
--> statement-breakpoint
CREATE POLICY integration_mappings_update ON "integration_mappings" FOR UPDATE
  USING (st_has_permission(workspace_id, 'documents.create'))
  WITH CHECK (st_has_permission(workspace_id, 'documents.create'));
--> statement-breakpoint

ALTER TABLE "integration_jobs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "integration_jobs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY integration_jobs_select ON "integration_jobs" FOR SELECT
  USING (st_has_permission(workspace_id, 'integrations.manage') OR st_has_permission(workspace_id, 'audit.view'));
--> statement-breakpoint
-- Members record the actions they take themselves (an import), always as themselves.
CREATE POLICY integration_jobs_insert ON "integration_jobs" FOR INSERT
  WITH CHECK (st_is_member(workspace_id) AND created_by = st_current_user());
--> statement-breakpoint

-- Queues work caused by business events: today, saving a finished document to Google Drive for
-- connections with auto-save on. Idempotent: one job per connection, operation and event.
CREATE OR REPLACE FUNCTION st_integration_enqueue(p_limit int) RETURNS int
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  WITH ins AS (
    INSERT INTO integration_jobs (workspace_id, connection_id, provider, operation, event_id,
      document_id, request_id, details)
    SELECT e.workspace_id, c.id, c.provider, 'save_signed_copy', e.id,
      (e.data->>'document_id')::uuid, (e.data->>'request_id')::uuid,
      jsonb_build_object('title', e.data->>'title', 'event', e.type)
    FROM webhook_events e
    JOIN integration_connections c
      ON c.workspace_id = e.workspace_id AND c.provider = 'google_drive' AND c.status = 'active'
     AND coalesce(c.settings->>'autoSave', 'false') = 'true'
     AND coalesce(c.connected_at, c.created_at) <= e.created_at
     -- Only documents finished after auto-save was turned on.
     AND coalesce((c.settings->>'autoSaveSince')::timestamptz, c.connected_at, c.created_at) <= e.created_at
    WHERE e.type = 'document.finalized' AND e.created_at > now() - interval '7 days'
      AND NOT EXISTS (SELECT 1 FROM integration_jobs j
        WHERE j.connection_id = c.id AND j.operation = 'save_signed_copy' AND j.event_id = e.id)
    ORDER BY e.created_at
    LIMIT p_limit
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int INTO n FROM ins;
  RETURN n;
END $$;
--> statement-breakpoint

-- Claims due jobs and returns what the worker needs: the sealed credentials and the storage keys
-- of the finished files. Jobs stuck in 'running' for 10 minutes are picked up again.
CREATE OR REPLACE FUNCTION st_integration_claim(p_limit int)
RETURNS TABLE (job_id uuid, workspace_id uuid, connection_id uuid, provider text, operation text,
  attempts int, settings jsonb, secret_encrypted text, access_token_expires_at timestamptz,
  request_id uuid, title text, certificate_number text, signed_storage_key text,
  certificate_storage_key text, completed_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT j.id FROM integration_jobs j
    WHERE (j.status IN ('pending', 'retrying') AND j.next_attempt_at <= now())
       OR (j.status = 'running' AND j.started_at < now() - interval '10 minutes')
    ORDER BY j.next_attempt_at LIMIT p_limit FOR UPDATE OF j SKIP LOCKED
  ), upd AS (
    UPDATE integration_jobs j SET status = 'running', started_at = now(), attempts = j.attempts + 1
    FROM due WHERE j.id = due.id RETURNING j.*
  )
  SELECT upd.id, upd.workspace_id, upd.connection_id, upd.provider, upd.operation, upd.attempts,
    c.settings, cr.secret_encrypted, cr.access_token_expires_at, upd.request_id, r.title,
    r.certificate_number, sf.storage_key, cf.storage_key, r.completed_at
  FROM upd
  LEFT JOIN integration_connections c ON c.id = upd.connection_id
  LEFT JOIN integration_credentials cr ON cr.connection_id = upd.connection_id
  LEFT JOIN signing_requests r ON r.id = upd.request_id AND r.workspace_id = upd.workspace_id
  LEFT JOIN document_files sf ON sf.id = r.signed_file_id
  LEFT JOIN document_files cf ON cf.id = r.certificate_file_id;
END $$;
--> statement-breakpoint

-- Records a job result. Failures back off exponentially (1, 2, 4 ... minutes, at most 6 hours) and
-- stop after p_max attempts. 'permanent' failures (revoked access, missing file) stop at once.
CREATE OR REPLACE FUNCTION st_integration_finish(p_job uuid, p_ok boolean, p_permanent boolean,
  p_error_code text, p_error text, p_external_ref text, p_details jsonb, p_max int)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE j integration_jobs%ROWTYPE;
BEGIN
  SELECT * INTO j FROM integration_jobs WHERE id = p_job FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF p_ok THEN
    UPDATE integration_jobs SET status = 'succeeded', completed_at = now(), error_code = NULL,
      error_message = NULL, external_reference = coalesce(p_external_ref, external_reference),
      details = details || coalesce(p_details, '{}'::jsonb),
      duration_ms = (extract(epoch FROM now() - started_at) * 1000)::int
    WHERE id = p_job;
    UPDATE integration_connections SET last_success_at = now(), updated_at = now()
    WHERE id = j.connection_id;
  ELSE
    UPDATE integration_jobs SET
      status = CASE WHEN p_permanent OR j.attempts >= p_max THEN 'failed' ELSE 'retrying' END,
      completed_at = CASE WHEN p_permanent OR j.attempts >= p_max THEN now() END,
      next_attempt_at = now() + least(interval '1 minute' * power(2, greatest(j.attempts - 1, 0)), interval '6 hours'),
      error_code = left(p_error_code, 64), error_message = left(p_error, 500),
      details = details || coalesce(p_details, '{}'::jsonb),
      duration_ms = (extract(epoch FROM now() - started_at) * 1000)::int
    WHERE id = p_job;
    UPDATE integration_connections SET last_error_at = now(), last_error = left(p_error, 500),
      status = CASE WHEN p_error_code IN ('auth_revoked', 'auth_expired') THEN 'expired' ELSE status END,
      updated_at = now()
    WHERE id = j.connection_id AND status = 'active';
  END IF;
END $$;
--> statement-breakpoint

-- Stores refreshed tokens from the worker (no signed-in member).
CREATE OR REPLACE FUNCTION st_integration_store_tokens(p_connection uuid, p_secret text, p_expires timestamptz)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE integration_credentials SET secret_encrypted = p_secret, access_token_expires_at = p_expires,
    updated_at = now() WHERE connection_id = p_connection
$$;
--> statement-breakpoint

-- Lets a member who manages integrations retry a failed job.
CREATE OR REPLACE FUNCTION st_integration_retry(p_job uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE ws uuid;
BEGIN
  SELECT workspace_id INTO ws FROM integration_jobs WHERE id = p_job AND status = 'failed';
  IF ws IS NULL OR NOT st_has_permission(ws, 'integrations.manage') THEN RETURN false; END IF;
  UPDATE integration_jobs SET status = 'retrying', next_attempt_at = now(), completed_at = NULL,
    attempts = 0 WHERE id = p_job;
  INSERT INTO audit_events (workspace_id, actor_user_id, action, target_type, target_id)
  VALUES (ws, st_current_user(), 'integration.job_retried', 'integration_job', p_job::text);
  RETURN true;
END $$;
--> statement-breakpoint
-- Cancels queued work when a connection is disconnected.
CREATE OR REPLACE FUNCTION st_integration_cancel(p_connection uuid) RETURNS int
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE ws uuid; n int;
BEGIN
  SELECT workspace_id INTO ws FROM integration_connections WHERE id = p_connection;
  IF ws IS NULL OR NOT st_has_permission(ws, 'integrations.manage') THEN RETURN 0; END IF;
  UPDATE integration_jobs SET status = 'cancelled', completed_at = now()
  WHERE connection_id = p_connection AND status IN ('pending', 'retrying');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION st_integration_cancel(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION st_integration_cancel(uuid) TO st_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION st_integration_enqueue(int), st_integration_claim(int),
  st_integration_finish(uuid, boolean, boolean, text, text, text, jsonb, int),
  st_integration_store_tokens(uuid, text, timestamptz), st_integration_retry(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION st_integration_enqueue(int), st_integration_claim(int),
  st_integration_finish(uuid, boolean, boolean, text, text, text, jsonb, int),
  st_integration_store_tokens(uuid, text, timestamptz), st_integration_retry(uuid) TO st_app;
--> statement-breakpoint

-- Availability switches for staff. A connector whose flag is off shows as "Maintenance".
INSERT INTO feature_flags (key, description, enabled) VALUES
  ('integration_google_drive', 'Google Drive integration: connect, import and save signed copies', true)
ON CONFLICT (key) DO NOTHING;
