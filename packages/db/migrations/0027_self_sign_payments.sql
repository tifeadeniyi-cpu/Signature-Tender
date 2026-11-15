-- "Sign it yourself": the person who sent a self-signing request may pay its flat fee, even
-- without billing access. Only for their own pending self_sign payment (no credits) on their
-- own request; every other payment still needs billing.manage.
CREATE OR REPLACE FUNCTION st_is_own_self_sign(rid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM signing_requests r
    WHERE r.id = rid AND r.sent_by = st_current_user()
      AND (SELECT count(*) FROM request_recipients x WHERE x.request_id = r.id) = 1
      AND EXISTS (
        SELECT 1 FROM request_recipients x
        WHERE x.request_id = r.id AND x.role = 'signer'
          AND lower(x.email) = lower(r.sender_email)
      )
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION st_is_own_self_sign(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION st_is_own_self_sign(uuid) TO st_app;
--> statement-breakpoint
CREATE POLICY payments_select_self_sign ON "payments" FOR SELECT TO st_app
  USING (price_code = 'self_sign' AND created_by = st_current_user());
--> statement-breakpoint
CREATE POLICY payments_insert_self_sign ON "payments" FOR INSERT TO st_app
  WITH CHECK (status = 'pending' AND created_by = st_current_user() AND kind = 'request'
    AND price_code = 'self_sign' AND credits = 0 AND request_id IS NOT NULL
    AND workspace_id = st_request_workspace(request_id) AND st_is_own_self_sign(request_id));
--> statement-breakpoint
CREATE POLICY payments_update_self_sign ON "payments" FOR UPDATE TO st_app
  USING (status = 'pending' AND created_by = st_current_user() AND price_code = 'self_sign')
  WITH CHECK (status IN ('pending', 'failed') AND created_by = st_current_user()
    AND price_code = 'self_sign' AND credits = 0);
