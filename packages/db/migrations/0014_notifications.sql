CREATE TYPE "public"."notification_status" AS ENUM('queued', 'sending', 'sent', 'delivered', 'retrying', 'failed', 'bounced', 'cancelled');--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"template" text NOT NULL,
	"template_version" text NOT NULL,
	"audience" text NOT NULL,
	"recipient_id" uuid,
	"user_id" text,
	"to_email" text NOT NULL,
	"to_name" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "notification_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"last_error" text,
	"provider_message_id" text,
	"link_hash" text,
	"link_version" integer DEFAULT 1 NOT NULL,
	"link_expires_at" timestamp with time zone,
	"link_revoked_at" timestamp with time zone,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_audience" CHECK ("notifications"."audience" in ('sender', 'recipient'))
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_request_id_signing_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."signing_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_request_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."request_recipients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_once_uq" ON "notifications" USING btree ("request_id","template",lower("to_email"));--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_link_uq" ON "notifications" USING btree ("link_hash");--> statement-breakpoint
CREATE INDEX "notifications_due_idx" ON "notifications" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "notifications_provider_idx" ON "notifications" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX "notifications_doc_idx" ON "notifications" USING btree ("document_id","created_at");