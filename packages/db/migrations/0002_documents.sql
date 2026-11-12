CREATE TYPE "public"."document_status" AS ENUM('draft', 'uploading', 'processing', 'ready_for_preparation', 'preparing', 'ready_to_send');--> statement-breakpoint
CREATE TYPE "public"."field_type" AS ENUM('signature', 'initials', 'date_signed', 'name', 'email', 'text', 'checkbox', 'dropdown', 'radio', 'number');--> statement-breakpoint
CREATE TYPE "public"."recipient_auth" AS ENUM('email_link', 'email_code');--> statement-breakpoint
CREATE TYPE "public"."recipient_role" AS ENUM('signer', 'reviewer', 'approver', 'cc', 'viewer');--> statement-breakpoint
CREATE TABLE "document_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"type" "field_type" NOT NULL,
	"page" integer NOT NULL,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"width" double precision NOT NULL,
	"height" double precision NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"label" text,
	"options" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_fields_page_pos" CHECK ("document_fields"."page" >= 1),
	CONSTRAINT "document_fields_bounds" CHECK ("document_fields"."x" >= 0 and "document_fields"."y" >= 0 and "document_fields"."width" > 0 and "document_fields"."height" > 0 and "document_fields"."x" + "document_fields"."width" <= 1.0001 and "document_fields"."y" + "document_fields"."height" <= 1.0001)
);
--> statement-breakpoint
CREATE TABLE "document_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"kind" text DEFAULT 'original' NOT NULL,
	"storage_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"page_count" integer NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_files_sha_len" CHECK (char_length("document_files"."sha256") = 64),
	CONSTRAINT "document_files_size_pos" CHECK ("document_files"."size_bytes" > 0)
);
--> statement-breakpoint
CREATE TABLE "document_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" "recipient_role" DEFAULT 'signer' NOT NULL,
	"signing_order" integer DEFAULT 1 NOT NULL,
	"auth_method" "recipient_auth" DEFAULT 'email_link' NOT NULL,
	"color_index" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_recipients_order_pos" CHECK ("document_recipients"."signing_order" >= 1)
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"title" text NOT NULL,
	"document_type" text DEFAULT 'agreement' NOT NULL,
	"status" "document_status" DEFAULT 'draft' NOT NULL,
	"signing_order_enabled" boolean DEFAULT false NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"email_message" text,
	"page_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "documents_title_len" CHECK (char_length("documents"."title") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "document_fields" ADD CONSTRAINT "document_fields_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_fields" ADD CONSTRAINT "document_fields_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_fields" ADD CONSTRAINT "document_fields_recipient_id_document_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."document_recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_recipients" ADD CONSTRAINT "document_recipients_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_recipients" ADD CONSTRAINT "document_recipients_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_fields_doc_idx" ON "document_fields" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_files_key_uq" ON "document_files" USING btree ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "document_files_doc_version_kind_uq" ON "document_files" USING btree ("document_id","version","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "document_recipients_email_uq" ON "document_recipients" USING btree ("document_id",lower("email"));--> statement-breakpoint
CREATE INDEX "documents_ws_updated_idx" ON "documents" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "documents_creator_idx" ON "documents" USING btree ("created_by");