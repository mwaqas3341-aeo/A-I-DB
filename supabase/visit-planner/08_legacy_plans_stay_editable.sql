-- Plans that existed before the step-by-step setup (config_legacy) stay fully editable and re-preparable.
-- Previously, saving Step 1 or removing the last holiday on such a plan dropped it out of legacy / back to step 3,
-- which locked its saved visits. Wizard steps are optional for legacy plans.

-- 1) jurisdiction change must not take a legacy plan out of legacy
create or replace function public.visit_planner_config_check() returns trigger
language plpgsql set search_path = public as $$
declare n_hol int; has_priv boolean; clash date;
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
  if not new.config_legacy and new.config_step >= 4 and n_hol = 0 and not new.no_holidays_confirmed then
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

-- 2) removing the last holiday never locks a legacy plan
create or replace function public.visit_holiday_after() returns trigger
language plpgsql set search_path = public as $$
declare pid uuid := coalesce(new.planner_id, old.planner_id); n int;
begin
  select count(*) into n from visit_planner_holidays where planner_id = pid;
  if tg_op = 'INSERT' then
    update visit_planners set no_holidays_confirmed = false where id = pid and no_holidays_confirmed;
  end if;
  update visit_planners set config_step = 3 where id = pid and not config_legacy and config_step >= 4 and n = 0 and not no_holidays_confirmed;
  return null;
end $$;

-- 3) saving categories on a legacy plan never lowers its step
create or replace function public.visit_planner_save_categories(p_planner uuid, p_targets jsonb, p_reason text default null)
returns public.visit_planners
language plpgsql set search_path = public as $$
declare
  p public.visit_planners; t jsonb; cat text; mn int; mx int; cats text[] := '{}';
  has_priv boolean; reason text; step int;
begin
  select * into p from visit_planners where id = p_planner;
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
  delete from visit_planner_category_targets where planner_id = p.id and category <> all (cats);
  for t in select value from jsonb_array_elements(p_targets) loop
    insert into visit_planner_category_targets (planner_id, user_id, category, min_visits, max_visits)
    values (p.id, p.user_id, btrim(t->>'category'), (t->>'min_visits')::int, (t->>'max_visits')::int)
    on conflict (planner_id, category) do update set min_visits = excluded.min_visits, max_visits = excluded.max_visits;
  end loop;
  has_priv := cats && array['PRIVATE', 'ACADEMY'];
  reason := case when has_priv then nullif(btrim(coalesce(p_reason, p.private_visit_reason, '')), '') else null end;
  step := greatest(p.config_step, 2);
  if not has_priv then step := greatest(step, 3);
  elsif reason is null then step := 2; end if;
  if p.config_legacy then step := 5; end if;
  update visit_planners set private_visit_reason = reason, config_step = step where id = p.id returning * into p;
  return p;
end $$;

-- 4) repair plans that already have saved visits but were pushed back into the wizard
alter table public.visit_planners disable trigger visit_planners_config_check;
update public.visit_planners p
   set config_legacy = true, config_step = 5,
       no_holidays_confirmed = not exists (select 1 from visit_planner_holidays h where h.planner_id = p.id)
 where not config_legacy and config_step < 5
   and exists (select 1 from visit_planner_entries e where e.planner_id = p.id);
alter table public.visit_planners enable trigger visit_planners_config_check;
