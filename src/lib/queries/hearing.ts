// Audiograms (audiograms + audiogram_points): a handful of rows per subject,
// always read whole. Scoped by subject like every other query.
import { getDb } from '@/lib/db';
import type { SubjectContext } from './context';
import { untilMigrated } from './optional';

export interface AudiogramPoint {
  side: 'left' | 'right';
  frequencyHz: number;
  sensitivityDbHl: number;
  masked: boolean;
  clamped: 'low' | 'high' | null;
}

export interface Audiogram {
  id: string;
  startTs: Date;
  tzOffsetMin: number;
  sourceName: string;
  points: AudiogramPoint[];
}

interface Row {
  id: string;
  start_ts: Date;
  tz_offset_min: number;
  source_name: string;
  points: Array<{
    side: 'left' | 'right';
    frequency_hz: number;
    sensitivity_db_hl: number;
    masked: boolean;
    clamped: 'low' | 'high' | null;
  }>;
}

export async function listAudiograms(ctx: SubjectContext, limit = 100): Promise<Audiogram[]> {
  const { rows } = await untilMigrated(() => getDb().query<Row>(
    `select a.id, a.start_ts, a.tz_offset_min, s.name as source_name,
            coalesce((select jsonb_agg(jsonb_build_object(
                        'side', p.side, 'frequency_hz', p.frequency_hz,
                        'sensitivity_db_hl', p.sensitivity_db_hl, 'masked', p.masked, 'clamped', p.clamped)
                      order by p.side, p.frequency_hz, p.masked)
                     from audiogram_points p where p.audiogram_id = a.id), '[]'::jsonb) as points
     from audiograms a
     join sources s on s.id = a.source_id
     where a.subject_id = $1
     order by a.start_ts desc
     limit $2`,
    [ctx.subjectId, limit]
  ), { rows: [] as Row[] });
  return rows.map((r) => ({
    id: r.id,
    startTs: r.start_ts,
    tzOffsetMin: r.tz_offset_min,
    sourceName: r.source_name,
    points: r.points.map((p) => ({
      side: p.side,
      frequencyHz: p.frequency_hz,
      sensitivityDbHl: p.sensitivity_db_hl,
      masked: p.masked,
      clamped: p.clamped,
    })),
  }));
}
