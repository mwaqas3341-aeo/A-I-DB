-- Visit Planner: "Actual Visits" card + "On Leave" / "Other Duty" days (tentative AND actual).
-- Additive and re-runnable. Run once in the Supabase SQL editor (after 01-04).
-- Nothing outside the visit_* tables / functions is touched.

-- ════════════════════════════════════════════════════════════════════
-- A) Tentative planner: allow whole-day 'leave' and 'other_duty' entries (+ comment)
-- ════════════════════════════════════════════════════════════════════
alter table public.visit_planner_entries add column if not exists comment text;

-- drop the old CHECKs that mention entry_type (their names are auto-generated), then re-add the new ones
do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.visit_planner_entries'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) ilike '%entry_type%'
  loop
    execute format('alter table public.visit_planner_entries drop constraint %I', c);
  end loop;
end $$;

alter table public.visit_planner_entries drop constraint if exists visit_entries_comment_len;
alter table public.visit_planner_entries
  add constraint visit_entries_type_check check (entry_type in ('school','office','leave','other_duty')),
  add constraint visit_entries_school_needs_emis check (entry_type <> 'school' or emis_code is not null),
  add constraint visit_entries_comment_len check (comment is null or char_length(comment) <= 500);

create or replace function public.visit_entry_validate() returns trigger language plpgsql set search_path = public as $$
declare p record;
begin
  select user_id, year, month, leave_days into p from visit_planners where id = new.planner_id;
  if not found then raise exception 'Planner not found'; end if;
  new.user_id := p.user_id;
  if extract(year from new.visit_date)::int <> p.year or extract(month from new.visit_date)::int <> p.month then
    raise exception 'Visit date % is outside the planner month', new.visit_date;
  end if;
  if extract(dow from new.visit_date)::smallint = any (p.leave_days) then
    raise exception 'Visit date % falls on a weekly leave day', new.visit_date;
  end if;

  if new.entry_type = 'school' then
    if not exists (select 1 from visit_planner_pool(new.emis_code) q where q.emis = new.emis_code) then
      raise exception 'School % is outside your permitted jurisdiction', new.emis_code;
    end if;
  else
    new.emis_code := null; new.visit_sequence := null;
    new.school_name := null; new.markaz := null; new.tehsil := null; new.wing := null;
  end if;

  if new.entry_type in ('leave','other_duty') then
    new.slot := 1;                                   -- whole-day entry lives in slot 1
    if exists (select 1 from visit_planner_entries x
               where x.planner_id = new.planner_id and x.visit_date = new.visit_date and x.id is distinct from new.id) then
      raise exception '% already has other entries — remove them first', new.visit_date;
    end if;
  elsif exists (select 1 from visit_planner_entries x
                where x.planner_id = new.planner_id and x.visit_date = new.visit_date
                  and x.entry_type in ('leave','other_duty') and x.id is distinct from new.id) then
    raise exception '% is marked On Leave / Other Duty', new.visit_date;
  end if;

  if new.entry_type <> 'other_duty' then new.comment := null; end if;
  return new;
end $$;

-- ════════════════════════════════════════════════════════════════════
-- B) Actual visits: one plan per user + month, entries = EMIS code + date
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.visit_actual_plans (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  year         smallint not null check (year between 1900 and 2200),
  month        smallint not null check (month between 1 and 12),
  markaz_label text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, year, month)
);

create table if not exists public.visit_actual_entries (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references public.visit_actual_plans(id) on delete cascade,
  user_id     uuid not null,
  visit_date  date not null,
  slot        smallint not null default 1 check (slot in (1,2)),
  entry_type  text not null default 'school' check (entry_type in ('school','leave','other_duty')),
  emis_code   text,
  school_name text,                 -- filled by the trigger below from the user's jurisdiction pool
  markaz      text,
  tehsil      text,
  wing        text,
  comment     text check (comment is null or char_length(comment) <= 500),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (plan_id, visit_date, slot),
  check (entry_type <> 'school' or emis_code is not null)
);
create unique index if not exists visit_actual_no_same_day_dup on public.visit_actual_entries (plan_id, visit_date, emis_code) where emis_code is not null;
create index if not exists visit_actual_entries_plan_idx on public.visit_actual_entries (plan_id);

drop trigger if exists visit_actual_plans_touch on public.visit_actual_plans;
create trigger visit_actual_plans_touch before update on public.visit_actual_plans for each row execute function public.visit_set_updated_at();
drop trigger if exists visit_actual_entries_touch on public.visit_actual_entries;
create trigger visit_actual_entries_touch before update on public.visit_actual_entries for each row execute function public.visit_set_updated_at();

create or replace function public.visit_actual_entry_validate() returns trigger language plpgsql set search_path = public as $$
declare p record; s record;
begin
  select user_id, year, month into p from visit_actual_plans where id = new.plan_id;
  if not found then raise exception 'Actual-visits plan not found'; end if;
  new.user_id := p.user_id;
  if extract(year from new.visit_date)::int <> p.year or extract(month from new.visit_date)::int <> p.month then
    raise exception 'Visit date % is outside the plan month', new.visit_date;
  end if;

  if new.entry_type = 'school' then
    select q.* into s from visit_planner_pool(new.emis_code) q where q.emis = new.emis_code;
    if not found then raise exception 'EMIS % was not found in your permitted jurisdiction', new.emis_code; end if;
    new.school_name := s.school_name; new.markaz := s.markaz_name; new.tehsil := s.tehsil; new.wing := s.wing;
    if exists (select 1 from visit_actual_entries x
               where x.plan_id = new.plan_id and x.visit_date = new.visit_date
                 and x.entry_type <> 'school' and x.id is distinct from new.id) then
      raise exception '% is marked On Leave / Other Duty', new.visit_date;
    end if;
  else
    new.slot := 1;
    new.emis_code := null; new.school_name := null; new.markaz := null; new.tehsil := null; new.wing := null;
    if exists (select 1 from visit_actual_entries x
               where x.plan_id = new.plan_id and x.visit_date = new.visit_date and x.id is distinct from new.id) then
      raise exception '% already has other entries — remove them first', new.visit_date;
    end if;
  end if;

  if new.entry_type <> 'other_duty' then new.comment := null; end if;
  return new;
end $$;

drop trigger if exists visit_actual_entries_validate on public.visit_actual_entries;
create trigger visit_actual_entries_validate before insert or update on public.visit_actual_entries
  for each row execute function public.visit_actual_entry_validate();

-- RLS: every user sees / changes only their own rows (admins can read and fix any), same as the tentative planner
alter table public.visit_actual_plans   enable row level security;
alter table public.visit_actual_entries enable row level security;

drop policy if exists vap_select on public.visit_actual_plans;
drop policy if exists vap_insert on public.visit_actual_plans;
drop policy if exists vap_update on public.visit_actual_plans;
drop policy if exists vap_delete on public.visit_actual_plans;
create policy vap_select on public.visit_actual_plans for select to authenticated using (user_id = (select auth.uid()) or (select is_admin()));
create policy vap_insert on public.visit_actual_plans for insert to authenticated with check (user_id = (select auth.uid()));
create policy vap_update on public.visit_actual_plans for update to authenticated using (user_id = (select auth.uid()) or (select is_admin())) with check (user_id = (select auth.uid()) or (select is_admin()));
create policy vap_delete on public.visit_actual_plans for delete to authenticated using (user_id = (select auth.uid()) or (select is_admin()));

drop policy if exists vae_select on public.visit_actual_entries;
drop policy if exists vae_insert on public.visit_actual_entries;
drop policy if exists vae_update on public.visit_actual_entries;
drop policy if exists vae_delete on public.visit_actual_entries;
create policy vae_select on public.visit_actual_entries for select to authenticated using (user_id = (select auth.uid()) or (select is_admin()));
create policy vae_insert on public.visit_actual_entries for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (select 1 from public.visit_actual_plans p where p.id = plan_id and p.user_id = (select auth.uid())));
create policy vae_update on public.visit_actual_entries for update to authenticated using (user_id = (select auth.uid()) or (select is_admin())) with check (user_id = (select auth.uid()) or (select is_admin()));
create policy vae_delete on public.visit_actual_entries for delete to authenticated using (user_id = (select auth.uid()) or (select is_admin()));

revoke all on public.visit_actual_plans, public.visit_actual_entries from anon;
grant select, insert, update, delete on public.visit_actual_plans, public.visit_actual_entries to authenticated;
