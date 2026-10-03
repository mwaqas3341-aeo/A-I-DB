-- Visit Planner: additive schema only. No existing table/function is altered.

-- 1) Planner-Markaz assignment for High / H.Sec. schools (their Wing & markaz_name in public_schools/schools are NOT touched)
create table public.visit_school_allocation (
  emis                 text primary key,
  school_name          text not null,
  level                text,
  district             text not null,
  tehsil               text not null,
  assigned_markaz_name text not null,
  markaz_code          text,
  source               text not null default 'SED-HIGH',
  created_at           timestamptz not null default now()
);
alter table public.visit_school_allocation enable row level security;
create policy vsa_select on public.visit_school_allocation for select to authenticated
  using ((select is_admin()) or fn_jurisdiction_visible(district, null, tehsil, assigned_markaz_name, emis));
create policy vsa_admin_write on public.visit_school_allocation for all to authenticated
  using ((select is_admin())) with check ((select is_admin()));
revoke all on public.visit_school_allocation from anon;

-- 2) Monthly planners (one per user + year + month)
create table public.visit_planners (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  year               smallint not null check (year between 1900 and 2200),
  month              smallint not null check (month between 1 and 12),
  weekly_leave_count smallint not null default 2 check (weekly_leave_count between 1 and 3),
  leave_days         smallint[] not null default '{0,6}',
  office_work_days   smallint[] not null default '{}',
  start_date         date,
  markaz_label       text,
  status             text not null default 'draft' check (status in ('draft','generated','edited','finalized')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id, year, month),
  check (cardinality(leave_days) = weekly_leave_count),
  check (leave_days <@ array[0,1,2,3,4,5,6]::smallint[]),
  check (office_work_days <@ array[0,1,2,3,4,5,6]::smallint[])
);

-- 3) Planner entries: one row per date + slot (slot 1 = Morning, slot 2 = Mid-Day), as in the official template
create table public.visit_planner_entries (
  id             uuid primary key default gen_random_uuid(),
  planner_id     uuid not null references public.visit_planners(id) on delete cascade,
  user_id        uuid not null,
  visit_date     date not null,
  slot           smallint not null check (slot in (1,2)),
  entry_type     text not null default 'school' check (entry_type in ('school','office')),
  emis_code      text,
  school_name    text,
  markaz         text,
  tehsil         text,
  wing           text,
  visit_sequence smallint,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (planner_id, visit_date, slot),
  check ((entry_type = 'school' and emis_code is not null) or entry_type = 'office')
);
create unique index visit_entries_no_same_day_dup on public.visit_planner_entries (planner_id, visit_date, emis_code) where emis_code is not null;
create index visit_entries_planner_idx on public.visit_planner_entries (planner_id);

create function public.visit_set_updated_at() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
create trigger visit_planners_touch before update on public.visit_planners for each row execute function public.visit_set_updated_at();
create trigger visit_entries_touch  before update on public.visit_planner_entries for each row execute function public.visit_set_updated_at();

-- 4) School pool for the logged-in user (jurisdiction enforced through the EXISTING fn_jurisdiction_visible)
create function public.visit_planner_pool(p_emis text default null)
returns table (emis text, school_name text, level text, school_type text, district text, tehsil text,
               wing text, markaz_name text, markaz_code text, source text)
language sql stable security invoker set search_path = public as $$
  with me as (select district from app_users where id = auth.uid()),
  mk as (
    select distinct on (markaz_name) markaz_name, tehsil, wing
    from public_schools
    where level not in ('High','H.Sec.') and markaz_name is not null and district = (select district from me)
    order by markaz_name
  ),
  cand as (
    select 1 pr, ps.emis, ps.school_name, ps.level, ps.type school_type, ps.district, ps.wing, ps.tehsil,
           ps.markaz_name, null::text markaz_code, 'PUBLIC' source
    from public_schools ps
    where coalesce(ps.status,'Active') in ('Active','Out Sourced')
      and ps.level not in ('High','H.Sec.')
      and (p_emis is null or ps.emis = p_emis)
      and (p_emis is not null or ps.district = (select district from me))
    union all
    select 2, a.emis, a.school_name, a.level, ps.type, a.district, ps.wing, a.tehsil,
           a.assigned_markaz_name, a.markaz_code, 'HIGH'
    from visit_school_allocation a left join public_schools ps on ps.emis = a.emis
    where (p_emis is null or a.emis = p_emis)
    union all
    select 3, x.emis_code, x.school_name, x.level, x.gender, upper(x.district), mk.wing, mk.tehsil,
           x.markaz_name, x.markaz_code, 'PIEMA'
    from piema_schools x join mk on mk.markaz_name = x.markaz_name
    where (p_emis is null or x.emis_code = p_emis)
    union all
    select 4, x.emis_code, x.school_name, x.level, x.gender, upper(x.district), mk.wing, mk.tehsil,
           x.markaz_name, x.markaz_code, 'PEF'
    from pef_schools x join mk on mk.markaz_name = x.markaz_name
    where (p_emis is null or x.emis_code = p_emis)   -- ALL PEF schools, incl. non-EMIS codes (e.g. 9-LYH-0029); the code is the identifier
  )
  select distinct on (c.emis) c.emis, c.school_name, c.level, c.school_type, c.district, c.tehsil,
         c.wing, c.markaz_name, c.markaz_code, c.source
  from cand c
  where fn_jurisdiction_visible(c.district, case when c.source = 'HIGH' then null else c.wing end,
                                c.tehsil, c.markaz_name, c.emis)
  order by c.emis, c.pr;
$$;
revoke all on function public.visit_planner_pool(text) from public, anon;
grant execute on function public.visit_planner_pool(text) to authenticated;

-- 5) Server-side validation of entries (date in month, not a leave day, school inside jurisdiction)
create function public.visit_entry_validate() returns trigger language plpgsql set search_path = public as $$
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
  end if;
  return new;
end $$;
create trigger visit_entries_validate before insert or update on public.visit_planner_entries
  for each row execute function public.visit_entry_validate();

-- 6) RLS
alter table public.visit_planners enable row level security;
alter table public.visit_planner_entries enable row level security;
create policy vp_select on public.visit_planners for select to authenticated using (user_id = (select auth.uid()) or (select is_admin()));
create policy vp_insert on public.visit_planners for insert to authenticated with check (user_id = (select auth.uid()));
create policy vp_update on public.visit_planners for update to authenticated using (user_id = (select auth.uid()) or (select is_admin())) with check (user_id = (select auth.uid()) or (select is_admin()));
create policy vp_delete on public.visit_planners for delete to authenticated using (user_id = (select auth.uid()) or (select is_admin()));
create policy ve_select on public.visit_planner_entries for select to authenticated using (user_id = (select auth.uid()) or (select is_admin()));
create policy ve_insert on public.visit_planner_entries for insert to authenticated with check (user_id = (select auth.uid()) and exists (select 1 from public.visit_planners p where p.id = planner_id and p.user_id = (select auth.uid())));
create policy ve_update on public.visit_planner_entries for update to authenticated using (user_id = (select auth.uid()) or (select is_admin())) with check (user_id = (select auth.uid()) or (select is_admin()));
create policy ve_delete on public.visit_planner_entries for delete to authenticated using (user_id = (select auth.uid()) or (select is_admin()));
revoke all on public.visit_planners, public.visit_planner_entries from anon;

-- Applied follow-up (already live): the pool RPC runs SECURITY DEFINER because pef_schools/piema_schools use
-- different district/tehsil spellings than app_users; every row is still filtered through fn_jurisdiction_visible().
alter function public.visit_planner_pool(text) security definer;
alter function public.visit_planner_pool(text) set search_path = public;
revoke all on function public.visit_planner_pool(text) from public, anon;
grant execute on function public.visit_planner_pool(text) to authenticated;
