CREATE TABLE "retention_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_type" text,
	"retain_days" integer NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retention_days_pos" CHECK ("retention_policies"."retain_days" > 0)
);
--> statement-breakpoint
CREATE TABLE "retrieval_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"code_expires_at" timestamp with time zone NOT NULL,
	"session_hash" text,
	"session_expires_at" timestamp with time zone,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "legal_hold" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "legal_hold_reason" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "purged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "retention_ws_type_uq" ON "retention_policies" USING btree ("workspace_id",coalesce("document_type", ''));--> statement-breakpoint
CREATE UNIQUE INDEX "retrieval_session_hash_uq" ON "retrieval_sessions" USING btree ("session_hash");--> statement-breakpoint
CREATE INDEX "retrieval_email_idx" ON "retrieval_sessions" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "retrieval_ip_idx" ON "retrieval_sessions" USING btree ("ip_address","created_at");