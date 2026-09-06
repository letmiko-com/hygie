// ECG recordings (ecg_recordings). The list never loads the voltages; the
// detail loads one trace. Both re-filter on subject_id.
import { getDb } from '@/lib/db';
import type { SubjectContext } from './context';

export interface EcgListItem {
  id: string;
  startTs: Date;
  endTs: Date | null;
  tzOffsetMin: number;
  classification: string;
  symptomsStatus: string;
  avgHrBpm: number | null;
  samplingHz: number;
  nSamples: number;
  sourceName: string;
}

export interface EcgDetail extends EcgListItem {
  algorithmVersion: number | null;
  lead: string;
  voltagesUv: number[];
}

interface ListRow {
  id: string;
  start_ts: Date;
  end_ts: Date | null;
  tz_offset_min: number;
  classification: string;
  symptoms_status: string;
  avg_hr_bpm: number | null;
  sampling_hz: number;
  n_samples: number;
  source_name: string;
}

function mapItem(r: ListRow): EcgListItem {
  return {
    id: r.id,
    startTs: r.start_ts,
    endTs: r.end_ts,
    tzOffsetMin: r.tz_offset_min,
    classification: r.classification,
    symptomsStatus: r.symptoms_status,
    avgHrBpm: r.avg_hr_bpm,
    samplingHz: r.sampling_hz,
    nSamples: r.n_samples,
    sourceName: r.source_name,
  };
}

const LIST_SQL = `select e.id, e.start_ts, e.end_ts, e.tz_offset_min, e.classification,
        e.symptoms_status, e.avg_hr_bpm, e.sampling_hz, e.n_samples, s.name as source_name
 from ecg_recordings e
 join sources s on s.id = e.source_id`;

export async function listEcgs(ctx: SubjectContext, limit = 500): Promise<EcgListItem[]> {
  const { rows } = await getDb().query<ListRow>(
    `${LIST_SQL} where e.subject_id = $1 order by e.start_ts desc limit $2`,
    [ctx.subjectId, limit]
  );
  return rows.map(mapItem);
}

/** Per classification, all time: the list header reads the mix at a glance. */
export async function ecgClassificationCounts(ctx: SubjectContext): Promise<Array<{ classification: string; count: number }>> {
  const { rows } = await getDb().query<{ classification: string; count: number }>(
    `select classification, count(*)::int as count
     from ecg_recordings where subject_id = $1
     group by 1 order by count desc, classification`,
    [ctx.subjectId]
  );
  return rows;
}

export async function getEcg(ctx: SubjectContext, id: string): Promise<EcgDetail | null> {
  interface Row extends ListRow {
    algorithm_version: number | null;
    lead: string;
    voltages_uv: number[];
  }
  const { rows } = await getDb().query<Row>(
    `select e.id, e.start_ts, e.end_ts, e.tz_offset_min, e.classification,
            e.symptoms_status, e.avg_hr_bpm, e.sampling_hz, e.n_samples, s.name as source_name,
            e.algorithm_version, e.lead, e.voltages_uv
     from ecg_recordings e
     join sources s on s.id = e.source_id
     where e.subject_id = $1 and e.id = $2`,
    [ctx.subjectId, id]
  );
  const r = rows[0];
  if (!r) return null;
  return { ...mapItem(r), algorithmVersion: r.algorithm_version, lead: r.lead, voltagesUv: r.voltages_uv };
}
