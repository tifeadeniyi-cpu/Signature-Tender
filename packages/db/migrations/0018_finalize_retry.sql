-- Automatic retry for requests whose signed copy or certificate could not be built.
-- The scheduled job has no signed-in member, so this function only hands back request ids and the
-- member who sent each one; the retry itself then runs under RLS as that member.
CREATE OR REPLACE FUNCTION st_finalization_retry_queue(p_limit int, p_max_attempts int)
RETURNS TABLE (request_id uuid, sent_by text, sender_name text, workspace_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id, r.sent_by, r.sender_name, r.workspace_name
  FROM signing_requests r
  WHERE r.status = 'finalization_failed'
    AND r.updated_at < now() - interval '10 minutes'
    AND (SELECT count(*) FROM signing_events e
         WHERE e.request_id = r.id AND e.type = 'request.finalization_failed') < p_max_attempts
  ORDER BY r.updated_at
  LIMIT least(greatest(p_limit, 1), 50);
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION st_finalization_retry_queue(int, int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION st_finalization_retry_queue(int, int) TO st_app;
