-- 0002: hourly rollups, built for real (expand only, backward compatible).
--
-- 1. rollup_dirty_ranges.batch_id: the ingestion worker enqueues the hours it
--    actually touched inside the SAME transaction as the writes, tagged with the
--    batch, so step 3 can wait for exactly its own ranges before claiming
--    'rollups_ready'. Ranges with a null batch_id come from other producers
--    (channel cutovers, XML backfill, manual rebuilds) and are drained when idle.
-- 2. rollup_rebuild_range(): the single implementation of "recompute rollup_hourly
--    from the sources of truth over a range". Lives in SQL because both the
--    TypeScript worker and the plain-node rebuild script must use the same code.

alter table rollup_dirty_ranges add column if not exists batch_id uuid;

-- The queue is drained in id order; the partial index serves the per-batch wait.
create index if not exists rollup_dirty_ranges_batch_idx
  on rollup_dirty_ranges (batch_id) where batch_id is not null;

-- ---------------------------------------------------------------------------
-- Recomputes rollup_hourly for one (subject, type) over [p_from, p_to), snapped
-- outwards to whole UTC hours. Derived data only: the range is deleted first, so
-- hours whose sources became empty disappear instead of lingering.
--
-- Truth rules, identical to the read layer (architecture.md §2 and §4):
--   * minute_cumulative types: XML observations strictly before the channel
--     cutover, deduplicated by ONE WINNING SOURCE PER UTC HOUR (source_priorities
--     rank, else the watch, else the higher value), plus minute_stats from the
--     cutover on. An hour straddling the cutover receives both halves.
--   * every other quantity type: plain aggregate over observations, both origins.
--   * category types are never rolled up (no numeric value).
-- n counts what the read layer counts, so a day summed from rollup_hourly is
-- identical to the same day read from the sources, n included: one contribution
-- per winning hour on the raw side of a cumulative, one per minute on the minute
-- side, one per sample everywhere else. min/max are only meaningful for the
-- non-cumulative regime (min/max of the samples); for cumulatives they are the
-- extremes of the merged contributions, kept for completeness, not for display.
--
-- Concurrency: upsert on conflict, so two overlapping rebuilds cannot collide.
create or replace function rollup_rebuild_range(
  p_subject uuid,
  p_type    smallint,
  p_from    timestamptz,
  p_to      timestamptz
) returns integer
language plpgsql
as $$
declare
  v_from   timestamptz;
  v_to     timestamptz;
  v_kind   text;
  v_regime text;
  v_rows   integer;
begin
  if p_to <= p_from then
    return 0;
  end if;
  v_from := date_trunc('hour', p_from);
  v_to   := date_trunc('hour', p_to - interval '1 microsecond') + interval '1 hour';

  select mt.kind, mt.hae_regime into v_kind, v_regime
  from metric_types mt where mt.id = p_type;
  if v_kind is distinct from 'quantity' then
    return 0;
  end if;

  delete from rollup_hourly r
   where r.subject_id = p_subject and r.type_id = p_type
     and r.hour_utc >= v_from and r.hour_utc < v_to;

  if v_regime = 'minute_cumulative' then
    with bounds as (
      select coalesce((select c.cutover_ts from channel_cutovers c
                       where c.subject_id = p_subject and c.type_id = p_type),
                      'infinity'::timestamptz) as cutover_ts
    ),
    raw_hourly as (
      select date_trunc('hour', o.start_ts) as hour_utc, o.source_id,
             sum(o.value) as v, count(*)::int as n,
             min(o.value) as vmin, max(o.value) as vmax
      from observations o, bounds b
      where o.subject_id = p_subject and o.type_id = p_type
        and o.origin = 'health_xml' and o.value is not null
        and o.start_ts >= v_from and o.start_ts < least(v_to, b.cutover_ts)
      group by 1, 2
    ),
    raw_winner as (
      -- One contribution per hour, exactly like the read layer's union: n counts
      -- merged contributions (1 per winning hour, 1 per minute), not samples.
      select distinct on (h.hour_utc) h.hour_utc, h.v, 1 as n, h.vmin, h.vmax
      from raw_hourly h
      join sources s on s.id = h.source_id
      left join source_priorities sp
        on sp.subject_id = p_subject and sp.type_id = p_type and sp.source_id = h.source_id
      order by h.hour_utc, sp.rank asc nulls last, (s.name ~* 'watch') desc, h.v desc
    ),
    minute as (
      select date_trunc('hour', m.minute_ts) as hour_utc,
             sum(m.value) as v, count(*)::int as n,
             min(m.value) as vmin, max(m.value) as vmax
      from minute_stats m, bounds b
      where m.subject_id = p_subject and m.type_id = p_type
        and m.minute_ts >= greatest(v_from, b.cutover_ts) and m.minute_ts < v_to
      group by 1
    ),
    merged as (
      select u.hour_utc, sum(u.n)::int as n, sum(u.v) as v,
             min(u.vmin) as vmin, max(u.vmax) as vmax
      from (select * from raw_winner union all select * from minute) u
      group by u.hour_utc
    )
    insert into rollup_hourly (subject_id, type_id, hour_utc, n, sum, min, max)
    select p_subject, p_type, m.hour_utc, m.n, m.v, m.vmin, m.vmax
    from merged m
    where m.v is not null
    on conflict (subject_id, type_id, hour_utc) do update
      set n = excluded.n, sum = excluded.sum, min = excluded.min, max = excluded.max;
  else
    insert into rollup_hourly (subject_id, type_id, hour_utc, n, sum, min, max)
    select p_subject, p_type, date_trunc('hour', o.start_ts),
           count(*)::int, sum(o.value), min(o.value), max(o.value)
    from observations o
    where o.subject_id = p_subject and o.type_id = p_type and o.value is not null
      and o.start_ts >= v_from and o.start_ts < v_to
    group by date_trunc('hour', o.start_ts)
    on conflict (subject_id, type_id, hour_utc) do update
      set n = excluded.n, sum = excluded.sum, min = excluded.min, max = excluded.max;
  end if;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;
