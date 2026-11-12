CREATE TYPE "public"."recipient_status" AS ENUM('waiting', 'notified', 'viewed', 'signed', 'declined');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('awaiting_payment', 'payment_processing', 'ready_to_dispatch', 'queued', 'sent', 'in_progress', 'awaiting_approval', 'completed', 'declined', 'expired', 'cancelled', 'finalization_failed');--> statement-breakpoint
CREATE TYPE "public"."signature_kind" AS ENUM('signature', 'initials');--> statement-breakpoint
CREATE TYPE "public"."signature_method" AS ENUM('typed', 'drawn', 'uploaded');--> statement-breakpoint
CREATE TABLE "request_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"type" "field_type" NOT NULL,
	"page" integer NOT NULL,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"width" double precision NOT NULL,
	"height" double precision NOT NULL,
	"required" boolean NOT NULL,
	"label" text,
	"options" jsonb,
	"value" text,
	"signature_id" uuid,
	"filled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "request_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" "recipient_role" NOT NULL,
	"signing_order" integer NOT NULL,
	"auth_method" "recipient_auth" NOT NULL,
	"color_index" integer DEFAULT 0 NOT NULL,
	"status" "recipient_status" DEFAULT 'waiting' NOT NULL,
	"token_hash" text,
	"token_expires_at" timestamp with time zone,
	"session_hash" text,
	"session_expires_at" timestamp with time zone,
	"otp_hash" text,
	"otp_expires_at" timestamp with time zone,
	"otp_attempts" integer DEFAULT 0 NOT NULL,
	"otp_sent_count" integer DEFAULT 0 NOT NULL,
	"otp_last_sent_at" timestamp with time zone,
	"notified_at" timestamp with time zone,
	"viewed_at" timestamp with time zone,
	"authenticated_at" timestamp with time zone,
	"consented_at" timestamp with time zone,
	"signed_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	"decline_reason" text,
	"signed_ip" text,
	"signed_user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"kind" "signature_kind" NOT NULL,
	"method" "signature_method" NOT NULL,
	"typed_text" text,
	"font" text,
	"image_png" "bytea" NOT NULL,
	"image_sha256" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"adopted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signing_events" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"recipient_id" uuid,
	"actor_user_id" text,
	"type" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signing_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"status" "request_status" NOT NULL,
	"is_test" boolean NOT NULL,
	"title" text NOT NULL,
	"sent_by" text NOT NULL,
	"sender_name" text NOT NULL,
	"sender_email" text NOT NULL,
	"workspace_name" text NOT NULL,
	"source_file_id" uuid NOT NULL,
	"source_sha256" text NOT NULL,
	"signing_order_enabled" boolean NOT NULL,
	"settings" jsonb NOT NULL,
	"email_message" text,
	"disclosure_version" text NOT NULL,
	"disclosure_text" text NOT NULL,
	"expires_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"closed_reason" text,
	"signed_file_id" uuid,
	"certificate_file_id" uuid,
	"finalization_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signing_requests_sha_len" CHECK (char_length("signing_requests"."source_sha256") = 64)
);
--> statement-breakpoint
ALTER TABLE "request_fields" ADD CONSTRAINT "request_fields_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_fields" ADD CONSTRAINT "request_fields_request_id_signing_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."signing_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_fields" ADD CONSTRAINT "request_fields_recipient_id_request_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."request_recipients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_recipients" ADD CONSTRAINT "request_recipients_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_recipients" ADD CONSTRAINT "request_recipients_request_id_signing_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."signing_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_request_id_signing_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."signing_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_recipient_id_request_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."request_recipients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_events" ADD CONSTRAINT "signing_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_events" ADD CONSTRAINT "signing_events_request_id_signing_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."signing_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_events" ADD CONSTRAINT "signing_events_recipient_id_request_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."request_recipients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_requests" ADD CONSTRAINT "signing_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_requests" ADD CONSTRAINT "signing_requests_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_requests" ADD CONSTRAINT "signing_requests_sent_by_user_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_requests" ADD CONSTRAINT "signing_requests_source_file_id_document_files_id_fk" FOREIGN KEY ("source_file_id") REFERENCES "public"."document_files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_requests" ADD CONSTRAINT "signing_requests_signed_file_id_document_files_id_fk" FOREIGN KEY ("signed_file_id") REFERENCES "public"."document_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_requests" ADD CONSTRAINT "signing_requests_certificate_file_id_document_files_id_fk" FOREIGN KEY ("certificate_file_id") REFERENCES "public"."document_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "request_fields_req_idx" ON "request_fields" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "request_fields_recipient_idx" ON "request_fields" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "request_recipients_req_idx" ON "request_recipients" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "request_recipients_token_uq" ON "request_recipients" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "request_recipients_email_uq" ON "request_recipients" USING btree ("request_id",lower("email"));--> statement-breakpoint
CREATE INDEX "signatures_recipient_idx" ON "signatures" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "signing_events_req_idx" ON "signing_events" USING btree ("request_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "signing_events_hash_uq" ON "signing_events" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "signing_requests_doc_idx" ON "signing_requests" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "signing_requests_ws_idx" ON "signing_requests" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "signing_requests_one_open_uq" ON "signing_requests" USING btree ("document_id") WHERE status not in ('completed','declined','expired','cancelled');