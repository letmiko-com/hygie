// Taxonomy lookup, cached in-process. The taxonomy only changes via the seed
// script (deploy-time), a short TTL just lets a re-seeded dev database show
// up without restarting.
import { getDb } from '@/lib/db';
import { cached } from './cache';

export type HaeRegime = 'raw_discrete' | 'minute_cumulative' | 'daily_summary' | 'unsupported';
export type Aggregation = 'sum' | 'average' | 'duration' | 'latest' | 'none';

export interface MetricTypeInfo {
  id: number;
  hkIdentifier: string;
  kind: 'quantity' | 'category';
  haeRegime: HaeRegime;
  aggregation: Aggregation;
  canonicalUnit: string | null;
  supported: boolean;
}

interface MetricTypeRow {
  id: number;
  hk_identifier: string;
  kind: 'quantity' | 'category';
  hae_regime: HaeRegime;
  aggregation: Aggregation;
  unit_name: string | null;
  supported: boolean;
}

async function loadAll(): Promise<Map<string, MetricTypeInfo>> {
  return cached('metric-types', 10 * 60_000, async () => {
    const { rows } = await getDb().query<MetricTypeRow>(
      `select t.id, t.hk_identifier, t.kind, t.hae_regime, t.aggregation,
              u.name as unit_name, t.supported
       from metric_types t
       left join units u on u.id = t.canonical_unit_id`
    );
    const map = new Map<string, MetricTypeInfo>();
    for (const r of rows) {
      map.set(r.hk_identifier, {
        id: r.id,
        hkIdentifier: r.hk_identifier,
        kind: r.kind,
        haeRegime: r.hae_regime,
        aggregation: r.aggregation,
        canonicalUnit: r.unit_name,
        supported: r.supported,
      });
    }
    return map;
  });
}

export async function getMetricType(hkIdentifier: string): Promise<MetricTypeInfo> {
  const map = await loadAll();
  const info = map.get(hkIdentifier);
  if (!info) throw new Error(`unknown metric type: ${hkIdentifier}`);
  return info;
}
