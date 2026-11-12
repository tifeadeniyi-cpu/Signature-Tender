-- Row-level security for signing requests. Two kinds of actor reach these tables:
--  * workspace members (app.user_id), governed by document permissions;
--  * recipients holding a link token (app.signer_token_hash), limited to their own request.
GRANT SELECT, INSERT, UPDATE ON "signing_requests", "request_recipients", "request_fields" TO st_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "signatures", "signing_events" TO st_app;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE "signing_events_seq_seq" TO st_app;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION st_current_signer() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT rr.id FROM request_recipients rr
  WHERE rr.token_hash = nullif(current_setting('app.signer_token_hash', true), '')
    AND (rr.token_expires_at IS NULL OR rr.token_expires_at > now())
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_signer_request() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT rr.request_id FROM request_recipients rr WHERE rr.id = st_current_signer()
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_signer_document() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.document_id FROM signing_requests r WHERE r.id = st_signer_request()
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_signer_sender() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.sent_by FROM signing_requests r WHERE r.id = st_signer_request()
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_can_send_document(doc uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT st_can_view_document(doc) AND EXISTS (
    SELECT 1 FROM documents d WHERE d.id = doc AND st_has_permission(d.workspace_id, 'documents.send')
  )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_can_view_request(req uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM signing_requests r WHERE r.id = req AND st_can_view_document(r.document_id))
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_can_send_request(req uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM signing_requests r WHERE r.id = req AND st_can_send_document(r.document_id))
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_request_workspace(req uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.workspace_id FROM signing_requests r WHERE r.id = req
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION st_current_signer(), st_signer_request(), st_signer_document(), st_signer_sender(),
  st_can_send_document(uuid), st_can_view_request(uuid), st_can_send_request(uuid), st_request_workspace(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION st_current_signer(), st_signer_request(), st_signer_document(), st_signer_sender(),
  st_can_send_document(uuid), st_can_view_request(uuid), st_can_send_request(uuid), st_request_workspace(uuid) TO st_app;
--> statement-breakpoint

-- Signers can read the document they were sent, and the source file, but nothing else.
CREATE POLICY documents_select_signer ON "documents" FOR SELECT TO st_app USING (id = st_signer_document());
--> statement-breakpoint
CREATE POLICY document_files_select_signer ON "document_files" FOR SELECT TO st_app USING (document_id = st_signer_document());
--> statement-breakpoint
-- Finalization runs in the last signer's context and may add only the signed copy and certificate.
CREATE POLICY document_files_insert_signer ON "document_files" FOR INSERT TO st_app
  WITH CHECK (document_id = st_signer_document() AND kind IN ('signed', 'certificate')
    AND created_by = st_signer_sender()
    AND workspace_id = (SELECT d.workspace_id FROM documents d WHERE d.id = document_id));
--> statement-breakpoint
CREATE POLICY document_files_insert_final ON "document_files" FOR INSERT TO st_app
  WITH CHECK (kind IN ('signed', 'certificate') AND st_can_send_document(document_id)
    AND workspace_id = (SELECT d.workspace_id FROM documents d WHERE d.id = document_id));
--> statement-breakpoint

ALTER TABLE "signing_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "signing_requests" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY signing_requests_select ON "signing_requests" FOR SELECT TO st_app
  USING (st_can_view_document(document_id) OR id = st_signer_request());
--> statement-breakpoint
CREATE POLICY signing_requests_insert ON "signing_requests" FOR INSERT TO st_app
  WITH CHECK (sent_by = st_current_user() AND st_can_send_document(document_id)
    AND workspace_id = (SELECT d.workspace_id FROM documents d WHERE d.id = document_id));
--> statement-breakpoint
CREATE POLICY signing_requests_update ON "signing_requests" FOR UPDATE TO st_app
  USING (st_can_send_document(document_id) OR id = st_signer_request())
  WITH CHECK (st_can_send_document(document_id) OR id = st_signer_request());
--> statement-breakpoint

ALTER TABLE "request_recipients" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "request_recipients" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY request_recipients_select ON "request_recipients" FOR SELECT TO st_app
  USING (st_can_view_request(request_id) OR request_id = st_signer_request());
--> statement-breakpoint
CREATE POLICY request_recipients_insert ON "request_recipients" FOR INSERT TO st_app
  WITH CHECK (st_can_send_request(request_id) AND workspace_id = st_request_workspace(request_id));
--> statement-breakpoint
-- A signer may advance their own request (e.g. notify the next person in order).
CREATE POLICY request_recipients_update ON "request_recipients" FOR UPDATE TO st_app
  USING (st_can_send_request(request_id) OR request_id = st_signer_request())
  WITH CHECK (st_can_send_request(request_id) OR request_id = st_signer_request());
--> statement-breakpoint

ALTER TABLE "request_fields" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "request_fields" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY request_fields_select ON "request_fields" FOR SELECT TO st_app
  USING (st_can_view_request(request_id) OR request_id = st_signer_request());
--> statement-breakpoint
CREATE POLICY request_fields_insert ON "request_fields" FOR INSERT TO st_app
  WITH CHECK (st_can_send_request(request_id) AND workspace_id = st_request_workspace(request_id));
--> statement-breakpoint
-- Only the assigned signer can fill a field.
CREATE POLICY request_fields_update ON "request_fields" FOR UPDATE TO st_app
  USING (recipient_id = st_current_signer()) WITH CHECK (recipient_id = st_current_signer());
--> statement-breakpoint

ALTER TABLE "signatures" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "signatures" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY signatures_select ON "signatures" FOR SELECT TO st_app
  USING (st_can_view_request(request_id) OR request_id = st_signer_request());
--> statement-breakpoint
CREATE POLICY signatures_insert ON "signatures" FOR INSERT TO st_app
  WITH CHECK (recipient_id = st_current_signer() AND request_id = st_signer_request()
    AND workspace_id = st_request_workspace(request_id));
--> statement-breakpoint

ALTER TABLE "signing_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "signing_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY signing_events_select ON "signing_events" FOR SELECT TO st_app
  USING (st_can_view_request(request_id) OR request_id = st_signer_request());
--> statement-breakpoint
CREATE POLICY signing_events_insert ON "signing_events" FOR INSERT TO st_app
  WITH CHECK (workspace_id = st_request_workspace(request_id) AND (
    (actor_user_id = st_current_user() AND st_can_view_request(request_id))
    OR (actor_user_id IS NULL AND request_id = st_signer_request())
  ));
