-- Row-level security and the application role.
-- The app connects as `st_app` (no superuser, no BYPASSRLS). Migrations run as the table owner.
-- In hosted environments create st_app with a password out of band (Neon console) before deploy;
-- this migration only creates it NOLOGIN if missing so grants succeed.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'st_app') THEN
    CREATE ROLE st_app NOLOGIN;
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO st_app;
--> statement-breakpoint
-- Identity tables: accessed only by the auth service, global by design.
GRANT SELECT, INSERT, UPDATE, DELETE ON "user", "session", "account", "verification", "two_factor", "passkey", "rate_limit" TO st_app;
--> statement-breakpoint
-- Reference/config tables: read-only for the app. Changes go through admin tooling with the owner role.
GRANT SELECT ON "permissions", "roles", "role_permissions", "feature_flags", "app_config", "subscription_plans", "prices" TO st_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "workspaces", "workspace_memberships", "user_profiles" TO st_app;
--> statement-breakpoint
-- Audit log is append-only for the app.
GRANT SELECT, INSERT ON "audit_events" TO st_app;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE "audit_events_seq_seq" TO st_app;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION st_current_user() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '') $$;
--> statement-breakpoint

-- SECURITY DEFINER helpers avoid recursive policy evaluation on workspace_memberships.
CREATE OR REPLACE FUNCTION st_is_member(ws uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_memberships m
    WHERE m.workspace_id = ws AND m.user_id = st_current_user() AND m.status = 'active'
  )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_has_permission(ws uuid, perm text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_memberships m
    JOIN role_permissions rp ON rp.role_id = m.role_id
    WHERE m.workspace_id = ws AND m.user_id = st_current_user() AND m.status = 'active'
      AND rp.permission_key = perm
  )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_workspace_has_members(ws uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM workspace_memberships m WHERE m.workspace_id = ws)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION st_is_member(uuid), st_has_permission(uuid, text), st_workspace_has_members(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION st_current_user(), st_is_member(uuid), st_has_permission(uuid, text), st_workspace_has_members(uuid) TO st_app;
--> statement-breakpoint

ALTER TABLE "workspaces" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workspaces" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workspaces_select ON "workspaces" FOR SELECT TO st_app
  USING (st_is_member(id) OR created_by = st_current_user());
--> statement-breakpoint
CREATE POLICY workspaces_insert ON "workspaces" FOR INSERT TO st_app
  WITH CHECK (created_by = st_current_user());
--> statement-breakpoint
CREATE POLICY workspaces_update ON "workspaces" FOR UPDATE TO st_app
  USING (st_has_permission(id, 'workspace.manage'))
  WITH CHECK (st_has_permission(id, 'workspace.manage'));
--> statement-breakpoint

ALTER TABLE "workspace_memberships" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workspace_memberships" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY memberships_select ON "workspace_memberships" FOR SELECT TO st_app
  USING (user_id = st_current_user() OR st_is_member(workspace_id));
--> statement-breakpoint
-- Insert allowed for team managers, or for the creator's own first (owner) membership.
CREATE POLICY memberships_insert ON "workspace_memberships" FOR INSERT TO st_app
  WITH CHECK (
    st_has_permission(workspace_id, 'team.manage')
    OR (
      user_id = st_current_user()
      AND NOT st_workspace_has_members(workspace_id)
      AND EXISTS (SELECT 1 FROM workspaces w WHERE w.id = workspace_id AND w.created_by = st_current_user())
    )
  );
--> statement-breakpoint
CREATE POLICY memberships_update ON "workspace_memberships" FOR UPDATE TO st_app
  USING (st_has_permission(workspace_id, 'team.manage'))
  WITH CHECK (st_has_permission(workspace_id, 'team.manage'));
--> statement-breakpoint

ALTER TABLE "user_profiles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "user_profiles" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY profiles_own ON "user_profiles" FOR ALL TO st_app
  USING (user_id = st_current_user()) WITH CHECK (user_id = st_current_user());
--> statement-breakpoint

ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audit_select ON "audit_events" FOR SELECT TO st_app
  USING (
    (workspace_id IS NOT NULL AND st_has_permission(workspace_id, 'audit.view'))
    OR actor_user_id = st_current_user()
  );
--> statement-breakpoint
CREATE POLICY audit_insert ON "audit_events" FOR INSERT TO st_app
  WITH CHECK (
    actor_user_id = st_current_user()
    AND (workspace_id IS NULL OR st_is_member(workspace_id))
  );
