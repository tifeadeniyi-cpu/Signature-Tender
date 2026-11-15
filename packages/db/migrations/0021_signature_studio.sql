CREATE TYPE "public"."signature_design_status" AS ENUM('draft', 'purchased', 'archived');--> statement-breakpoint
CREATE TYPE "public"."signature_purchase_status" AS ENUM('pending', 'processing', 'paid', 'failed', 'expired', 'refunded', 'disputed', 'duplicate');--> statement-breakpoint
CREATE TABLE "signature_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signature_design_id" uuid NOT NULL,
	"purchase_id" uuid NOT NULL,
	"format" text NOT NULL,
	"background" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"storage_reference" text,
	"content_hash" text,
	"width" integer,
	"height" integer,
	"bytes" integer,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"generated_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signature_assets_format" CHECK ("signature_assets"."format" in ('png', 'svg', 'jpeg')),
	CONSTRAINT "signature_assets_status" CHECK ("signature_assets"."status" in ('ready', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "signature_designs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_session_hash" text,
	"owner_user_id" text,
	"display_name" text DEFAULT 'My signature' NOT NULL,
	"kind" text DEFAULT 'signature' NOT NULL,
	"creation_method" text NOT NULL,
	"style_family" text,
	"design" jsonb NOT NULL,
	"canonical_design_hash" text NOT NULL,
	"renderer_version" integer DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "signature_design_status" DEFAULT 'draft' NOT NULL,
	"duplicated_from" uuid,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purchased_at" timestamp with time zone,
	CONSTRAINT "signature_designs_has_owner" CHECK ("signature_designs"."owner_user_id" is not null or "signature_designs"."creator_session_hash" is not null),
	CONSTRAINT "signature_designs_kind" CHECK ("signature_designs"."kind" in ('signature', 'initials'))
);
--> statement-breakpoint
CREATE TABLE "signature_downloads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entitlement_id" uuid NOT NULL,
	"asset_id" uuid,
	"format" text NOT NULL,
	"via" text NOT NULL,
	"result" text NOT NULL,
	"downloaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signature_entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signature_design_id" uuid NOT NULL,
	"purchase_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"access_status" text DEFAULT 'active' NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	CONSTRAINT "signature_entitlements_status" CHECK ("signature_entitlements"."access_status" in ('active', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "signature_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signature_design_id" uuid NOT NULL,
	"design_snapshot" jsonb NOT NULL,
	"design_hash" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"customer_email" text,
	"payment_provider" text DEFAULT 'stripe' NOT NULL,
	"stripe_checkout_session_id" text,
	"stripe_payment_intent_id" text,
	"amount_cents" integer NOT NULL,
	"amount_refunded_cents" integer DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"payment_status" "signature_purchase_status" DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purchased_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signature_purchases_amount_nonneg" CHECK ("signature_purchases"."amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "signature_studio_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event" text NOT NULL,
	"session_hash" text,
	"user_id" text,
	"design_id" uuid,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signature_studio_rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signature_uploads" (
	"sha256" text PRIMARY KEY NOT NULL,
	"storage_key" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" integer NOT NULL,
	"creator_session_hash" text,
	"owner_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signature_assets" ADD CONSTRAINT "signature_assets_signature_design_id_signature_designs_id_fk" FOREIGN KEY ("signature_design_id") REFERENCES "public"."signature_designs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_assets" ADD CONSTRAINT "signature_assets_purchase_id_signature_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."signature_purchases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_designs" ADD CONSTRAINT "signature_designs_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_downloads" ADD CONSTRAINT "signature_downloads_entitlement_id_signature_entitlements_id_fk" FOREIGN KEY ("entitlement_id") REFERENCES "public"."signature_entitlements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_downloads" ADD CONSTRAINT "signature_downloads_asset_id_signature_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."signature_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_entitlements" ADD CONSTRAINT "signature_entitlements_signature_design_id_signature_designs_id_fk" FOREIGN KEY ("signature_design_id") REFERENCES "public"."signature_designs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_entitlements" ADD CONSTRAINT "signature_entitlements_purchase_id_signature_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."signature_purchases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_entitlements" ADD CONSTRAINT "signature_entitlements_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_purchases" ADD CONSTRAINT "signature_purchases_signature_design_id_signature_designs_id_fk" FOREIGN KEY ("signature_design_id") REFERENCES "public"."signature_designs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_purchases" ADD CONSTRAINT "signature_purchases_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_uploads" ADD CONSTRAINT "signature_uploads_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "signature_assets_variant_uq" ON "signature_assets" USING btree ("purchase_id","format","background");--> statement-breakpoint
CREATE INDEX "signature_assets_status_idx" ON "signature_assets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "signature_designs_owner_idx" ON "signature_designs" USING btree ("owner_user_id","updated_at");--> statement-breakpoint
CREATE INDEX "signature_designs_session_idx" ON "signature_designs" USING btree ("creator_session_hash","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "signature_designs_default_uq" ON "signature_designs" USING btree ("owner_user_id","kind") WHERE "signature_designs"."is_default" and "signature_designs"."owner_user_id" is not null;--> statement-breakpoint
CREATE INDEX "signature_downloads_entitlement_idx" ON "signature_downloads" USING btree ("entitlement_id","downloaded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "signature_entitlements_purchase_uq" ON "signature_entitlements" USING btree ("purchase_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signature_entitlements_design_active_uq" ON "signature_entitlements" USING btree ("signature_design_id") WHERE "signature_entitlements"."access_status" = 'active';--> statement-breakpoint
CREATE INDEX "signature_entitlements_owner_idx" ON "signature_entitlements" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signature_purchases_session_uq" ON "signature_purchases" USING btree ("stripe_checkout_session_id");--> statement-breakpoint
CREATE INDEX "signature_purchases_intent_idx" ON "signature_purchases" USING btree ("stripe_payment_intent_id");--> statement-breakpoint
CREATE INDEX "signature_purchases_design_idx" ON "signature_purchases" USING btree ("signature_design_id");--> statement-breakpoint
CREATE INDEX "signature_purchases_owner_idx" ON "signature_purchases" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE INDEX "signature_studio_events_event_idx" ON "signature_studio_events" USING btree ("event","created_at");--> statement-breakpoint
CREATE INDEX "signature_uploads_session_idx" ON "signature_uploads" USING btree ("creator_session_hash");