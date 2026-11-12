-- Phase 6 row-level security: custom roles, team management without privilege escalation,
-- groups, invitations, contacts, templates and branding.

GRANT INSERT, UPDATE, DELETE ON "roles", "role_permissions" TO st_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "workspace_groups", "group_members", "contacts", "template_categories" TO st_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "workspace_invitations", "templates", "template_versions" TO st_app;
--> statement-breakpoint

-- True when the caller holds the owner role in the workspace.
CREATE OR REPLACE FUNCTION st_is_owner(ws uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_memberships m JOIN roles r ON r.id = m.role_id
    WHERE m.workspace_id = ws AND m.user_id = st_current_user() AND m.status = 'active'
      AND r.workspace_id IS NULL AND r.key = 'owner'
  )
$$;
--> statement-breakpoint
-- A role may be given (or a member holding it managed) only if it belongs to this workspace or
-- the system, every permission it carries is one the caller already has, and owner only by owners.
CREATE OR REPLACE FUNCTION st_can_assign_role(ws uuid, role uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM roles r
    WHERE r.id = role AND (r.workspace_id IS NULL OR r.workspace_id = ws)
      AND (r.key <> 'owner' OR r.workspace_id IS NOT NULL OR st_is_owner(ws))
      AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
        WHERE rp.role_id = r.id AND NOT st_has_permission(ws, rp.permission_key)
      )
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION st_is_owner(uuid), st_can_assign_role(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION st_is_owner(uuid), st_can_assign_role(uuid, uuid) TO st_app;
--> statement-breakpoint

-- Roles: system roles are visible to everyone; custom roles to members of their workspace.
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY roles_select ON "roles" FOR SELECT TO st_app
  USING (workspace_id IS NULL OR st_is_member(workspace_id));
--> statement-breakpoint
CREATE POLICY roles_write ON "roles" FOR ALL TO st_app
  USING (workspace_id IS NOT NULL AND NOT is_system AND st_has_permission(workspace_id, 'roles.manage'))
  WITH CHECK (workspace_id IS NOT NULL AND NOT is_system AND st_has_permission(workspace_id, 'roles.manage'));
--> statement-breakpoint
ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY role_permissions_select ON "role_permissions" FOR SELECT TO st_app
  USING (EXISTS (SELECT 1 FROM roles r WHERE r.id = role_id));
--> statement-breakpoint
-- Custom roles can only carry permissions the editor already holds.
CREATE POLICY role_permissions_write ON "role_permissions" FOR ALL TO st_app
  USING (EXISTS (
    SELECT 1 FROM roles r WHERE r.id = role_id AND r.workspace_id IS NOT NULL AND NOT r.is_system
      AND st_has_permission(r.workspace_id, 'roles.manage')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM roles r WHERE r.id = role_id AND r.workspace_id IS NOT NULL AND NOT r.is_system
      AND st_has_permission(r.workspace_id, 'roles.manage')
      AND st_has_permission(r.workspace_id, permission_key)
  ));
--> statement-breakpoint

-- Memberships: managers may change other people's membership only for roles they could assign,
-- never their own; the workspace must always keep an active owner.
DROP POLICY IF EXISTS memberships_insert ON "workspace_memberships";
--> statement-breakpoint
DROP POLICY IF EXISTS memberships_update ON "workspace_memberships";
--> statement-breakpoint
CREATE POLICY memberships_insert ON "workspace_memberships" FOR INSERT TO st_app
  WITH CHECK (
    (st_has_permission(workspace_id, 'team.manage') AND user_id <> st_current_user()
      AND st_can_assign_role(workspace_id, role_id))
    OR (
      user_id = st_current_user()
      AND NOT st_workspace_has_members(workspace_id)
      AND EXISTS (SELECT 1 FROM workspaces w WHERE w.id = workspace_id AND w.created_by = st_current_user())
    )
  );
--> statement-breakpoint
CREATE POLICY memberships_update ON "workspace_memberships" FOR UPDATE TO st_app
  USING (st_has_permission(workspace_id, 'team.manage') AND user_id <> st_current_user()
    AND st_can_assign_role(workspace_id, role_id))
  WITH CHECK (st_has_permission(workspace_id, 'team.manage') AND user_id <> st_current_user()
    AND st_can_assign_role(workspace_id, role_id));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_keep_an_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE owner_role uuid;
BEGIN
  SELECT id INTO owner_role FROM roles WHERE workspace_id IS NULL AND key = 'owner';
  IF OLD.role_id = owner_role AND OLD.status = 'active'
     AND NOT (NEW.role_id = owner_role AND NEW.status = 'active')
     AND NOT EXISTS (
       SELECT 1 FROM workspace_memberships m
       WHERE m.workspace_id = OLD.workspace_id AND m.id <> OLD.id
         AND m.role_id = owner_role AND m.status = 'active'
     ) THEN
    RAISE EXCEPTION 'A workspace must keep at least one active owner' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER memberships_keep_owner BEFORE UPDATE ON "workspace_memberships"
  FOR EACH ROW EXECUTE FUNCTION st_keep_an_owner();
--> statement-breakpoint
-- Records activity for the caller's own membership at most every five minutes.
CREATE OR REPLACE FUNCTION st_touch_membership(ws uuid) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE workspace_memberships SET last_active_at = now()
  WHERE workspace_id = ws AND user_id = st_current_user() AND status = 'active'
    AND (last_active_at IS NULL OR last_active_at < now() - interval '5 minutes')
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION st_touch_membership(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION st_touch_membership(uuid) TO st_app;
--> statement-breakpoint

-- Groups organise people; they never grant access to documents.
ALTER TABLE "workspace_groups" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workspace_groups" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY groups_select ON "workspace_groups" FOR SELECT TO st_app USING (st_is_member(workspace_id));
--> statement-breakpoint
CREATE POLICY groups_write ON "workspace_groups" FOR ALL TO st_app
  USING (st_has_permission(workspace_id, 'team.manage'))
  WITH CHECK (st_has_permission(workspace_id, 'team.manage'));
--> statement-breakpoint
ALTER TABLE "group_members" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "group_members" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY group_members_select ON "group_members" FOR SELECT TO st_app USING (st_is_member(workspace_id));
--> statement-breakpoint
CREATE POLICY group_members_write ON "group_members" FOR ALL TO st_app
  USING (st_has_permission(workspace_id, 'team.manage'))
  WITH CHECK (
    st_has_permission(workspace_id, 'team.manage')
    AND EXISTS (SELECT 1 FROM workspace_groups g WHERE g.id = group_id AND g.workspace_id = group_members.workspace_id)
    AND EXISTS (SELECT 1 FROM workspace_memberships m WHERE m.id = membership_id AND m.workspace_id = group_members.workspace_id)
  );
--> statement-breakpoint

-- Invitations.
ALTER TABLE "workspace_invitations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workspace_invitations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY invitations_select ON "workspace_invitations" FOR SELECT TO st_app
  USING (st_has_permission(workspace_id, 'team.view'));
--> statement-breakpoint
CREATE POLICY invitations_insert ON "workspace_invitations" FOR INSERT TO st_app
  WITH CHECK (st_has_permission(workspace_id, 'team.manage') AND invited_by = st_current_user()
    AND st_can_assign_role(workspace_id, role_id));
--> statement-breakpoint
CREATE POLICY invitations_update ON "workspace_invitations" FOR UPDATE TO st_app
  USING (st_has_permission(workspace_id, 'team.manage') AND accepted_at IS NULL
    AND st_can_assign_role(workspace_id, role_id))
  WITH CHECK (st_has_permission(workspace_id, 'team.manage') AND st_can_assign_role(workspace_id, role_id));
--> statement-breakpoint

-- What the invite page may show before the person signs in.
CREATE OR REPLACE FUNCTION st_invitation_preview(p_token_hash text)
RETURNS TABLE (workspace_name text, inviter_name text, email text, role_name text, state text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT w.name, u.name, i.email, r.name,
    CASE WHEN i.revoked_at IS NOT NULL THEN 'revoked'
         WHEN i.accepted_at IS NOT NULL THEN 'accepted'
         WHEN i.expires_at < now() THEN 'expired'
         ELSE 'open' END
  FROM workspace_invitations i
  JOIN workspaces w ON w.id = i.workspace_id
  JOIN roles r ON r.id = i.role_id
  JOIN "user" u ON u.id = i.invited_by
  WHERE i.token_hash = p_token_hash
$$;
--> statement-breakpoint
-- Accepts an invitation for the signed-in user whose verified email matches it.
CREATE OR REPLACE FUNCTION st_accept_invitation(p_token_hash text, OUT result text, OUT ws uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE inv workspace_invitations%ROWTYPE; me "user"%ROWTYPE; mid uuid;
BEGIN
  SELECT * INTO inv FROM workspace_invitations WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN result := 'not_found'; RETURN; END IF;
  ws := inv.workspace_id;
  IF inv.revoked_at IS NOT NULL THEN result := 'revoked'; RETURN; END IF;
  IF inv.accepted_at IS NOT NULL THEN result := 'accepted'; RETURN; END IF;
  IF inv.expires_at < now() THEN result := 'expired'; RETURN; END IF;
  SELECT * INTO me FROM "user" WHERE id = st_current_user();
  IF NOT FOUND OR NOT me.email_verified THEN result := 'unverified'; RETURN; END IF;
  IF lower(me.email) <> lower(inv.email) THEN result := 'wrong_email'; RETURN; END IF;
  SELECT id INTO mid FROM workspace_memberships WHERE workspace_id = inv.workspace_id AND user_id = me.id;
  IF mid IS NULL THEN
    INSERT INTO workspace_memberships (workspace_id, user_id, role_id, status, member_type)
    VALUES (inv.workspace_id, me.id, inv.role_id, 'active', inv.member_type) RETURNING id INTO mid;
  ELSE
    UPDATE workspace_memberships SET role_id = inv.role_id, status = 'active',
      member_type = inv.member_type, updated_at = now() WHERE id = mid;
  END IF;
  IF inv.group_id IS NOT NULL THEN
    INSERT INTO group_members (group_id, membership_id, workspace_id)
    VALUES (inv.group_id, mid, inv.workspace_id) ON CONFLICT DO NOTHING;
  END IF;
  UPDATE workspace_invitations SET accepted_at = now(), accepted_by = me.id WHERE id = inv.id;
  INSERT INTO audit_events (workspace_id, actor_user_id, action, target_type, target_id, metadata)
  VALUES (inv.workspace_id, me.id, 'team.invitation_accepted', 'membership', mid::text,
          jsonb_build_object('invitationId', inv.id));
  result := 'ok';
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION st_invitation_preview(text), st_accept_invitation(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION st_invitation_preview(text), st_accept_invitation(text) TO st_app;
--> statement-breakpoint

-- Contacts: shared ones are visible to the workspace, private ones only to their owner.
ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "contacts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY contacts_select ON "contacts" FOR SELECT TO st_app
  USING (st_has_permission(workspace_id, 'contacts.view')
    AND (visibility = 'shared' OR owner_user_id = st_current_user()));
--> statement-breakpoint
CREATE POLICY contacts_insert ON "contacts" FOR INSERT TO st_app
  WITH CHECK (st_has_permission(workspace_id, 'contacts.manage') AND owner_user_id = st_current_user());
--> statement-breakpoint
CREATE POLICY contacts_update ON "contacts" FOR UPDATE TO st_app
  USING (st_has_permission(workspace_id, 'contacts.manage')
    AND (visibility = 'shared' OR owner_user_id = st_current_user()))
  WITH CHECK (st_has_permission(workspace_id, 'contacts.manage')
    AND (visibility = 'shared' OR owner_user_id = st_current_user()));
--> statement-breakpoint
CREATE POLICY contacts_delete ON "contacts" FOR DELETE TO st_app
  USING (st_has_permission(workspace_id, 'contacts.manage')
    AND (visibility = 'shared' OR owner_user_id = st_current_user()));
--> statement-breakpoint
-- Senders mark contacts as used without needing permission to edit them.
CREATE OR REPLACE FUNCTION st_touch_contacts(ws uuid, emails text[]) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE contacts SET last_used_at = now()
  WHERE workspace_id = ws AND st_is_member(ws) AND lower(email) = ANY (emails)
    AND (visibility = 'shared' OR owner_user_id = st_current_user())
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION st_touch_contacts(uuid, text[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION st_touch_contacts(uuid, text[]) TO st_app;
--> statement-breakpoint

-- Templates.
CREATE OR REPLACE FUNCTION st_can_view_template(t uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM templates x
    WHERE x.id = t AND x.deleted_at IS NULL AND st_has_permission(x.workspace_id, 'templates.view')
      AND (x.shared OR x.created_by = st_current_user())
  )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_can_edit_template(t uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM templates x
    WHERE x.id = t AND x.deleted_at IS NULL AND st_has_permission(x.workspace_id, 'templates.manage')
      AND (x.shared OR x.created_by = st_current_user())
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION st_can_view_template(uuid), st_can_edit_template(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION st_can_view_template(uuid), st_can_edit_template(uuid) TO st_app;
--> statement-breakpoint
ALTER TABLE "templates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "templates" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY templates_select ON "templates" FOR SELECT TO st_app
  USING (st_has_permission(workspace_id, 'templates.view') AND (shared OR created_by = st_current_user()));
--> statement-breakpoint
CREATE POLICY templates_insert ON "templates" FOR INSERT TO st_app
  WITH CHECK (st_has_permission(workspace_id, 'templates.manage') AND created_by = st_current_user());
--> statement-breakpoint
CREATE POLICY templates_update ON "templates" FOR UPDATE TO st_app
  USING (st_has_permission(workspace_id, 'templates.manage') AND (shared OR created_by = st_current_user()))
  WITH CHECK (st_has_permission(workspace_id, 'templates.manage') AND (shared OR created_by = st_current_user()));
--> statement-breakpoint
ALTER TABLE "template_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "template_versions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY template_versions_select ON "template_versions" FOR SELECT TO st_app
  USING (st_can_view_template(template_id));
--> statement-breakpoint
CREATE POLICY template_versions_insert ON "template_versions" FOR INSERT TO st_app
  WITH CHECK (st_can_edit_template(template_id) AND created_by = st_current_user() AND published_at IS NULL
    AND EXISTS (SELECT 1 FROM templates x WHERE x.id = template_id AND x.workspace_id = template_versions.workspace_id));
--> statement-breakpoint
-- Published versions are frozen: only the unpublished draft can change.
CREATE POLICY template_versions_update ON "template_versions" FOR UPDATE TO st_app
  USING (st_can_edit_template(template_id) AND published_at IS NULL)
  WITH CHECK (st_can_edit_template(template_id));
--> statement-breakpoint
ALTER TABLE "template_categories" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "template_categories" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY template_categories_select ON "template_categories" FOR SELECT TO st_app
  USING (st_is_member(workspace_id));
--> statement-breakpoint
CREATE POLICY template_categories_write ON "template_categories" FOR ALL TO st_app
  USING (st_has_permission(workspace_id, 'templates.manage'))
  WITH CHECK (st_has_permission(workspace_id, 'templates.manage'));
--> statement-breakpoint

-- Branding shown to recipients who are not signed in. Logos and colours are public by nature.
CREATE OR REPLACE FUNCTION st_workspace_brand(ws uuid)
RETURNS TABLE (name text, brand_name text, brand_color text, logo_key text, logo_type text, logo_sha256 text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT w.name, w.brand_name, w.brand_color, w.brand_logo_key, w.brand_logo_type, w.brand_logo_sha256
  FROM workspaces w WHERE w.id = ws
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION st_workspace_brand(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION st_workspace_brand(uuid) TO st_app;
