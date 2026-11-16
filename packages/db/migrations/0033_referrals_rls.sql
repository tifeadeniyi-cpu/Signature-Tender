-- Row-level security for the referral program. All writes happen in the billing system context
-- (app.system_actor = 'billing'), the same context that grants every other credit: the app's
-- core code checks the actor first, then records referrals and ledger entries there. A signed-in
-- person may read their own referral links directly; everything else (their referral history,
-- masked) is read through @st/core with explicit filters. Staff use st_admin_require first.
GRANT SELECT, INSERT, UPDATE ON "referral_programs", "referral_identities", "referral_attributions", "referral_rewards", "referral_visits" TO st_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "referral_events" TO st_app;
--> statement-breakpoint

ALTER TABLE "referral_programs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "referral_programs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Program terms are not secret (they appear on the public invite page).
CREATE POLICY referral_programs_select ON "referral_programs" FOR SELECT TO st_app USING (true);
--> statement-breakpoint
CREATE POLICY referral_programs_write ON "referral_programs" FOR UPDATE TO st_app
  USING (st_is_billing_system()) WITH CHECK (st_is_billing_system());
--> statement-breakpoint
CREATE POLICY referral_programs_insert ON "referral_programs" FOR INSERT TO st_app
  WITH CHECK (st_is_billing_system());
--> statement-breakpoint

ALTER TABLE "referral_identities" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "referral_identities" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY referral_identities_select ON "referral_identities" FOR SELECT TO st_app
  USING (st_is_billing_system() OR owner_user_id = st_current_user());
--> statement-breakpoint
CREATE POLICY referral_identities_insert ON "referral_identities" FOR INSERT TO st_app
  WITH CHECK (st_is_billing_system());
--> statement-breakpoint
CREATE POLICY referral_identities_update ON "referral_identities" FOR UPDATE TO st_app
  USING (st_is_billing_system()) WITH CHECK (st_is_billing_system());
--> statement-breakpoint

ALTER TABLE "referral_attributions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "referral_attributions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY referral_attributions_system ON "referral_attributions" FOR ALL TO st_app
  USING (st_is_billing_system()) WITH CHECK (st_is_billing_system());
--> statement-breakpoint

ALTER TABLE "referral_rewards" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "referral_rewards" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY referral_rewards_system ON "referral_rewards" FOR ALL TO st_app
  USING (st_is_billing_system()) WITH CHECK (st_is_billing_system());
--> statement-breakpoint

ALTER TABLE "referral_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "referral_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY referral_events_select ON "referral_events" FOR SELECT TO st_app
  USING (st_is_billing_system());
--> statement-breakpoint
CREATE POLICY referral_events_insert ON "referral_events" FOR INSERT TO st_app
  WITH CHECK (st_is_billing_system());
--> statement-breakpoint

ALTER TABLE "referral_visits" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "referral_visits" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY referral_visits_system ON "referral_visits" FOR ALL TO st_app
  USING (st_is_billing_system()) WITH CHECK (st_is_billing_system());
--> statement-breakpoint

-- Referral events and rewards are history: nobody edits or deletes an event, and a reward row
-- only ever moves from issued to reversed.
CREATE OR REPLACE FUNCTION st_referral_reward_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.attribution_id IS DISTINCT FROM OLD.attribution_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.credits IS DISTINCT FROM OLD.credits
     OR NEW.ledger_entry_id IS DISTINCT FROM OLD.ledger_entry_id
     OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
     OR (OLD.status = 'reversed' AND NEW.status <> 'reversed') THEN
    RAISE EXCEPTION 'A referral reward can only be reversed, never changed.';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER referral_rewards_guard BEFORE UPDATE ON "referral_rewards"
  FOR EACH ROW EXECUTE FUNCTION st_referral_reward_guard();
--> statement-breakpoint

-- The workspace a referred person's welcome credit goes to: the first one they created. Only the
-- billing system context may ask (workspaces are otherwise visible to their members only).
CREATE OR REPLACE FUNCTION st_referral_first_workspace(uid text) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT st_is_billing_system() THEN
    RAISE EXCEPTION 'st_referral_first_workspace is for the billing system' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT w.id FROM workspaces w WHERE w.created_by = uid ORDER BY w.created_at, w.id LIMIT 1);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION st_referral_first_workspace(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION st_referral_first_workspace(text) TO st_app;
--> statement-breakpoint
-- Staff pages check and log access with st_admin_require (it refuses anyone who is not platform
-- staff). Referral administration and the Signature Studio report call it directly.
GRANT EXECUTE ON FUNCTION st_admin_require(text) TO st_app;
