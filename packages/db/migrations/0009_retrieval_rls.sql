-- Retention policies: members read their workspace's policies; workspace managers change them.
GRANT SELECT, INSERT, UPDATE, DELETE ON "retention_policies" TO st_app;
--> statement-breakpoint
ALTER TABLE "retention_policies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "retention_policies" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY retention_select ON "retention_policies" FOR SELECT TO st_app
  USING (st_is_member(workspace_id));
--> statement-breakpoint
CREATE POLICY retention_write ON "retention_policies" FOR ALL TO st_app
  USING (st_has_permission(workspace_id, 'workspace.manage'))
  WITH CHECK (st_has_permission(workspace_id, 'workspace.manage') AND updated_by = st_current_user());
--> statement-breakpoint

-- Verified-email retrieval (spec 17.3). The app role has no grant on retrieval_sessions; only the
-- SECURITY DEFINER functions below read or write it. A verified session exposes only the requests
-- where that email is a recipient, and only completed files the sender allowed to be downloaded.
ALTER TABLE "retrieval_sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION st_retrieval_start(p_email text, p_code_hash text, p_ip text,
  OUT session_id uuid, OUT has_documents boolean, OUT allowed boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE n_email int; n_ip int;
BEGIN
  SELECT count(*) INTO n_email FROM retrieval_sessions
    WHERE email = p_email AND created_at > now() - interval '1 hour';
  SELECT count(*) INTO n_ip FROM retrieval_sessions
    WHERE p_ip IS NOT NULL AND ip_address = p_ip AND created_at > now() - interval '1 hour';
  IF n_email >= 5 OR n_ip >= 30 THEN
    allowed := false; has_documents := false; session_id := NULL;
    RETURN;
  END IF;
  allowed := true;
  has_documents := EXISTS (
    SELECT 1 FROM request_recipients rr JOIN signing_requests r ON r.id = rr.request_id
    WHERE lower(rr.email) = p_email
      AND r.status IN ('sent', 'in_progress', 'awaiting_approval', 'completed'));
  INSERT INTO retrieval_sessions (email, code_hash, code_expires_at, ip_address)
    VALUES (p_email, p_code_hash, now() + interval '10 minutes', p_ip)
    RETURNING id INTO session_id;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_retrieval_verify(p_id uuid, p_code_hash text, p_session_hash text)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE s retrieval_sessions%ROWTYPE;
BEGIN
  SELECT * INTO s FROM retrieval_sessions WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'invalid'; END IF;
  IF s.session_hash IS NOT NULL THEN RETURN 'used'; END IF;
  IF s.attempts >= 5 THEN RETURN 'locked'; END IF;
  IF s.code_expires_at < now() THEN RETURN 'expired'; END IF;
  UPDATE retrieval_sessions SET attempts = attempts + 1 WHERE id = p_id;
  IF s.code_hash <> p_code_hash THEN
    RETURN CASE WHEN s.attempts + 1 >= 5 THEN 'locked' ELSE 'invalid' END;
  END IF;
  UPDATE retrieval_sessions
    SET session_hash = p_session_hash, session_expires_at = now() + interval '30 minutes'
    WHERE id = p_id;
  RETURN 'ok';
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_retrieval_email() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.email FROM retrieval_sessions s
  WHERE s.session_hash = nullif(current_setting('app.retrieval_session_hash', true), '')
    AND s.session_expires_at > now()
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_retrieval_request_ok(req uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM request_recipients rr JOIN signing_requests r ON r.id = rr.request_id
    WHERE rr.request_id = req AND lower(rr.email) = st_retrieval_email()
      AND r.status IN ('sent', 'in_progress', 'awaiting_approval', 'completed'))
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_retrieval_file_ok(f uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM signing_requests r JOIN documents d ON d.id = r.document_id
    WHERE (r.signed_file_id = f OR r.certificate_file_id = f)
      AND r.status = 'completed' AND d.purged_at IS NULL
      AND coalesce((r.settings ->> 'allowDownload')::boolean, true)
      AND st_retrieval_request_ok(r.id))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION st_retrieval_start(text, text, text), st_retrieval_verify(uuid, text, text),
  st_retrieval_email(), st_retrieval_request_ok(uuid), st_retrieval_file_ok(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION st_retrieval_start(text, text, text), st_retrieval_verify(uuid, text, text),
  st_retrieval_email(), st_retrieval_request_ok(uuid), st_retrieval_file_ok(uuid) TO st_app;
--> statement-breakpoint

CREATE POLICY signing_requests_select_retrieval ON "signing_requests" FOR SELECT TO st_app
  USING (st_retrieval_request_ok(id));
--> statement-breakpoint
CREATE POLICY request_recipients_select_retrieval ON "request_recipients" FOR SELECT TO st_app
  USING (lower(email) = st_retrieval_email());
--> statement-breakpoint
-- Lets a verified recipient get a fresh signing link (token rotation) for their own row only.
CREATE POLICY request_recipients_update_retrieval ON "request_recipients" FOR UPDATE TO st_app
  USING (lower(email) = st_retrieval_email() AND st_retrieval_request_ok(request_id))
  WITH CHECK (lower(email) = st_retrieval_email() AND st_retrieval_request_ok(request_id));
--> statement-breakpoint
CREATE POLICY document_files_select_retrieval ON "document_files" FOR SELECT TO st_app
  USING (st_retrieval_file_ok(id));
--> statement-breakpoint
CREATE POLICY signing_events_select_retrieval ON "signing_events" FOR SELECT TO st_app
  USING (st_retrieval_request_ok(request_id));
--> statement-breakpoint
CREATE POLICY signing_events_insert_retrieval ON "signing_events" FOR INSERT TO st_app
  WITH CHECK (actor_user_id IS NULL AND st_retrieval_request_ok(request_id)
    AND workspace_id = st_request_workspace(request_id));
