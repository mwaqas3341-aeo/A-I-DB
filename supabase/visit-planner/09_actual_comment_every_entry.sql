-- Actual visits: the optional details/comment is kept for every entry type (school visits, leave, other duty).
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

  new.comment := nullif(btrim(coalesce(new.comment, '')), '');   -- an optional details/comment is kept on every entry type

  if new.entry_type = 'leave' then
    if exists (select 1 from visit_actual_entries x
               where x.plan_id = new.plan_id and x.visit_date = new.visit_date and x.id is distinct from new.id) then
      raise exception '% already has other entries — remove them first', new.visit_date;
    end if;
    new.emis_code := null; new.school_name := null; new.markaz := null; new.tehsil := null; new.wing := null;
    new.school_type := null; new.visit_type := null;
    return new;
  end if;

  if new.entry_type = 'school' then
    if new.emis_code is null then raise exception 'Select the school visited'; end if;
    if new.visit_type is null then raise exception 'Select the visit type (Online Monitoring / Assessment or Follow Up)'; end if;
  else
    new.visit_type := null;
    if new.comment is null then raise exception 'Write a comment describing the other duty (inquiry, exam duty, …)'; end if;
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

  return new;
end $$;
