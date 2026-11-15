-- Certificate of Completion: a human-readable certificate number, a public (non-secret)
-- verification reference, when the current certificate was issued, and the SHA-256 of the
-- combined package (signed agreement + certificate), which is rebuilt byte-for-byte on download.
ALTER TABLE "signing_requests" ADD COLUMN "certificate_number" text;
--> statement-breakpoint
ALTER TABLE "signing_requests" ADD COLUMN "verification_ref" text;
--> statement-breakpoint
ALTER TABLE "signing_requests" ADD COLUMN "certificate_issued_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "signing_requests" ADD COLUMN "package_sha256" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "signing_requests_certificate_number_uq" ON "signing_requests" ("certificate_number") WHERE "certificate_number" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "signing_requests_verification_ref_uq" ON "signing_requests" ("verification_ref") WHERE "verification_ref" IS NOT NULL;
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS "certificate_number_seq" START 1;
--> statement-breakpoint
-- CERT-<year>-<6 digits>. The app role cannot touch the sequence directly.
CREATE OR REPLACE FUNCTION st_next_certificate_number(at timestamptz) RETURNS text
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  SELECT 'CERT-' || to_char(at AT TIME ZONE 'UTC', 'YYYY') || '-' || lpad(nextval('certificate_number_seq')::text, 6, '0')
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION st_next_certificate_number(timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION st_next_certificate_number(timestamptz) TO st_app;
--> statement-breakpoint
-- Public verification: only what a stranger holding the reference may learn. No title, names,
-- emails, IP addresses or authentication details.
CREATE OR REPLACE FUNCTION st_verify_reference(ref text)
RETURNS TABLE (verification_ref text, status text, certificate_number text, certificate_issued_at timestamptz,
  completed_at timestamptz, agreement_pages integer, certificate_pages integer, signer_count integer,
  is_test boolean, files_available boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.verification_ref, r.status::text, r.certificate_number, r.certificate_issued_at, r.completed_at,
    sf.page_count, cf.page_count,
    (SELECT count(*)::int FROM request_recipients rr WHERE rr.request_id = r.id AND rr.role::text IN ('signer','approver','reviewer')),
    r.is_test, d.purged_at IS NULL
  FROM signing_requests r
  JOIN documents d ON d.id = r.document_id
  LEFT JOIN document_files sf ON sf.id = r.signed_file_id
  LEFT JOIN document_files cf ON cf.id = r.certificate_file_id
  WHERE r.verification_ref = upper(trim(ref))
$$;
--> statement-breakpoint
-- Which stored artifact of this request, if any, has exactly this SHA-256. Compares on the server
-- so stored hashes are never listed publicly.
CREATE OR REPLACE FUNCTION st_verify_hash(ref text, sha text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN r.package_sha256 = lower(sha) THEN 'package'
    WHEN sf.sha256 = lower(sha) THEN 'signed'
    WHEN cf.sha256 = lower(sha) THEN 'certificate'
    WHEN r.source_sha256 = lower(sha) THEN 'original'
    ELSE 'none' END
  FROM signing_requests r
  LEFT JOIN document_files sf ON sf.id = r.signed_file_id
  LEFT JOIN document_files cf ON cf.id = r.certificate_file_id
  WHERE r.verification_ref = upper(trim(ref)) AND r.status = 'completed'
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION st_verify_reference(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION st_verify_hash(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION st_verify_reference(text) TO st_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION st_verify_hash(text, text) TO st_app;
--> statement-breakpoint
-- Certificate re-issue (app.system_actor = 'certificates'): a staff-started job that gives
-- completed requests still holding an old-design certificate a new one. It may read the evidence
-- of completed requests, add one certificate file, point the request at it, and append one
-- 'request.certificate_reissued' event. It cannot change signed agreements, recipients or fields.
CREATE OR REPLACE FUNCTION st_certificate_system() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.system_actor', true), '') = 'certificates'
$$;
--> statement-breakpoint
CREATE POLICY signing_requests_select_certsys ON "signing_requests" FOR SELECT TO st_app
  USING (st_certificate_system() AND status = 'completed');
--> statement-breakpoint
CREATE POLICY signing_requests_update_certsys ON "signing_requests" FOR UPDATE TO st_app
  USING (st_certificate_system() AND status = 'completed' AND certificate_number IS NULL)
  WITH CHECK (st_certificate_system() AND status = 'completed');
--> statement-breakpoint
CREATE POLICY documents_select_certsys ON "documents" FOR SELECT TO st_app
  USING (st_certificate_system());
--> statement-breakpoint
CREATE POLICY document_files_select_certsys ON "document_files" FOR SELECT TO st_app
  USING (st_certificate_system());
--> statement-breakpoint
CREATE POLICY document_files_insert_certsys ON "document_files" FOR INSERT TO st_app
  WITH CHECK (st_certificate_system() AND kind = 'certificate');
--> statement-breakpoint
CREATE POLICY request_recipients_select_certsys ON "request_recipients" FOR SELECT TO st_app
  USING (st_certificate_system());
--> statement-breakpoint
CREATE POLICY request_fields_select_certsys ON "request_fields" FOR SELECT TO st_app
  USING (st_certificate_system());
--> statement-breakpoint
CREATE POLICY signatures_select_certsys ON "signatures" FOR SELECT TO st_app
  USING (st_certificate_system());
--> statement-breakpoint
CREATE POLICY signing_events_select_certsys ON "signing_events" FOR SELECT TO st_app
  USING (st_certificate_system());
--> statement-breakpoint
CREATE POLICY signing_events_insert_certsys ON "signing_events" FOR INSERT TO st_app
  WITH CHECK (st_certificate_system() AND type = 'request.certificate_reissued');
