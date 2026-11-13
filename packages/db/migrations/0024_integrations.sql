-- Integrations marketplace framework (adds only). Existing partner and Slack connections keep
-- their one-per-workspace rule through a partial unique index; OAuth connections are one per
-- external account. The certificate columns from 0023 were missing from its snapshot; this
-- migration's snapshot includes them, and the SQL does not touch them.
CREATE TABLE "integration_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"connection_id" uuid,
	"provider" text NOT NULL,
	"action" text NOT NULL,
	"status" text NOT NULL,
	"job_id" uuid,
	"document_id" uuid,
	"request_id" uuid,
	"external_reference" text,
	"correlation_id" text,
	"duration_ms" integer,
	"actor_user_id" text,
	"error_code" text,
	"message" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_activity_status" CHECK ("integration_activity"."status" in ('success','pending','retrying','failed','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "integration_credentials" (
	"connection_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"sealed_access_token" text NOT NULL,
	"sealed_refresh_token" text,
	"token_type" text DEFAULT 'Bearer' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_event_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"name" text NOT NULL,
	"event_type" text NOT NULL,
	"action" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"last_run_at" timestamp with time zone,
	"run_count" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_object_type" text NOT NULL,
	"external_object_id" text NOT NULL,
	"external_label" text,
	"document_id" uuid NOT NULL,
	"request_id" uuid,
	"sync_status" text DEFAULT 'linked' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_mappings_sync_status" CHECK ("integration_mappings"."sync_status" in ('linked','pending','synced','failed'))
);
--> statement-breakpoint
CREATE TABLE "integration_sync_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"subscription_id" uuid,
	"operation" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"idempotency_key" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 6 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"correlation_id" text,
	"external_reference" text,
	"document_id" uuid,
	"request_id" uuid,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_sync_jobs_status" CHECK ("integration_sync_jobs"."status" in ('pending','running','retrying','succeeded','failed','cancelled'))
);
--> statement-breakpoint
ALTER TABLE "integration_connections" DROP CONSTRAINT "integration_connections_status";--> statement-breakpoint
DROP INDEX "integration_connections_uq";--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "visibility" text DEFAULT 'workspace' NOT NULL;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "owner_user_id" text;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "external_account_id" text;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "external_account_label" text;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "scopes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "connected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "last_success_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "last_failure_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "last_refreshed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "last_error_code" text;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "last_error_message" text;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "integration_activity" ADD CONSTRAINT "integration_activity_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_activity" ADD CONSTRAINT "integration_activity_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_activity" ADD CONSTRAINT "integration_activity_job_id_integration_sync_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."integration_sync_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_activity" ADD CONSTRAINT "integration_activity_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_activity" ADD CONSTRAINT "integration_activity_request_id_signing_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."signing_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_activity" ADD CONSTRAINT "integration_activity_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_credentials" ADD CONSTRAINT "integration_credentials_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_credentials" ADD CONSTRAINT "integration_credentials_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_event_subscriptions" ADD CONSTRAINT "integration_event_subscriptions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_event_subscriptions" ADD CONSTRAINT "integration_event_subscriptions_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_event_subscriptions" ADD CONSTRAINT "integration_event_subscriptions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_mappings" ADD CONSTRAINT "integration_mappings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_mappings" ADD CONSTRAINT "integration_mappings_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_mappings" ADD CONSTRAINT "integration_mappings_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_mappings" ADD CONSTRAINT "integration_mappings_request_id_signing_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."signing_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_mappings" ADD CONSTRAINT "integration_mappings_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_jobs" ADD CONSTRAINT "integration_sync_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_jobs" ADD CONSTRAINT "integration_sync_jobs_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_jobs" ADD CONSTRAINT "integration_sync_jobs_subscription_id_integration_event_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."integration_event_subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_jobs" ADD CONSTRAINT "integration_sync_jobs_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_jobs" ADD CONSTRAINT "integration_sync_jobs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_jobs" ADD CONSTRAINT "integration_sync_jobs_request_id_signing_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."signing_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_activity_ws_idx" ON "integration_activity" USING btree ("workspace_id","occurred_at");--> statement-breakpoint
CREATE INDEX "integration_activity_conn_idx" ON "integration_activity" USING btree ("connection_id","occurred_at");--> statement-breakpoint
CREATE INDEX "integration_subscriptions_match_idx" ON "integration_event_subscriptions" USING btree ("workspace_id","event_type") WHERE "integration_event_subscriptions"."enabled";--> statement-breakpoint
CREATE INDEX "integration_subscriptions_conn_idx" ON "integration_event_subscriptions" USING btree ("connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_mappings_uq" ON "integration_mappings" USING btree ("connection_id","external_object_type","external_object_id","document_id");--> statement-breakpoint
CREATE INDEX "integration_mappings_doc_idx" ON "integration_mappings" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "integration_mappings_request_idx" ON "integration_mappings" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "integration_mappings_external_idx" ON "integration_mappings" USING btree ("workspace_id","provider","external_object_type","external_object_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_sync_jobs_idem_uq" ON "integration_sync_jobs" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "integration_sync_jobs_due_idx" ON "integration_sync_jobs" USING btree ("next_attempt_at") WHERE "integration_sync_jobs"."status" in ('pending','retrying');--> statement-breakpoint
CREATE INDEX "integration_sync_jobs_conn_idx" ON "integration_sync_jobs" USING btree ("connection_id","created_at");--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connections_account_uq" ON "integration_connections" USING btree ("workspace_id","provider","external_account_id",coalesce("owner_user_id", '')) WHERE "integration_connections"."external_account_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connections_uq" ON "integration_connections" USING btree ("workspace_id","provider") WHERE "integration_connections"."external_account_id" is null;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_visibility" CHECK ("integration_connections"."visibility" in ('workspace','personal'));--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_personal_owner" CHECK ("integration_connections"."visibility" = 'workspace' or "integration_connections"."owner_user_id" is not null);--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_status" CHECK ("integration_connections"."status" in ('active','disabled','expired','permission_required','error'));