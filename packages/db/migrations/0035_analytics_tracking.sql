CREATE TABLE "app_activity_daily" (
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"active_seconds" integer DEFAULT 0 NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_activity_daily_user_id_day_pk" PRIMARY KEY("user_id","day"),
	CONSTRAINT "app_activity_daily_seconds" CHECK ("app_activity_daily"."active_seconds" BETWEEN 0 AND 57600)
);
--> statement-breakpoint
CREATE TABLE "site_visits_daily" (
	"day" date NOT NULL,
	"page" text NOT NULL,
	"source" text NOT NULL,
	"visits" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "site_visits_daily_day_page_source_pk" PRIMARY KEY("day","page","source")
);
--> statement-breakpoint
CREATE TABLE "subscription_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ref" text NOT NULL,
	"plan_code" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_events_kind" CHECK ("subscription_events"."kind" IN ('started', 'renewed', 'renewal_failed', 'cancel_requested', 'cancel_withdrawn', 'ended'))
);
--> statement-breakpoint
CREATE TABLE "user_acquisition" (
	"user_id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_activity_daily" ADD CONSTRAINT "app_activity_daily_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_acquisition" ADD CONSTRAINT "user_acquisition_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_activity_daily_day_idx" ON "app_activity_daily" USING btree ("day");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_events_uq" ON "subscription_events" USING btree ("kind","ref");--> statement-breakpoint
CREATE INDEX "subscription_events_at_idx" ON "subscription_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "user_acquisition_source_idx" ON "user_acquisition" USING btree ("source");--> statement-breakpoint

-- Founder admin, phase 5: privacy-first measurement. No IP addresses, user agents, raw referrers,
-- campaign values, cookies or device identifiers are stored. The app role has no direct access to
-- the visit, acquisition or activity tables: it writes through the validating functions below and
-- staff read aggregates through st_admin_perf_measurement, which withholds small groups.
ALTER TABLE "site_visits_daily" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "site_visits_daily" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "user_acquisition" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "user_acquisition" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "app_activity_daily" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "app_activity_daily" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "site_visits_daily", "user_acquisition", "app_activity_daily" FROM st_app;
--> statement-breakpoint

-- Subscription lifecycle rows are written by the Stripe webhook handler (billing system actor).
GRANT INSERT ON "subscription_events" TO st_app;
--> statement-breakpoint
ALTER TABLE "subscription_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "subscription_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY subscription_events_system ON "subscription_events" FOR INSERT TO st_app
  WITH CHECK (st_is_billing_system());
--> statement-breakpoint

-- Earlier subscription invoices already record starts and renewals; carry them over once.
INSERT INTO subscription_events (workspace_id, kind, ref, occurred_at)
SELECT workspace_id, CASE billing_reason WHEN 'subscription_create' THEN 'started' ELSE 'renewed' END,
  stripe_invoice_id, updated_at
FROM invoices WHERE status = 'paid' AND billing_reason IN ('subscription_create', 'subscription_cycle')
ON CONFLICT (kind, ref) DO NOTHING;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION st_track_source(p_source text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_source IN ('direct', 'search', 'social', 'ai_assistant', 'email', 'campaign', 'referral')
    THEN p_source ELSE 'direct' END
$$;
--> statement-breakpoint

-- One website visit: the page group it started on and where it came from. Counts only.
CREATE OR REPLACE FUNCTION st_track_visit(p_page text, p_source text) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO site_visits_daily (day, page, source, visits)
  VALUES ((now() AT TIME ZONE 'UTC')::date,
    CASE WHEN p_page IN ('home', 'product', 'pricing', 'signature_studio', 'verify', 'legal', 'sign_up', 'sign_in')
      THEN p_page ELSE 'other' END,
    st_track_source(p_source), 1)
  ON CONFLICT (day, page, source) DO UPDATE SET visits = site_visits_daily.visits + 1;
$$;
--> statement-breakpoint

-- Where the signed-in person came from before creating their account. Recorded once, and only
-- for an account created in the last 7 days.
CREATE OR REPLACE FUNCTION st_track_signup_source(p_source text) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO user_acquisition (user_id, source)
  SELECT u.id, st_track_source(p_source) FROM "user" u
  WHERE u.id = st_current_user() AND u.created_at > now() - interval '7 days'
  ON CONFLICT (user_id) DO NOTHING;
$$;
--> statement-breakpoint

-- Adds active seconds for the signed-in person today. A report can't add more time than has
-- passed since the previous one (plus a little slack), so several open tabs or a replayed request
-- can't inflate the total. At most 90 seconds per report and 16 hours per day.
CREATE OR REPLACE FUNCTION st_track_active(p_seconds int) RETURNS int
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid text := st_current_user();
  total int;
BEGIN
  IF uid IS NULL OR p_seconds IS NULL OR p_seconds <= 0 THEN RETURN 0; END IF;
  INSERT INTO app_activity_daily AS a (user_id, day, active_seconds, last_at)
  VALUES (uid, (now() AT TIME ZONE 'UTC')::date, least(p_seconds, 90), now())
  ON CONFLICT (user_id, day) DO UPDATE SET
    active_seconds = least(57600, a.active_seconds + least(least(p_seconds, 90),
      greatest(0, ceil(extract(epoch FROM now() - a.last_at))::int + 5))),
    last_at = now()
  RETURNING active_seconds INTO total;
  RETURN total;
END $$;
--> statement-breakpoint

-- Removes per-person activity older than 13 months. Visit counts hold no personal data.
CREATE OR REPLACE FUNCTION st_track_prune() RETURNS int
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  DELETE FROM app_activity_daily WHERE day < (now() AT TIME ZONE 'UTC')::date - interval '13 months';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
--> statement-breakpoint

-- Staff report: visits, sign-up sources, time in the app and subscription renewals.
CREATE OR REPLACE FUNCTION st_admin_perf_measurement(
  p_from timestamptz, p_to timestamptz, p_cmp_from timestamptz, p_cmp_to timestamptz, p_bucket text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  has_cmp boolean := p_cmp_from IS NOT NULL AND p_cmp_to IS NOT NULL;
  k int := st_admin_min_group();
  d_from date := (p_from AT TIME ZONE 'UTC')::date;
  d_to date := (p_to AT TIME ZONE 'UTC')::date;
  c_from date := (p_cmp_from AT TIME ZONE 'UTC')::date;
  c_to date := (p_cmp_to AT TIME ZONE 'UTC')::date;
  visits_since date := (SELECT min(day) FROM site_visits_daily);
  source_since timestamptz := (SELECT min(recorded_at) FROM user_acquisition);
  time_since date := (SELECT min(day) FROM app_activity_daily);
  sub_since timestamptz := (SELECT min(occurred_at) FROM subscription_events);
  conv_from timestamptz := greatest(p_from, coalesce(visits_since::timestamptz, p_to));
  t_users int;
  out jsonb;
BEGIN
  PERFORM st_admin_require_perm('analytics.view', 'performance_measurement');
  SELECT count(DISTINCT user_id) INTO t_users FROM app_activity_daily WHERE day >= d_from AND day < d_to;

  WITH
  signups AS (
    SELECT coalesce(a.source, 'not_recorded') AS source FROM "user" u
    LEFT JOIN user_acquisition a ON a.user_id = u.id
    WHERE u.created_at >= p_from AND u.created_at < p_to
  ),
  signup_groups AS (
    SELECT CASE WHEN source = 'not_recorded' OR count(*) >= k THEN source ELSE 'other' END AS source, count(*) AS n
    FROM signups GROUP BY source
  ),
  per_user AS (
    SELECT user_id, sum(active_seconds) AS secs, count(*) AS days FROM app_activity_daily
    WHERE day >= d_from AND day < d_to GROUP BY user_id
  ),
  renewal_invoices AS (
    SELECT ref, min(occurred_at) AS first_at, bool_or(kind = 'renewed') AS renewed,
      bool_or(kind = 'renewal_failed') AS failed
    FROM subscription_events WHERE kind IN ('renewed', 'renewal_failed') GROUP BY ref
  )
  SELECT jsonb_build_object(
    'visits', jsonb_build_object(
      'since', visits_since,
      'total', (SELECT coalesce(sum(visits), 0) FROM site_visits_daily WHERE day >= d_from AND day < d_to),
      'total_cmp', CASE WHEN has_cmp AND visits_since IS NOT NULL AND visits_since <= c_from THEN
        (SELECT coalesce(sum(visits), 0) FROM site_visits_daily WHERE day >= c_from AND day < c_to) END,
      'series', (SELECT coalesce(jsonb_agg(jsonb_build_object('start', b.start, 'visits',
          (SELECT coalesce(sum(v.visits), 0) FROM site_visits_daily v
           WHERE v.day >= (b.start AT TIME ZONE 'UTC')::date AND v.day < (b.stop AT TIME ZONE 'UTC')::date))
        ORDER BY b.start), '[]') FROM st_admin_buckets(p_from, p_to, p_bucket) b),
      'by_source', (SELECT coalesce(jsonb_agg(jsonb_build_object('source', source, 'visits', n) ORDER BY n DESC), '[]')
        FROM (SELECT source, sum(visits) AS n FROM site_visits_daily WHERE day >= d_from AND day < d_to GROUP BY source) s),
      'by_page', (SELECT coalesce(jsonb_agg(jsonb_build_object('page', page, 'visits', n) ORDER BY n DESC), '[]')
        FROM (SELECT page, sum(visits) AS n FROM site_visits_daily WHERE day >= d_from AND day < d_to GROUP BY page) s),
      'conv_visits', (SELECT coalesce(sum(visits), 0) FROM site_visits_daily
        WHERE day >= (conv_from AT TIME ZONE 'UTC')::date AND day < d_to),
      'conv_users', (SELECT count(*) FROM "user" WHERE created_at >= conv_from AND created_at < p_to)
    ),
    'signups', jsonb_build_object(
      'since', source_since,
      'users_new', (SELECT count(*) FROM signups),
      'recorded', (SELECT count(*) FROM signups WHERE source <> 'not_recorded'),
      'by_source', (SELECT coalesce(jsonb_agg(jsonb_build_object('source', source, 'users', n) ORDER BY n DESC), '[]')
        FROM (SELECT source, sum(n) AS n FROM signup_groups GROUP BY source) g)
    ),
    'time', CASE WHEN t_users < k THEN jsonb_build_object('since', time_since, 'suppressed', true, 'users', NULL)
    ELSE jsonb_build_object(
      'since', time_since,
      'suppressed', false,
      'users', t_users,
      'seconds', (SELECT coalesce(sum(secs), 0) FROM per_user),
      'user_days', (SELECT coalesce(sum(days), 0) FROM per_user),
      'median_seconds', (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY secs) FROM per_user),
      'users_cmp', CASE WHEN has_cmp THEN (SELECT count(DISTINCT user_id) FROM app_activity_daily WHERE day >= c_from AND day < c_to) END,
      'seconds_cmp', CASE WHEN has_cmp THEN (SELECT coalesce(sum(active_seconds), 0) FROM app_activity_daily WHERE day >= c_from AND day < c_to) END,
      'user_days_cmp', CASE WHEN has_cmp THEN (SELECT count(*) FROM app_activity_daily WHERE day >= c_from AND day < c_to) END,
      'bands', jsonb_build_object(
        'under_5m', (SELECT count(*) FROM per_user WHERE secs < 300),
        'm5_30', (SELECT count(*) FROM per_user WHERE secs >= 300 AND secs < 1800),
        'm30_2h', (SELECT count(*) FROM per_user WHERE secs >= 1800 AND secs < 7200),
        'over_2h', (SELECT count(*) FROM per_user WHERE secs >= 7200)
      ),
      'series', (SELECT coalesce(jsonb_agg(x ORDER BY x->>'start'), '[]') FROM (
        SELECT jsonb_build_object('start', b.start,
          'users', CASE WHEN count(DISTINCT a.user_id) >= k THEN count(DISTINCT a.user_id) END,
          'seconds', CASE WHEN count(DISTINCT a.user_id) >= k THEN coalesce(sum(a.active_seconds), 0) END,
          'user_days', CASE WHEN count(DISTINCT a.user_id) >= k THEN count(a.user_id) END) AS x
        FROM st_admin_buckets(p_from, p_to, p_bucket) b
        LEFT JOIN app_activity_daily a ON a.day >= (b.start AT TIME ZONE 'UTC')::date AND a.day < (b.stop AT TIME ZONE 'UTC')::date
        GROUP BY b.start
      ) s)
    ) END,
    'renewals', jsonb_build_object(
      'since', sub_since,
      'due', (SELECT count(*) FROM renewal_invoices WHERE first_at >= p_from AND first_at < p_to),
      'renewed', (SELECT count(*) FROM renewal_invoices WHERE first_at >= p_from AND first_at < p_to AND renewed),
      'failed', (SELECT count(*) FROM renewal_invoices WHERE first_at >= p_from AND first_at < p_to AND failed),
      'recovered', (SELECT count(*) FROM renewal_invoices WHERE first_at >= p_from AND first_at < p_to AND failed AND renewed),
      'due_cmp', CASE WHEN has_cmp THEN (SELECT count(*) FROM renewal_invoices WHERE first_at >= p_cmp_from AND first_at < p_cmp_to) END,
      'renewed_cmp', CASE WHEN has_cmp THEN (SELECT count(*) FROM renewal_invoices WHERE first_at >= p_cmp_from AND first_at < p_cmp_to AND renewed) END,
      'started', (SELECT count(*) FROM subscription_events WHERE kind = 'started' AND occurred_at >= p_from AND occurred_at < p_to),
      'cancel_requested', (SELECT count(*) FROM subscription_events WHERE kind = 'cancel_requested' AND occurred_at >= p_from AND occurred_at < p_to),
      'cancel_withdrawn', (SELECT count(*) FROM subscription_events WHERE kind = 'cancel_withdrawn' AND occurred_at >= p_from AND occurred_at < p_to),
      'ended', (SELECT count(*) FROM subscription_events WHERE kind = 'ended' AND occurred_at >= p_from AND occurred_at < p_to),
      'series', (SELECT coalesce(jsonb_agg(jsonb_build_object('start', b.start,
          'renewed', (SELECT count(*) FROM renewal_invoices r WHERE r.first_at >= b.start AND r.first_at < b.stop AND r.renewed),
          'failed', (SELECT count(*) FROM renewal_invoices r WHERE r.first_at >= b.start AND r.first_at < b.stop AND r.failed AND NOT r.renewed),
          'started', (SELECT count(*) FROM subscription_events e WHERE e.kind = 'started' AND e.occurred_at >= b.start AND e.occurred_at < b.stop),
          'ended', (SELECT count(*) FROM subscription_events e WHERE e.kind = 'ended' AND e.occurred_at >= b.start AND e.occurred_at < b.stop))
        ORDER BY b.start), '[]') FROM st_admin_buckets(p_from, p_to, p_bucket) b)
    ),
    'generated_at', now()
  ) INTO out;
  RETURN out;
END $$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION st_track_visit(text, text), st_track_signup_source(text), st_track_active(int),
  st_track_prune(), st_admin_perf_measurement(timestamptz, timestamptz, timestamptz, timestamptz, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION st_track_visit(text, text), st_track_signup_source(text), st_track_active(int),
  st_track_prune(), st_admin_perf_measurement(timestamptz, timestamptz, timestamptz, timestamptz, text) TO st_app;
