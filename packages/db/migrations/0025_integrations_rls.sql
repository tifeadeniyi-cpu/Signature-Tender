-- Integrations marketplace: row-level security, the automation trigger and the job worker functions.
--
-- Who can do what:
--   integrations.manage  connect workspace-wide accounts, manage any connection, create automations
--   integrations.use     use workspace connections, connect a personal account
--   integrations.view_logs  read the workspace's integration activity and jobs
-- A personal connection belongs to one member; only that member (and managers, to disconnect it)
-- can use it. OAuth tokens are readable only by members who can use the connection.

CREATE OR REPLACE FUNCTION st_integration_can_use(p_conn uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM integration_connections c
    WHERE c.id = p_conn AND st_is_member(c.workspace_id) AND (
      (c.visibility = 'workspace' AND (st_has_permission(c.workspace_id, 'integrations.use')
        OR st_has_permission(c.workspace_id, 'integrations.manage')))
      OR (c.visibility = 'personal' AND c.owner_user_id = st_current_user())
    )
  )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_integration_can_manage(p_conn uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM integration_connections c
    WHERE c.id = p_conn AND st_is_member(c.workspace_id) AND (
      st_has_permission(c.workspace_id, 'integrations.manage')
      OR (c.visibility = 'personal' AND c.owner_user_id = st_current_user())
    )
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION st_integration_can_use(uuid), st_integration_can_manage(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION st_integration_can_use(uuid), st_integration_can_manage(uuid) TO st_app;
--> statement-breakpoint

-- Connections: replace the Phase 7 policies so personal connections stay private.
DROP POLICY IF EXISTS integration_connections_select ON "integration_connections";
--> statement-breakpoint
DROP POLICY IF EXISTS integration_connections_insert ON "integration_connections";
--> statement-breakpoint
DROP POLICY IF EXISTS integration_connections_update ON "integration_connections";
--> statement-breakpoint
CREATE POLICY integration_connections_select ON "integration_connections" FOR SELECT USING (
  st_is_member(workspace_id) AND (
    visibility = 'workspace'
    OR owner_user_id = st_current_user()
    OR st_has_permission(workspace_id, 'integrations.manage')
  )
);
--> statement-breakpoint
-- Partner and Slack connections (no external account) keep the Phase 7 rule: they issue API keys or
-- webhooks, so they need api.manage as well.
CREATE POLICY integration_connections_insert ON "integration_connections" FOR INSERT WITH CHECK (
  (external_account_id IS NULL
    AND st_has_permission(workspace_id, 'integrations.manage')
    AND st_has_permission(workspace_id, 'api.manage'))
  OR (external_account_id IS NOT NULL AND created_by = st_current_user() AND (
    (visibility = 'workspace' AND st_has_permission(workspace_id, 'integrations.manage'))
    OR (visibility = 'personal' AND owner_user_id = st_current_user()
      AND (st_has_permission(workspace_id, 'integrations.use')
        OR st_has_permission(workspace_id, 'integrations.manage')))
  ))
);
--> statement-breakpoint
CREATE POLICY integration_connections_update ON "integration_connections" FOR UPDATE
  USING (
    st_has_permission(workspace_id, 'integrations.manage')
    OR (visibility = 'personal' AND owner_user_id = st_current_user())
  )
  WITH CHECK (
    st_has_permission(workspace_id, 'integrations.manage')
    OR (visibility = 'personal' AND owner_user_id = st_current_user())
  );
--> statement-breakpoint

-- Credentials.
GRANT SELECT, INSERT, UPDATE, DELETE ON "integration_credentials" TO st_app;
--> statement-breakpoint
ALTER TABLE "integration_credentials" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "integration_credentials" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Reading and refreshing tokens needs "use"; storing or deleting them needs "manage".
CREATE POLICY integration_credentials_select ON "integration_credentials" FOR SELECT
  USING (st_integration_can_use(connection_id));
--> statement-breakpoint
CREATE POLICY integration_credentials_insert ON "integration_credentials" FOR INSERT
  WITH CHECK (st_integration_can_manage(connection_id)
    AND workspace_id = (SELECT c.workspace_id FROM integration_connections c WHERE c.id = connection_id));
--> statement-breakpoint
CREATE POLICY integration_credentials_update ON "integration_credentials" FOR UPDATE
  USING (st_integration_can_use(connection_id))
  WITH CHECK (st_integration_can_use(connection_id));
--> statement-breakpoint
CREATE POLICY integration_credentials_delete ON "integration_credentials" FOR DELETE
  USING (st_integration_can_manage(connection_id));
--> statement-breakpoint

-- Mappings.
GRANT SELECT, INSERT, UPDATE ON "integration_mappings" TO st_app;
--> statement-breakpoint
ALTER TABLE "integration_mappings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "integration_mappings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY integration_mappings_select ON "integration_mappings" FOR SELECT USING (
  st_integration_can_use(connection_id) OR st_has_permission(workspace_id, 'integrations.view_logs')
);
--> statement-breakpoint
CREATE POLICY integration_mappings_insert ON "integration_mappings" FOR INSERT WITH CHECK (
  st_integration_can_use(connection_id)
  AND workspace_id = (SELECT c.workspace_id FROM integration_connections c WHERE c.id = connection_id)
  AND workspace_id = (SELECT d.workspace_id FROM documents d WHERE d.id = document_id)
  AND (request_id IS NULL OR document_id = (SELECT r.document_id FROM signing_requests r WHERE r.id = request_id))
);
--> statement-breakpoint
CREATE POLICY integration_mappings_update ON "integration_mappings" FOR UPDATE
  USING (st_integration_can_use(connection_id))
  WITH CHECK (
    st_integration_can_use(connection_id)
    AND (request_id IS NULL OR document_id = (SELECT r.document_id FROM signing_requests r WHERE r.id = request_id))
  );
--> statement-breakpoint

-- Automations.
GRANT SELECT, INSERT, UPDATE, DELETE ON "integration_event_subscriptions" TO st_app;
--> statement-breakpoint
ALTER TABLE "integration_event_subscriptions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "integration_event_subscriptions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY integration_subscriptions_select ON "integration_event_subscriptions" FOR SELECT
  USING (st_integration_can_use(connection_id) OR st_has_permission(workspace_id, 'integrations.view_logs'));
--> statement-breakpoint
CREATE POLICY integration_subscriptions_insert ON "integration_event_subscriptions" FOR INSERT
  WITH CHECK (st_integration_can_manage(connection_id) AND created_by = st_current_user()
    AND workspace_id = (SELECT c.workspace_id FROM integration_connections c WHERE c.id = connection_id));
--> statement-breakpoint
CREATE POLICY integration_subscriptions_update ON "integration_event_subscriptions" FOR UPDATE
  USING (st_integration_can_manage(connection_id))
  WITH CHECK (st_integration_can_manage(connection_id));
--> statement-breakpoint
CREATE POLICY integration_subscriptions_delete ON "integration_event_subscriptions" FOR DELETE
  USING (st_integration_can_manage(connection_id));
--> statement-breakpoint

-- Jobs. Members queue jobs on connections they can use, as themselves. Claiming and recording
-- results goes through the SECURITY DEFINER worker functions below.
GRANT SELECT, INSERT, UPDATE ON "integration_sync_jobs" TO st_app;
--> statement-breakpoint
ALTER TABLE "integration_sync_jobs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "integration_sync_jobs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY integration_sync_jobs_select ON "integration_sync_jobs" FOR SELECT USING (
  actor_user_id = st_current_user()
  OR st_has_permission(workspace_id, 'integrations.view_logs')
  OR st_has_permission(workspace_id, 'integrations.manage')
);
--> statement-breakpoint
CREATE POLICY integration_sync_jobs_insert ON "integration_sync_jobs" FOR INSERT WITH CHECK (
  actor_user_id = st_current_user() AND status = 'pending' AND attempt_count = 0
  AND st_integration_can_use(connection_id)
  AND workspace_id = (SELECT c.workspace_id FROM integration_connections c WHERE c.id = connection_id)
);
--> statement-breakpoint
-- Managers can cancel a waiting job or send a failed one back to the queue.
CREATE POLICY integration_sync_jobs_update ON "integration_sync_jobs" FOR UPDATE
  USING (st_integration_can_manage(connection_id) AND status IN ('pending','retrying','failed'))
  WITH CHECK (st_integration_can_manage(connection_id) AND status IN ('pending','cancelled'));
--> statement-breakpoint

-- Activity.
GRANT SELECT, INSERT ON "integration_activity" TO st_app;
--> statement-breakpoint
ALTER TABLE "integration_activity" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "integration_activity" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY integration_activity_select ON "integration_activity" FOR SELECT USING (
  st_is_member(workspace_id) AND (
    actor_user_id = st_current_user()
    OR st_has_permission(workspace_id, 'integrations.view_logs')
    OR st_has_permission(workspace_id, 'integrations.manage')
  )
);
--> statement-breakpoint
CREATE POLICY integration_activity_insert ON "integration_activity" FOR INSERT WITH CHECK (
  st_is_member(workspace_id) AND actor_user_id = st_current_user()
  AND (connection_id IS NULL
    OR workspace_id = (SELECT c.workspace_id FROM integration_connections c WHERE c.id = connection_id))
);
--> statement-breakpoint

-- Automations: every Signature Tender event that matches an enabled rule on an active connection
-- queues one job. The (rule, event) idempotency key means an event can never queue the same work
-- twice. Test webhook events are written already fanned out and are skipped.
CREATE OR REPLACE FUNCTION st_integration_events() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.fanned_out_at IS NOT NULL THEN RETURN NEW; END IF;
  INSERT INTO integration_sync_jobs (workspace_id, connection_id, subscription_id, operation,
    idempotency_key, actor_user_id, correlation_id, document_id, request_id, input)
  SELECT s.workspace_id, s.connection_id, s.id, s.action,
    'event:' || s.id || ':' || NEW.id, s.created_by, NEW.id::text,
    (SELECT d.id FROM documents d WHERE d.id::text = NEW.data->>'document_id' AND d.workspace_id = NEW.workspace_id),
    (SELECT r.id FROM signing_requests r WHERE r.id::text = NEW.data->>'request_id' AND r.workspace_id = NEW.workspace_id),
    jsonb_build_object('event_type', NEW.type, 'configuration', s.configuration)
  FROM integration_event_subscriptions s
  JOIN integration_connections c ON c.id = s.connection_id
  WHERE s.workspace_id = NEW.workspace_id AND s.event_type = NEW.type AND s.enabled
    AND c.status = 'active'
  ON CONFLICT (workspace_id, idempotency_key) DO NOTHING;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION st_integration_events() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER integration_events_after_insert AFTER INSERT ON "webhook_events"
  FOR EACH ROW EXECUTE FUNCTION st_integration_events();
--> statement-breakpoint

-- Worker: claims due jobs. A job left running for 10 minutes (a crashed worker) is claimed again.
-- Each claim counts as an attempt. Returns only what the worker needs to run the job as its actor.
CREATE OR REPLACE FUNCTION st_integration_claim_jobs(p_limit int)
RETURNS TABLE (id uuid, workspace_id uuid, connection_id uuid, provider text, operation text,
  actor_user_id text, attempt_count int, max_attempts int, document_id uuid, request_id uuid,
  correlation_id text, input jsonb)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  WITH due AS (
    SELECT j.id FROM integration_sync_jobs j
    WHERE (j.status IN ('pending','retrying') AND j.next_attempt_at <= now())
       OR (j.status = 'running' AND j.started_at < now() - interval '10 minutes')
    ORDER BY j.next_attempt_at
    LIMIT greatest(1, least(p_limit, 50))
    FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE integration_sync_jobs j
    SET status = 'running', attempt_count = j.attempt_count + 1, started_at = now(), updated_at = now()
    FROM due WHERE j.id = due.id
    RETURNING j.*
  )
  SELECT upd.id, upd.workspace_id, upd.connection_id, c.provider, upd.operation, upd.actor_user_id,
    upd.attempt_count, upd.max_attempts, upd.document_id, upd.request_id, upd.correlation_id, upd.input
  FROM upd JOIN integration_connections c ON c.id = upd.connection_id
$$;
--> statement-breakpoint
-- Worker: records a job's outcome. A retryable failure waits 30s, 1m, 2m, ... (capped at 6 hours,
-- or the provider's Retry-After) and fails for good after max_attempts. Rule counters are updated.
CREATE OR REPLACE FUNCTION st_integration_finish_job(p_job uuid, p_ok boolean, p_retryable boolean,
  p_error_code text, p_error_message text, p_output jsonb, p_retry_after_seconds int)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE j integration_sync_jobs%ROWTYPE; next_status text;
BEGIN
  SELECT * INTO j FROM integration_sync_jobs WHERE id = p_job AND status = 'running' FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF p_ok THEN next_status := 'succeeded';
  ELSIF p_retryable AND j.attempt_count < j.max_attempts THEN next_status := 'retrying';
  ELSE next_status := 'failed';
  END IF;
  UPDATE integration_sync_jobs SET
    status = next_status,
    output = coalesce(p_output, output),
    error_code = CASE WHEN p_ok THEN NULL ELSE left(p_error_code, 100) END,
    error_message = CASE WHEN p_ok THEN NULL ELSE left(p_error_message, 500) END,
    completed_at = CASE WHEN next_status IN ('succeeded','failed') THEN now() ELSE NULL END,
    next_attempt_at = CASE WHEN next_status = 'retrying' THEN now() + make_interval(secs =>
      least(21600, greatest(coalesce(p_retry_after_seconds, 0), 30 * power(2, j.attempt_count - 1))))
      ELSE next_attempt_at END,
    updated_at = now()
  WHERE id = p_job;
  IF j.subscription_id IS NOT NULL AND next_status IN ('succeeded','failed') THEN
    UPDATE integration_event_subscriptions SET
      last_run_at = now(), run_count = run_count + 1,
      failure_count = failure_count + CASE WHEN next_status = 'failed' THEN 1 ELSE 0 END,
      updated_at = now()
    WHERE id = j.subscription_id;
  END IF;
  RETURN next_status;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION st_integration_claim_jobs(int),
  st_integration_finish_job(uuid, boolean, boolean, text, text, jsonb, int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION st_integration_claim_jobs(int),
  st_integration_finish_job(uuid, boolean, boolean, text, text, jsonb, int) TO st_app;
--> statement-breakpoint
-- Connection health, recorded by whoever just used the connection (a member or a job's actor).
-- p_status: 'active' after a successful provider call, or 'expired' / 'permission_required' /
-- 'error' after a failure. A disabled (disconnected) connection is never revived here.
CREATE OR REPLACE FUNCTION st_integration_record_health(p_conn uuid, p_ok boolean, p_status text,
  p_error_code text, p_error_message text, p_refreshed boolean)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT st_integration_can_use(p_conn) THEN RETURN; END IF;
  IF p_status NOT IN ('active','expired','permission_required','error') THEN
    RAISE EXCEPTION 'invalid connection status %', p_status;
  END IF;
  UPDATE integration_connections SET
    status = CASE WHEN status = 'disabled' THEN status ELSE p_status END,
    last_success_at = CASE WHEN p_ok THEN now() ELSE last_success_at END,
    last_failure_at = CASE WHEN p_ok THEN last_failure_at ELSE now() END,
    last_refreshed_at = CASE WHEN p_refreshed THEN now() ELSE last_refreshed_at END,
    last_error_code = CASE WHEN p_ok THEN NULL ELSE left(p_error_code, 100) END,
    last_error_message = CASE WHEN p_ok THEN NULL ELSE left(p_error_message, 500) END,
    updated_at = now()
  WHERE id = p_conn;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION st_integration_record_health(uuid, boolean, text, text, text, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION st_integration_record_health(uuid, boolean, text, text, text, boolean) TO st_app;
--> statement-breakpoint
-- Staff set an integration's availability (available, beta, coming_soon, maintenance, unavailable).
-- Stored in app_config under integrations.availability, audited. Code still refuses to connect a
-- connector that is not built, whatever this says.
CREATE OR REPLACE FUNCTION st_integration_set_availability(p_provider text, p_availability text)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE cur jsonb;
BEGIN
  IF NOT st_is_platform_admin() THEN
    RAISE EXCEPTION 'not a platform admin' USING ERRCODE = '42501';
  END IF;
  IF p_provider !~ '^[a-z0-9_]{2,40}$' THEN RAISE EXCEPTION 'invalid provider'; END IF;
  IF p_availability IS NOT NULL AND p_availability NOT IN
    ('available','beta','coming_soon','maintenance','unavailable') THEN
    RAISE EXCEPTION 'invalid availability';
  END IF;
  SELECT value INTO cur FROM app_config WHERE key = 'integrations.availability';
  cur := coalesce(cur, '{}'::jsonb);
  cur := CASE WHEN p_availability IS NULL THEN cur - p_provider
              ELSE cur || jsonb_build_object(p_provider, p_availability) END;
  INSERT INTO app_config (key, value, description, updated_at)
  VALUES ('integrations.availability', cur, 'Integration availability overrides (admin)', now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  INSERT INTO audit_events (workspace_id, actor_user_id, action, target_type, target_id, metadata)
  VALUES (NULL, st_current_user(), 'integration.availability_changed', 'integration', p_provider,
    jsonb_build_object('availability', p_availability));
END $$;
--> statement-breakpoint
-- Staff overview: connection and job counts per provider. Counts only; no accounts, tokens or
-- documents leave this function.
CREATE OR REPLACE FUNCTION st_integration_admin_overview()
RETURNS TABLE (provider text, connections int, active int, needs_attention int,
  jobs_failed_7d int, jobs_succeeded_7d int, envelopes_linked_30d int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT st_is_platform_admin() THEN
    RAISE EXCEPTION 'not a platform admin' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT c.provider,
    count(*)::int,
    count(*) FILTER (WHERE c.status = 'active')::int,
    count(*) FILTER (WHERE c.status IN ('expired','permission_required','error'))::int,
    (SELECT count(*)::int FROM integration_sync_jobs j JOIN integration_connections c2 ON c2.id = j.connection_id
      WHERE c2.provider = c.provider AND j.status = 'failed' AND j.updated_at > now() - interval '7 days'),
    (SELECT count(*)::int FROM integration_sync_jobs j JOIN integration_connections c2 ON c2.id = j.connection_id
      WHERE c2.provider = c.provider AND j.status = 'succeeded' AND j.updated_at > now() - interval '7 days'),
    (SELECT count(DISTINCT m.request_id)::int FROM integration_mappings m
      WHERE m.provider = c.provider AND m.request_id IS NOT NULL AND m.created_at > now() - interval '30 days')
  FROM integration_connections c
  GROUP BY c.provider;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION st_integration_set_availability(text, text), st_integration_admin_overview() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION st_integration_set_availability(text, text), st_integration_admin_overview() TO st_app;
