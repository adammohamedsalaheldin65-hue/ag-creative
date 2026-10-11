-- WARAQA SUBSCRIPTION MIGRATION | Run only in the Waraqa Supabase project.
-- Project URL must end with vhyygvbqemhqirbcycev.supabase.co
-- IMPORTANT: run after supabase/schema.sql.
-- This migration does not allow screenshot-based automatic activation.
-- Subscription periods are measured by the DATABASE clock, not browser time.
BEGIN;

CREATE TABLE IF NOT EXISTS public.teacher_subscriptions (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  trial_started_at timestamptz NOT NULL,
  trial_ends_at timestamptz NOT NULL,
  paid_until timestamptz,
  plan text NOT NULL DEFAULT 'trial' CHECK (plan IN ('trial','basic','premium')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscription_trial_period CHECK (trial_ends_at > trial_started_at)
);
ALTER TABLE public.teacher_subscriptions
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'trial'
    CHECK (plan IN ('trial','basic','premium'));
ALTER TABLE public.teacher_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.teacher_subscriptions FROM public,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.teacher_subscriptions TO service_role;

-- Do not allow user-created free trial rows or modifications of expiry.
CREATE OR REPLACE FUNCTION public.waraqa_create_trial()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
  IF NEW.is_anonymous IS DISTINCT FROM TRUE THEN
    INSERT INTO public.teacher_subscriptions(user_id,trial_started_at,trial_ends_at)
    VALUES (NEW.id, NEW.created_at, NEW.created_at + interval '1 month')
    ON CONFLICT(user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS on_waraqa_user_created ON auth.users;
CREATE TRIGGER on_waraqa_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.waraqa_create_trial();

-- Existing permanent accounts retain their true ORIGINAL signup date.
-- Anonymous accounts DO NOT receive a paid-plan trial.
INSERT INTO public.teacher_subscriptions(user_id,trial_started_at,trial_ends_at)
SELECT id,created_at,created_at + interval '1 month'
FROM auth.users WHERE is_anonymous IS DISTINCT FROM TRUE
ON CONFLICT(user_id) DO NOTHING;

-- Private proof ledger. A request cannot approve itself.
CREATE TABLE IF NOT EXISTS public.subscription_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  receipt_path text NOT NULL,
  reference_note text NOT NULL DEFAULT '',
  plan text NOT NULL DEFAULT 'basic' CHECK (plan IN ('basic','premium')),
  amount_egp integer NOT NULL DEFAULT 50 CHECK (amount_egp>0 AND amount_egp<=100000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  ai_result jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(ai_result)='object'),
  admin_note text NOT NULL DEFAULT '',
  verified_transaction_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
ALTER TABLE public.subscription_payments
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'basic' CHECK (plan IN ('basic','premium'));
ALTER TABLE public.subscription_payments
  ADD COLUMN IF NOT EXISTS amount_egp integer NOT NULL DEFAULT 50 CHECK (amount_egp>0 AND amount_egp<=100000);
CREATE INDEX IF NOT EXISTS subscription_payments_user_time ON public.subscription_payments(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS subscription_payments_status_time ON public.subscription_payments(status,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS subscription_payments_verified_bank_ref
 ON public.subscription_payments(lower(verified_transaction_ref))
 WHERE verified_transaction_ref IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS subscription_payments_one_pending
 ON public.subscription_payments(user_id) WHERE status='pending';
ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.subscription_payments FROM public,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.subscription_payments TO service_role;

-- Upload/view only through authenticated server endpoints; never public.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('payment-proofs','payment-proofs',false,2000000,ARRAY['image/png','image/jpeg','image/webp'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=2000000,
  allowed_mime_types=ARRAY['image/png','image/jpeg','image/webp'];

-- This SQL may be run again safely.
DROP POLICY IF EXISTS "Teachers browse own proof" ON storage.objects;
DROP POLICY IF EXISTS "Teachers upload own proof" ON storage.objects;
DROP POLICY IF EXISTS "Teachers update own proof" ON storage.objects;
DROP POLICY IF EXISTS "Teachers delete own proof" ON storage.objects;

-- RLS for ALL existing exams and image objects, including offline/manual exams.
-- Restricts already-signed-in expired accounts as well as new logins.
CREATE OR REPLACE FUNCTION public.waraqa_has_access()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.teacher_subscriptions s
    WHERE s.user_id=(SELECT auth.uid())
      AND GREATEST(s.trial_ends_at,COALESCE(s.paid_until,'-infinity'::timestamptz)) > now()
  );
$$;
REVOKE ALL ON FUNCTION public.waraqa_has_access() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.waraqa_has_access() TO authenticated,service_role;

DROP POLICY IF EXISTS "Teachers select own exams" ON public.exams;
CREATE POLICY "Teachers select own exams" ON public.exams FOR SELECT TO authenticated
 USING ((SELECT auth.uid())=user_id AND (SELECT public.waraqa_has_access()));
DROP POLICY IF EXISTS "Teachers insert own exams" ON public.exams;
CREATE POLICY "Teachers insert own exams" ON public.exams FOR INSERT TO authenticated
 WITH CHECK ((SELECT auth.uid())=user_id AND (SELECT public.waraqa_has_access()));
DROP POLICY IF EXISTS "Teachers update own exams" ON public.exams;
CREATE POLICY "Teachers update own exams" ON public.exams FOR UPDATE TO authenticated
 USING ((SELECT auth.uid())=user_id AND (SELECT public.waraqa_has_access()))
 WITH CHECK ((SELECT auth.uid())=user_id AND (SELECT public.waraqa_has_access()));
DROP POLICY IF EXISTS "Teachers delete own exams" ON public.exams;
CREATE POLICY "Teachers delete own exams" ON public.exams FOR DELETE TO authenticated
 USING ((SELECT auth.uid())=user_id AND (SELECT public.waraqa_has_access()));

DROP POLICY IF EXISTS "Teachers read own images" ON storage.objects;
CREATE POLICY "Teachers read own images" ON storage.objects FOR SELECT TO authenticated
 USING (bucket_id='exam-images'
   AND (storage.foldername(name))[1]=(SELECT auth.uid())::text
   AND (SELECT public.waraqa_has_access()));
DROP POLICY IF EXISTS "Teachers upload own images" ON storage.objects;
CREATE POLICY "Teachers upload own images" ON storage.objects FOR INSERT TO authenticated
 WITH CHECK (bucket_id='exam-images'
   AND (storage.foldername(name))[1]=(SELECT auth.uid())::text
   AND (SELECT public.waraqa_has_access()));
DROP POLICY IF EXISTS "Teachers replace own images" ON storage.objects;
CREATE POLICY "Teachers replace own images" ON storage.objects FOR UPDATE TO authenticated
 USING (bucket_id='exam-images'
   AND (storage.foldername(name))[1]=(SELECT auth.uid())::text
   AND (SELECT public.waraqa_has_access()))
 WITH CHECK (bucket_id='exam-images'
   AND (storage.foldername(name))[1]=(SELECT auth.uid())::text
   AND (SELECT public.waraqa_has_access()));
DROP POLICY IF EXISTS "Teachers delete own images" ON storage.objects;
CREATE POLICY "Teachers delete own images" ON storage.objects FOR DELETE TO authenticated
 USING (bucket_id='exam-images'
   AND (storage.foldername(name))[1]=(SELECT auth.uid())::text
   AND (SELECT public.waraqa_has_access()));

-- Atomic and one-time approval: requires service role AND an admin token at API layer.
CREATE OR REPLACE FUNCTION public.waraqa_resolve_payment(
  p_payment_id uuid,p_approve boolean,p_admin_note text DEFAULT '',p_verified_ref text DEFAULT ''
)
RETURNS TABLE(payment_id uuid,new_status text,paid_through timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE p public.subscription_payments%ROWTYPE; until_date timestamptz;
BEGIN
  SELECT * INTO p FROM public.subscription_payments
  WHERE id=p_payment_id FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'payment_not_found'; END IF;
  IF p.status <> 'pending' THEN RAISE EXCEPTION 'payment_already_processed'; END IF;
  IF p_approve THEN
    IF length(trim(COALESCE(p_verified_ref,'')))<6 OR length(p_verified_ref)>140 THEN
      RAISE EXCEPTION 'bank_reference_required';
    END IF;
    -- The UNIQUE partial index prevents using the SAME verified bank transaction to
    -- extend different teacher accounts; the administrator enters it from bank records.
    UPDATE public.subscription_payments
       SET verified_transaction_ref=trim(p_verified_ref)
    WHERE id=p_payment_id;
    INSERT INTO public.teacher_subscriptions(user_id,trial_started_at,trial_ends_at,paid_until,plan)
    SELECT u.id,u.created_at,u.created_at+interval '1 month',
      GREATEST(now(),u.created_at+interval '1 month')+interval '1 month',p.plan
    FROM auth.users u WHERE u.id=p.user_id
    ON CONFLICT(user_id) DO UPDATE
       SET paid_until=GREATEST(now(),public.teacher_subscriptions.trial_ends_at,
          COALESCE(public.teacher_subscriptions.paid_until,'-infinity'::timestamptz))
          +interval '1 month',
           plan=EXCLUDED.plan,
           updated_at=now()
    RETURNING paid_until INTO until_date;
  END IF;
  UPDATE public.subscription_payments
    SET status=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
        admin_note=LEFT(COALESCE(p_admin_note,''),400),
        resolved_at=now()
    WHERE id=p_payment_id;
  RETURN QUERY SELECT p_payment_id,
    (CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END)::text,until_date;
END;
$$;
REVOKE ALL ON FUNCTION public.waraqa_resolve_payment(uuid,boolean,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.waraqa_resolve_payment(uuid,boolean,text,text) TO service_role;

-- Paid plans have distinct daily AI policies.
-- Trial/basic: 3 AI jobs per UTC day per account.
-- Premium: NO per-account DAILY quota, but 8/minute burst protection
-- and 200/minute site-wide protection to control abuse and provider costs.
-- Gemini provider/model account limitations can still apply.
CREATE OR REPLACE FUNCTION public.claim_ai_quota(p_user uuid,p_kind text)
RETURNS TABLE(allowed boolean,reason text,remaining integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $
DECLARE
  utc_day timestamptz := date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
  minute_start timestamptz := date_trunc('minute',now());
  current_plan text;
  current_trial timestamptz;
  current_paid timestamptz;
  premium_active boolean;
  daily_count integer;
  short_burst_count integer;
  global_burst_count integer;
BEGIN
 IF p_user IS NULL OR p_kind NOT IN ('exam','storyboard') THEN
    RETURN QUERY SELECT false,'invalid'::text,0;RETURN;
 END IF;
 SELECT s.plan,s.trial_ends_at,s.paid_until
 INTO current_plan,current_trial,current_paid
 FROM public.teacher_subscriptions s WHERE s.user_id=p_user;
 IF current_plan IS NULL OR GREATEST(current_trial,COALESCE(current_paid,'-infinity'::timestamptz))<=now() THEN
    RETURN QUERY SELECT false,'expired'::text,0;RETURN;
 END IF;
 premium_active := current_plan='premium' AND current_paid>now();
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('waraqa-plan-ai-'||minute_start::text,0));
 SELECT count(*) INTO short_burst_count
   FROM public.ai_requests WHERE user_id=p_user AND created_at>=minute_start;
 IF short_burst_count>=8 THEN
   RETURN QUERY SELECT false,'burst'::text,0;RETURN;
 END IF;
 SELECT count(*) INTO global_burst_count
   FROM public.ai_requests WHERE created_at>=minute_start;
 IF global_burst_count>=200 THEN
   RETURN QUERY SELECT false,'global_burst'::text,0;RETURN;
 END IF;
 IF NOT premium_active THEN
   SELECT count(*) INTO daily_count
   FROM public.ai_requests WHERE user_id=p_user AND created_at>=utc_day;
   IF daily_count>=3 THEN
      RETURN QUERY SELECT false,'daily'::text,0;RETURN;
   END IF;
 END IF;
 INSERT INTO public.ai_requests(user_id,kind)VALUES(p_user,p_kind);
 RETURN QUERY SELECT true,(CASE WHEN premium_active THEN 'premium' ELSE 'basic' END)::text,
                     (CASE WHEN premium_active THEN -1 ELSE 2-daily_count END);
END;
$;
REVOKE ALL ON FUNCTION public.claim_ai_quota(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ai_quota(uuid,text) TO service_role;

COMMIT;

-- Before enabling SUBSCRIPTION_ENABLED=true, verify:
-- SELECT count(*) FROM public.teacher_subscriptions;
-- SELECT count(*) FROM public.subscription_payments;
-- Confirm storage bucket payment-proofs exists and is PRIVATE.
-- Supabase Auth: turn on email confirmation, restrict signup rate, and disable anonymous sign-ins.
