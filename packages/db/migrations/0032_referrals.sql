-- Give 1, Get 2 referral program. Rewards are ordinary credit-ledger entries in a new `referral`
-- bucket; these tables record who referred whom and which ledger entry paid each reward.
ALTER TYPE "credit_bucket" ADD VALUE IF NOT EXISTS 'referral';
--> statement-breakpoint
ALTER TYPE "credit_entry_type" ADD VALUE IF NOT EXISTS 'referral_welcome';
--> statement-breakpoint
ALTER TYPE "credit_entry_type" ADD VALUE IF NOT EXISTS 'referral_reward';
--> statement-breakpoint
ALTER TYPE "credit_entry_type" ADD VALUE IF NOT EXISTS 'referral_reversal';
--> statement-breakpoint
ALTER TYPE "credit_entry_type" ADD VALUE IF NOT EXISTS 'referral_adjustment';
--> statement-breakpoint
CREATE TYPE "referral_program_status" AS ENUM ('active', 'paused', 'ended');
--> statement-breakpoint
CREATE TYPE "referral_identity_status" AS ENUM ('active', 'revoked');
--> statement-breakpoint
CREATE TYPE "referral_status" AS ENUM ('verification_pending', 'verified', 'awaiting_purchase', 'under_review', 'rewarded', 'rejected', 'reversed');
--> statement-breakpoint
CREATE TYPE "referral_reward_kind" AS ENUM ('welcome', 'referrer');
--> statement-breakpoint
CREATE TYPE "referral_reward_status" AS ENUM ('issued', 'reversed');
--> statement-breakpoint
CREATE TABLE "referral_programs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "status" "referral_program_status" DEFAULT 'paused' NOT NULL,
  "referrer_credits" integer DEFAULT 2 NOT NULL,
  "referred_credits" integer DEFAULT 1 NOT NULL,
  "attribution_window_days" integer DEFAULT 30 NOT NULL,
  "qualification_delay_hours" integer DEFAULT 0 NOT NULL,
  "settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "start_at" timestamp with time zone,
  "end_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "referral_programs_credits" CHECK ("referrer_credits" >= 0 and "referred_credits" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "referral_programs_key_uq" ON "referral_programs" ("key");
--> statement-breakpoint
CREATE TABLE "referral_identities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "code" text NOT NULL,
  "status" "referral_identity_status" DEFAULT 'active' NOT NULL,
  "revoked_at" timestamp with time zone,
  "revoked_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "referral_identities_code_shape" CHECK ("code" ~ '^[A-Z2-9]{8,12}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "referral_identities_code_uq" ON "referral_identities" ("code");
--> statement-breakpoint
CREATE UNIQUE INDEX "referral_identities_owner_ws_uq" ON "referral_identities" ("owner_user_id", "workspace_id");
--> statement-breakpoint
CREATE TABLE "referral_attributions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "identity_id" uuid NOT NULL REFERENCES "referral_identities"("id") ON DELETE restrict,
  "program_id" uuid NOT NULL REFERENCES "referral_programs"("id") ON DELETE restrict,
  "referred_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "referred_workspace_id" uuid REFERENCES "workspaces"("id") ON DELETE set null,
  "source" text NOT NULL,
  "status" "referral_status" NOT NULL,
  "registered_at" timestamp with time zone DEFAULT now() NOT NULL,
  "verified_at" timestamp with time zone,
  "qualified_at" timestamp with time zone,
  "reward_after" timestamp with time zone,
  "qualification_payment_id" uuid REFERENCES "payments"("id") ON DELETE restrict,
  "risk_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "referral_attributions_source" CHECK ("source" in ('link', 'code'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "referral_attributions_referred_uq" ON "referral_attributions" ("referred_user_id");
--> statement-breakpoint
CREATE INDEX "referral_attributions_identity_idx" ON "referral_attributions" ("identity_id", "created_at");
--> statement-breakpoint
CREATE INDEX "referral_attributions_status_idx" ON "referral_attributions" ("status");
--> statement-breakpoint
CREATE TABLE "referral_rewards" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "attribution_id" uuid NOT NULL REFERENCES "referral_attributions"("id") ON DELETE restrict,
  "kind" "referral_reward_kind" NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE restrict,
  "credits" integer NOT NULL,
  "status" "referral_reward_status" DEFAULT 'issued' NOT NULL,
  "ledger_entry_id" uuid NOT NULL REFERENCES "credit_ledger"("id") ON DELETE restrict,
  "issued_at" timestamp with time zone DEFAULT now() NOT NULL,
  "reversed_at" timestamp with time zone,
  "reversed_credits" integer,
  "reversal_reason" text,
  CONSTRAINT "referral_rewards_credits_pos" CHECK ("credits" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "referral_rewards_once_uq" ON "referral_rewards" ("attribution_id", "kind");
--> statement-breakpoint
CREATE INDEX "referral_rewards_workspace_idx" ON "referral_rewards" ("workspace_id", "issued_at");
--> statement-breakpoint
CREATE TABLE "referral_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "attribution_id" uuid REFERENCES "referral_attributions"("id") ON DELETE cascade,
  "identity_id" uuid REFERENCES "referral_identities"("id") ON DELETE cascade,
  "type" text NOT NULL,
  "actor_type" text NOT NULL,
  "actor_user_id" text REFERENCES "user"("id") ON DELETE set null,
  "data" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "referral_events_attribution_idx" ON "referral_events" ("attribution_id", "created_at");
--> statement-breakpoint
CREATE INDEX "referral_events_type_idx" ON "referral_events" ("type", "created_at");
--> statement-breakpoint
CREATE TABLE "referral_visits" (
  "identity_id" uuid NOT NULL REFERENCES "referral_identities"("id") ON DELETE cascade,
  "day" date NOT NULL,
  "visits" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "referral_visits_pk" PRIMARY KEY ("identity_id", "day")
);
--> statement-breakpoint
-- The standard campaign. It starts paused: staff switch it on in Admin > Referrals.
INSERT INTO "referral_programs" ("key", "name", "status", "referrer_credits", "referred_credits")
VALUES ('standard', 'Give 1, Get 2', 'paused', 2, 1)
ON CONFLICT ("key") DO NOTHING;
