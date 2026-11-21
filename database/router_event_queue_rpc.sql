-- Router event queue: secure claim/retry/ack RPCs for the outbound MikroTik connector.
ALTER TABLE public.router_events
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS result_payload jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.router_events DROP CONSTRAINT IF EXISTS router_events_processing_status_check;
ALTER TABLE public.router_events ADD CONSTRAINT router_events_processing_status_check
  CHECK (processing_status IN ('pending','processing','processed','failed','ignored'));
ALTER TABLE public.router_events DROP CONSTRAINT IF EXISTS router_events_attempt_count_check;
ALTER TABLE public.router_events ADD CONSTRAINT router_events_attempt_count_check CHECK (attempt_count >= 0);

CREATE INDEX IF NOT EXISTS router_events_claim_queue_idx
  ON public.router_events(device_id,occurred_at)
  WHERE processing_status IN ('pending','processing');

CREATE OR REPLACE FUNCTION private.claim_router_events(p_token_hash text,p_limit integer DEFAULT 20)
RETURNS TABLE(id uuid,session_id uuid,event_type text,event_payload jsonb,occurred_at timestamptz,attempt_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_device_id uuid;
BEGIN
  IF p_limit IS NULL OR p_limit<1 OR p_limit>50 THEN
    RAISE EXCEPTION 'Event batch size must be between 1 and 50' USING errcode='22023';
  END IF;
  SELECT c.device_id INTO v_device_id FROM private.router_device_credentials c
  WHERE c.token_hash=p_token_hash AND c.revoked_at IS NULL AND c.expires_at>now()
  ORDER BY c.created_at DESC LIMIT 1;
  IF v_device_id IS NULL THEN
    RAISE EXCEPTION 'Router credential is invalid or expired' USING errcode='28000';
  END IF;
  PERFORM private.authenticate_router_device(p_token_hash);
  RETURN QUERY
  WITH claimable AS (
    SELECT e.id FROM public.router_events e
    WHERE e.device_id=v_device_id
      AND (e.processing_status='pending'
        OR (e.processing_status='processing' AND e.claimed_at<now()-interval '2 minutes'))
      AND e.attempt_count<5
    ORDER BY e.occurred_at FOR UPDATE SKIP LOCKED LIMIT p_limit
  )
  UPDATE public.router_events e
  SET processing_status='processing',claimed_at=now(),attempt_count=e.attempt_count+1
  FROM claimable c WHERE e.id=c.id
  RETURNING e.id,e.session_id,e.event_type,e.event_payload,e.occurred_at,e.attempt_count;
END;
$function$;

CREATE OR REPLACE FUNCTION private.complete_router_event(
 p_token_hash text,p_event_id uuid,p_success boolean,
 p_result_payload jsonb DEFAULT '{}'::jsonb,p_error text DEFAULT NULL
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_device_id uuid; v_attempts integer;
BEGIN
  SELECT c.device_id INTO v_device_id FROM private.router_device_credentials c
  WHERE c.token_hash=p_token_hash AND c.revoked_at IS NULL AND c.expires_at>now()
  ORDER BY c.created_at DESC LIMIT 1;
  IF v_device_id IS NULL THEN
    RAISE EXCEPTION 'Router credential is invalid or expired' USING errcode='28000';
  END IF;
  UPDATE public.router_events e
  SET processing_status=CASE WHEN p_success THEN 'processed'
    WHEN e.attempt_count>=5 THEN 'failed' ELSE 'pending' END,
    processed_at=CASE WHEN p_success OR e.attempt_count>=5 THEN now() ELSE NULL END,
    claimed_at=NULL,
    last_error=CASE WHEN p_success THEN NULL ELSE left(coalesce(p_error,'Router failed to apply event'),1000) END,
    result_payload=coalesce(p_result_payload,'{}'::jsonb)
  WHERE e.id=p_event_id AND e.device_id=v_device_id AND e.processing_status='processing'
  RETURNING e.attempt_count INTO v_attempts;
  RETURN FOUND;
END;
$function$;

REVOKE ALL ON FUNCTION private.claim_router_events(text,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.complete_router_event(text,uuid,boolean,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.claim_router_events(text,integer) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION private.complete_router_event(text,uuid,boolean,jsonb,text) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.claim_router_events(p_token_hash text,p_limit integer DEFAULT 20)
RETURNS TABLE(id uuid,session_id uuid,event_type text,event_payload jsonb,occurred_at timestamptz,attempt_count integer)
LANGUAGE sql SECURITY INVOKER SET search_path TO ''
AS $function$ SELECT * FROM private.claim_router_events(p_token_hash,p_limit); $function$;

CREATE OR REPLACE FUNCTION public.complete_router_event(
 p_token_hash text,p_event_id uuid,p_success boolean,
 p_result_payload jsonb DEFAULT '{}'::jsonb,p_error text DEFAULT NULL
)
RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path TO ''
AS $function$
 SELECT private.complete_router_event(p_token_hash,p_event_id,p_success,p_result_payload,p_error);
$function$;

REVOKE ALL ON FUNCTION public.claim_router_events(text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_router_event(text,uuid,boolean,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_router_events(text,integer) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_router_event(text,uuid,boolean,jsonb,text) TO anon,authenticated;
