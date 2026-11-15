-- Document claims: a recipient with an account keeps one completed document in it.
-- The app role can read its own claims but never writes the table directly: st_claim_request()
-- checks the account's verified email against the recipient before inserting. Claimant access to
-- the request is only active in the dedicated claimant context (app.claimant = 'on', set by
-- withClaimant), so claimed requests never show up in a member's workspace queries.
GRANT SELECT ON "document_claims" TO st_app;
--> statement-breakpoint
ALTER TABLE "document_claims" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "document_claims" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY document_claims_select ON "document_claims" FOR SELECT TO st_app
  USING (user_id = st_current_user());
--> statement-breakpoint

CREATE OR REPLACE FUNCTION st_claimed_request_ok(req uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT current_setting('app.claimant', true) = 'on' AND EXISTS (
    SELECT 1 FROM document_claims c JOIN signing_requests r ON r.id = c.request_id
    WHERE c.request_id = req AND c.user_id = st_current_user() AND r.status = 'completed')
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_claimed_file_ok(f uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM signing_requests r JOIN documents d ON d.id = r.document_id
    WHERE (r.signed_file_id = f OR r.certificate_file_id = f)
      AND r.status = 'completed' AND d.purged_at IS NULL
      AND coalesce((r.settings ->> 'allowDownload')::boolean, true)
      AND st_claimed_request_ok(r.id))
$$;
--> statement-breakpoint
-- Participants of a claimed request: names, roles and progress only (no emails, IPs or links).
CREATE OR REPLACE FUNCTION st_claimed_signers(req uuid)
RETURNS TABLE (recipient_id uuid, name text, role text, status text, signing_order integer, signed_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT rr.id, rr.name, rr.role::text, rr.status::text, rr.signing_order, rr.signed_at
  FROM request_recipients rr
  WHERE rr.request_id = req AND st_claimed_request_ok(req)
  ORDER BY rr.signing_order, rr.created_at
$$;
--> statement-breakpoint
-- What the signed-in user may see about a claim before confirming it: the title only when the
-- account's verified email is a recipient of that request.
CREATE OR REPLACE FUNCTION st_claim_preview(req uuid, rcpt uuid,
  OUT outcome text, OUT title text, OUT sender_name text, OUT completed_at timestamptz,
  OUT already_claimed boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE u_email text; u_verified boolean; r_email text; r_status text;
BEGIN
  already_claimed := false;
  SELECT u.email, u.email_verified INTO u_email, u_verified FROM "user" u WHERE u.id = st_current_user();
  IF u_email IS NULL THEN outcome := 'unauthenticated'; RETURN; END IF;
  IF NOT u_verified THEN outcome := 'unverified'; RETURN; END IF;
  SELECT rr.email, r.status::text, r.title, r.sender_name, r.completed_at
    INTO r_email, r_status, title, sender_name, completed_at
    FROM request_recipients rr JOIN signing_requests r ON r.id = rr.request_id
    WHERE rr.id = rcpt AND rr.request_id = req;
  IF r_email IS NULL THEN outcome := 'not_found'; title := NULL; sender_name := NULL; completed_at := NULL; RETURN; END IF;
  IF lower(r_email) <> lower(u_email) THEN
    outcome := 'email_mismatch'; title := NULL; sender_name := NULL; completed_at := NULL; RETURN;
  END IF;
  IF r_status <> 'completed' THEN outcome := 'not_completed'; RETURN; END IF;
  already_claimed := EXISTS (SELECT 1 FROM document_claims c WHERE c.user_id = st_current_user() AND c.request_id = req);
  outcome := 'ok';
END $$;
--> statement-breakpoint
-- Adds the claim after the same checks. Idempotent: claiming twice keeps one row.
CREATE OR REPLACE FUNCTION st_claim_request(req uuid, rcpt uuid) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; ws uuid;
BEGIN
  SELECT * INTO p FROM st_claim_preview(req, rcpt);
  IF p.outcome <> 'ok' THEN RETURN p.outcome; END IF;
  IF p.already_claimed THEN RETURN 'exists'; END IF;
  SELECT r.workspace_id INTO ws FROM signing_requests r WHERE r.id = req;
  INSERT INTO document_claims (user_id, request_id, recipient_id, workspace_id)
    VALUES (st_current_user(), req, rcpt, ws)
    ON CONFLICT (user_id, request_id) DO NOTHING;
  RETURN 'ok';
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION st_claimed_request_ok(uuid), st_claimed_file_ok(uuid), st_claimed_signers(uuid),
  st_claim_preview(uuid, uuid), st_claim_request(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION st_claimed_request_ok(uuid), st_claimed_file_ok(uuid), st_claimed_signers(uuid),
  st_claim_preview(uuid, uuid), st_claim_request(uuid, uuid) TO st_app;
--> statement-breakpoint

CREATE POLICY signing_requests_select_claimant ON "signing_requests" FOR SELECT TO st_app
  USING (st_claimed_request_ok(id));
--> statement-breakpoint
CREATE POLICY document_files_select_claimant ON "document_files" FOR SELECT TO st_app
  USING (st_claimed_file_ok(id));
--> statement-breakpoint
CREATE POLICY signing_events_select_claimant ON "signing_events" FOR SELECT TO st_app
  USING (st_claimed_request_ok(request_id));
--> statement-breakpoint
-- Downloads and views by a claimant are recorded in the request's evidence chain.
CREATE POLICY signing_events_insert_claimant ON "signing_events" FOR INSERT TO st_app
  WITH CHECK (actor_user_id = st_current_user() AND recipient_id IS NOT NULL
    AND st_claimed_request_ok(request_id) AND workspace_id = st_request_workspace(request_id));
