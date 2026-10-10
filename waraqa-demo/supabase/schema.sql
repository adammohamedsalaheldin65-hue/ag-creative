-- ورقة | Supabase production setup
-- Run in a NEW Supabase project dedicated to this site.
-- Never put secret service_role or Gemini keys in the browser or GitHub.

create extension if not exists pgcrypto;

create table if not exists public.exams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exams_payload_object check (jsonb_typeof(payload)='object'),
  constraint exams_payload_size check (octet_length(payload::text) < 300000)
);

create index if not exists exams_user_date_idx on public.exams(user_id,created_at desc);

alter table public.exams enable row level security;
revoke all on public.exams from anon;
grant select,insert,update,delete on public.exams to authenticated;

drop policy if exists "Teachers select own exams" on public.exams;
create policy "Teachers select own exams" on public.exams for select
  to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Teachers insert own exams" on public.exams;
create policy "Teachers insert own exams" on public.exams for insert
  to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Teachers update own exams" on public.exams;
create policy "Teachers update own exams" on public.exams for update
  to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "Teachers delete own exams" on public.exams;
create policy "Teachers delete own exams" on public.exams for delete
  to authenticated using ((select auth.uid()) = user_id);

-- Private images. Paths start with the owner's auth uid.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values('exam-images','exam-images',false,2000000,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=2000000,allowed_mime_types=array['image/jpeg','image/png','image/webp'];

drop policy if exists "Teachers read own images" on storage.objects;
create policy "Teachers read own images" on storage.objects for select to authenticated
  using (bucket_id='exam-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Teachers upload own images" on storage.objects;
create policy "Teachers upload own images" on storage.objects for insert to authenticated
  with check (bucket_id='exam-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Teachers replace own images" on storage.objects;
create policy "Teachers replace own images" on storage.objects for update to authenticated
  using (bucket_id='exam-images' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id='exam-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Teachers delete own images" on storage.objects;
create policy "Teachers delete own images" on storage.objects for delete to authenticated
  using (bucket_id='exam-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- The AI usage ledger is PRIVATE; users cannot edit or query it.
create table if not exists public.ai_requests (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check (kind in ('exam','storyboard')),
 created_at timestamptz not null default now()
);
create index if not exists ai_requests_daily_idx on public.ai_requests(created_at,user_id);
alter table public.ai_requests enable row level security;
revoke all on public.ai_requests from public,anon,authenticated;
grant select,insert on public.ai_requests to service_role;

-- Atomic quota under an advisory lock: max 3 AI requests per browser identity and 30 total per UTC day.
-- Anonymous users can create new identities if they clear browser storage; the hard GLOBAL cap remains in effect.
-- The application server calls this with the service role ONLY after verifying /auth/v1/user.
create or replace function public.claim_ai_quota(p_user uuid,p_kind text)
returns table(allowed boolean,reason text,remaining integer)
language plpgsql security definer set search_path=''
as $$
declare 
 day_start timestamptz := date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
 user_count integer;
 global_count integer;
begin
 if p_user is null or p_kind not in ('exam','storyboard') then
   return query select false,'invalid'::text,0; return;
 end if;
 -- Lock all claims for the day to avoid concurrent quota bypasses.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('waraqa-ai-quota-'||day_start::text,0));
 select count(*) into user_count from public.ai_requests
 where user_id=p_user and created_at>=day_start;
 select count(*) into global_count from public.ai_requests
 where created_at>=day_start;
 if user_count>=3 then return query select false,'daily'::text,0; return; end if;
 if global_count>=30 then return query select false,'global'::text,0; return; end if;
 insert into public.ai_requests(user_id,kind) values (p_user,p_kind);
 return query select true,'ok'::text,2-user_count;
end;
$$;
revoke all on function public.claim_ai_quota(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_ai_quota(uuid,text) to service_role;

-- Verify after running: SQL Editor -> select * from pg_policies where schemaname='public';
-- For passwordless teacher AI, enable Anonymous Sign-Ins in Supabase Auth > Providers.
-- Rate limits/CAPTCHA on anonymous signups strongly recommended; anonymous users can exhaust the platform-wide daily quota.
-- Keep ALLOW_ANONYMOUS_AI=false until the platform keys, policy and privacy notices are configured.
