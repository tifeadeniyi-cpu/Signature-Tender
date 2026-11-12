-- Phase 7: API keys, idempotency, rate limits, webhooks and partner connections.
-- Keys, idempotency records and rate windows are reached only through SECURITY DEFINER functions
-- keyed by the key's hash or id. Webhook events are written by triggers, so every code path that
-- changes a request emits them.

GRANT SELECT, INSERT, UPDATE ON "api_keys" TO st_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "webhook_endpoints" TO st_app;
--> statement-breakpoint
GRANT SELECT ON "webhook_events", "webhook_deliveries" TO st_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "integration_connections" TO st_app;
--> statement-breakpoint

ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "api_keys" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY api_keys_select ON "api_keys" FOR SELECT USING (st_has_permission(workspace_id, 'api.manage'));
--> statement-breakpoint
CREATE POLICY api_keys_insert ON "api_keys" FOR INSERT
  WITH CHECK (st_has_permission(workspace_id, 'api.manage') AND created_by = st_current_user());
--> statement-breakpoint
CREATE POLICY api_keys_update ON "api_keys" FOR UPDATE
  USING (st_has_permission(workspace_id, 'api.manage'))
  WITH CHECK (st_has_permission(workspace_id, 'api.manage'));
--> statement-breakpoint

ALTER TABLE "api_idempotency" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "api_idempotency" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "api_rate_windows" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "api_rate_windows" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "webhook_endpoints" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "webhook_endpoints" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY webhook_endpoints_all ON "webhook_endpoints" FOR ALL
  USING (st_has_permission(workspace_id, 'api.manage'))
  WITH CHECK (st_has_permission(workspace_id, 'api.manage'));
--> statement-breakpoint
ALTER TABLE "webhook_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "webhook_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY webhook_events_select ON "webhook_events" FOR SELECT USING (st_has_permission(workspace_id, 'api.manage'));
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY webhook_deliveries_select ON "webhook_deliveries" FOR SELECT USING (st_has_permission(workspace_id, 'api.manage'));
--> statement-breakpoint

ALTER TABLE "integration_connections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "integration_connections" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY integration_connections_select ON "integration_connections" FOR SELECT USING (st_is_member(workspace_id));
--> statement-breakpoint
CREATE POLICY integration_connections_insert ON "integration_connections" FOR INSERT
  WITH CHECK (st_has_permission(workspace_id, 'integrations.manage') AND st_has_permission(workspace_id, 'api.manage'));
--> statement-breakpoint
CREATE POLICY integration_connections_update ON "integration_connections" FOR UPDATE
  USING (st_has_permission(workspace_id, 'integrations.manage'))
  WITH CHECK (st_has_permission(workspace_id, 'integrations.manage'));
--> statement-breakpoint

-- Authenticates a key by hash. A key works only while it is not revoked or expired and the member
-- who created it is still active in the workspace. Records last use at most once a minute.
CREATE OR REPLACE FUNCTION st_api_key_lookup(p_hash text)
RETURNS TABLE (id uuid, workspace_id uuid, created_by text, scopes text[])
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE k api_keys%ROWTYPE;
BEGIN
  SELECT * INTO k FROM api_keys WHERE key_hash = p_hash;
  IF NOT FOUND OR k.revoked_at IS NOT NULL OR (k.expires_at IS NOT NULL AND k.expires_at < now()) THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM workspace_memberships m WHERE m.workspace_id = k.workspace_id
                 AND m.user_id = k.created_by AND m.status = 'active') THEN RETURN; END IF;
  IF k.last_used_at IS NULL OR k.last_used_at < now() - interval '1 minute' THEN
    UPDATE api_keys SET last_used_at = now() WHERE api_keys.id = k.id;
  END IF;
  id := k.id; workspace_id := k.workspace_id; created_by := k.created_by; scopes := k.scopes;
  RETURN NEXT;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_api_rate_hit(p_key uuid, p_limit int) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE w timestamptz := date_trunc('minute', now()); n int;
BEGIN
  INSERT INTO api_rate_windows (api_key_id, window_start, count) VALUES (p_key, w, 1)
  ON CONFLICT (api_key_id, window_start) DO UPDATE SET count = api_rate_windows.count + 1
  RETURNING count INTO n;
  IF n = 1 THEN DELETE FROM api_rate_windows WHERE api_key_id = p_key AND window_start < w - interval '10 minutes'; END IF;
  RETURN n <= p_limit;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_api_idem_begin(p_key uuid, p_idem text, p_hash text,
  OUT state text, OUT status int, OUT body jsonb)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE r api_idempotency%ROWTYPE;
BEGIN
  DELETE FROM api_idempotency WHERE api_key_id = p_key AND created_at < now() - interval '24 hours';
  INSERT INTO api_idempotency (api_key_id, key, request_hash) VALUES (p_key, p_idem, p_hash)
  ON CONFLICT DO NOTHING;
  IF FOUND THEN state := 'new'; RETURN; END IF;
  SELECT * INTO r FROM api_idempotency WHERE api_key_id = p_key AND key = p_idem;
  IF r.request_hash <> p_hash THEN state := 'mismatch'; RETURN; END IF;
  IF r.response_status IS NULL THEN state := 'in_progress'; RETURN; END IF;
  state := 'replay'; status := r.response_status; body := r.response_body;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_api_idem_finish(p_key uuid, p_idem text, p_status int, p_body jsonb) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_status >= 500 THEN
    DELETE FROM api_idempotency WHERE api_key_id = p_key AND key = p_idem;
  ELSE
    UPDATE api_idempotency SET response_status = p_status, response_body = p_body
    WHERE api_key_id = p_key AND key = p_idem;
  END IF;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION st_api_key_lookup(text), st_api_rate_hit(uuid, int),
  st_api_idem_begin(uuid, text, text), st_api_idem_finish(uuid, text, int, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION st_api_key_lookup(text), st_api_rate_hit(uuid, int),
  st_api_idem_begin(uuid, text, text), st_api_idem_finish(uuid, text, int, jsonb) TO st_app;
--> statement-breakpoint

-- Event outbox, written by triggers.
CREATE OR REPLACE FUNCTION st_emit_event(p_ws uuid, p_type text, p_data jsonb) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO webhook_events (workspace_id, type, data) VALUES (p_ws, p_type, p_data)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION st_emit_event(uuid, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_request_event_data(r signing_requests) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'request_id', r.id, 'document_id', r.document_id, 'status', r.status::text, 'test', r.is_test,
    'title', r.title, 'external_source', d.external_source, 'external_id', d.external_id)
  FROM documents d WHERE d.id = r.document_id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION st_request_event_data(signing_requests) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_signing_requests_events() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d jsonb := st_request_event_data(NEW);
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM st_emit_event(NEW.workspace_id, 'request.created', d);
    IF NEW.status = 'sent' THEN PERFORM st_emit_event(NEW.workspace_id, 'request.sent', d); END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'sent' THEN PERFORM st_emit_event(NEW.workspace_id, 'request.sent', d);
    ELSIF NEW.status = 'completed' THEN PERFORM st_emit_event(NEW.workspace_id, 'request.completed', d);
    ELSIF NEW.status = 'declined' THEN PERFORM st_emit_event(NEW.workspace_id, 'request.declined', d);
    ELSIF NEW.status = 'expired' THEN PERFORM st_emit_event(NEW.workspace_id, 'request.expired', d);
    ELSIF NEW.status = 'cancelled' THEN PERFORM st_emit_event(NEW.workspace_id, 'request.cancelled', d);
    END IF;
  END IF;
  IF OLD.signed_file_id IS NULL AND NEW.signed_file_id IS NOT NULL THEN
    PERFORM st_emit_event(NEW.workspace_id, 'document.finalized', d);
    PERFORM st_emit_event(NEW.workspace_id, 'document.available', d);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER signing_requests_events AFTER INSERT OR UPDATE ON "signing_requests"
  FOR EACH ROW EXECUTE FUNCTION st_signing_requests_events();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_request_recipients_events() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r signing_requests%ROWTYPE; d jsonb;
BEGIN
  SELECT * INTO r FROM signing_requests WHERE id = NEW.request_id;
  d := st_request_event_data(r) || jsonb_build_object(
    'recipient_id', NEW.id, 'recipient_email', NEW.email, 'recipient_role', NEW.role::text);
  IF OLD.viewed_at IS NULL AND NEW.viewed_at IS NOT NULL THEN
    PERFORM st_emit_event(NEW.workspace_id, 'recipient.viewed', d); END IF;
  IF OLD.authenticated_at IS NULL AND NEW.authenticated_at IS NOT NULL THEN
    PERFORM st_emit_event(NEW.workspace_id, 'recipient.authenticated', d); END IF;
  IF OLD.signed_at IS NULL AND NEW.signed_at IS NOT NULL THEN
    PERFORM st_emit_event(NEW.workspace_id,
      CASE WHEN NEW.role::text = 'approver' THEN 'recipient.approved' ELSE 'recipient.signed' END, d); END IF;
  IF OLD.declined_at IS NULL AND NEW.declined_at IS NOT NULL THEN
    PERFORM st_emit_event(NEW.workspace_id, 'recipient.declined', d); END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER request_recipients_events AFTER UPDATE ON "request_recipients"
  FOR EACH ROW EXECUTE FUNCTION st_request_recipients_events();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_payments_events() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status::text IN ('paid', 'failed') THEN
    PERFORM st_emit_event(NEW.workspace_id,
      CASE WHEN NEW.status::text = 'paid' THEN 'payment.succeeded' ELSE 'payment.failed' END,
      jsonb_build_object('payment_id', NEW.id, 'kind', NEW.kind::text, 'amount_cents', NEW.amount_cents,
        'currency', NEW.currency, 'credits', NEW.credits, 'request_id', NEW.request_id));
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER payments_events AFTER UPDATE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION st_payments_events();
--> statement-breakpoint

-- Delivery worker. These run without a signed-in member (cron), so they are definer functions that
-- only move outbox rows; endpoint secrets stay encrypted and are decrypted by the app.
CREATE OR REPLACE FUNCTION st_webhook_fanout(p_limit int) RETURNS int
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE e webhook_events%ROWTYPE; n int := 0;
BEGIN
  FOR e IN SELECT * FROM webhook_events WHERE fanned_out_at IS NULL ORDER BY created_at
           LIMIT p_limit FOR UPDATE SKIP LOCKED LOOP
    INSERT INTO webhook_deliveries (workspace_id, endpoint_id, event_id)
    SELECT e.workspace_id, w.id, e.id FROM webhook_endpoints w
    WHERE w.workspace_id = e.workspace_id AND w.enabled AND w.created_at <= e.created_at
      AND (cardinality(w.events) = 0 OR e.type = ANY (w.events))
    ON CONFLICT DO NOTHING;
    UPDATE webhook_events SET fanned_out_at = now() WHERE id = e.id;
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_webhook_claim(p_limit int)
RETURNS TABLE (delivery_id uuid, endpoint_id uuid, url text, secret_encrypted text,
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
  SELECT upd.id, w.id, w.url, w.secret_encrypted, w.previous_secret_encrypted, w.previous_secret_expires_at,
         e.id, e.type, e.data, e.created_at, upd.attempts, upd.workspace_id
  FROM upd JOIN webhook_endpoints w ON w.id = upd.endpoint_id JOIN webhook_events e ON e.id = upd.event_id;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_webhook_record(p_delivery uuid, p_ok boolean, p_status int, p_error text, p_max int)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE a int;
BEGIN
  UPDATE webhook_deliveries SET attempts = attempts + 1, last_status_code = p_status,
    last_error = left(p_error, 500)
  WHERE id = p_delivery RETURNING attempts INTO a;
  IF p_ok THEN
    UPDATE webhook_deliveries SET status = 'succeeded' WHERE id = p_delivery;
  ELSIF a >= p_max THEN
    UPDATE webhook_deliveries SET status = 'dead' WHERE id = p_delivery;
  ELSE
    UPDATE webhook_deliveries SET status = 'failed',
      next_attempt_at = now() + least(interval '6 hours', interval '30 seconds' * power(2, a - 1))
    WHERE id = p_delivery;
  END IF;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION st_webhook_fanout(int), st_webhook_claim(int),
  st_webhook_record(uuid, boolean, int, text, int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION st_webhook_fanout(int), st_webhook_claim(int),
  st_webhook_record(uuid, boolean, int, text, int) TO st_app;
--> statement-breakpoint

-- Manual retry and test pings, for members who manage the API.
CREATE OR REPLACE FUNCTION st_webhook_retry(p_delivery uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE ws uuid;
BEGIN
  SELECT workspace_id INTO ws FROM webhook_deliveries WHERE id = p_delivery;
  IF ws IS NULL OR NOT st_has_permission(ws, 'api.manage') THEN RETURN false; END IF;
  UPDATE webhook_deliveries SET status = 'pending', next_attempt_at = now(),
    attempts = greatest(attempts - 1, 0) WHERE id = p_delivery;
  INSERT INTO audit_events (workspace_id, actor_user_id, action, target_type, target_id)
  VALUES (ws, st_current_user(), 'webhook.delivery_retried', 'webhook_delivery', p_delivery::text);
  RETURN true;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_webhook_test(p_endpoint uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE ws uuid; ev uuid;
BEGIN
  SELECT workspace_id INTO ws FROM webhook_endpoints WHERE id = p_endpoint;
  IF ws IS NULL OR NOT st_has_permission(ws, 'api.manage') THEN RETURN NULL; END IF;
  INSERT INTO webhook_events (workspace_id, type, data, fanned_out_at)
  VALUES (ws, 'webhook.test', jsonb_build_object('endpoint_id', p_endpoint), now()) RETURNING id INTO ev;
  INSERT INTO webhook_deliveries (workspace_id, endpoint_id, event_id) VALUES (ws, p_endpoint, ev);
  RETURN ev;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION st_webhook_retry(uuid), st_webhook_test(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION st_webhook_retry(uuid), st_webhook_test(uuid) TO st_app;
