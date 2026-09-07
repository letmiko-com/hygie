-- Time in heart rate zones, precomputed per workout.
--
-- The read path used to walk every HR sample of every session in the window
-- (a window function over ~200 000 rows for a year), which is why /sport
-- refused to run the zone accounting past 92 days. One row per workout holds
-- the same truth: the sample-owns-the-interval rule (capped at 60 s) is a
-- property of the session, not of the window.
--
-- The zone cuts DO depend on the subject's maximum heart rate, so the maximum
-- used is stored on the row: a different maximum (a newly observed one, or a
-- declared one the subject just changed) makes the row stale and it is
-- recomputed. That is rare — the observed maximum is cached for a day and a
-- declared one is typed by hand — and the recomputation costs exactly what
-- the old read cost, once.
--
-- A session with no HR sample gets a row of zeros rather than no row: without
-- it, every read would try to compute it again, forever.
create table workout_hr_zones (
  workout_id  uuid primary key references workouts(id) on delete cascade,
  subject_id  uuid not null references subjects(id) on delete cascade,
  max_hr_bpm  smallint not null check (max_hr_bpm > 0),
  below_s     double precision not null default 0 check (below_s >= 0),
  z1_s        double precision not null default 0 check (z1_s >= 0),
  z2_s        double precision not null default 0 check (z2_s >= 0),
  z3_s        double precision not null default 0 check (z3_s >= 0),
  z4_s        double precision not null default 0 check (z4_s >= 0),
  z5_s        double precision not null default 0 check (z5_s >= 0),
  computed_at timestamptz not null default now()
);
create index workout_hr_zones_subject on workout_hr_zones (subject_id, max_hr_bpm);

-- Fills the missing (or stale) rows for one subject's sessions in a window.
-- Returns how many rows it wrote. Idempotent: calling it twice in a row
-- writes nothing the second time.
--
-- The zone of a sample is width_bucket(bpm / max, [0.5 .. 0.9]), the exact
-- expression the old read used and the one src/lib/queries/zones.ts uses in
-- TypeScript, so a precomputed row and a live computation cannot disagree.
create or replace function workout_hr_zones_fill(
  p_subject uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_max_hr smallint,
  p_max_gap double precision
) returns integer
language plpgsql
as $$
declare
  v_hr_type smallint;
  v_written integer;
begin
  select id into v_hr_type from metric_types
   where hk_identifier = 'HKQuantityTypeIdentifierHeartRate';
  if v_hr_type is null then
    return 0;
  end if;

  with todo as (
    select w.id, w.start_ts, w.end_ts
    from workouts w
    where w.subject_id = p_subject
      and w.start_ts >= p_from
      and w.start_ts < p_to
      and not exists (
        select 1 from workout_hr_zones z
        where z.workout_id = w.id and z.max_hr_bpm = p_max_hr
      )
  ),
  samples as (
    select t.id as workout_id,
           width_bucket(o.value / p_max_hr::float, array[0.5, 0.6, 0.7, 0.8, 0.9]) as zone,
           least(
             extract(epoch from
               lead(o.start_ts) over (partition by t.id order by o.start_ts) - o.start_ts),
             p_max_gap
           ) as dt
    from todo t
    join observations o
      on o.subject_id = p_subject
     and o.type_id = v_hr_type
     and o.start_ts >= t.start_ts
     and o.start_ts < t.end_ts
  ),
  agg as (
    select workout_id,
           coalesce(sum(dt) filter (where zone = 0), 0) as below_s,
           coalesce(sum(dt) filter (where zone = 1), 0) as z1_s,
           coalesce(sum(dt) filter (where zone = 2), 0) as z2_s,
           coalesce(sum(dt) filter (where zone = 3), 0) as z3_s,
           coalesce(sum(dt) filter (where zone = 4), 0) as z4_s,
           coalesce(sum(dt) filter (where zone >= 5), 0) as z5_s
    from samples
    where dt is not null and dt > 0
    group by workout_id
  ),
  written as (
    insert into workout_hr_zones
      (workout_id, subject_id, max_hr_bpm, below_s, z1_s, z2_s, z3_s, z4_s, z5_s, computed_at)
    -- LEFT JOIN: a session without a single HR sample is written as zeros.
    select t.id, p_subject, p_max_hr,
           coalesce(a.below_s, 0), coalesce(a.z1_s, 0), coalesce(a.z2_s, 0),
           coalesce(a.z3_s, 0), coalesce(a.z4_s, 0), coalesce(a.z5_s, 0), now()
    from todo t
    left join agg a on a.workout_id = t.id
    on conflict (workout_id) do update set
      max_hr_bpm = excluded.max_hr_bpm,
      below_s = excluded.below_s,
      z1_s = excluded.z1_s,
      z2_s = excluded.z2_s,
      z3_s = excluded.z3_s,
      z4_s = excluded.z4_s,
      z5_s = excluded.z5_s,
      computed_at = excluded.computed_at
    returning 1
  )
  select count(*)::int into v_written from written;
  return v_written;
end;
$$;
