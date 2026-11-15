-- Founder admin, phase 4: Platform Performance. One function per tab (Growth, Engagement, Feature
-- Usage, Conversion & Retention, Delivery & Operations); the Overview tab reuses the Command Center.
-- Aggregates and opaque references only: no document titles, files, recipients, signature
-- artwork, error text or customer contact details. Groups smaller than st_admin_min_group() are
-- merged or withheld so a breakdown cannot single out one customer.

-- The feature registry: which recorded actions count as using which feature. Opening a page is
-- never a use; these are actions that change something.
CREATE OR REPLACE FUNCTION st_admin_feature(p_action text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_action IN ('document.uploaded', 'document.created_from_template') THEN 'create'
    WHEN p_action = 'document.sent' THEN 'send'
    WHEN p_action LIKE 'template.%' THEN 'templates'
    WHEN p_action LIKE 'team.%' THEN 'team'
    WHEN p_action LIKE 'contact.%' THEN 'contacts'
    WHEN p_action LIKE 'integration.%' OR p_action LIKE 'connection.%' THEN 'integrations'
    WHEN p_action LIKE 'api.%' OR p_action LIKE 'webhook.%' THEN 'api'
    WHEN p_action LIKE 'studio.%' THEN 'studio'
    ELSE NULL
  END
$$;
--> statement-breakpoint

-- Signed-in activity: a sign-in, a recorded action in a workspace, or a Signature Studio design.
-- Internal helper for the functions below; not callable by the app.
CREATE OR REPLACE FUNCTION st_admin_activity(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (uid text, at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.user_id, s.created_at FROM session s WHERE s.created_at >= p_from AND s.created_at < p_to
  UNION ALL
  SELECT a.actor_user_id, a.occurred_at FROM audit_events a
  WHERE a.workspace_id IS NOT NULL AND a.actor_user_id IS NOT NULL
    AND a.occurred_at >= p_from AND a.occurred_at < p_to
  UNION ALL
  SELECT d.owner_user_id, d.created_at FROM signature_designs d
  WHERE d.owner_user_id IS NOT NULL AND d.created_at >= p_from AND d.created_at < p_to
$$;
--> statement-breakpoint

-- Feature use events (user, feature, time) in a window.
CREATE OR REPLACE FUNCTION st_admin_feature_use(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (uid text, feature text, at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.actor_user_id, st_admin_feature(a.action), a.occurred_at FROM audit_events a
  WHERE a.workspace_id IS NOT NULL AND a.actor_user_id IS NOT NULL
    AND a.occurred_at >= p_from AND a.occurred_at < p_to AND st_admin_feature(a.action) IS NOT NULL
  UNION ALL
  SELECT d.owner_user_id, 'studio', d.created_at FROM signature_designs d
  WHERE d.owner_user_id IS NOT NULL AND d.created_at >= p_from AND d.created_at < p_to
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION st_admin_buckets(p_from timestamptz, p_to timestamptz, p_bucket text)
RETURNS TABLE (start timestamptz, stop timestamptz)
LANGUAGE sql IMMUTABLE AS $$
  SELECT greatest(gs, p_from), least(gs + ('1 ' || b)::interval, p_to)
  FROM (SELECT CASE WHEN p_bucket IN ('day', 'week', 'month') THEN p_bucket ELSE 'month' END AS b) x,
       generate_series(date_trunc(x.b, p_from), p_to - interval '1 microsecond', ('1 ' || x.b)::interval) gs
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- Growth
CREATE OR REPLACE FUNCTION st_admin_perf_growth(
  p_from timestamptz, p_to timestamptz, p_cmp_from timestamptz, p_cmp_to timestamptz, p_bucket text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  has_cmp boolean := p_cmp_from IS NOT NULL AND p_cmp_to IS NOT NULL;
  k int := st_admin_min_group();
  out jsonb;
BEGIN
  PERFORM st_admin_require_perm('analytics.view', 'performance_growth');
  WITH
  first_sent AS (
    SELECT sent_by AS uid, min(sent_at) AS at FROM signing_requests
    WHERE NOT is_test AND sent_at IS NOT NULL AND sent_by IS NOT NULL GROUP BY sent_by
  ),
  first_paid AS (
    SELECT workspace_id, min(coalesce(paid_at, created_at)) AS at FROM payments
    WHERE status IN ('paid', 'partially_refunded', 'refunded', 'disputed') GROUP BY workspace_id
  ),
  active_orgs AS (
    SELECT DISTINCT workspace_id, (sent_at >= p_from) AS cur FROM signing_requests
    WHERE NOT is_test AND ((sent_at >= p_from AND sent_at < p_to)
      OR (has_cmp AND sent_at >= p_cmp_from AND sent_at < p_cmp_to))
  ),
  plans AS (
    SELECT w.id, w.created_at, coalesce(ba.plan_code, 'payg') AS plan
    FROM workspaces w LEFT JOIN billing_accounts ba ON ba.workspace_id = w.id
    WHERE w.created_at < p_to
  ),
  plan_groups AS (
    SELECT plan, CASE WHEN count(*) FILTER (WHERE created_at >= p_from) >= k THEN plan ELSE 'other' END AS label
    FROM plans GROUP BY plan
  )
  SELECT jsonb_build_object(
    'kpi', jsonb_build_object(
      'users_total', (SELECT count(*) FROM "user" WHERE created_at < p_to),
      'users_start', (SELECT count(*) FROM "user" WHERE created_at < p_from),
      'users_new', (SELECT count(*) FROM "user" WHERE created_at >= p_from AND created_at < p_to),
      'users_new_cmp', CASE WHEN has_cmp THEN (SELECT count(*) FROM "user" WHERE created_at >= p_cmp_from AND created_at < p_cmp_to) END,
      'users_start_cmp', CASE WHEN has_cmp THEN (SELECT count(*) FROM "user" WHERE created_at < p_cmp_from) END,
      'orgs_total', (SELECT count(*) FROM workspaces WHERE created_at < p_to),
      'orgs_start', (SELECT count(*) FROM workspaces WHERE created_at < p_from),
      'orgs_new', (SELECT count(*) FROM workspaces WHERE created_at >= p_from AND created_at < p_to),
      'orgs_new_cmp', CASE WHEN has_cmp THEN (SELECT count(*) FROM workspaces WHERE created_at >= p_cmp_from AND created_at < p_cmp_to) END,
      'orgs_start_cmp', CASE WHEN has_cmp THEN (SELECT count(*) FROM workspaces WHERE created_at < p_cmp_from) END,
      'orgs_active', (SELECT count(*) FROM active_orgs WHERE cur),
      'orgs_active_cmp', CASE WHEN has_cmp THEN (SELECT count(*) FROM active_orgs WHERE NOT cur) END,
      'orgs_paid', (SELECT count(*) FROM first_paid WHERE at < p_to),
      'orgs_paid_cmp', CASE WHEN has_cmp THEN (SELECT count(*) FROM first_paid WHERE at < p_cmp_to) END,
      'orgs_total_cmp', CASE WHEN has_cmp THEN (SELECT count(*) FROM workspaces WHERE created_at < p_cmp_to) END
    ),
    'series', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'start', bk.start,
        'users_new', (SELECT count(*) FROM "user" u WHERE u.created_at >= bk.start AND u.created_at < bk.stop),
        'orgs_new', (SELECT count(*) FROM workspaces w WHERE w.created_at >= bk.start AND w.created_at < bk.stop),
        'users_total', (SELECT count(*) FROM "user" u WHERE u.created_at < bk.stop),
        'orgs_total', (SELECT count(*) FROM workspaces w WHERE w.created_at < bk.stop),
        'users_start', (SELECT count(*) FROM "user" u WHERE u.created_at < bk.start),
        'activated', (SELECT count(*) FROM first_sent f WHERE f.at >= bk.start AND f.at < bk.stop),
        'paying', (SELECT count(*) FROM first_paid f WHERE f.at >= bk.start AND f.at < bk.stop)
      ) ORDER BY bk.start), '[]'::jsonb) FROM st_admin_buckets(p_from, p_to, p_bucket) bk
    ),
    -- New organizations per interval by their current plan; plans with fewer than k new
    -- organizations in the period are merged into "other".
    'by_plan', (
      SELECT jsonb_build_object(
        'plans', (SELECT coalesce(jsonb_agg(DISTINCT label), '[]'::jsonb) FROM plan_groups),
        'rows', (
          SELECT coalesce(jsonb_agg(jsonb_build_object('start', bk.start, 'plan', g.label, 'orgs', g.n) ORDER BY bk.start, g.label), '[]'::jsonb)
          FROM st_admin_buckets(p_from, p_to, p_bucket) bk
          CROSS JOIN LATERAL (
            SELECT pg.label, count(*) AS n FROM plans pl JOIN plan_groups pg ON pg.plan = pl.plan
            WHERE pl.created_at >= bk.start AND pl.created_at < bk.stop GROUP BY pg.label
          ) g
        )
      )
    ),
    'generated_at', now()
  ) INTO out;
  RETURN out;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- Engagement
CREATE OR REPLACE FUNCTION st_admin_perf_engagement(
  p_from timestamptz, p_to timestamptz, p_cmp_from timestamptz, p_cmp_to timestamptz, p_bucket text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  has_cmp boolean := p_cmp_from IS NOT NULL AND p_cmp_to IS NOT NULL;
  days numeric := greatest(extract(epoch FROM (p_to - p_from)) / 86400, 1);
  k int := st_admin_min_group();
  out jsonb;
BEGIN
  PERFORM st_admin_require_perm('analytics.view', 'performance_engagement');
  WITH
  act AS (
    SELECT uid, at, date_trunc('day', at) AS day
    FROM st_admin_activity(least(p_from, p_to - interval '30 days', coalesce(p_cmp_from, p_from)), p_to)
  ),
  cur AS (SELECT * FROM act WHERE at >= p_from),
  prev AS (SELECT DISTINCT uid FROM act WHERE has_cmp AND at >= p_cmp_from AND at < p_cmp_to),
  per_user AS (SELECT uid, count(DISTINCT day) AS d FROM cur GROUP BY uid),
  org_act AS (
    SELECT DISTINCT a.workspace_id, (a.occurred_at >= p_from) AS is_cur FROM audit_events a
    WHERE a.workspace_id IS NOT NULL AND a.actor_user_id IS NOT NULL
      AND ((a.occurred_at >= p_from AND a.occurred_at < p_to)
        OR (has_cmp AND a.occurred_at >= p_cmp_from AND a.occurred_at < p_cmp_to))
  ),
  org_plans AS (
    SELECT o.workspace_id, coalesce(ba.plan_code, 'payg') AS plan FROM org_act o
    LEFT JOIN billing_accounts ba ON ba.workspace_id = o.workspace_id WHERE o.is_cur
  ),
  freq AS (
    SELECT CASE
      WHEN d * 7 / days >= 5 THEN 'daily'
      WHEN d * 7 / days >= 2 THEN 'several_weekly'
      WHEN d * 7 / days >= 1 THEN 'weekly'
      ELSE 'occasional' END AS seg
    FROM per_user
  )
  SELECT jsonb_build_object(
    'kpi', jsonb_build_object(
      'active_users', (SELECT count(*) FROM per_user),
      'active_users_cmp', CASE WHEN has_cmp THEN (SELECT count(*) FROM prev) END,
      'dau_avg', (SELECT round(count(DISTINCT (uid, day))::numeric / days, 1) FROM cur),
      'wau', (SELECT count(DISTINCT uid) FROM act WHERE at >= p_to - interval '7 days'),
      'mau', (SELECT count(DISTINCT uid) FROM act WHERE at >= p_to - interval '30 days'),
      'active_days', (SELECT coalesce(sum(d), 0) FROM per_user),
      'signins', (SELECT count(*) FROM session WHERE created_at >= p_from AND created_at < p_to),
      'returning', CASE WHEN has_cmp THEN (SELECT count(*) FROM per_user pu JOIN prev USING (uid)) END,
      'registered', (SELECT count(*) FROM "user" WHERE created_at < p_to),
      'orgs_active', (SELECT count(*) FROM org_act WHERE is_cur),
      'orgs_active_cmp', CASE WHEN has_cmp THEN (SELECT count(*) FROM org_act WHERE NOT is_cur) END,
      'feature_users', (SELECT count(DISTINCT uid) FROM st_admin_feature_use(p_from, p_to)),
      'period_days', round(days, 2)
    ),
    'series', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'start', bk.start,
        'active_users', (SELECT count(DISTINCT uid) FROM cur WHERE at >= bk.start AND at < bk.stop),
        'signins', (SELECT count(*) FROM session s WHERE s.created_at >= bk.start AND s.created_at < bk.stop),
        'orgs_active', (SELECT count(DISTINCT a.workspace_id) FROM audit_events a
          WHERE a.workspace_id IS NOT NULL AND a.actor_user_id IS NOT NULL AND a.occurred_at >= bk.start AND a.occurred_at < bk.stop)
      ) ORDER BY bk.start), '[]'::jsonb) FROM st_admin_buckets(p_from, p_to, p_bucket) bk
    ),
    'frequency', jsonb_build_object(
      'daily', (SELECT count(*) FROM freq WHERE seg = 'daily'),
      'several_weekly', (SELECT count(*) FROM freq WHERE seg = 'several_weekly'),
      'weekly', (SELECT count(*) FROM freq WHERE seg = 'weekly'),
      'occasional', (SELECT count(*) FROM freq WHERE seg = 'occasional'),
      'inactive', (SELECT count(*) FROM "user" u WHERE u.created_at < p_to
                   AND NOT EXISTS (SELECT 1 FROM per_user pu WHERE pu.uid = u.id))
    ),
    'by_plan', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('plan', g.plan, 'orgs', g.n) ORDER BY g.n DESC, g.plan), '[]'::jsonb)
      FROM (
        SELECT CASE WHEN n >= k THEN plan ELSE 'other' END AS plan, sum(n)::bigint AS n
        FROM (SELECT plan, count(*) AS n FROM org_plans GROUP BY plan) x GROUP BY 1
      ) g
    ),
    'generated_at', now()
  ) INTO out;
  RETURN out;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- Feature usage
CREATE OR REPLACE FUNCTION st_admin_perf_features(
  p_from timestamptz, p_to timestamptz, p_cmp_from timestamptz, p_cmp_to timestamptz, p_bucket text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  has_cmp boolean := p_cmp_from IS NOT NULL AND p_cmp_to IS NOT NULL;
  out jsonb;
BEGIN
  PERFORM st_admin_require_perm('analytics.view', 'performance_features');
  WITH
  cur AS (SELECT * FROM st_admin_feature_use(p_from, p_to)),
  prev AS (SELECT * FROM st_admin_feature_use(p_cmp_from, p_cmp_to) WHERE has_cmp),
  earlier AS (SELECT DISTINCT uid, feature FROM st_admin_feature_use('-infinity', p_from)),
  eligible AS (SELECT DISTINCT uid FROM st_admin_activity(p_from, p_to)),
  eligible_cmp AS (SELECT DISTINCT uid FROM st_admin_activity(p_cmp_from, p_cmp_to) WHERE has_cmp),
  registry(feature) AS (VALUES ('create'), ('send'), ('templates'), ('studio'), ('team'), ('contacts'), ('integrations'), ('api'))
  SELECT jsonb_build_object(
    'eligible', (SELECT count(*) FROM eligible),
    'eligible_cmp', CASE WHEN has_cmp THEN (SELECT count(*) FROM eligible_cmp) END,
    'events', (SELECT count(*) FROM cur),
    'events_cmp', CASE WHEN has_cmp THEN (SELECT count(*) FROM prev) END,
    'feature_users', (SELECT count(DISTINCT uid) FROM cur),
    'feature_users_cmp', CASE WHEN has_cmp THEN (SELECT count(DISTINCT uid) FROM prev) END,
    'user_features', (SELECT count(*) FROM (SELECT DISTINCT uid, feature FROM cur) x),
    'rows', (
      SELECT jsonb_agg(jsonb_build_object(
        'feature', r.feature,
        'users', (SELECT count(DISTINCT uid) FROM cur WHERE cur.feature = r.feature),
        'events', (SELECT count(*) FROM cur WHERE cur.feature = r.feature),
        'users_cmp', CASE WHEN has_cmp THEN (SELECT count(DISTINCT uid) FROM prev WHERE prev.feature = r.feature) END,
        'events_cmp', CASE WHEN has_cmp THEN (SELECT count(*) FROM prev WHERE prev.feature = r.feature) END,
        'returning_users', (SELECT count(DISTINCT c.uid) FROM cur c JOIN earlier e ON e.uid = c.uid AND e.feature = c.feature
                            WHERE c.feature = r.feature)
      ) ORDER BY r.feature) FROM registry r
    ),
    'series', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('start', bk.start, 'feature', g.feature, 'users', g.n) ORDER BY bk.start, g.feature), '[]'::jsonb)
      FROM st_admin_buckets(p_from, p_to, p_bucket) bk
      LEFT JOIN LATERAL (SELECT feature, count(DISTINCT uid) AS n FROM cur
                         WHERE at >= bk.start AND at < bk.stop GROUP BY feature) g ON true
    ),
    'generated_at', now()
  ) INTO out;
  RETURN out;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- Conversion & retention
CREATE OR REPLACE FUNCTION st_admin_perf_conversion(
  p_from timestamptz, p_to timestamptz, p_cmp_from timestamptz, p_cmp_to timestamptz, p_bucket text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  has_cmp boolean := p_cmp_from IS NOT NULL AND p_cmp_to IS NOT NULL;
  k int := st_admin_min_group();
  out jsonb;
BEGIN
  PERFORM st_admin_require_perm('analytics.view', 'performance_conversion');
  WITH
  cohort AS (SELECT id, created_at FROM "user" WHERE created_at >= p_from AND created_at < p_to),
  cohort_cmp AS (SELECT id, created_at FROM "user" WHERE has_cmp AND created_at >= p_cmp_from AND created_at < p_cmp_to),
  sends AS (SELECT sent_by AS uid, count(*) AS n FROM signing_requests
            WHERE NOT is_test AND sent_at IS NOT NULL AND sent_by IS NOT NULL GROUP BY sent_by),
  act AS (SELECT uid, at FROM st_admin_activity(p_from, now())),
  studio AS (
    SELECT coalesce(session_hash, user_id) AS sid, event FROM signature_studio_events
    WHERE coalesce(session_hash, user_id) IN (
      SELECT coalesce(session_hash, user_id) FROM signature_studio_events
      WHERE event = 'design_started' AND created_at >= p_from AND created_at < p_to)
  ),
  orgs AS (SELECT id FROM workspaces WHERE created_at >= p_from AND created_at < p_to),
  org_paid AS (
    SELECT workspace_id, count(*) AS n FROM payments
    WHERE status IN ('paid', 'partially_refunded', 'refunded', 'disputed') GROUP BY workspace_id
  ),
  org_live AS (SELECT DISTINCT workspace_id FROM signing_requests WHERE NOT is_test AND sent_at IS NOT NULL),
  org_cur AS (SELECT DISTINCT workspace_id FROM audit_events WHERE workspace_id IS NOT NULL AND actor_user_id IS NOT NULL
              AND occurred_at >= p_from AND occurred_at < p_to),
  org_prev AS (SELECT DISTINCT workspace_id FROM audit_events WHERE has_cmp AND workspace_id IS NOT NULL AND actor_user_id IS NOT NULL
              AND occurred_at >= p_cmp_from AND occurred_at < p_cmp_to),
  org_before AS (SELECT DISTINCT workspace_id FROM audit_events WHERE has_cmp AND workspace_id IS NOT NULL AND actor_user_id IS NOT NULL
              AND occurred_at < p_cmp_from),
  months AS (
    SELECT gs AS m FROM generate_series(date_trunc('month', p_to - interval '1 microsecond') - interval '5 months',
      date_trunc('month', p_to - interval '1 microsecond'), interval '1 month') gs
  ),
  all_act AS (SELECT uid, date_trunc('month', at) AS m FROM st_admin_activity(
    date_trunc('month', p_to - interval '1 microsecond') - interval '5 months', now()) GROUP BY 1, 2)
  SELECT jsonb_build_object(
    'funnel', jsonb_build_object(
      'registered', (SELECT count(*) FROM cohort),
      'workspace', (SELECT count(*) FROM cohort c WHERE EXISTS (SELECT 1 FROM workspace_memberships m WHERE m.user_id = c.id AND m.status = 'active')),
      'document_created', (SELECT count(*) FROM cohort c WHERE EXISTS (SELECT 1 FROM documents d WHERE d.created_by = c.id)),
      'document_sent', (SELECT count(*) FROM cohort c JOIN sends s ON s.uid = c.id),
      'repeat', (SELECT count(*) FROM cohort c JOIN sends s ON s.uid = c.id WHERE s.n >= 2),
      'registered_cmp', CASE WHEN has_cmp THEN (SELECT count(*) FROM cohort_cmp) END,
      'document_sent_cmp', CASE WHEN has_cmp THEN (SELECT count(*) FROM cohort_cmp c JOIN sends s ON s.uid = c.id) END
    ),
    'studio_funnel', jsonb_build_object(
      'visited', (SELECT count(DISTINCT coalesce(session_hash, user_id)) FROM signature_studio_events
                  WHERE event = 'studio_visited' AND created_at >= p_from AND created_at < p_to),
      'started', (SELECT count(DISTINCT sid) FROM studio WHERE event = 'design_started'),
      'customized', (SELECT count(DISTINCT sid) FROM studio WHERE event IN ('font_selected', 'smart_stroke_used', 'custom_stroke_added', 'variation_generated')),
      'auth', (SELECT count(DISTINCT sid) FROM studio WHERE event IN ('auth_started', 'registration_completed')),
      'checkout', (SELECT count(DISTINCT sid) FROM studio WHERE event = 'checkout_started'),
      'paid', (SELECT count(DISTINCT sid) FROM studio WHERE event = 'purchase_completed'),
      'downloaded', (SELECT count(DISTINCT sid) FROM studio WHERE event = 'asset_downloaded')
    ),
    'paid_funnel', jsonb_build_object(
      'orgs', (SELECT count(*) FROM orgs),
      'used', (SELECT count(*) FROM orgs o JOIN org_live l ON l.workspace_id = o.id),
      'paid', (SELECT count(*) FROM orgs o JOIN org_paid p ON p.workspace_id = o.id),
      'repeat', (SELECT count(*) FROM orgs o JOIN org_paid p ON p.workspace_id = o.id WHERE p.n >= 2)
    ),
    -- Day-N retention: of the people who registered in the period and have passed the whole
    -- window, the share active in it. D1 = 24-48h after sign-up, D7 = days 7-13, D30 = days 30-59.
    'retention', (
      SELECT jsonb_build_object(
        'd1_eligible', count(*) FILTER (WHERE c.created_at + interval '2 days' <= now()),
        'd1', count(*) FILTER (WHERE c.created_at + interval '2 days' <= now() AND EXISTS (
          SELECT 1 FROM act a WHERE a.uid = c.id AND a.at >= c.created_at + interval '1 day' AND a.at < c.created_at + interval '2 days')),
        'd7_eligible', count(*) FILTER (WHERE c.created_at + interval '14 days' <= now()),
        'd7', count(*) FILTER (WHERE c.created_at + interval '14 days' <= now() AND EXISTS (
          SELECT 1 FROM act a WHERE a.uid = c.id AND a.at >= c.created_at + interval '7 days' AND a.at < c.created_at + interval '14 days')),
        'd30_eligible', count(*) FILTER (WHERE c.created_at + interval '60 days' <= now()),
        'd30', count(*) FILTER (WHERE c.created_at + interval '60 days' <= now() AND EXISTS (
          SELECT 1 FROM act a WHERE a.uid = c.id AND a.at >= c.created_at + interval '30 days' AND a.at < c.created_at + interval '60 days'))
      ) FROM cohort c
    ),
    -- Monthly cohorts (last six months up to the period end): the share of each sign-up month
    -- active in each later month. Cohorts smaller than k are withheld.
    'cohorts', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('month', mo.m, 'size', sz.n, 'suppressed', sz.n < k,
        'retained', CASE WHEN sz.n < k THEN NULL ELSE (
          SELECT jsonb_agg(CASE WHEN mo.m + (i || ' months')::interval > now() THEN NULL ELSE (
            SELECT count(DISTINCT u.id) FROM "user" u JOIN all_act a ON a.uid = u.id
            WHERE u.created_at >= mo.m AND u.created_at < mo.m + interval '1 month'
              AND a.m = mo.m + (i || ' months')::interval) END ORDER BY i)
          FROM generate_series(0, 5) i) END) ORDER BY mo.m), '[]'::jsonb)
      FROM months mo CROSS JOIN LATERAL (
        SELECT count(*) AS n FROM "user" u WHERE u.created_at >= mo.m AND u.created_at < mo.m + interval '1 month') sz
    ),
    'orgs', jsonb_build_object(
      'active', (SELECT count(*) FROM org_cur),
      'active_cmp', CASE WHEN has_cmp THEN (SELECT count(*) FROM org_prev) END,
      'retained', CASE WHEN has_cmp THEN (SELECT count(*) FROM org_prev JOIN org_cur USING (workspace_id)) END,
      'recovered', CASE WHEN has_cmp THEN (SELECT count(*) FROM org_cur c
        WHERE NOT EXISTS (SELECT 1 FROM org_prev p WHERE p.workspace_id = c.workspace_id)
          AND EXISTS (SELECT 1 FROM org_before b WHERE b.workspace_id = c.workspace_id)) END
    ),
    -- Subscriptions are a snapshot now: the billing account keeps current state, not history.
    'subscriptions', jsonb_build_object(
      'active', (SELECT count(*) FROM billing_accounts WHERE subscription_status IN ('active', 'trialing', 'past_due')),
      'cancelling', (SELECT count(*) FROM billing_accounts WHERE subscription_status IN ('active', 'trialing', 'past_due') AND cancel_at_period_end),
      'ended', (SELECT count(*) FROM billing_accounts WHERE subscription_status IN ('canceled', 'incomplete_expired', 'unpaid'))
    ),
    'generated_at', now()
  ) INTO out;
  RETURN out;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- Delivery & operations. The failure list (sanitized: service, category, status, attempts, and an
-- opaque reference; never error text) is returned only to roles with system.view.
CREATE OR REPLACE FUNCTION st_admin_perf_delivery(
  p_from timestamptz, p_to timestamptz, p_cmp_from timestamptz, p_cmp_to timestamptz, p_bucket text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  has_cmp boolean := p_cmp_from IS NOT NULL AND p_cmp_to IS NOT NULL;
  can_system boolean;
  out jsonb;
BEGIN
  PERFORM st_admin_require_perm('analytics.view', 'performance_delivery');
  can_system := st_admin_has('system.view');
  WITH
  live AS (SELECT * FROM signing_requests WHERE NOT is_test),
  sent AS (SELECT * FROM live WHERE sent_at >= p_from AND sent_at < p_to),
  done AS (SELECT * FROM live WHERE completed_at >= p_from AND completed_at < p_to AND sent_at IS NOT NULL),
  failed AS (SELECT * FROM live WHERE status = 'finalization_failed' AND updated_at >= p_from AND updated_at < p_to),
  views AS (
    SELECT rr.* FROM request_recipients rr JOIN live r ON r.id = rr.request_id
    WHERE rr.viewed_at >= p_from AND rr.viewed_at < p_to
  )
  SELECT jsonb_build_object(
    'kpi', jsonb_build_object(
      'created', (SELECT count(*) FROM documents WHERE created_at >= p_from AND created_at < p_to),
      'created_cmp', CASE WHEN has_cmp THEN (SELECT count(*) FROM documents WHERE created_at >= p_cmp_from AND created_at < p_cmp_to) END,
      'sent', (SELECT count(*) FROM sent),
      'sent_cmp', CASE WHEN has_cmp THEN (SELECT count(*) FROM live WHERE sent_at >= p_cmp_from AND sent_at < p_cmp_to) END,
      'completed', (SELECT count(*) FROM done),
      'completed_cmp', CASE WHEN has_cmp THEN (SELECT count(*) FROM live WHERE completed_at >= p_cmp_from AND completed_at < p_cmp_to) END,
      'cohort_completed', (SELECT count(*) FROM sent WHERE status = 'completed'),
      'median_hours', (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM completed_at - sent_at)) / 3600)::numeric, 1) FROM done),
      'avg_hours', (SELECT round((avg(extract(epoch FROM completed_at - sent_at)) / 3600)::numeric, 1) FROM done),
      'finalized_ok', (SELECT count(*) FROM done),
      'finalized_failed', (SELECT count(*) FROM failed),
      'finalized_failed_cmp', CASE WHEN has_cmp THEN (SELECT count(*) FROM live WHERE status = 'finalization_failed' AND updated_at >= p_cmp_from AND updated_at < p_cmp_to) END,
      'signing_started', (SELECT count(*) FROM views),
      'signing_signed', (SELECT count(*) FROM views WHERE signed_at IS NOT NULL),
      'signing_declined', (SELECT count(*) FROM views WHERE declined_at IS NOT NULL),
      'certificates', (SELECT count(*) FROM live WHERE certificate_issued_at >= p_from AND certificate_issued_at < p_to),
      'certificates_reissued', (SELECT count(*) FROM signing_events WHERE type = 'request.certificate_reissued' AND created_at >= p_from AND created_at < p_to)
    ),
    'status', (
      SELECT jsonb_build_object(
        'completed', count(*) FILTER (WHERE status = 'completed'),
        'pending', count(*) FILTER (WHERE status IN ('payment_processing','ready_to_dispatch','queued','sent','in_progress','awaiting_approval','awaiting_payment')),
        'declined', count(*) FILTER (WHERE status = 'declined'),
        'expired', count(*) FILTER (WHERE status = 'expired'),
        'cancelled', count(*) FILTER (WHERE status = 'cancelled'),
        'failed', count(*) FILTER (WHERE status = 'finalization_failed'),
        'total', count(*))
      FROM sent
    ),
    'series', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'start', bk.start,
        'created', (SELECT count(*) FROM documents d WHERE d.created_at >= bk.start AND d.created_at < bk.stop),
        'sent', (SELECT count(*) FROM live l WHERE l.sent_at >= bk.start AND l.sent_at < bk.stop),
        'completed', (SELECT count(*) FROM live l WHERE l.completed_at >= bk.start AND l.completed_at < bk.stop),
        'failed', (SELECT count(*) FROM live l WHERE l.status = 'finalization_failed' AND l.updated_at >= bk.start AND l.updated_at < bk.stop),
        'certificates', (SELECT count(*) FROM live l WHERE l.certificate_issued_at >= bk.start AND l.certificate_issued_at < bk.stop),
        'reissued', (SELECT count(*) FROM signing_events e WHERE e.type = 'request.certificate_reissued' AND e.created_at >= bk.start AND e.created_at < bk.stop),
        'signing_started', (SELECT count(*) FROM request_recipients rr JOIN live r ON r.id = rr.request_id WHERE rr.viewed_at >= bk.start AND rr.viewed_at < bk.stop),
        'signing_signed', (SELECT count(*) FROM request_recipients rr JOIN live r ON r.id = rr.request_id WHERE rr.viewed_at >= bk.start AND rr.viewed_at < bk.stop AND rr.signed_at IS NOT NULL),
        'signing_declined', (SELECT count(*) FROM request_recipients rr JOIN live r ON r.id = rr.request_id WHERE rr.viewed_at >= bk.start AND rr.viewed_at < bk.stop AND rr.declined_at IS NOT NULL),
        'signing_minutes', (SELECT round((avg(extract(epoch FROM rr.signed_at - rr.viewed_at)) / 60)::numeric, 1)
          FROM request_recipients rr JOIN live r ON r.id = rr.request_id WHERE rr.viewed_at >= bk.start AND rr.viewed_at < bk.stop AND rr.signed_at IS NOT NULL)
      ) ORDER BY bk.start), '[]'::jsonb) FROM st_admin_buckets(p_from, p_to, p_bucket) bk
    ),
    'completion_time', (
      SELECT jsonb_build_object(
        'under_1h', count(*) FILTER (WHERE completed_at - sent_at < interval '1 hour'),
        'under_1d', count(*) FILTER (WHERE completed_at - sent_at >= interval '1 hour' AND completed_at - sent_at < interval '1 day'),
        'under_3d', count(*) FILTER (WHERE completed_at - sent_at >= interval '1 day' AND completed_at - sent_at < interval '3 days'),
        'under_7d', count(*) FILTER (WHERE completed_at - sent_at >= interval '3 days' AND completed_at - sent_at < interval '7 days'),
        'over_7d', count(*) FILTER (WHERE completed_at - sent_at >= interval '7 days'))
      FROM done
    ),
    'reliability', jsonb_build_object(
      'emails_total', (SELECT count(*) FROM notifications WHERE status NOT IN ('queued', 'cancelled') AND created_at >= p_from AND created_at < p_to),
      'emails_ok', (SELECT count(*) FROM notifications WHERE status IN ('sent', 'delivered') AND created_at >= p_from AND created_at < p_to),
      'webhooks_total', (SELECT count(*) FROM webhook_deliveries WHERE status IN ('succeeded', 'dead', 'failed') AND created_at >= p_from AND created_at < p_to),
      'webhooks_ok', (SELECT count(*) FROM webhook_deliveries WHERE status = 'succeeded' AND created_at >= p_from AND created_at < p_to),
      'finalization_total', (SELECT count(*) FROM done) + (SELECT count(*) FROM failed),
      'finalization_ok', (SELECT count(*) FROM done),
      'sync_total', (SELECT count(*) FROM integration_sync_jobs WHERE status IN ('succeeded', 'failed') AND created_at >= p_from AND created_at < p_to),
      'sync_ok', (SELECT count(*) FROM integration_sync_jobs WHERE status = 'succeeded' AND created_at >= p_from AND created_at < p_to)
    ),
    'failures', CASE WHEN can_system THEN (
      SELECT coalesce(jsonb_agg(row_to_json(f)::jsonb ORDER BY f.at DESC), '[]'::jsonb) FROM (
        SELECT * FROM (
          SELECT upper(left(md5(id::text), 8)) AS ref, 'finishing' AS service, 'finalization_failed' AS category,
            updated_at AS at, 'open' AS status, NULL::int AS attempts FROM failed
          UNION ALL
          SELECT upper(left(md5(id::text), 8)), 'webhook',
            CASE WHEN last_status_code IS NOT NULL THEN 'http_' || last_status_code ELSE 'no_response' END,
            coalesce(last_attempt_at, created_at), CASE WHEN status = 'dead' THEN 'gave_up' ELSE 'retrying' END, attempts
          FROM webhook_deliveries WHERE status IN ('dead', 'failed') AND created_at >= p_from AND created_at < p_to
          UNION ALL
          SELECT upper(left(md5(id::text), 8)), 'email', status::text, coalesce(failed_at, updated_at),
            CASE WHEN status = 'retrying' THEN 'retrying' ELSE 'gave_up' END, attempts
          FROM notifications WHERE status IN ('failed', 'bounced', 'retrying') AND created_at >= p_from AND created_at < p_to
          UNION ALL
          SELECT upper(left(md5(id::text), 8)), 'integration_sync',
            coalesce(nullif(regexp_replace(lower(coalesce(error_code, 'unknown')), '[^a-z0-9_]', '_', 'g'), ''), 'unknown'),
            updated_at, 'gave_up', attempt_count
          FROM integration_sync_jobs WHERE status = 'failed' AND created_at >= p_from AND created_at < p_to
        ) x ORDER BY at DESC LIMIT 50
      ) f
    ) END,
    'generated_at', now()
  ) INTO out;
  RETURN out;
END $$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION st_admin_activity(timestamptz, timestamptz), st_admin_feature_use(timestamptz, timestamptz),
  st_admin_perf_growth(timestamptz, timestamptz, timestamptz, timestamptz, text),
  st_admin_perf_engagement(timestamptz, timestamptz, timestamptz, timestamptz, text),
  st_admin_perf_features(timestamptz, timestamptz, timestamptz, timestamptz, text),
  st_admin_perf_conversion(timestamptz, timestamptz, timestamptz, timestamptz, text),
  st_admin_perf_delivery(timestamptz, timestamptz, timestamptz, timestamptz, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  st_admin_perf_growth(timestamptz, timestamptz, timestamptz, timestamptz, text),
  st_admin_perf_engagement(timestamptz, timestamptz, timestamptz, timestamptz, text),
  st_admin_perf_features(timestamptz, timestamptz, timestamptz, timestamptz, text),
  st_admin_perf_conversion(timestamptz, timestamptz, timestamptz, timestamptz, text),
  st_admin_perf_delivery(timestamptz, timestamptz, timestamptz, timestamptz, text) TO st_app;
