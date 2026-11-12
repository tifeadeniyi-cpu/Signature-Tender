-- Row-level security for documents and their preparation data.
GRANT SELECT, INSERT, UPDATE ON "documents" TO st_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "document_files" TO st_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "document_recipients", "document_fields" TO st_app;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION st_can_view_document(doc uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM documents d
    WHERE d.id = doc AND d.deleted_at IS NULL
      AND (
        st_has_permission(d.workspace_id, 'documents.view_all')
        OR (d.created_by = st_current_user() AND st_has_permission(d.workspace_id, 'documents.view_own'))
      )
  )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION st_can_edit_document(doc uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM documents d
    WHERE d.id = doc AND d.deleted_at IS NULL
      AND st_has_permission(d.workspace_id, 'documents.create')
      AND (d.created_by = st_current_user() OR st_has_permission(d.workspace_id, 'documents.view_all'))
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION st_can_view_document(uuid), st_can_edit_document(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION st_can_view_document(uuid), st_can_edit_document(uuid) TO st_app;
--> statement-breakpoint

ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY documents_select ON "documents" FOR SELECT TO st_app
  USING (
    st_has_permission(workspace_id, 'documents.view_all')
    OR (created_by = st_current_user() AND st_has_permission(workspace_id, 'documents.view_own'))
  );
--> statement-breakpoint
CREATE POLICY documents_insert ON "documents" FOR INSERT TO st_app
  WITH CHECK (created_by = st_current_user() AND st_has_permission(workspace_id, 'documents.create'));
--> statement-breakpoint
-- Soft delete is an UPDATE of deleted_at, so it is covered here; hard DELETE is not granted.
CREATE POLICY documents_update ON "documents" FOR UPDATE TO st_app
  USING (
    st_has_permission(workspace_id, 'documents.create')
    AND (created_by = st_current_user() OR st_has_permission(workspace_id, 'documents.view_all'))
  )
  WITH CHECK (
    st_has_permission(workspace_id, 'documents.create')
    AND (created_by = st_current_user() OR st_has_permission(workspace_id, 'documents.view_all'))
  );
--> statement-breakpoint

ALTER TABLE "document_files" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "document_files" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY document_files_select ON "document_files" FOR SELECT TO st_app USING (st_can_view_document(document_id));
--> statement-breakpoint
CREATE POLICY document_files_insert ON "document_files" FOR INSERT TO st_app
  WITH CHECK (created_by = st_current_user() AND st_can_edit_document(document_id)
    AND workspace_id = (SELECT d.workspace_id FROM documents d WHERE d.id = document_id));
--> statement-breakpoint

ALTER TABLE "document_recipients" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "document_recipients" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY document_recipients_select ON "document_recipients" FOR SELECT TO st_app USING (st_can_view_document(document_id));
--> statement-breakpoint
CREATE POLICY document_recipients_write ON "document_recipients" FOR ALL TO st_app
  USING (st_can_edit_document(document_id))
  WITH CHECK (st_can_edit_document(document_id)
    AND workspace_id = (SELECT d.workspace_id FROM documents d WHERE d.id = document_id));
--> statement-breakpoint

ALTER TABLE "document_fields" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "document_fields" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY document_fields_select ON "document_fields" FOR SELECT TO st_app USING (st_can_view_document(document_id));
--> statement-breakpoint
CREATE POLICY document_fields_write ON "document_fields" FOR ALL TO st_app
  USING (st_can_edit_document(document_id))
  WITH CHECK (st_can_edit_document(document_id)
    AND workspace_id = (SELECT d.workspace_id FROM documents d WHERE d.id = document_id)
    AND EXISTS (SELECT 1 FROM document_recipients r WHERE r.id = recipient_id AND r.document_id = document_fields.document_id));
