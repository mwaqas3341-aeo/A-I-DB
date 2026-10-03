-- Applied (live): allocation file (High / PIEMA / PEF) decides the planner Markaz and beats public_schools.markaz_name.
-- De-duplication happens BEFORE the jurisdiction check, so a school never shows under two Markaz.
-- Wing is only read, never written. Supersedes visit_planner_pool() in 01_schema.sql.
create or replace function public.visit_planner_pool(p_emis text default null)
returns table (emis text, school_name text, level text, school_type text, district text, tehsil text,
               wing text, markaz_name text, markaz_code text, source text)
language sql stable security definer set search_path = public as $$
  with me as (select district from app_users where id = auth.uid()),
  mk as (
    select distinct on (markaz_name) markaz_name, tehsil, wing
    from public_schools
    where level not in ('High','H.Sec.') and markaz_name is not null and district = (select district from me)
    order by markaz_name
  ),
  cand as (
    select 1 pr, a.emis, a.school_name, a.level, ps.type school_type, a.district, ps.wing wing, a.tehsil,
           a.assigned_markaz_name markaz_name, a.markaz_code, 'HIGH' source
    from visit_school_allocation a left join public_schools ps on ps.emis = a.emis
    where (p_emis is null or a.emis = p_emis)
    union all
    select 2, x.emis_code, x.school_name, x.level, x.gender, upper(x.district), coalesce(ps.wing, mk.wing), mk.tehsil,
           x.markaz_name, x.markaz_code, 'PIEMA'
    from piema_schools x join mk on mk.markaz_name = x.markaz_name left join public_schools ps on ps.emis = x.emis_code
    where (p_emis is null or x.emis_code = p_emis)
    union all
    select 3, x.emis_code, x.school_name, x.level, x.gender, upper(x.district), coalesce(ps.wing, mk.wing), mk.tehsil,
           x.markaz_name, x.markaz_code, 'PEF'
    from pef_schools x join mk on mk.markaz_name = x.markaz_name left join public_schools ps on ps.emis = x.emis_code
    where (p_emis is null or x.emis_code = p_emis)
    union all
    select 4, ps.emis, ps.school_name, ps.level, ps.type, ps.district, ps.wing, ps.tehsil,
           ps.markaz_name, null::text, 'PUBLIC'
    from public_schools ps
    where coalesce(ps.status,'Active') in ('Active','Out Sourced')
      and ps.level not in ('High','H.Sec.')
      and (p_emis is null or ps.emis = p_emis)
      and (p_emis is not null or ps.district = (select district from me))
  ),
  best as (
    select distinct on (c.emis) c.* from cand c order by c.emis, c.pr
  )
  select b.emis, b.school_name, b.level, b.school_type, b.district, b.tehsil, b.wing, b.markaz_name, b.markaz_code, b.source
  from best b
  where fn_jurisdiction_visible(b.district, case when b.source = 'HIGH' then null else b.wing end,
                                b.tehsil, b.markaz_name, b.emis);
$$;
revoke all on function public.visit_planner_pool(text) from public, anon;
grant execute on function public.visit_planner_pool(text) to authenticated;
