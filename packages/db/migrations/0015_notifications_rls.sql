-- Row-level security for transactional email notifications. Three kinds of actor reach the table:
--  * whoever finalizes a request (the recipient who signed last, or a sender retrying) inserts the
--    completion notifications in the same transaction, and only once the request is completed;
--  * the notification dispatcher (app.system_actor = 'notifications') claims, sends and records
--    delivery results; it is the only context that can update rows;
--  * workspace members who can view the document read its notifications in the Activity tab.
GRANT SELECT, INSERT, UPDATE ON "notifications" TO st_app;
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION st_is_notification_system() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.system_actor', true), '') = 'notifications'
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_request_completed(req uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM signing_requests r
    WHERE r.id = req AND r.status = 'completed'
      AND r.signed_file_id IS NOT NULL AND r.certificate_file_id IS NOT NULL)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_request_document(req uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.document_id FROM signing_requests r WHERE r.id = req
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION st_is_notification_system(), st_request_completed(uuid), st_request_document(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION st_is_notification_system(), st_request_completed(uuid), st_request_document(uuid) TO st_app;
--> statement-breakpoint

CREATE POLICY notifications_select ON "notifications" FOR SELECT TO st_app
  USING (st_is_notification_system() OR st_can_view_document(document_id));
--> statement-breakpoint
CREATE POLICY notifications_insert ON "notifications" FOR INSERT TO st_app
  WITH CHECK (
    st_request_completed(request_id)
    AND workspace_id = st_request_workspace(request_id)
    AND document_id = st_request_document(request_id)
    AND status = 'queued' AND attempts = 0 AND link_hash IS NULL
    AND (st_signer_request() = request_id OR st_can_send_request(request_id) OR st_is_notification_system()));
--> statement-breakpoint
CREATE POLICY notifications_update ON "notifications" FOR UPDATE TO st_app
  USING (st_is_notification_system()) WITH CHECK (st_is_notification_system());
--> statement-breakpoint

-- Resolves an emailed access link (by token hash) for the public link page. Returns only what the
-- page needs to ask the right person to verify; it never grants access to files by itself.
CREATE OR REPLACE FUNCTION st_notification_link(p_hash text)
RETURNS TABLE (notification_id uuid, request_id uuid, document_id uuid, audience text,
  to_email text, title text, request_status text, expired boolean, revoked boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT n.id, n.request_id, n.document_id, n.audience, n.to_email, r.title, r.status::text,
    coalesce(n.link_expires_at < now(), true), n.link_revoked_at IS NOT NULL
  FROM notifications n JOIN signing_requests r ON r.id = n.request_id
  WHERE p_hash ~ '^[0-9a-f]{64}$' AND n.link_hash = p_hash
$$;
--> statement-breakpoint
-- Lets a sender revoke every emailed access link for a request (for example, sent to a wrong address).
CREATE OR REPLACE FUNCTION st_revoke_notification_links(req uuid) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  IF NOT st_can_send_request(req) THEN RETURN 0; END IF;
  UPDATE notifications SET link_revoked_at = now(), updated_at = now()
    WHERE request_id = req AND link_revoked_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
--> statement-breakpoint
-- Signer progress for a verified-email recipient's view of a request: names, roles and status of
-- the other participants (no email addresses, IP addresses or links).
CREATE OR REPLACE FUNCTION st_retrieval_signers(req uuid)
RETURNS TABLE (name text, role text, status text, signing_order integer, signed_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT rr.name, rr.role::text, rr.status::text, rr.signing_order, rr.signed_at
  FROM request_recipients rr
  WHERE rr.request_id = req AND st_retrieval_request_ok(req)
  ORDER BY rr.signing_order, rr.created_at
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION st_notification_link(text), st_revoke_notification_links(uuid), st_retrieval_signers(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION st_notification_link(text), st_revoke_notification_links(uuid), st_retrieval_signers(uuid) TO st_app;
