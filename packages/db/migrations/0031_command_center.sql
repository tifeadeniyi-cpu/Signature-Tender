-- Founder admin, phase 3: the Command Center. One function returns every aggregate the dashboard
-- shows for a period and its comparison period. Counts, sums and opaque references only: no
-- document titles, files, recipients, signature artwork or customer contact details.
-- Revenue is returned only to roles with revenue.view; the audit summary only with audit.view.

-- Small groups are merged so a breakdown cannot single out one customer's activity.
CREATE OR REPLACE FUNCTION st_admin_min_group() RETURNS int LANGUAGE sql IMMUTABLE AS $$ SELECT 5 $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION st_admin_command_center(
  p_from timestamptz, p_to timestamptz, p_cmp_from timestamptz, p_cmp_to timestamptz, p_bucket text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b text := CASE WHEN p_bucket IN ('day', 'week', 'month') THEN p_bucket ELSE 'month' END;
  has_cmp boolean := p_cmp_from IS NOT NULL AND p_cmp_to IS NOT NULL;
  can_revenue boolean;
  can_audit boolean;
  k int := st_admin_min_group();
  out jsonb;
BEGIN
  PERFORM st_admin_require_perm('analytics.view', 'command_center');
  can_revenue := st_admin_has('revenue.view');
  can_audit := st_admin_has('audit.view');

  WITH
  -- Live (non-test) requests sent in each period: the document cohort.
  sent AS (
    SELECT r.id, r.status, r.document_id, r.workspace_id, r.sent_at, r.completed_at
    FROM signing_requests r
    WHERE NOT r.is_test AND r.sent_at >= p_from AND r.sent_at < p_to
  ),
  sent_cmp AS (
    SELECT r.id, r.status FROM signing_requests r
    WHERE has_cmp AND NOT r.is_test AND r.sent_at >= p_cmp_from AND r.sent_at < p_cmp_to
  ),
  buckets AS (
    SELECT gs AS start, gs + ('1 ' || b)::interval AS stop
    FROM generate_series(date_trunc(b, p_from), p_to - interval '1 microsecond', ('1 ' || b)::interval) gs
  ),
  money AS (
    SELECT p.kind::text AS kind, upper(p.currency) AS currency, coalesce(p.paid_at, p.created_at) AS at,
      p.amount_cents::bigint AS gross, p.amount_refunded_cents::bigint AS refunded,
      CASE WHEN p.status = 'disputed' THEN p.amount_cents::bigint ELSE 0 END AS disputed
    FROM payments p WHERE p.status IN ('paid', 'partially_refunded', 'refunded', 'disputed')
    UNION ALL
    SELECT 'studio', upper(s.currency), coalesce(s.purchased_at, s.created_at),
      s.amount_cents::bigint, s.amount_refunded_cents::bigint,
      CASE WHEN s.payment_status = 'disputed' THEN s.amount_cents::bigint ELSE 0 END
    FROM signature_purchases s WHERE s.payment_status IN ('paid', 'refunded', 'disputed')
  ),
  feature_use AS (
    SELECT a.actor_user_id AS uid,
      CASE
        WHEN a.action = 'document.sent' THEN 'send'
        WHEN a.action LIKE 'template.%' THEN 'templates'
        WHEN a.action LIKE 'team.%' THEN 'team'
        WHEN a.action LIKE 'integration.%' THEN 'integrations'
        WHEN a.action LIKE 'api.%' OR a.action LIKE 'webhook.%' THEN 'api'
        WHEN a.action LIKE 'contact%' THEN 'contacts'
        ELSE NULL
      END AS feature
    FROM audit_events a
    WHERE a.workspace_id IS NOT NULL AND a.actor_user_id IS NOT NULL
      AND a.occurred_at >= p_from AND a.occurred_at < p_to
    UNION ALL
    SELECT d.owner_user_id, 'studio' FROM signature_designs d
    WHERE d.owner_user_id IS NOT NULL AND d.created_at >= p_from AND d.created_at < p_to
  ),
  types AS (
    SELECT coalesce(nullif(d.document_type, ''), 'uncategorized') AS t, count(DISTINCT s.document_id) AS n
    FROM sent s JOIN documents d ON d.id = s.document_id GROUP BY 1
  )
  SELECT jsonb_build_object(
    'kpi', jsonb_build_object(
      'users_total', (SELECT count(*) FROM "user" WHERE created_at < p_to),
      'users_new', (SELECT count(*) FROM "user" WHERE created_at >= p_from AND created_at < p_to),
      'users_new_cmp', CASE WHEN has_cmp THEN (SELECT count(*) FROM "user" WHERE created_at >= p_cmp_from AND created_at < p_cmp_to) END,
      'orgs_total', (SELECT count(*) FROM workspaces WHERE created_at < p_to),
      'orgs_new', (SELECT count(*) FROM workspaces WHERE created_at >= p_from AND created_at < p_to),
      'orgs_new_cmp', CASE WHEN has_cmp THEN (SELECT count(*) FROM workspaces WHERE created_at >= p_cmp_from AND created_at < p_cmp_to) END,
      'orgs_active', (SELECT count(DISTINCT workspace_id) FROM sent),
      'docs_sent', (SELECT count(*) FROM sent),
      'docs_sent_cmp', CASE WHEN has_cmp THEN (SELECT count(*) FROM sent_cmp) END,
      'docs_sent_total', (SELECT count(*) FROM signing_requests WHERE NOT is_test AND sent_at IS NOT NULL AND sent_at < p_to),
      'docs_completed', (SELECT count(*) FROM signing_requests WHERE NOT is_test AND completed_at >= p_from AND completed_at < p_to),
      'docs_completed_cmp', CASE WHEN has_cmp THEN (SELECT count(*) FROM signing_requests WHERE NOT is_test AND completed_at >= p_cmp_from AND completed_at < p_cmp_to) END,
      'cohort_completed', (SELECT count(*) FROM sent WHERE status = 'completed'),
      'cohort_completed_cmp', CASE WHEN has_cmp THEN (SELECT count(*) FROM sent_cmp WHERE status = 'completed') END,
      'designs_new', (SELECT count(*) FROM signature_designs WHERE created_at >= p_from AND created_at < p_to),
      'designs_new_cmp', CASE WHEN has_cmp THEN (SELECT count(*) FROM signature_designs WHERE created_at >= p_cmp_from AND created_at < p_cmp_to) END,
      'studio_purchases', (SELECT count(*) FROM signature_purchases WHERE payment_status IN ('paid','refunded','disputed') AND purchased_at >= p_from AND purchased_at < p_to),
      'studio_purchases_cmp', CASE WHEN has_cmp THEN (SELECT count(*) FROM signature_purchases WHERE payment_status IN ('paid','refunded','disputed') AND purchased_at >= p_cmp_from AND purchased_at < p_cmp_to) END
    ),
    'growth', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'start', bk.start,
        'users_new', (SELECT count(*) FROM "user" u WHERE u.created_at >= greatest(bk.start, p_from) AND u.created_at < least(bk.stop, p_to)),
        'orgs_new', (SELECT count(*) FROM workspaces w WHERE w.created_at >= greatest(bk.start, p_from) AND w.created_at < least(bk.stop, p_to)),
        'users_total', (SELECT count(*) FROM "user" u WHERE u.created_at < least(bk.stop, p_to)),
        'orgs_total', (SELECT count(*) FROM workspaces w WHERE w.created_at < least(bk.stop, p_to))
      ) ORDER BY bk.start), '[]'::jsonb) FROM buckets bk
    ),
    'doc_status', (
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
    'doc_types', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('type', g.t, 'count', g.n) ORDER BY g.n DESC, g.t), '[]'::jsonb)
      FROM (
        SELECT CASE WHEN n >= k THEN t ELSE 'small_groups' END AS t, sum(n)::bigint AS n
        FROM types GROUP BY 1
      ) g
    ),
    'features', jsonb_build_object(
      'active_users', (SELECT count(DISTINCT uid) FROM feature_use),
      'rows', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('feature', f.feature, 'users', f.users) ORDER BY f.users DESC, f.feature), '[]'::jsonb)
        FROM (SELECT feature, count(DISTINCT uid) AS users FROM feature_use WHERE feature IS NOT NULL GROUP BY feature) f
      )
    ),
    'studio', jsonb_build_object(
      'sessions', (SELECT count(DISTINCT coalesce(e.session_hash, e.user_id)) FROM signature_studio_events e
                   WHERE e.event = 'design_started' AND e.created_at >= p_from AND e.created_at < p_to),
      'sessions_cmp', CASE WHEN has_cmp THEN (SELECT count(DISTINCT coalesce(e.session_hash, e.user_id)) FROM signature_studio_events e
                   WHERE e.event = 'design_started' AND e.created_at >= p_cmp_from AND e.created_at < p_cmp_to) END,
      'designs', (SELECT count(*) FROM signature_designs WHERE created_at >= p_from AND created_at < p_to),
      'designs_purchased', (SELECT count(DISTINCT d.id) FROM signature_designs d
                   JOIN signature_purchases s ON s.signature_design_id = d.id AND s.payment_status IN ('paid','refunded','disputed')
                   WHERE d.created_at >= p_from AND d.created_at < p_to),
      'downloads', (SELECT count(*) FROM signature_downloads WHERE result = 'ok' AND downloaded_at >= p_from AND downloaded_at < p_to)
    ),
    'revenue', CASE WHEN can_revenue THEN jsonb_build_object(
      'totals', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'gross', gross, 'refunded', refunded,
          'disputed', disputed, 'net', gross - refunded - disputed, 'gross_cmp', gross_cmp, 'net_cmp', net_cmp) ORDER BY gross DESC), '[]'::jsonb)
        FROM (
          SELECT currency,
            sum(gross) FILTER (WHERE at >= p_from AND at < p_to) AS gross,
            sum(refunded) FILTER (WHERE at >= p_from AND at < p_to) AS refunded,
            sum(disputed) FILTER (WHERE at >= p_from AND at < p_to) AS disputed,
            CASE WHEN has_cmp THEN coalesce(sum(gross) FILTER (WHERE at >= p_cmp_from AND at < p_cmp_to), 0) END AS gross_cmp,
            CASE WHEN has_cmp THEN coalesce(sum(gross - refunded - disputed) FILTER (WHERE at >= p_cmp_from AND at < p_cmp_to), 0) END AS net_cmp
          FROM money
          WHERE (at >= p_from AND at < p_to) OR (has_cmp AND at >= p_cmp_from AND at < p_cmp_to)
          GROUP BY currency
        ) t WHERE gross IS NOT NULL OR gross_cmp > 0
      ),
      'by_kind', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'currency', currency, 'net', net) ORDER BY net DESC), '[]'::jsonb)
        FROM (SELECT kind, currency, sum(gross - refunded - disputed) AS net FROM money
              WHERE at >= p_from AND at < p_to GROUP BY kind, currency) t
      ),
      'series', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('start', bk.start, 'currency', m.currency,
          'gross', m.gross, 'refunded', m.refunded, 'disputed', m.disputed, 'net', m.gross - m.refunded - m.disputed)
          ORDER BY bk.start), '[]'::jsonb)
        FROM buckets bk
        CROSS JOIN LATERAL (
          SELECT currency, sum(gross) AS gross, sum(refunded) AS refunded, sum(disputed) AS disputed FROM money
          WHERE at >= greatest(bk.start, p_from) AND at < least(bk.stop, p_to) GROUP BY currency
        ) m
      )
    ) END,
    'activity', (
      SELECT coalesce(jsonb_agg(row_to_json(a)::jsonb ORDER BY a.at DESC), '[]'::jsonb) FROM (
        SELECT * FROM (
          SELECT 'user_registered' AS kind, created_at AS at, 'info' AS severity FROM "user"
          UNION ALL SELECT 'organization_registered', created_at, 'info' FROM workspaces
          UNION ALL SELECT 'payment_' || kind::text, coalesce(paid_at, created_at), 'info' FROM payments WHERE status = 'paid'
          UNION ALL SELECT 'studio_purchase', purchased_at, 'info' FROM signature_purchases WHERE payment_status = 'paid' AND purchased_at IS NOT NULL
          UNION ALL SELECT 'integration_connected', occurred_at, 'info' FROM audit_events WHERE action = 'integration.connected'
          UNION ALL SELECT 'finalization_failed', updated_at, 'warning' FROM signing_requests WHERE status = 'finalization_failed'
          UNION ALL SELECT 'webhook_dead', coalesce(last_attempt_at, created_at), 'warning' FROM webhook_deliveries WHERE status = 'dead'
          UNION ALL SELECT 'payment_failed', created_at, 'warning' FROM payments WHERE status = 'failed'
        ) e WHERE e.at < p_to ORDER BY e.at DESC LIMIT 8
      ) a
    ),
    'audit', CASE WHEN can_audit THEN (
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'action', x.action, 'at', x.occurred_at,
        'risk', st_audit_risk(x.action), 'category', st_audit_category(x.action)) ORDER BY x.seq DESC), '[]'::jsonb)
      FROM (SELECT id, seq, action, occurred_at FROM audit_events
            WHERE workspace_id IS NULL AND action <> 'admin.viewed' ORDER BY seq DESC LIMIT 5) x
    ) END,
    'security', jsonb_build_object(
      'staff', (SELECT count(*) FROM platform_admins),
      'staff_strong', (SELECT count(*) FROM platform_admins pa JOIN "user" u ON u.id = pa.user_id
        WHERE coalesce(u.two_factor_enabled, false) OR EXISTS (SELECT 1 FROM passkey p WHERE p.user_id = pa.user_id)),
      'denied', (SELECT count(*) FROM audit_events WHERE action = 'admin.access_denied' AND occurred_at >= p_from AND occurred_at < p_to),
      'audit_append_only', (SELECT count(*) = 2 FROM pg_trigger WHERE tgrelid = 'audit_events'::regclass
        AND tgname IN ('audit_events_no_change', 'audit_events_no_truncate') AND tgenabled <> 'D'),
      'production_signing', (SELECT enabled FROM feature_flags WHERE key = 'production_signing')
    ),
    'health', jsonb_build_object(
      'finalization_failed', (SELECT count(*) FROM signing_requests WHERE status = 'finalization_failed'),
      'webhooks_total', (SELECT count(*) FROM webhook_deliveries WHERE created_at >= p_from AND created_at < p_to),
      'webhooks_ok', (SELECT count(*) FROM webhook_deliveries WHERE status = 'succeeded' AND created_at >= p_from AND created_at < p_to),
      'webhooks_dead', (SELECT count(*) FROM webhook_deliveries WHERE status = 'dead' AND created_at >= p_from AND created_at < p_to),
      'emails_total', (SELECT count(*) FROM notifications WHERE status NOT IN ('queued','cancelled') AND created_at >= p_from AND created_at < p_to),
      'emails_ok', (SELECT count(*) FROM notifications WHERE status IN ('sent','delivered') AND created_at >= p_from AND created_at < p_to),
      'emails_bounced', (SELECT count(*) FROM notifications WHERE status = 'bounced' AND created_at >= p_from AND created_at < p_to),
      'emails_failed', (SELECT count(*) FROM notifications WHERE status = 'failed' AND created_at >= p_from AND created_at < p_to),
      'stripe_unprocessed', (SELECT count(*) FROM stripe_events WHERE processed_at IS NULL AND received_at < now() - interval '15 minutes'),
      'sync_failed', (SELECT count(*) FROM integration_sync_jobs WHERE status = 'failed' AND created_at >= p_from AND created_at < p_to)
    ),
    'generated_at', now()
  ) INTO out;
  RETURN out;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION st_admin_command_center(timestamptz, timestamptz, timestamptz, timestamptz, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION st_admin_command_center(timestamptz, timestamptz, timestamptz, timestamptz, text) TO st_app;
