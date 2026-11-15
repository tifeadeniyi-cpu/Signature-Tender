-- Founder admin, phase 2: staff roles and permissions, an append-only audit log, and the admin
-- audit trail. Staff still never see document contents, recipients, signatures or signing evidence.

-- Permissions by role. This is the one place the matrix lives: the app reads it through
-- st_admin_permissions() and every admin function checks it through st_admin_require_perm().
CREATE OR REPLACE FUNCTION st_admin_role_permissions(p_role text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_role
    WHEN 'founder' THEN ARRAY['analytics.view','revenue.view','audit.view','security.view',
      'system.view','support.view','access.view','settings.manage','operations.manage']
    WHEN 'finance' THEN ARRAY['analytics.view','revenue.view']
    WHEN 'support' THEN ARRAY['support.view']
    WHEN 'security' THEN ARRAY['analytics.view','audit.view','security.view','system.view','access.view']
    WHEN 'technical' THEN ARRAY['analytics.view','system.view','settings.manage','operations.manage']
    WHEN 'analyst' THEN ARRAY['analytics.view']
    ELSE ARRAY[]::text[]
  END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_admin_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM platform_admins WHERE user_id = st_current_user();
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_admin_permissions() RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(st_admin_role_permissions(st_admin_role()), ARRAY[]::text[]);
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_admin_has(p_perm text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_perm = ANY(st_admin_permissions());
$$;
--> statement-breakpoint
-- Like st_admin_require, but also checks the staff member's role allows this view.
CREATE OR REPLACE FUNCTION st_admin_require_perm(p_perm text, p_view text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT st_is_platform_admin() OR NOT st_admin_has(p_perm) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  INSERT INTO audit_events (workspace_id, actor_user_id, action, target_type, target_id, metadata)
  VALUES (NULL, st_current_user(), 'admin.viewed', 'admin_view', p_view,
          jsonb_build_object('permission', p_perm, 'role', st_admin_role()));
END $$;
--> statement-breakpoint
-- A denied attempt is recorded in its own transaction by the app (a raised error would roll the
-- insert back). Anyone signed in may record their own denial; nothing else can be written here.
CREATE OR REPLACE FUNCTION st_admin_record_denied(p_view text, p_perm text) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO audit_events (workspace_id, actor_user_id, action, target_type, target_id, metadata)
  SELECT NULL, st_current_user(), 'admin.access_denied', 'admin_view', left(p_view, 200),
         jsonb_build_object('permission', left(coalesce(p_perm, ''), 64), 'staff', st_is_platform_admin())
  WHERE st_current_user() IS NOT NULL;
$$;
--> statement-breakpoint

-- The audit log is append-only for everyone, the database owner included: the app role already
-- lacks UPDATE and DELETE, and these triggers refuse them outright.
CREATE OR REPLACE FUNCTION st_audit_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE = '42501';
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_events_no_change BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION st_audit_immutable();
--> statement-breakpoint
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION st_audit_immutable();
--> statement-breakpoint

-- Audit categories and risk, from the action name.
CREATE OR REPLACE FUNCTION st_audit_category(p_action text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_action = 'admin.access_denied' OR p_action LIKE 'security.%' THEN 'security'
    WHEN p_action LIKE 'auth.%' THEN 'authentication'
    WHEN p_action LIKE 'admin.%' THEN 'admin_access'
    WHEN p_action IN ('studio.settings_updated', 'integration.availability_changed')
      OR p_action LIKE 'platform.%' OR p_action LIKE 'pricing.%' OR p_action LIKE 'flag.%'
      THEN 'configuration'
    WHEN p_action LIKE 'certificate.%' OR p_action LIKE 'operations.%' THEN 'operations'
    WHEN p_action LIKE 'billing.%' OR p_action LIKE 'credits.%' OR p_action LIKE 'studio.purchase%'
      THEN 'payments'
    ELSE 'platform'
  END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_audit_risk(p_action text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_action = 'admin.access_denied' OR p_action LIKE 'security.%' THEN 'high'
    WHEN st_audit_category(p_action) IN ('configuration', 'payments', 'operations') THEN 'medium'
    ELSE 'low'
  END
$$;
--> statement-breakpoint

-- The admin audit trail: platform-level events only (workspace_id is null). Customer workspace
-- activity stays with that workspace. Customers appear as an opaque reference, never by name or
-- email, and their event details are withheld. Staff event details have secrets redacted.
CREATE OR REPLACE FUNCTION st_admin_audit_log(
  p_from timestamptz, p_to timestamptz, p_category text, p_q text, p_limit int, p_offset int)
RETURNS TABLE (
  id uuid, seq bigint, occurred_at timestamptz, actor text, actor_role text, category text,
  action text, target_type text, target_ref text, outcome text, risk text, details jsonb,
  total bigint)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM st_admin_require_perm('audit.view', 'audit_log');
  RETURN QUERY
  WITH ev AS (
    SELECT a.*, st_audit_category(a.action) AS cat, pa.role AS staff_role, u.name AS staff_name
    FROM audit_events a
    LEFT JOIN platform_admins pa ON pa.user_id = a.actor_user_id
    LEFT JOIN "user" u ON u.id = a.actor_user_id AND pa.user_id IS NOT NULL
    WHERE a.workspace_id IS NULL
      AND (p_from IS NULL OR a.occurred_at >= p_from)
      AND (p_to IS NULL OR a.occurred_at < p_to)
      AND (coalesce(p_category, '') = '' OR st_audit_category(a.action) = p_category)
      AND (coalesce(p_q, '') = '' OR a.action ILIKE '%' || p_q || '%' OR a.id::text = p_q
           OR a.target_id ILIKE '%' || p_q || '%')
  )
  SELECT ev.id, ev.seq, ev.occurred_at,
    CASE
      WHEN ev.staff_role IS NOT NULL THEN coalesce(ev.staff_name, 'Staff')
      WHEN ev.actor_user_id IS NULL THEN initcap(ev.actor_type)
      ELSE 'User ' || upper(left(md5(ev.actor_user_id), 8))
    END,
    coalesce(ev.staff_role, CASE WHEN ev.actor_user_id IS NULL THEN ev.actor_type ELSE 'customer' END),
    ev.cat, ev.action, ev.target_type,
    CASE WHEN ev.staff_role IS NULL AND ev.target_type IN ('user', 'document', 'request', 'signature')
      THEN upper(left(md5(coalesce(ev.target_id, '')), 8)) ELSE ev.target_id END,
    coalesce(ev.metadata ->> 'outcome', CASE WHEN ev.action = 'admin.access_denied' THEN 'denied' ELSE 'success' END),
    st_audit_risk(ev.action),
    CASE WHEN ev.staff_role IS NULL THEN '{}'::jsonb ELSE (
      SELECT coalesce(jsonb_object_agg(k, CASE
        WHEN k ~* '(secret|token|password|passcode|key|email|phone|card|code)' THEN '"[redacted]"'::jsonb
        ELSE v END), '{}'::jsonb)
      FROM jsonb_each(ev.metadata) AS m(k, v)) END,
    count(*) OVER ()
  FROM ev
  ORDER BY ev.seq DESC
  LIMIT least(greatest(coalesce(p_limit, 50), 1), 200)
  OFFSET greatest(coalesce(p_offset, 0), 0);
END $$;
--> statement-breakpoint

-- Staff and their access, for Admin Access Management. Staff emails are shown; customers' never.
CREATE OR REPLACE FUNCTION st_admin_staff()
RETURNS TABLE (user_id text, name text, email text, role text, note text, granted_at timestamptz,
  strong_sign_in boolean, passkeys bigint, last_sign_in timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM st_admin_require_perm('access.view', 'access');
  RETURN QUERY
  SELECT pa.user_id, u.name, u.email, pa.role, pa.note, pa.granted_at,
    coalesce(u.two_factor_enabled, false) OR EXISTS (SELECT 1 FROM passkey p WHERE p.user_id = pa.user_id),
    (SELECT count(*) FROM passkey p WHERE p.user_id = pa.user_id),
    (SELECT max(s.created_at) FROM session s WHERE s.user_id = pa.user_id)
  FROM platform_admins pa JOIN "user" u ON u.id = pa.user_id
  ORDER BY array_position(ARRAY['founder','security','technical','finance','support','analyst'], pa.role),
    u.name;
END $$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION st_admin_role(), st_admin_permissions(), st_admin_has(text),
  st_admin_require_perm(text, text), st_admin_record_denied(text, text),
  st_admin_audit_log(timestamptz, timestamptz, text, text, int, int), st_admin_staff() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION st_admin_role(), st_admin_permissions(), st_admin_has(text),
  st_admin_require_perm(text, text), st_admin_record_denied(text, text),
  st_admin_audit_log(timestamptz, timestamptz, text, text, int, int), st_admin_staff() TO st_app;
