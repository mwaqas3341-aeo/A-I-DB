-- Applied (live): pef_schools / piema_schools gained the public_schools data-form columns (wing, area, rooms, bank, ECCE, FTF, ...),
-- status default 'Active', canonical district/tehsil spelling, wing derived from Markaz, the same recalculation trigger as
-- public_schools, and wing-aware RLS policies. See the migration "pef_piema_school_data_columns" in the Supabase project.

-- Applied (live): visit_planner_pool() now also offers Active private schools and academies (identified by unique_id;
-- tehsil/wing taken from the Markaz master because private_schools has inconsistent tehsil spellings and no wing).
-- Jurisdiction still goes through fn_jurisdiction_visible(); the entry trigger re-checks every school server-side.
