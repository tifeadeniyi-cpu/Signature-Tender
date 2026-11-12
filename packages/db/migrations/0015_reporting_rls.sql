-- Phase 8: API usage reporting, Slack-format webhooks, and the internal administration functions.
GRANT SELECT ON "api_usage_daily" TO st_app;
--> statement-breakpoint
ALTER TABLE "api_usage_daily" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "api_usage_daily" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY api_usage_daily_select ON "api_usage_daily" FOR SELECT USING (st_has_permission(workspace_id, 'api.manage'));
--> statement-breakpoint
-- Staff list: no grants and no policies for the app role. Only definer functions read it.
ALTER TABLE "platform_admins" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "platform_admins" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "platform_admins" FROM st_app;
--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_format" CHECK (format IN ('signature_tender', 'slack'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_api_rate_hit(p_key uuid, p_limit int) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE w timestamptz := date_trunc('minute', now()); n int;
BEGIN
  INSERT INTO api_rate_windows (api_key_id, window_start, count) VALUES (p_key, w, 1)
  ON CONFLICT (api_key_id, window_start) DO UPDATE SET count = api_rate_windows.count + 1
  RETURNING count INTO n;
  IF n = 1 THEN DELETE FROM api_rate_windows WHERE api_key_id = p_key AND window_start < w - interval '10 minutes'; END IF;
  INSERT INTO api_usage_daily (api_key_id, workspace_id, day, calls)
  SELECT p_key, k.workspace_id, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD'), 1 FROM api_keys k WHERE k.id = p_key
  ON CONFLICT (api_key_id, day) DO UPDATE SET calls = api_usage_daily.calls + 1;
  RETURN n <= p_limit;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_api_usage_error(p_key uuid) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE api_usage_daily SET errors = errors + 1
  WHERE api_key_id = p_key AND day = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD');
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION st_api_usage_error(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION st_api_usage_error(uuid) TO st_app;
--> statement-breakpoint

-- Internal administration (spec Part 27). Every function checks the caller is platform staff,
-- returns counts and identifiers only (never document contents, recipients or signatures), and
-- writes an audit row so staff access is itself on the record.
CREATE OR REPLACE FUNCTION st_is_platform_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM platform_admins WHERE user_id = st_current_user());
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_admin_require(p_view text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT st_is_platform_admin() THEN RAISE EXCEPTION 'not a platform admin' USING ERRCODE = '42501'; END IF;
  INSERT INTO audit_events (workspace_id, actor_user_id, action, target_type, target_id)
  VALUES (NULL, st_current_user(), 'admin.viewed', 'admin_view', p_view);
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_admin_overview() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  PERFORM st_admin_require('overview');
  SELECT jsonb_build_object(
    'workspaces', (SELECT count(*) FROM workspaces),
    'active_workspaces_30d', (SELECT count(DISTINCT workspace_id) FROM signing_requests WHERE created_at > now() - interval '30 days'),
    'users', (SELECT count(*) FROM "user"),
    'requests_total', (SELECT count(*) FROM signing_requests WHERE NOT is_test),
    'requests_30d', (SELECT count(*) FROM signing_requests WHERE NOT is_test AND created_at > now() - interval '30 days'),
    'test_requests_30d', (SELECT count(*) FROM signing_requests WHERE is_test AND created_at > now() - interval '30 days'),
    'completed_30d', (SELECT count(*) FROM signing_requests WHERE NOT is_test AND completed_at > now() - interval '30 days'),
    'pending', (SELECT count(*) FROM signing_requests WHERE status IN ('sent','in_progress','awaiting_approval')),
    'awaiting_payment', (SELECT count(*) FROM signing_requests WHERE status IN ('awaiting_payment','payment_processing')),
    'finalization_failed', (SELECT count(*) FROM signing_requests WHERE status = 'finalization_failed'),
    'webhooks_dead_30d', (SELECT count(*) FROM webhook_deliveries WHERE status = 'dead' AND created_at > now() - interval '30 days'),
    'webhooks_retrying', (SELECT count(*) FROM webhook_deliveries WHERE status = 'failed'),
    'credits_consumed_30d', (SELECT count(*) FROM credit_holds WHERE status = 'consumed' AND updated_at > now() - interval '30 days'),
    'api_calls_30d', (SELECT coalesce(sum(calls), 0) FROM api_usage_daily WHERE day >= to_char(now() - interval '30 days', 'YYYY-MM-DD')),
    'revenue_30d', (SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (
        SELECT currency, kind::text AS kind, sum(amount_cents - amount_refunded_cents)::bigint AS net_cents, count(*) AS payments
        FROM payments WHERE status IN ('paid','partially_refunded','refunded') AND paid_at > now() - interval '30 days'
        GROUP BY currency, kind ORDER BY currency, kind) x),
    'revenue_month', (SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (
        SELECT currency, kind::text AS kind, sum(amount_cents - amount_refunded_cents)::bigint AS net_cents, count(*) AS payments
        FROM payments WHERE status IN ('paid','partially_refunded','refunded') AND paid_at >= date_trunc('month', now())
        GROUP BY currency, kind ORDER BY currency, kind) x),
    'requests_by_month', (SELECT coalesce(jsonb_agg(x ORDER BY x.month), '[]'::jsonb) FROM (
        SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month,
               count(*) FILTER (WHERE NOT is_test) AS live, count(*) FILTER (WHERE is_test) AS test,
               count(*) FILTER (WHERE status = 'completed' AND NOT is_test) AS completed
        FROM signing_requests WHERE created_at >= date_trunc('month', now()) - interval '11 months'
        GROUP BY 1) x)
  ) INTO r;
  RETURN r;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_admin_workspaces(p_query text, p_limit int)
RETURNS TABLE (id uuid, name text, created_at timestamptz, members bigint, plan_code text,
  subscription_status text, live_requests bigint, test_requests bigint, last_request_at timestamptz,
  credits_available bigint, failed_payments bigint)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM st_admin_require('workspaces');
  RETURN QUERY
  SELECT w.id, w.name, w.created_at,
    (SELECT count(*) FROM workspace_memberships m WHERE m.workspace_id = w.id AND m.status = 'active'),
    coalesce(b.plan_code, 'payg'), b.subscription_status,
    (SELECT count(*) FROM signing_requests s WHERE s.workspace_id = w.id AND NOT s.is_test),
    (SELECT count(*) FROM signing_requests s WHERE s.workspace_id = w.id AND s.is_test),
    (SELECT max(s.created_at) FROM signing_requests s WHERE s.workspace_id = w.id),
    (SELECT coalesce(sum(l.delta), 0) FROM credit_ledger l WHERE l.workspace_id = w.id)::bigint,
    (SELECT count(*) FROM payments p WHERE p.workspace_id = w.id AND p.status IN ('failed','disputed'))
  FROM workspaces w LEFT JOIN billing_accounts b ON b.workspace_id = w.id
  WHERE p_query IS NULL OR p_query = '' OR w.name ILIKE '%' || replace(replace(p_query, '%', '\%'), '_', '\_') || '%'
     OR w.id::text = p_query
  ORDER BY w.created_at DESC
  LIMIT least(greatest(p_limit, 1), 200);
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_admin_operations(p_limit int) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE lim int := least(greatest(p_limit, 1), 200);
BEGIN
  PERFORM st_admin_require('operations');
  RETURN jsonb_build_object(
    'finalization_failures', (SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (
      SELECT s.id AS request_id, s.workspace_id, w.name AS workspace, s.updated_at, left(s.finalization_error, 200) AS error
      FROM signing_requests s JOIN workspaces w ON w.id = s.workspace_id
      WHERE s.status = 'finalization_failed' ORDER BY s.updated_at DESC LIMIT lim) x),
    'webhook_failures', (SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (
      SELECT d.id AS delivery_id, d.workspace_id, w.name AS workspace, e.type AS event_type, d.status::text AS status,
             d.attempts, d.last_status_code, left(d.last_error, 200) AS error, d.last_attempt_at,
             split_part(split_part(ep.url, '://', 2), '/', 1) AS host
      FROM webhook_deliveries d JOIN webhook_events e ON e.id = d.event_id
      JOIN webhook_endpoints ep ON ep.id = d.endpoint_id JOIN workspaces w ON w.id = d.workspace_id
      WHERE d.status IN ('failed','dead') ORDER BY d.last_attempt_at DESC NULLS LAST LIMIT lim) x),
    'payment_issues', (SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (
      SELECT p.id AS payment_id, p.workspace_id, w.name AS workspace, p.kind::text AS kind, p.status::text AS status,
             p.amount_cents, p.currency, p.created_at, left(p.failure_reason, 200) AS reason
      FROM payments p JOIN workspaces w ON w.id = p.workspace_id
      WHERE p.status IN ('failed','disputed')
         OR (p.status IN ('pending','processing') AND p.created_at < now() - interval '1 hour' AND p.created_at > now() - interval '7 days')
      ORDER BY p.created_at DESC LIMIT lim) x),
    'stripe_events_unprocessed', (SELECT count(*) FROM stripe_events WHERE processed_at IS NULL AND received_at < now() - interval '10 minutes'),
    'stuck_requests', (SELECT count(*) FROM signing_requests WHERE status IN ('ready_to_dispatch','queued') AND updated_at < now() - interval '1 hour'),
    'feature_flags', (SELECT coalesce(jsonb_agg(jsonb_build_object('key', key, 'enabled', enabled, 'environments', environments) ORDER BY key), '[]'::jsonb) FROM feature_flags)
  );
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION st_is_platform_admin(), st_admin_require(text), st_admin_overview(),
  st_admin_workspaces(text, int), st_admin_operations(int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION st_is_platform_admin(), st_admin_overview(), st_admin_workspaces(text, int),
  st_admin_operations(int) TO st_app;
--> statement-breakpoint
DROP FUNCTION st_webhook_claim(int);
--> statement-breakpoint
CREATE FUNCTION st_webhook_claim(p_limit int)
RETURNS TABLE (delivery_id uuid, endpoint_id uuid, url text, format text, secret_encrypted text,
  previous_secret_encrypted text, previous_secret_expires_at timestamptz, event_id uuid,
  event_type text, event_data jsonb, event_created_at timestamptz, attempts int, workspace_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT d.id FROM webhook_deliveries d JOIN webhook_endpoints w ON w.id = d.endpoint_id
    WHERE w.enabled AND d.next_attempt_at <= now()
      AND (d.status IN ('pending', 'failed')
           OR (d.status = 'delivering' AND d.last_attempt_at < now() - interval '5 minutes'))
    ORDER BY d.next_attempt_at LIMIT p_limit FOR UPDATE OF d SKIP LOCKED
  ), upd AS (
    UPDATE webhook_deliveries d SET status = 'delivering', last_attempt_at = now()
    FROM due WHERE d.id = due.id RETURNING d.*
  )
  SELECT upd.id, w.id, w.url, w.format, w.secret_encrypted, w.previous_secret_encrypted, w.previous_secret_expires_at,
         e.id, e.type, e.data, e.created_at, upd.attempts, upd.workspace_id
  FROM upd JOIN webhook_endpoints w ON w.id = upd.endpoint_id JOIN webhook_events e ON e.id = upd.event_id;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION st_webhook_claim(int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION st_webhook_claim(int) TO st_app;
