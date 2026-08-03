// What this subject can actually chart. The explorer offers the taxonomy
// intersected with reality: a type declared in metric_types but never
// measured for this subject is not an option, it is noise.
//
// Availability is an index probe per type (subject_id, type_id, start_ts),
// not a count: counting 7M rows to populate a picker would be absurd. Both
// storage regimes are probed — a minute_cumulative type ingested only through
// HAE has rows in minute_stats and none in observations.
//
// Derived series (sleep, training time) are facts the app computes rather
// than measures; they are part of the catalogue because correlating sleep
// with resting heart rate is the whole point of the screen, but they only
// exist per day and say so.
import { getDb } from '@/lib/db';
import { cached } from './cache';
import type { SubjectContext } from './context';
import type { Aggregation, HaeRegime } from './metric-types';

/** Derived (computed) series keys. Namespaced so they cannot collide with HK. */
export const DERIVED_SLEEP = 'derived:sleep_asleep';
export const DERIVED_TRAINING = 'derived:training_time';
export const DERIVED_KEYS = [DERIVED_SLEEP, DERIVED_TRAINING] as const;
export type DerivedKey = (typeof DERIVED_KEYS)[number];

export function isDerived(key: string): key is DerivedKey {
  return (DERIVED_KEYS as readonly string[]).includes(key);
}

export interface CatalogEntry {
  key: string;
  /** Null for derived series (they have no metric_types row). */
  hkIdentifier: string | null;
  unit: string | null;
  aggregation: Aggregation;
  haeRegime: HaeRegime | null;
  /** Derived series only exist at day granularity. */
  dailyOnly: boolean;
  firstDay: string | null;
  lastDay: string | null;
}

interface Row {
  hk_identifier: string;
  unit_name: string | null;
  aggregation: Aggregation;
  hae_regime: HaeRegime;
  first_day: string | null;
  last_day: string | null;
}

/**
 * Charting-capable types with data for this subject, plus the derived series.
 * Cached per subject and per local day: the set only grows with ingestion,
 * and a picker does not need to see a new type the second it lands.
 */
export async function subjectCatalog(ctx: SubjectContext, today: string): Promise<CatalogEntry[]> {
  const entries = await cached(`catalog:${ctx.subjectId}:${today}`, 30 * 60_000, async () => {
    const { rows } = await getDb().query<Row>(
      `select t.hk_identifier, u.name as unit_name, t.aggregation, t.hae_regime,
              ((select min(o.start_ts)
                from observations o where o.subject_id = $1 and o.type_id = t.id)
               at time zone $2)::date::text as first_day,
              greatest(
                ((select max(o.start_ts)
                  from observations o where o.subject_id = $1 and o.type_id = t.id)
                 at time zone $2)::date::text,
                ((select max(m.minute_ts)
                  from minute_stats m where m.subject_id = $1 and m.type_id = t.id)
                 at time zone $2)::date::text
              ) as last_day
       from metric_types t
       left join units u on u.id = t.canonical_unit_id
       where t.supported and t.kind = 'quantity' and t.aggregation <> 'none'
         and (exists (select 1 from observations o
                      where o.subject_id = $1 and o.type_id = t.id)
              or exists (select 1 from minute_stats m
                         where m.subject_id = $1 and m.type_id = t.id))
       order by t.hk_identifier`,
      [ctx.subjectId, ctx.timezone]
    );
    return rows.map<CatalogEntry>((r) => ({
      key: r.hk_identifier,
      hkIdentifier: r.hk_identifier,
      unit: r.unit_name,
      aggregation: r.aggregation,
      haeRegime: r.hae_regime,
      dailyOnly: false,
      firstDay: r.first_day,
      lastDay: r.last_day,
    }));
  });

  const derived: CatalogEntry[] = [
    {
      key: DERIVED_SLEEP,
      hkIdentifier: null,
      unit: 'h',
      aggregation: 'average',
      haeRegime: null,
      dailyOnly: true,
      firstDay: null,
      lastDay: null,
    },
    {
      key: DERIVED_TRAINING,
      hkIdentifier: null,
      unit: 'min',
      aggregation: 'sum',
      haeRegime: null,
      dailyOnly: true,
      firstDay: null,
      lastDay: null,
    },
  ];

  return [...derived, ...entries];
}
