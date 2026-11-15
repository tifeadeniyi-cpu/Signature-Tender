-- Row-level security for Signature Studio. Two kinds of actor reach these tables:
--  * a designer: a signed-in user (app.user_id) and/or a guest browser session (app.studio_guest,
--    the SHA-256 of a random httpOnly cookie). A draft belongs to its user, or until sign-in to
--    the guest session that created it. Purchases and entitlements always belong to a user.
--  * the Stripe webhook (app.system_actor = 'billing') and the Studio fulfilment/admin service
--    (app.system_actor = 'studio'). Only these record payments, grant entitlements and write files.
-- Purchased designs are immutable: a trigger refuses any change to their artwork.
GRANT SELECT, INSERT, UPDATE, DELETE ON "signature_designs" TO st_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "signature_uploads", "signature_purchases", "signature_entitlements", "signature_assets", "signature_studio_rate_limits" TO st_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "signature_downloads", "signature_studio_events" TO st_app;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION st_studio_guest() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.studio_guest', true), '') $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_studio_system() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.system_actor', true), '') IN ('billing', 'studio')
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_studio_owns(owner text, guest text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT (owner IS NOT NULL AND owner = st_current_user())
      OR (owner IS NULL AND guest IS NOT NULL AND guest = st_studio_guest())
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_studio_can_see_entitlement(ent uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM signature_entitlements e
    WHERE e.id = ent
      AND e.owner_user_id = st_current_user())
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_studio_can_see_purchase(pid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM signature_purchases p
    WHERE p.id = pid
      AND p.owner_user_id = st_current_user())
$$;
-- Moves a guest session's drafts to the signed-in, verified user. Runs only for the current user
-- and only for rows that belong to the given guest session and nobody else.
CREATE OR REPLACE FUNCTION st_studio_claim(guest text) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid text := st_current_user();
  n integer;
BEGIN
  IF uid IS NULL OR guest IS NULL OR guest <> st_studio_guest() THEN
    RAISE EXCEPTION 'studio claim requires a signed-in user and the matching guest session';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "user" u WHERE u.id = uid AND u.email_verified) THEN
    RAISE EXCEPTION 'studio claim requires a verified email';
  END IF;
  UPDATE signature_designs SET owner_user_id = uid, updated_at = now()
    WHERE owner_user_id IS NULL AND creator_session_hash = guest;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION st_studio_guest(), st_studio_system(), st_studio_owns(text, text), st_studio_can_see_entitlement(uuid), st_studio_can_see_purchase(uuid), st_studio_claim(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION st_studio_guest(), st_studio_system(), st_studio_owns(text, text), st_studio_can_see_entitlement(uuid), st_studio_can_see_purchase(uuid), st_studio_claim(text) TO st_app;
--> statement-breakpoint

-- Purchased artwork never changes, and only the payment system can mark a design purchased.
CREATE OR REPLACE FUNCTION st_signature_design_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'purchased' AND (
       NEW.design IS DISTINCT FROM OLD.design
    OR NEW.canonical_design_hash IS DISTINCT FROM OLD.canonical_design_hash
    OR NEW.status = 'draft') THEN
    RAISE EXCEPTION 'A purchased signature design cannot be changed. Duplicate it to make a new design.';
  END IF;
  IF NEW.status = 'purchased' AND OLD.status <> 'purchased' AND NOT st_studio_system() THEN
    RAISE EXCEPTION 'Only a verified payment can finalize a signature design.';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER signature_designs_guard BEFORE UPDATE ON "signature_designs"
  FOR EACH ROW EXECUTE FUNCTION st_signature_design_guard();
--> statement-breakpoint

ALTER TABLE "signature_designs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "signature_designs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY signature_designs_select ON "signature_designs" FOR SELECT TO st_app
  USING (st_studio_system() OR st_studio_owns(owner_user_id, creator_session_hash));
--> statement-breakpoint
CREATE POLICY signature_designs_insert ON "signature_designs" FOR INSERT TO st_app
  WITH CHECK (status = 'draft' AND st_studio_owns(owner_user_id, creator_session_hash));
--> statement-breakpoint
CREATE POLICY signature_designs_update ON "signature_designs" FOR UPDATE TO st_app
  USING (st_studio_system() OR st_studio_owns(owner_user_id, creator_session_hash))
  WITH CHECK (st_studio_system() OR st_studio_owns(owner_user_id, creator_session_hash));
--> statement-breakpoint
CREATE POLICY signature_designs_delete ON "signature_designs" FOR DELETE TO st_app
  USING (status = 'draft' AND st_studio_owns(owner_user_id, creator_session_hash));
--> statement-breakpoint

ALTER TABLE "signature_uploads" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "signature_uploads" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY signature_uploads_system ON "signature_uploads" FOR ALL TO st_app
  USING (st_studio_system()) WITH CHECK (st_studio_system());
--> statement-breakpoint

ALTER TABLE "signature_purchases" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "signature_purchases" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY signature_purchases_select ON "signature_purchases" FOR SELECT TO st_app
  USING (st_studio_system() OR owner_user_id = st_current_user());
--> statement-breakpoint
CREATE POLICY signature_purchases_insert ON "signature_purchases" FOR INSERT TO st_app
  WITH CHECK (payment_status = 'pending' AND owner_user_id = st_current_user());
--> statement-breakpoint
CREATE POLICY signature_purchases_update ON "signature_purchases" FOR UPDATE TO st_app
  USING (st_studio_system()
         OR (payment_status = 'pending' AND owner_user_id = st_current_user()))
  WITH CHECK (st_studio_system()
         OR (payment_status IN ('pending', 'failed') AND owner_user_id = st_current_user()));
--> statement-breakpoint

ALTER TABLE "signature_entitlements" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "signature_entitlements" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY signature_entitlements_select ON "signature_entitlements" FOR SELECT TO st_app
  USING (st_studio_system() OR owner_user_id = st_current_user());
--> statement-breakpoint
CREATE POLICY signature_entitlements_write ON "signature_entitlements" FOR INSERT TO st_app
  WITH CHECK (st_studio_system());
--> statement-breakpoint
CREATE POLICY signature_entitlements_update ON "signature_entitlements" FOR UPDATE TO st_app
  USING (st_studio_system()) WITH CHECK (st_studio_system());
--> statement-breakpoint

ALTER TABLE "signature_assets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "signature_assets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY signature_assets_select ON "signature_assets" FOR SELECT TO st_app
  USING (st_studio_system() OR st_studio_can_see_purchase(purchase_id));
--> statement-breakpoint
CREATE POLICY signature_assets_insert ON "signature_assets" FOR INSERT TO st_app
  WITH CHECK (st_studio_system());
--> statement-breakpoint
CREATE POLICY signature_assets_update ON "signature_assets" FOR UPDATE TO st_app
  USING (st_studio_system()) WITH CHECK (st_studio_system());
--> statement-breakpoint

ALTER TABLE "signature_downloads" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "signature_downloads" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY signature_downloads_select ON "signature_downloads" FOR SELECT TO st_app
  USING (st_studio_system());
--> statement-breakpoint
CREATE POLICY signature_downloads_insert ON "signature_downloads" FOR INSERT TO st_app
  WITH CHECK (st_studio_system() OR st_studio_can_see_entitlement(entitlement_id));
--> statement-breakpoint

ALTER TABLE "signature_studio_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "signature_studio_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY signature_studio_events_insert ON "signature_studio_events" FOR INSERT TO st_app
  WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY signature_studio_events_select ON "signature_studio_events" FOR SELECT TO st_app
  USING (st_studio_system());
--> statement-breakpoint

ALTER TABLE "signature_studio_rate_limits" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "signature_studio_rate_limits" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY signature_studio_rate_limits_system ON "signature_studio_rate_limits" FOR ALL TO st_app
  USING (st_studio_system()) WITH CHECK (st_studio_system());
--> statement-breakpoint

-- Staff save the Studio settings through this function: it checks platform staff, stores the
-- settings in app_config (which the app role can only read) and writes an audit event.
CREATE OR REPLACE FUNCTION st_studio_save_settings(p_settings jsonb) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT st_is_platform_admin() THEN
    RAISE EXCEPTION 'not a platform admin' USING ERRCODE = '42501';
  END IF;
  INSERT INTO app_config (key, value, description, updated_at)
  VALUES ('signature_studio.settings', p_settings, 'Signature Studio settings (admin)', now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  INSERT INTO audit_events (workspace_id, actor_user_id, action, target_type, target_id, metadata)
  VALUES (NULL, st_current_user(), 'studio.settings_updated', 'app_config', 'signature_studio.settings', p_settings);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION st_studio_save_settings(jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION st_studio_save_settings(jsonb) TO st_app;
--> statement-breakpoint

-- Studio purchase events (completed, refunded, disputed) are recorded by the billing and studio
-- system actors, which have no signed-in user. They may only write account-level studio events.
CREATE POLICY audit_insert_studio_system ON "audit_events" FOR INSERT TO st_app
  WITH CHECK (workspace_id IS NULL AND action LIKE 'studio.%' AND st_studio_system());
--> statement-breakpoint

-- Staff report: how many Studio buyers went on to send a document or pay for a request.
-- Counts only; no names, emails or documents leave this function.
CREATE OR REPLACE FUNCTION st_studio_conversion() RETURNS TABLE (buyers int, buyers_sent int, buyers_paid_request int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT st_is_platform_admin() THEN
    RAISE EXCEPTION 'not a platform admin' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH b AS (
    SELECT owner_user_id AS u, min(purchased_at) AS first_buy FROM signature_purchases
    WHERE payment_status = 'paid' GROUP BY owner_user_id
  )
  SELECT
    (SELECT count(*)::int FROM b),
    (SELECT count(*)::int FROM b WHERE EXISTS (
       SELECT 1 FROM signing_requests r WHERE r.sent_by = b.u AND r.created_at > b.first_buy)),
    (SELECT count(*)::int FROM b WHERE EXISTS (
       SELECT 1 FROM payments p WHERE p.created_by = b.u AND p.status = 'paid' AND p.kind = 'request' AND p.created_at > b.first_buy));
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION st_studio_conversion() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION st_studio_conversion() TO st_app;
