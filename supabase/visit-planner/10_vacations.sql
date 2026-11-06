-- Summer / winter vacations: a date range (up to 3 months) that makes every covered day a non-working day in the
-- tentative AND actual planners of ALL months it touches (present and future). Stored once per user, not per month.
create table if not exists public.visit_vacations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  vacation_type text not null check (vacation_type in ('summer', 'winter')),
  start_date    date not null,
  end_date      date not null,
  name          text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (end_date >= start_date),
  check (end_date <= (start_date + interval '3 months' - interval '1 day')::date)
);
create index if not exists visit_vacations_user_idx on public.visit_vacations (user_id, start_date, end_date);
drop trigger if exists visit_vacations_touch on public.visit_vacations;
create trigger visit_vacations_touch before update on public.visit_vacations for each row execute function public.visit_set_updated_at();

alter table public.visit_vacations enable row level security;
drop policy if exists visit_vacations_sel on public.visit_vacations; drop policy if exists visit_vacations_ins on public.visit_vacations;
drop policy if exists visit_vacations_upd on public.visit_vacations; drop policy if exists visit_vacations_del on public.visit_vacations;
drop policy if exists aeo_only_module on public.visit_vacations;
create policy visit_vacations_sel on public.visit_vacations for select to authenticated using (user_id = (select auth.uid()) or (select is_admin()));
create policy visit_vacations_ins on public.visit_vacations for insert to authenticated with check (user_id = (select auth.uid()));
create policy visit_vacations_upd on public.visit_vacations for update to authenticated using (user_id = (select auth.uid()) or (select is_admin())) with check (user_id = (select auth.uid()) or (select is_admin()));
create policy visit_vacations_del on public.visit_vacations for delete to authenticated using (user_id = (select auth.uid()) or (select is_admin()));
create policy aeo_only_module on public.visit_vacations as restrictive for all to authenticated using (is_admin() or is_aeo_user()) with check (is_admin() or is_aeo_user());
revoke all on public.visit_vacations from anon;

-- rules + automatic adjustment of existing plans
create or replace function public.visit_vacation_check() returns trigger
language plpgsql set search_path = public as $$
declare d date; pl record;
begin
  if new.end_date < new.start_date then raise exception 'The vacation end date cannot be before its start date.'; end if;
  if new.end_date > (new.start_date + interval '3 months' - interval '1 day')::date then
    raise exception 'A vacation can last at most 3 months.';
  end if;
  new.name := coalesce(nullif(btrim(new.name), ''), case new.vacation_type when 'summer' then 'Summer vacation' else 'Winter vacation' end);
  select v.start_date into d from visit_vacations v
   where v.user_id = new.user_id and v.id is distinct from new.id and v.start_date <= new.end_date and v.end_date >= new.start_date limit 1;
  if found then raise exception 'This period overlaps another vacation you already added (starting %).', d; end if;
  select e.visit_date into d from visit_actual_entries e
   where e.user_id = new.user_id and e.visit_date between new.start_date and new.end_date order by e.visit_date limit 1;
  if found then raise exception 'Actual visits are already recorded on % (inside this vacation). Remove them first.', d; end if;
  select p.year, p.month into pl from visit_planners p
   where p.user_id = new.user_id and p.status = 'finalized'
     and exists (select 1 from visit_planner_entries e where e.planner_id = p.id and e.visit_date between new.start_date and new.end_date) limit 1;
  if found then raise exception 'The finalized tentative plan of %-% has visits inside this vacation. Re-open that plan first.', pl.year, lpad(pl.month::text, 2, '0'); end if;
  delete from visit_planner_entries e using visit_planners p
   where e.planner_id = p.id and p.user_id = new.user_id and e.visit_date between new.start_date and new.end_date;
  return new;
end $$;
drop trigger if exists visit_vacation_check on public.visit_vacations;
create trigger visit_vacation_check before insert or update on public.visit_vacations for each row execute function public.visit_vacation_check();

-- when a vacation shrinks/disappears, plans that relied on it for Step 4 go back to Step 4
create or replace function public.visit_vacation_after() returns trigger
language plpgsql set search_path = public as $$
begin
  update visit_planners p set config_step = 3
   where p.user_id = old.user_id and not p.config_legacy and p.config_step >= 4 and not p.no_holidays_confirmed
     and make_date(p.year, p.month, 1) <= old.end_date and (make_date(p.year, p.month, 1) + interval '1 month' - interval '1 day')::date >= old.start_date
     and not exists (select 1 from visit_planner_holidays h where h.planner_id = p.id)
     and not exists (select 1 from visit_vacations v where v.user_id = p.user_id
                       and v.start_date <= (make_date(p.year, p.month, 1) + interval '1 month' - interval '1 day')::date and v.end_date >= make_date(p.year, p.month, 1));
  return null;
end $$;
drop trigger if exists visit_vacation_after on public.visit_vacations;
create trigger visit_vacation_after after update or delete on public.visit_vacations for each row execute function public.visit_vacation_after();

-- no visit / leave / duty on a vacation day, tentative or actual
create or replace function public.visit_vacation_block_entry() returns trigger
language plpgsql set search_path = public as $$
declare u uuid; v record;
begin
  if tg_table_name = 'visit_planner_entries' then select user_id into u from visit_planners where id = new.planner_id;
  else select user_id into u from visit_actual_plans where id = new.plan_id; end if;
  select vacation_type, name, start_date, end_date into v from visit_vacations
   where user_id = u and new.visit_date between start_date and end_date limit 1;
  if found then raise exception '% falls in "%" (% to %) — nothing can be planned or recorded on a vacation day.', new.visit_date, v.name, v.start_date, v.end_date; end if;
  return new;
end $$;
drop trigger if exists zz_vacation_block on public.visit_planner_entries;
create trigger zz_vacation_block before insert or update of visit_date on public.visit_planner_entries for each row execute function public.visit_vacation_block_entry();
drop trigger if exists zz_vacation_block on public.visit_actual_entries;
create trigger zz_vacation_block before insert or update of visit_date on public.visit_actual_entries for each row execute function public.visit_vacation_block_entry();

create or replace function public.visit_effective_vacations(p_year int, p_month int)
returns table (id uuid, vacation_type text, start_date date, end_date date, name text)
language sql stable set search_path = public as $$
  select v.id, v.vacation_type, v.start_date, v.end_date, v.name from visit_vacations v
   where v.user_id = (select auth.uid())
     and v.start_date <= (make_date(p_year, p_month, 1) + interval '1 month' - interval '1 day')::date and v.end_date >= make_date(p_year, p_month, 1)
   order by v.start_date;
$$;

-- Step 4 of the wizard also counts a vacation touching the month
create or replace function public.visit_planner_config_check() returns trigger
language plpgsql set search_path = public as $$
declare n_hol int; n_vac int; has_priv boolean; clash date;
begin
  if tg_op = 'INSERT' then
    new.config_step := 0; new.config_legacy := false; new.finalized_at := null; new.no_holidays_confirmed := false;
    if new.status = 'finalized' then new.status := 'draft'; end if;
    return new;
  end if;

  new.config_legacy := old.config_legacy;
  new.finalized_at  := old.finalized_at;
  if old.config_legacy then new.config_step := 5; end if;     -- legacy plans always stay at "setup complete"

  if (new.jur_district, new.jur_wing, new.jur_tehsil, new.jur_markaz)
     is distinct from (old.jur_district, old.jur_wing, old.jur_tehsil, old.jur_markaz) then
    if old.status = 'finalized' then raise exception 'Re-open the plan for editing before changing its jurisdiction.'; end if;
    if not old.config_legacy and old.config_step >= 2 then new.config_step := least(new.config_step, 1); end if;
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
  select count(*) into n_vac from visit_vacations v where v.user_id = new.user_id
     and v.start_date <= (make_date(new.year, new.month, 1) + interval '1 month' - interval '1 day')::date and v.end_date >= make_date(new.year, new.month, 1);
  if not new.config_legacy and new.config_step >= 4 and n_hol = 0 and n_vac = 0 and not new.no_holidays_confirmed then
    raise exception 'Step 4: add the month''s holidays or vacation, or confirm that there are none.';
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

create or replace function public.visit_holiday_after() returns trigger
language plpgsql set search_path = public as $$
declare pid uuid := coalesce(new.planner_id, old.planner_id); n int; nv int;
begin
  select count(*) into n from visit_planner_holidays where planner_id = pid;
  select count(*) into nv from visit_vacations v join visit_planners p on p.id = pid and v.user_id = p.user_id
     and v.start_date <= (make_date(p.year, p.month, 1) + interval '1 month' - interval '1 day')::date and v.end_date >= make_date(p.year, p.month, 1);
  if tg_op = 'INSERT' then
    update visit_planners set no_holidays_confirmed = false where id = pid and no_holidays_confirmed;
  end if;
  update visit_planners set config_step = 3 where id = pid and not config_legacy and config_step >= 4 and n = 0 and nv = 0 and not no_holidays_confirmed;
  return null;
end $$;
