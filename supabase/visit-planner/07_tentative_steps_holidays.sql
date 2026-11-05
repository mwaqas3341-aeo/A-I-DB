-- Visit Planner — Tentative Plan: step-by-step configuration + gazetted/local holidays.
-- Run AFTER 06_actual_visits_school_types.sql. Re-runnable (idempotent) and additive:
--   * visit_planners gets the jurisdiction (District/Wing/Tehsil/Markaz), the private-school reason,
--     the "no holidays" confirmation, the wizard progress (config_step 0-5) and finalized_at.
--   * visit_planner_category_targets — one row per selected school category with min / max visits.
--   * visit_planner_holidays        — gazetted / local holidays of the planner's month.
--   * Triggers enforce everything in the database (a client cannot skip a step or schedule on a holiday).
--   * Plans that already exist are marked config_legacy and keep working exactly as before.
-- Holidays become binding for ACTUAL visits once the tentative plan has been finalized (finalized_at is set).

-- ── 1) planner columns (+ one-time legacy backfill) ───────────────────
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'visit_planners' and column_name = 'config_step') then
    alter table public.visit_planners
      add column jur_district text, add column jur_wing text, add column jur_tehsil text, add column jur_markaz text,
      add column private_visit_reason text,
      add column no_holidays_confirmed boolean not null default false,
      add column config_step smallint not null default 0,
      add column config_legacy boolean not null default false,
      add column finalized_at timestamptz;
    -- plans that exist today predate the wizard: keep them fully editable, do not touch updated_at
    alter table public.visit_planners disable trigger visit_planners_touch;
    update public.visit_planners
       set config_step = 5, config_legacy = true, no_holidays_confirmed = true,
           finalized_at = case when status = 'finalized' then updated_at end;
    alter table public.visit_planners enable trigger visit_planners_touch;
  end if;
end $$;

alter table public.visit_planners drop constraint if exists visit_planners_config_step_check;
alter table public.visit_planners add constraint visit_planners_config_step_check check (config_step between 0 and 5);

-- ── 2) category targets ───────────────────────────────────────────────
-- `category` is a visit_planner_pool().source value (PUBLIC, HIGH, PIEMA, PEF, PRIVATE, ACADEMY, …): deliberately
-- NOT a CHECK list, the categories come from the school data and are validated against it by the RPC below.
create table if not exists public.visit_planner_category_targets (
  id          uuid primary key default gen_random_uuid(),
  planner_id  uuid not null references public.visit_planners(id) on delete cascade,
  user_id     uuid not null,
  category    text not null check (char_length(btrim(category)) > 0),
  min_visits  integer not null check (min_visits >= 0),
  max_visits  integer not null check (max_visits >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (planner_id, category),
  check (min_visits <= max_visits)
);
create index if not exists visit_targets_planner_idx on public.visit_planner_category_targets (planner_id);

-- ── 3) holidays ───────────────────────────────────────────────────────
create table if not exists public.visit_planner_holidays (
  id            uuid primary key default gen_random_uuid(),
  planner_id    uuid not null references public.visit_planners(id) on delete cascade,
  user_id       uuid not null,
  holiday_date  date not null,
  holiday_type  text not null check (holiday_type in ('gazetted', 'local')),
  name          text not null check (char_length(btrim(name)) > 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (planner_id, holiday_date)
);
create index if not exists visit_holidays_planner_idx on public.visit_planner_holidays (planner_id);

drop trigger if exists visit_targets_touch on public.visit_planner_category_targets;
create trigger visit_targets_touch before update on public.visit_planner_category_targets for each row execute function public.visit_set_updated_at();
drop trigger if exists visit_holidays_touch on public.visit_planner_holidays;
create trigger visit_holidays_touch before update on public.visit_planner_holidays for each row execute function public.visit_set_updated_at();

-- ── 4) RLS (same model as the other planner tables) ───────────────────
alter table public.visit_planner_category_targets enable row level security;
alter table public.visit_planner_holidays enable row level security;
do $$
declare t text;
begin
  foreach t in array array['visit_planner_category_targets', 'visit_planner_holidays'] loop
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format('drop policy if exists %I on public.%I', t || '_ins', t);
    execute format('drop policy if exists %I on public.%I', t || '_upd', t);
    execute format('drop policy if exists %I on public.%I', t || '_del', t);
    execute format('drop policy if exists aeo_only_module on public.%I', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()) or (select is_admin()))', t || '_sel', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()) and exists (select 1 from public.visit_planners p where p.id = planner_id and p.user_id = (select auth.uid())))', t || '_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid()) or (select is_admin())) with check (user_id = (select auth.uid()) or (select is_admin()))', t || '_upd', t);
    execute format('create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()) or (select is_admin()))', t || '_del', t);
    execute format('create policy aeo_only_module on public.%I as restrictive for all to authenticated using (is_admin() or is_aeo_user()) with check (is_admin() or is_aeo_user())', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- ── 5) planner trigger: wizard progress + finalisation rules ──────────
create or replace function public.visit_planner_config_check() returns trigger
language plpgsql set search_path = public as $$
declare n_hol int; has_priv boolean; clash date;
begin
  if tg_op = 'INSERT' then                       -- a new plan always starts at step 0, whatever the client sends
    new.config_step := 0; new.config_legacy := false; new.finalized_at := null; new.no_holidays_confirmed := false;
    if new.status = 'finalized' then new.status := 'draft'; end if;
    return new;
  end if;

  new.config_legacy := old.config_legacy;        -- clients can neither set nor forge these
  new.finalized_at  := old.finalized_at;

  if (new.jur_district, new.jur_wing, new.jur_tehsil, new.jur_markaz)
     is distinct from (old.jur_district, old.jur_wing, old.jur_tehsil, old.jur_markaz) then
    if old.status = 'finalized' then raise exception 'Re-open the plan for editing before changing its jurisdiction.'; end if;
    new.config_legacy := false;
    if old.config_step >= 2 then new.config_step := least(new.config_step, 1); end if;   -- categories etc. must be re-confirmed
  end if;

  if old.status = 'finalized' and new.status = 'finalized'
     and (new.private_visit_reason is distinct from old.private_visit_reason
          or new.no_holidays_confirmed is distinct from old.no_holidays_confirmed) then
    raise exception 'Re-open the plan for editing before changing its configuration.';
  end if;

  if not new.config_legacy then
    if new.config_step >= 1 and (coalesce(btrim(new.jur_district), '') = '' or coalesce(btrim(new.jur_wing), '') = ''
                                 or coalesce(btrim(new.jur_tehsil), '') = '' or coalesce(btrim(new.jur_markaz), '') = '') then
      raise exception 'Step 1: select District, Wing, Tehsil and Markaz first.';
    end if;
    if new.config_step >= 2 and not exists (select 1 from visit_planner_category_targets where planner_id = new.id) then
      raise exception 'Step 2: select at least one school category with its minimum and maximum visits.';
    end if;
    if new.config_step >= 3 then
      select exists (select 1 from visit_planner_category_targets where planner_id = new.id and category in ('PRIVATE', 'ACADEMY')) into has_priv;
      if has_priv and coalesce(btrim(new.private_visit_reason), '') = '' then
        raise exception 'Step 3: enter the Reason for Visiting Private Schools.';
      end if;
    end if;
  end if;

  select count(*) into n_hol from visit_planner_holidays where planner_id = new.id;
  if new.config_step >= 4 and n_hol = 0 and not new.no_holidays_confirmed then
    raise exception 'Step 4: add the month''s holidays or confirm that there are none.';
  end if;
  if new.no_holidays_confirmed and n_hol > 0 then
    raise exception 'Holidays are listed for this month, so "no holidays" cannot be confirmed.';
  end if;

  if new.status = 'finalized' then
    if new.config_step < 5 then raise exception 'Complete configuration steps 1–5 before finalizing the plan.'; end if;
    if old.status is distinct from 'finalized' then
      select e.visit_date into clash from visit_actual_entries e
        join visit_planner_holidays h on h.holiday_date = e.visit_date and h.planner_id = new.id
       where e.user_id = new.user_id limit 1;
      if found then raise exception 'An actual visit is already recorded on holiday date %. Remove it before finalizing.', clash; end if;
      new.finalized_at := now();
    end if;
  end if;
  return new;
end $$;
drop trigger if exists visit_planners_config_check on public.visit_planners;
create trigger visit_planners_config_check before insert or update on public.visit_planners
  for each row execute function public.visit_planner_config_check();

-- ── 6) holiday triggers ───────────────────────────────────────────────
create or replace function public.visit_holiday_check() returns trigger
language plpgsql set search_path = public as $$
declare p record;
begin
  if tg_op = 'DELETE' then
    select status into p from visit_planners where id = old.planner_id;
    if found and p.status = 'finalized' then raise exception 'Re-open the plan for editing before removing holidays.'; end if;
    return old;                                   -- (planner row already gone = cascade delete → allowed)
  end if;
  select user_id, year, month, status into p from visit_planners where id = new.planner_id;
  if not found then raise exception 'Planner not found'; end if;
  if p.status = 'finalized' then raise exception 'Re-open the plan for editing before changing holidays.'; end if;
  new.user_id := p.user_id;
  new.name := btrim(coalesce(new.name, ''));
  if new.name = '' then raise exception 'Enter the holiday name or description.'; end if;
  if extract(year from new.holiday_date)::int <> p.year or extract(month from new.holiday_date)::int <> p.month then
    raise exception 'Holiday date % is outside the planning month.', new.holiday_date;
  end if;
  if exists (select 1 from visit_planner_entries e where e.planner_id = new.planner_id and e.visit_date = new.holiday_date) then
    raise exception '% already has planned visits — remove them before marking it as a holiday.', new.holiday_date;
  end if;
  if exists (select 1 from visit_actual_entries e where e.user_id = p.user_id and e.visit_date = new.holiday_date) then
    raise exception 'An actual visit is already recorded on % — remove it before marking it as a holiday.', new.holiday_date;
  end if;
  return new;
end $$;
drop trigger if exists visit_holidays_check on public.visit_planner_holidays;
create trigger visit_holidays_check before insert or update or delete on public.visit_planner_holidays
  for each row execute function public.visit_holiday_check();

create or replace function public.visit_holiday_after() returns trigger
language plpgsql set search_path = public as $$
declare pid uuid := coalesce(new.planner_id, old.planner_id); n int;
begin
  select count(*) into n from visit_planner_holidays where planner_id = pid;
  if tg_op = 'INSERT' then
    update visit_planners set no_holidays_confirmed = false where id = pid and no_holidays_confirmed;
  end if;
  -- removing the last holiday un-confirms step 4 until the user states "no holidays" explicitly
  update visit_planners set config_step = 3 where id = pid and config_step >= 4 and n = 0 and not no_holidays_confirmed;
  return null;
end $$;
drop trigger if exists visit_holidays_after on public.visit_planner_holidays;
create trigger visit_holidays_after after insert or update or delete on public.visit_planner_holidays
  for each row execute function public.visit_holiday_after();

-- ── 7) category-target triggers ───────────────────────────────────────
create or replace function public.visit_target_check() returns trigger
language plpgsql set search_path = public as $$
declare p record;
begin
  if tg_op = 'DELETE' then
    select status into p from visit_planners where id = old.planner_id;
    if found and p.status = 'finalized' then raise exception 'Re-open the plan for editing before changing categories.'; end if;
    return old;
  end if;
  select user_id, status into p from visit_planners where id = new.planner_id;
  if not found then raise exception 'Planner not found'; end if;
  if p.status = 'finalized' then raise exception 'Re-open the plan for editing before changing categories.'; end if;
  new.user_id := p.user_id; new.category := btrim(new.category);
  return new;
end $$;
drop trigger if exists visit_targets_check on public.visit_planner_category_targets;
create trigger visit_targets_check before insert or update or delete on public.visit_planner_category_targets
  for each row execute function public.visit_target_check();

create or replace function public.visit_target_after() returns trigger
language plpgsql set search_path = public as $$
declare pid uuid := coalesce(new.planner_id, old.planner_id);
begin
  update visit_planners set config_step = 1 where id = pid and config_step >= 2 and not config_legacy
     and not exists (select 1 from visit_planner_category_targets where planner_id = pid);
  update visit_planners set config_step = 2 where id = pid and config_step >= 3 and not config_legacy
     and btrim(coalesce(private_visit_reason, '')) = ''
     and exists (select 1 from visit_planner_category_targets where planner_id = pid and category in ('PRIVATE', 'ACADEMY'));
  return null;
end $$;
drop trigger if exists visit_targets_after on public.visit_planner_category_targets;
create trigger visit_targets_after after insert or update or delete on public.visit_planner_category_targets
  for each row execute function public.visit_target_after();

-- ── 8) Step 2 RPC: validate + save all category targets atomically ────
-- p_targets = [{"category":"PUBLIC","min_visits":2,"max_visits":10}, …]. p_reason: pass NULL to keep the stored reason.
create or replace function public.visit_planner_save_categories(p_planner uuid, p_targets jsonb, p_reason text default null)
returns public.visit_planners
language plpgsql set search_path = public as $$
declare
  p public.visit_planners; t jsonb; cat text; mn int; mx int; cats text[] := '{}';
  has_priv boolean; reason text; step int;
begin
  select * into p from visit_planners where id = p_planner;        -- RLS: owner / admin only
  if not found then raise exception 'Planner not found'; end if;
  if p.status = 'finalized' then raise exception 'Re-open the plan for editing before changing categories.'; end if;
  if coalesce(btrim(p.jur_district), '') = '' or coalesce(btrim(p.jur_wing), '') = '' or coalesce(btrim(p.jur_tehsil), '') = ''
     or coalesce(btrim(p.jur_markaz), '') = '' then
    raise exception 'Complete Step 1 (District, Wing, Tehsil, Markaz) first.';
  end if;
  if jsonb_typeof(p_targets) is distinct from 'array' or jsonb_array_length(p_targets) = 0 then
    raise exception 'Select at least one school category.';
  end if;

  for t in select value from jsonb_array_elements(p_targets) loop
    cat := btrim(coalesce(t->>'category', ''));
    if cat = '' then raise exception 'A category is missing its name.'; end if;
    if cat = any (cats) then raise exception 'Category % is listed twice.', cat; end if;
    if coalesce(t->>'min_visits', '') !~ '^\d{1,4}$' or coalesce(t->>'max_visits', '') !~ '^\d{1,4}$' then
      raise exception 'Minimum and maximum visits for % must be whole numbers (0 or more).', cat;
    end if;
    mn := (t->>'min_visits')::int; mx := (t->>'max_visits')::int;
    if mn > mx then raise exception 'Minimum visits cannot exceed maximum visits for %.', cat; end if;
    if not exists (select 1 from visit_planner_pool() q
                    where q.source = cat and q.district = p.jur_district and q.tehsil = p.jur_tehsil
                      and (q.source = 'HIGH' or q.wing = p.jur_wing)
                      and (p.jur_markaz = 'ALL' or q.markaz_name = p.jur_markaz)) then
      raise exception 'There are no eligible % schools in the selected jurisdiction.', cat;
    end if;
    cats := cats || cat;
  end loop;

  delete from visit_planner_category_targets where planner_id = p.id and category <> all (cats);   -- never passes through "empty"
  for t in select value from jsonb_array_elements(p_targets) loop
    insert into visit_planner_category_targets (planner_id, user_id, category, min_visits, max_visits)
    values (p.id, p.user_id, btrim(t->>'category'), (t->>'min_visits')::int, (t->>'max_visits')::int)
    on conflict (planner_id, category) do update set min_visits = excluded.min_visits, max_visits = excluded.max_visits;
  end loop;

  has_priv := cats && array['PRIVATE', 'ACADEMY'];
  reason := case when has_priv then nullif(btrim(coalesce(p_reason, p.private_visit_reason, '')), '') else null end;
  step := greatest(p.config_step, 2);
  if not has_priv then step := greatest(step, 3);                  -- step 3 does not apply without private schools
  elsif reason is null then step := 2; end if;

  update visit_planners set private_visit_reason = reason, config_step = step where id = p.id returning * into p;
  return p;
end $$;
revoke all on function public.visit_planner_save_categories(uuid, jsonb, text) from public, anon;
grant execute on function public.visit_planner_save_categories(uuid, jsonb, text) to authenticated;

-- ── 9) holidays that bind ACTUAL visits (tentative plan finalized) ────
create or replace function public.visit_effective_holidays(p_year int, p_month int)
returns table (holiday_date date, holiday_type text, name text)
language sql stable set search_path = public as $$
  select h.holiday_date, h.holiday_type, h.name
    from visit_planner_holidays h join visit_planners p on p.id = h.planner_id
   where p.user_id = auth.uid() and p.year = p_year and p.month = p_month and p.finalized_at is not null
   order by h.holiday_date;
$$;
revoke all on function public.visit_effective_holidays(int, int) from public, anon;
grant execute on function public.visit_effective_holidays(int, int) to authenticated;

-- ── 10) tentative entries: setup must be complete + no visits on holidays ──
create or replace function public.visit_entry_validate() returns trigger
language plpgsql set search_path = public as $$
declare p record; h record;
begin
  select user_id, year, month, leave_days, config_step into p from visit_planners where id = new.planner_id;
  if not found then raise exception 'Planner not found'; end if;
  new.user_id := p.user_id;
  if p.config_step < 5 then
    raise exception 'Complete setup steps 1–5 (jurisdiction, categories, private-school reason, holidays, leave & schools) before planning visits.';
  end if;
  if extract(year from new.visit_date)::int <> p.year or extract(month from new.visit_date)::int <> p.month then
    raise exception 'Visit date % is outside the planner month', new.visit_date;
  end if;
  if extract(dow from new.visit_date)::smallint = any (p.leave_days) then
    raise exception 'Visit date % falls on a weekly leave day', new.visit_date;
  end if;
  select holiday_type, name into h from visit_planner_holidays where planner_id = new.planner_id and holiday_date = new.visit_date;
  if found then raise exception '% is a % holiday (%) — no visits can be planned on a holiday.', new.visit_date, h.holiday_type, h.name; end if;
  if new.entry_type = 'school' then
    if not exists (select 1 from visit_planner_pool(new.emis_code) q where q.emis = new.emis_code) then
      raise exception 'School % is outside your permitted jurisdiction', new.emis_code;
    end if;
  else
    new.emis_code := null; new.visit_sequence := null;
  end if;
  return new;
end $$;

-- ── 11) actual entries: no visits on the holidays of the finalized tentative plan ──
create or replace function public.visit_actual_entry_validate() returns trigger
language plpgsql set search_path = public as $$
declare p record; w record; hol record;
begin
  select user_id, year, month into p from visit_actual_plans where id = new.plan_id;
  if not found then raise exception 'Actual-visits plan not found'; end if;
  new.user_id := p.user_id;
  if extract(year from new.visit_date)::int <> p.year or extract(month from new.visit_date)::int <> p.month then
    raise exception 'Visit date % is outside the plan month', new.visit_date;
  end if;
  select h.holiday_type, h.name into hol
    from visit_planner_holidays h join visit_planners vp on vp.id = h.planner_id
   where vp.user_id = p.user_id and vp.year = p.year and vp.month = p.month and vp.finalized_at is not null
     and h.holiday_date = new.visit_date limit 1;
  if found then raise exception '% is a % holiday (%) — nothing can be recorded on a holiday.', new.visit_date, hol.holiday_type, hol.name; end if;
  if exists (select 1 from visit_actual_entries x
             where x.plan_id = new.plan_id and x.visit_date = new.visit_date and x.entry_type = 'leave' and x.id is distinct from new.id) then
    raise exception '% is marked On Leave — remove the leave entry first', new.visit_date;
  end if;

  if new.entry_type = 'leave' then
    if exists (select 1 from visit_actual_entries x
               where x.plan_id = new.plan_id and x.visit_date = new.visit_date and x.id is distinct from new.id) then
      raise exception '% already has other entries — remove them first', new.visit_date;
    end if;
    new.emis_code := null; new.school_name := null; new.markaz := null; new.tehsil := null; new.wing := null;
    new.school_type := null; new.visit_type := null; new.comment := null;
    return new;
  end if;

  if new.entry_type = 'school' then
    if new.emis_code is null then raise exception 'Select the school visited'; end if;
    if new.visit_type is null then raise exception 'Select the visit type (Online Monitoring / Assessment or Follow Up)'; end if;
  else
    new.visit_type := null;
    if btrim(coalesce(new.comment, '')) = '' then raise exception 'Write a comment describing the other duty (inquiry, exam duty, …)'; end if;
  end if;

  if new.emis_code is not null then
    select x.* into w from visit_actual_wide_pool(new.emis_code) x where x.emis = new.emis_code;
    if not found then raise exception 'School % was not found in your permitted area', new.emis_code; end if;
    if new.entry_type = 'school' and not coalesce(is_admin(), false)
       and not exists (select 1 from visit_planner_pool(new.emis_code) q where q.emis = new.emis_code) then
      raise exception 'School % is outside your assigned jurisdiction (only Other Duty may use any school of the district)', new.emis_code;
    end if;
    if new.school_type is not null and new.school_type <> w.kind then
      raise exception 'EMIS % is a % school, not %', new.emis_code, w.kind, new.school_type;
    end if;
    new.school_type := w.kind;
    new.school_name := w.school_name; new.markaz := w.markaz_name; new.tehsil := w.tehsil; new.wing := w.wing;
  else
    new.school_name := null; new.markaz := null; new.tehsil := null; new.wing := null; new.school_type := null;
  end if;

  if new.entry_type <> 'other_duty' then new.comment := null; end if;
  return new;
end $$;
