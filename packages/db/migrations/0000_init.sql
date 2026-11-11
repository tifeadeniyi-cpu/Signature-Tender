CREATE TYPE "public"."membership_status" AS ENUM('invited', 'active', 'suspended', 'removed');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passkey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"aaguid" text
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "two_factor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL,
	"verified" boolean DEFAULT true,
	"failed_verification_count" integer DEFAULT 0,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"two_factor_enabled" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"key" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_key" text NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_key_pk" PRIMARY KEY("role_id","permission_key")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"job_title" text,
	"phone" text,
	"timezone" text DEFAULT 'America/Chicago' NOT NULL,
	"locale" text DEFAULT 'en-US' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role_id" uuid NOT NULL,
	"status" "membership_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"legal_name" text,
	"contact_email" text,
	"website" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_name_len" CHECK (char_length("workspaces"."name") between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"workspace_id" uuid,
	"actor_user_id" text,
	"actor_type" text DEFAULT 'user' NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"environments" text[] DEFAULT '{}'::text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"credits" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"stripe_price_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prices_credits_pos" CHECK ("prices"."credits" > 0),
	CONSTRAINT "prices_amount_nonneg" CHECK ("prices"."amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "subscription_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"monthly_price_cents" integer,
	"included_requests" integer,
	"overage_price_cents" integer,
	"is_custom" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"stripe_price_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_price_nonneg" CHECK ("subscription_plans"."monthly_price_cents" is null or "subscription_plans"."monthly_price_cents" >= 0),
	CONSTRAINT "plans_overage_nonneg" CHECK ("subscription_plans"."overage_price_cents" is null or "subscription_plans"."overage_price_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_key_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."permissions"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "passkey_user_idx" ON "passkey" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "passkey_credential_idx" ON "passkey" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "two_factor_user_idx" ON "two_factor" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "two_factor_secret_idx" ON "two_factor" USING btree ("secret");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_lower_uq" ON "user" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_scope_key_uq" ON "roles" USING btree (coalesce("workspace_id"::text, 'system'),"key");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_ws_user_uq" ON "workspace_memberships" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "workspace_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_slug_uq" ON "workspaces" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "audit_ws_time_idx" ON "audit_events" USING btree ("workspace_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_events" USING btree ("actor_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prices_code_uq" ON "prices" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_code_uq" ON "subscription_plans" USING btree ("code");