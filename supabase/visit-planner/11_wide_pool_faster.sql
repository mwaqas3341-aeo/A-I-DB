-- Visit Planner: make visit_actual_wide_pool() ~6x faster for normal users (1.9 s -> 0.3 s) with IDENTICAL results.
-- Already applied to production as migrations visit_actual_wide_pool_faster_for_non_admins + visit_actual_wide_pool_evaluate_flags_once.
-- Why it was slow: is_admin() / fn_jurisdiction_visible() were evaluated for every one of ~39,000 schools. Now the admin flag and the user's
-- district are computed once, and "visible through an assigned jurisdiction" is a membership test against visit_planner_pool().
-- Verified: row count + md5 of (emis|kind|markaz|tehsil|wing) were identical before and after for a normal user (2,119 rows) and an admin (39,030 rows).
create or replace function public.visit_actual_wide_pool(p_code text default null)
returns table (emis text, school_name text, level text, district text, tehsil text, wing text, markaz_name text, kind text)
language sql stable security definer set search_path = public as $$
  with flag as materialized (select coalesce(is_admin(), false) as adm, (select upper(district) from app_users where id = auth.uid()) as dist),
  jur as materialized (select q.emis from visit_planner_pool() q),
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
  from best b, flag f
  where f.adm or upper(b.district) = f.dist or b.emis in (select emis from jur);
$$;
