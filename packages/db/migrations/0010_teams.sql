CREATE TYPE "public"."contact_visibility" AS ENUM('shared', 'private');--> statement-breakpoint
CREATE TYPE "public"."template_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"visibility" "contact_visibility" DEFAULT 'shared' NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"company" text,
	"job_title" text,
	"contact_type" text DEFAULT 'person' NOT NULL,
	"notes" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_used_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_name_len" CHECK (char_length("contacts"."name") between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"group_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	CONSTRAINT "group_members_group_id_membership_id_pk" PRIMARY KEY("group_id","membership_id")
);
--> statement-breakpoint
CREATE TABLE "template_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "template_categories_name_len" CHECK (char_length("template_categories"."name") between 1 and 40)
);
--> statement-breakpoint
CREATE TABLE "template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"storage_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"page_count" integer NOT NULL,
	"recipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"signing_order_enabled" boolean DEFAULT false NOT NULL,
	"email_message" text,
	"published_at" timestamp with time zone,
	"published_by" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'Agreements' NOT NULL,
	"document_type" text DEFAULT 'agreement' NOT NULL,
	"status" "template_status" DEFAULT 'draft' NOT NULL,
	"shared" boolean DEFAULT true NOT NULL,
	"published_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "templates_title_len" CHECK (char_length("templates"."title") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "workspace_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_groups_name_len" CHECK (char_length("workspace_groups"."name") between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "workspace_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role_id" uuid NOT NULL,
	"group_id" uuid,
	"member_type" text DEFAULT 'internal' NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"sent_count" integer DEFAULT 1 NOT NULL,
	"last_sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_invitations_member_type" CHECK ("workspace_invitations"."member_type" in ('internal','external'))
);
--> statement-breakpoint
ALTER TABLE "workspace_memberships" ADD COLUMN "member_type" text DEFAULT 'internal' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_memberships" ADD COLUMN "last_active_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "brand_name" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "brand_color" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "brand_logo_key" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "brand_logo_type" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "brand_logo_sha256" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "template_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "template_version_id" uuid;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_workspace_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."workspace_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_membership_id_workspace_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."workspace_memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_categories" ADD CONSTRAINT "template_categories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_groups" ADD CONSTRAINT "workspace_groups_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_group_id_workspace_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."workspace_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_accepted_by_user_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_email_uq" ON "contacts" USING btree ("workspace_id",(case when "visibility" = 'private' then "owner_user_id" else '' end),lower("email"));--> statement-breakpoint
CREATE INDEX "contacts_ws_idx" ON "contacts" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "template_categories_name_uq" ON "template_categories" USING btree ("workspace_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "template_versions_uq" ON "template_versions" USING btree ("template_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "template_versions_one_draft_uq" ON "template_versions" USING btree ("template_id") WHERE published_at is null;--> statement-breakpoint
CREATE INDEX "templates_ws_idx" ON "templates" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_groups_name_uq" ON "workspace_groups" USING btree ("workspace_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_invitations_token_uq" ON "workspace_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_invitations_open_uq" ON "workspace_invitations" USING btree ("workspace_id",lower("email")) WHERE accepted_at is null and revoked_at is null;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_template_version_id_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."template_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "memberships_member_type" CHECK ("workspace_memberships"."member_type" in ('internal','external'));