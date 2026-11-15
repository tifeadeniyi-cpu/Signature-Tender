-- Companies must keep a card on file to add team members. The card is saved through Stripe
-- Checkout in setup mode; we keep only its brand and last four digits for display.
ALTER TABLE "billing_accounts" ADD COLUMN "card_payment_method_id" text;
--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD COLUMN "card_brand" text;
--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD COLUMN "card_last4" text;
--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD COLUMN "card_saved_at" timestamp with time zone;
--> statement-breakpoint
-- Whether the workspace has a card on file (a saved card, or an active subscription, which
-- always has one), with the saved card's display details. For anyone who can see the team or
-- the billing, so the Team page can explain why inviting is blocked.
CREATE OR REPLACE FUNCTION st_workspace_card(ws uuid)
RETURNS TABLE (has_card boolean, brand text, last4 text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COALESCE(b.card_saved_at IS NOT NULL
      OR (b.stripe_subscription_id IS NOT NULL
          AND b.subscription_status IN ('active', 'trialing', 'past_due')), false),
    b.card_brand,
    b.card_last4
  FROM (SELECT 1) one
  LEFT JOIN billing_accounts b ON b.workspace_id = ws
  WHERE st_has_permission(ws, 'team.view') OR st_has_permission(ws, 'team.manage')
    OR st_has_permission(ws, 'billing.manage')
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION st_workspace_card(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION st_workspace_card(uuid) TO st_app;
