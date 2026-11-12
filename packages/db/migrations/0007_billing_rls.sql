-- Row-level security for billing. Two kinds of actor reach these tables:
--  * workspace members (app.user_id): billing managers read everything; senders read balances and
--    may reserve or restore a credit for a request they can send. Nobody signed in can grant credits.
--  * the Stripe webhook (app.system_actor = 'billing'), which records payments and grants credits only
--    after verifying Stripe's signature. Only the webhook module sets this.
-- The ledger is append-only: the app role has no UPDATE or DELETE on it.
GRANT SELECT, INSERT, UPDATE ON "billing_accounts", "payments", "credit_holds", "invoices", "stripe_events" TO st_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "credit_ledger" TO st_app;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE "credit_ledger_seq_seq" TO st_app;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION st_is_billing_system() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.system_actor', true), '') = 'billing'
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_can_view_balance(ws uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT st_has_permission(ws, 'billing.manage') OR st_has_permission(ws, 'documents.send')
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION st_is_billing_system(), st_can_view_balance(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION st_is_billing_system(), st_can_view_balance(uuid) TO st_app;
--> statement-breakpoint

ALTER TABLE "billing_accounts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "billing_accounts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY billing_accounts_select ON "billing_accounts" FOR SELECT TO st_app
  USING (st_is_billing_system() OR st_can_view_balance(workspace_id));
--> statement-breakpoint
CREATE POLICY billing_accounts_insert ON "billing_accounts" FOR INSERT TO st_app
  WITH CHECK (st_is_billing_system());
--> statement-breakpoint
CREATE POLICY billing_accounts_update ON "billing_accounts" FOR UPDATE TO st_app
  USING (st_is_billing_system()) WITH CHECK (st_is_billing_system());
--> statement-breakpoint

ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY payments_select ON "payments" FOR SELECT TO st_app
  USING (st_is_billing_system() OR st_has_permission(workspace_id, 'billing.manage'));
--> statement-breakpoint
-- A billing manager starts a checkout: the row is born pending, with their own id.
CREATE POLICY payments_insert_member ON "payments" FOR INSERT TO st_app
  WITH CHECK (status = 'pending' AND created_by = st_current_user()
    AND st_has_permission(workspace_id, 'billing.manage')
    AND (request_id IS NULL OR (st_can_view_request(request_id) AND workspace_id = st_request_workspace(request_id))));
--> statement-breakpoint
-- ...and may attach the Stripe session to it, or mark it failed, while it is still pending.
CREATE POLICY payments_update_member ON "payments" FOR UPDATE TO st_app
  USING (status = 'pending' AND created_by = st_current_user() AND st_has_permission(workspace_id, 'billing.manage'))
  WITH CHECK (status IN ('pending', 'failed') AND created_by = st_current_user());
--> statement-breakpoint
CREATE POLICY payments_system ON "payments" FOR ALL TO st_app
  USING (st_is_billing_system()) WITH CHECK (st_is_billing_system());
--> statement-breakpoint

ALTER TABLE "credit_ledger" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "credit_ledger" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY credit_ledger_select ON "credit_ledger" FOR SELECT TO st_app
  USING (st_is_billing_system() OR st_can_view_balance(workspace_id));
--> statement-breakpoint
CREATE POLICY credit_ledger_insert_system ON "credit_ledger" FOR INSERT TO st_app
  WITH CHECK (st_is_billing_system());
--> statement-breakpoint
-- Members can only move one credit in or out of a hold for a request they are allowed to send.
CREATE POLICY credit_ledger_insert_member ON "credit_ledger" FOR INSERT TO st_app
  WITH CHECK (
    ((entry_type = 'reserve' AND delta = -1) OR (entry_type = 'restore' AND delta = 1))
    AND request_id IS NOT NULL AND payment_id IS NULL
    AND created_by = st_current_user()
    AND st_can_send_request(request_id)
    AND workspace_id = st_request_workspace(request_id));
--> statement-breakpoint

ALTER TABLE "credit_holds" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "credit_holds" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY credit_holds_select ON "credit_holds" FOR SELECT TO st_app
  USING (st_is_billing_system() OR st_can_view_balance(workspace_id));
--> statement-breakpoint
CREATE POLICY credit_holds_insert ON "credit_holds" FOR INSERT TO st_app
  WITH CHECK (status = 'reserved' AND st_can_send_request(request_id)
    AND workspace_id = st_request_workspace(request_id));
--> statement-breakpoint
CREATE POLICY credit_holds_update ON "credit_holds" FOR UPDATE TO st_app
  USING (st_can_send_request(request_id))
  WITH CHECK (st_can_send_request(request_id) AND workspace_id = st_request_workspace(request_id));
--> statement-breakpoint

ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invoices" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY invoices_select ON "invoices" FOR SELECT TO st_app
  USING (st_is_billing_system() OR st_has_permission(workspace_id, 'billing.manage'));
--> statement-breakpoint
CREATE POLICY invoices_system ON "invoices" FOR ALL TO st_app
  USING (st_is_billing_system()) WITH CHECK (st_is_billing_system());
--> statement-breakpoint

ALTER TABLE "stripe_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "stripe_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY stripe_events_system ON "stripe_events" FOR ALL TO st_app
  USING (st_is_billing_system()) WITH CHECK (st_is_billing_system());
