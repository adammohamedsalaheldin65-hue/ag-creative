-- WARAQA STUDENT PORTAL MIGRATION.
-- RUN ONLY IN THE WARAQA SUPABASE PROJECT: vhyygvbqemhqirbcycev.supabase.co
-- Run AFTER supabase/schema.sql and supabase/subscriptions.sql.
-- NEVER run in the unrelated project igqjgvnwxvgxujxhfgkh.
-- Existing teacher accounts retain paid subscriptions, exams and image policies.
BEGIN;

-- Immutable account role. Students can neither edit their role nor grant themselves teacher access.
CREATE TABLE IF NOT EXISTS public.waraqa_accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('teacher','student')),
  display_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.waraqa_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.waraqa_accounts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.waraqa_accounts TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.waraqa_accounts TO service_role;
DROP POLICY IF EXISTS "Account owner reads their role" ON public.waraqa_accounts;
CREATE POLICY "Account owner reads their role" ON public.waraqa_accounts
 FOR SELECT TO authenticated USING (user_id=(SELECT auth.uid()));

-- For existing accounts, keep them teachers. New accounts choose role at signup.
INSERT INTO public.waraqa_accounts(user_id,role,display_name)
SELECT id,'teacher',left(COALESCE(raw_user_meta_data->>'full_name',email,''),80)
FROM auth.users WHERE is_anonymous IS DISTINCT FROM TRUE
ON CONFLICT(user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.waraqa_register_account()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
  IF NEW.is_anonymous IS DISTINCT FROM TRUE THEN
    INSERT INTO public.waraqa_accounts(user_id,role,display_name)
    VALUES (
      NEW.id,
      CASE WHEN NEW.raw_user_meta_data->>'waraqa_role'='student' THEN 'student' ELSE 'teacher' END,
      left(COALESCE(NEW.raw_user_meta_data->>'full_name',split_part(COALESCE(NEW.email,''),'@',1),'المستخدم'),80)
    )
    ON CONFLICT(user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS on_waraqa_account_registered ON auth.users;
CREATE TRIGGER on_waraqa_account_registered AFTER INSERT ON auth.users
 FOR EACH ROW EXECUTE FUNCTION public.waraqa_register_account();

-- Replace previous teacher-only trial trigger. Student signups never get teacher billing trials.
CREATE OR REPLACE FUNCTION public.waraqa_create_trial()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
  IF NEW.is_anonymous IS DISTINCT FROM TRUE
     AND NEW.raw_user_meta_data->>'waraqa_role' IS DISTINCT FROM 'student' THEN
    INSERT INTO public.teacher_subscriptions(user_id,trial_started_at,trial_ends_at)
    VALUES (NEW.id,NEW.created_at,NEW.created_at+interval '1 month')
    ON CONFLICT(user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- Keep teacher-only exam storage access even when a user is authenticated as a student.
CREATE OR REPLACE FUNCTION public.waraqa_has_access()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.teacher_subscriptions s
    JOIN public.waraqa_accounts a ON a.user_id=s.user_id AND a.role='teacher'
    WHERE s.user_id=(SELECT auth.uid())
      AND GREATEST(s.trial_ends_at,COALESCE(s.paid_until,'-infinity'::timestamptz))>now()
  );
$$;
REVOKE ALL ON FUNCTION public.waraqa_has_access() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.waraqa_has_access() TO authenticated,service_role;

-- Separate student AI ledger; no student/teacher can insert into it from the client.
CREATE TABLE IF NOT EXISTS public.student_ai_requests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS student_ai_requests_day ON public.student_ai_requests(created_at,user_id);
ALTER TABLE public.student_ai_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.student_ai_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.student_ai_requests TO service_role;

-- Tight platform-wide budget guard: 2 student jobs/user/day, 25 total/day,
-- max 2 per user/minute. Claims are atomic; counts are server/database enforced.
CREATE OR REPLACE FUNCTION public.claim_student_ai_quota(p_user uuid)
RETURNS TABLE(allowed boolean,reason text,remaining integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  day_start timestamptz := date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  minute_start timestamptz := date_trunc('minute',now());
  user_day integer;
  site_day integer;
  user_minute integer;
BEGIN
  IF p_user IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.waraqa_accounts WHERE user_id=p_user AND role='student'
  ) THEN
    RETURN QUERY SELECT false,'role'::text,0;RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('waraqa-student-ai-'||day_start::text,0)
  );
  SELECT count(*) INTO user_day FROM public.student_ai_requests
    WHERE user_id=p_user AND created_at>=day_start;
  SELECT count(*) INTO site_day FROM public.student_ai_requests
    WHERE created_at>=day_start;
  SELECT count(*) INTO user_minute FROM public.student_ai_requests
    WHERE user_id=p_user AND created_at>=minute_start;
  IF site_day>=25 THEN RETURN QUERY SELECT false,'global'::text,0;RETURN;END IF;
  IF user_day>=2 THEN RETURN QUERY SELECT false,'daily'::text,0;RETURN;END IF;
  IF user_minute>=2 THEN RETURN QUERY SELECT false,'burst'::text,0;RETURN;END IF;
  INSERT INTO public.student_ai_requests(user_id) VALUES(p_user);
  RETURN QUERY SELECT true,'ok'::text,1-user_day;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_student_ai_quota(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_student_ai_quota(uuid) TO service_role;

-- Published quizzes keep PRIVATE answer keys; students receive only stripped public questions.
CREATE TABLE IF NOT EXISTS public.waraqa_quizzes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 teacher_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 source_exam_id uuid REFERENCES public.exams(id) ON DELETE SET NULL,
 access_code text NOT NULL UNIQUE CHECK (access_code ~ '^[A-F0-9]{12}$'),
 title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
 subject text NOT NULL DEFAULT '',
 grade text NOT NULL DEFAULT '',
 questions jsonb NOT NULL CHECK (jsonb_typeof(questions)='array' AND octet_length(questions::text)<100000),
 enabled boolean NOT NULL DEFAULT true,
 expires_at timestamptz NOT NULL DEFAULT (now()+interval '60 days'),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS waraqa_quizzes_teacher_time ON public.waraqa_quizzes(teacher_id,created_at DESC);
ALTER TABLE public.waraqa_quizzes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.waraqa_quizzes FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.waraqa_quizzes TO service_role;

CREATE TABLE IF NOT EXISTS public.waraqa_quiz_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 quiz_id uuid NOT NULL REFERENCES public.waraqa_quizzes(id) ON DELETE CASCADE,
 student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 responses jsonb NOT NULL CHECK (jsonb_typeof(responses)='object' AND octet_length(responses::text)<12000),
 correct_count integer NOT NULL CHECK (correct_count>=0),
 question_count integer NOT NULL CHECK (question_count>0),
 score_percent numeric(5,2) NOT NULL CHECK(score_percent>=0 AND score_percent<=100),
 submitted_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(quiz_id,student_id)
);
CREATE INDEX IF NOT EXISTS waraqa_quiz_attempts_student_time
 ON public.waraqa_quiz_attempts(student_id,submitted_at DESC);
ALTER TABLE public.waraqa_quiz_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.waraqa_quiz_attempts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.waraqa_quiz_attempts TO service_role;

COMMIT;

-- SECURITY CHECKS after applying (run separately):
-- select role,count(*) from public.waraqa_accounts group by role;
-- select proname from pg_proc where proname='claim_student_ai_quota';
-- Confirm public.waraqa_quizzes and public.waraqa_quiz_attempts have RLS enabled.
