-- Visit Planner — Actual Visits, round 2. Run AFTER 05_actual_visits_leave_other_duty.sql. Re-runnable, additive.
--  * any number of schools per day (the 2-slot limit is removed for ACTUAL visits only)
--  * each school visit records its school type (public / outsourced / piema / pef / private) and
--    visit type (monitoring_assessment / follow_up)
--  * Other Duty may point at ANY school of the user's district (or any school for admins) + a required comment
--  * new read-only function visit_actual_wide_pool(): every school the user may pick, with its kind.
--    The existing visit_planner_pool() and the tentative planner are NOT touched.

-- ── 1) columns + constraints ─────────────────────────────────────────
alter table public.visit_actual_entries add column if not exists school_type text;
alter table public.visit_actual_entries add column if not exists visit_type  text;

-- drop the 2-slot rule (CHECK on slot + UNIQUE(plan_id, visit_date, slot)); slot stays as a harmless column
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.visit_actual_entries'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) ilike '%slot%'
  loop execute format('alter table public.visit_actual_entries drop constraint %I', c.conname); end loop;
  for c in select con.conname from pg_constraint con
           where con.conrelid = 'public.visit_actual_entries'::regclass and con.contype = 'u'
             and (select array_agg(a.attname::text order by a.attname) from pg_attribute a
                  where a.attrelid = con.conrelid and a.attnum = any (con.conkey)) = array['plan_id','slot','visit_date']
  loop execute format('alter table public.visit_actual_entries drop constraint %I', c.conname); end loop;
end $$;

alter table public.visit_actual_entries drop constraint if exists visit_actual_school_type_check;
alter table public.visit_actual_entries drop constraint if exists visit_actual_visit_type_check;
alter table public.visit_actual_entries drop constraint if exists visit_actual_visit_needs_type;
alter table public.visit_actual_entries drop constraint if exists visit_actual_duty_needs_comment;
alter table public.visit_actual_entries
  add constraint visit_actual_school_type_check check (school_type is null or school_type in ('public','outsourced','piema','pef','private')),
  add constraint visit_actual_visit_type_check  check (visit_type  is null or visit_type  in ('monitoring_assessment','follow_up')),
  -- NOT VALID: rows saved before this migration are left alone, every new / edited row is checked
  add constraint visit_actual_visit_needs_type  check (entry_type <> 'school' or visit_type is not null) not valid,
  add constraint visit_actual_duty_needs_comment check (entry_type <> 'other_duty' or char_length(btrim(coalesce(comment,''))) > 0) not valid;

create index if not exists visit_actual_entries_date_idx on public.visit_actual_entries (plan_id, visit_date, created_at);

-- ── 2) every school the user may pick, with its kind ─────────────────
-- Non-admin: own district + anything fn_jurisdiction_visible() allows (covers extra assigned districts). Admin: everything.
-- kind: outsourced = public_schools.status 'Out Sourced'; the allocation file (High / PIEMA / PEF) wins over public_schools,
-- exactly as in visit_planner_pool(). Private schools are identified by unique_id (same convention as the pool).
create or replace function public.visit_actual_wide_pool(p_code text default null)
returns table (emis text, school_name text, level text, district text, tehsil text, wing text, markaz_name text, kind text)
language sql stable security definer set search_path = public as $$
  with me as (select district from app_users where id = auth.uid()),
  mk as (
    select distinct on (upper(district), markaz_name) upper(district) dist, markaz_name, tehsil, wing
    from public_schools
    where level not in ('High','H.Sec.') and markaz_name is not null and district is not null
    order by upper(district), markaz_name
  ),
  cand as (
    select 0 pr, a.emis, a.school_name, a.level, a.district, a.tehsil, ps.wing, a.assigned_markaz_name markaz_name,
           case when ps.status = 'Out Sourced' then 'outsourced' else 'public' end kind
    from visit_school_allocation a left join public_schools ps on ps.emis = a.emis
    where (p_code is null or a.emis = p_code)
    union all
    select 1, x.emis_code, x.school_name, x.level, upper(x.district), mk.tehsil, coalesce(ps.wing, mk.wing), x.markaz_name, 'piema'
    from piema_schools x join mk on mk.markaz_name = x.markaz_name and mk.dist = upper(x.district)
         left join public_schools ps on ps.emis = x.emis_code
    where (p_code is null or x.emis_code = p_code)
    union all
    select 2, x.emis_code, x.school_name, x.level, upper(x.district), mk.tehsil, coalesce(ps.wing, mk.wing), x.markaz_name, 'pef'
    from pef_schools x join mk on mk.markaz_name = x.markaz_name and mk.dist = upper(x.district)
         left join public_schools ps on ps.emis = x.emis_code
    where (p_code is null or x.emis_code = p_code)
    union all
    select 3, ps.emis, ps.school_name, ps.level, ps.district, ps.tehsil, ps.wing, ps.markaz_name,
           case when ps.status = 'Out Sourced' then 'outsourced' else 'public' end
    from public_schools ps
    where coalesce(ps.status,'Active') in ('Active','Out Sourced') and (p_code is null or ps.emis = p_code)
    union all
    select 4, p.unique_id, p.school_name, null::text, upper(p.district), coalesce(mk.tehsil, p.tehsil), mk.wing, p.markaz_name, 'private'
    from private_schools p left join mk on mk.markaz_name = p.markaz_name and mk.dist = upper(p.district)
    where coalesce(lower(p.status),'active') = 'active' and (p_code is null or p.unique_id = p_code)
  ),
  best as (select distinct on (c.emis) c.* from cand c where c.emis is not null order by c.emis, c.pr)
  select b.emis, b.school_name, b.level, b.district, b.tehsil, b.wing, b.markaz_name, b.kind
  from best b
  where coalesce(is_admin(), false)
     or upper(b.district) = upper((select district from me))
     or fn_jurisdiction_visible(b.district, b.wing, b.tehsil, b.markaz_name, b.emis);
$$;
revoke all on function public.visit_actual_wide_pool(text) from public, anon;
grant execute on function public.visit_actual_wide_pool(text) to authenticated;

-- ── 3) server-side validation of every actual entry ──────────────────
create or replace function public.visit_actual_entry_validate() returns trigger language plpgsql set search_path = public as $$
declare p record; w record;
begin
  select user_id, year, month into p from visit_actual_plans where id = new.plan_id;
  if not found then raise exception 'Actual-visits plan not found'; end if;
  new.user_id := p.user_id;
  if extract(year from new.visit_date)::int <> p.year or extract(month from new.visit_date)::int <> p.month then
    raise exception 'Visit date % is outside the plan month', new.visit_date;
  end if;
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
