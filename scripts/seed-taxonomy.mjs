// Idempotent taxonomy seed: upserts db/taxonomy.json into units, metric_types and
// metric_category_values. Safe to re-run; never deletes rows (removing a type from the
// taxonomy is a migration concern, not a seed concern).
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';

const taxonomy = JSON.parse(
  await readFile(join(process.cwd(), 'db', 'taxonomy.json'), 'utf8')
);

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query('begin');

  // Units: every canonical unit plus every unit the XML importer may reference as
  // original_unit (the xml.unit field, e.g. kcal while the canonical unit is kJ).
  const unitNames = new Set();
  for (const t of taxonomy.metric_types) {
    if (t.canonical_unit) unitNames.add(t.canonical_unit);
    if (t.xml?.unit) unitNames.add(t.xml.unit);
  }
  for (const name of unitNames) {
    await client.query('insert into units (name) values ($1) on conflict (name) do nothing', [name]);
  }
  const unitId = new Map(
    (await client.query('select id, name from units')).rows.map((r) => [r.name, r.id])
  );

  for (const t of taxonomy.metric_types) {
    await client.query(
      `insert into metric_types
         (hk_identifier, kind, hae_regime, aggregation, canonical_unit_id, quantize_scale, supported)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (hk_identifier) do update set
         kind = excluded.kind,
         hae_regime = excluded.hae_regime,
         aggregation = excluded.aggregation,
         canonical_unit_id = excluded.canonical_unit_id,
         quantize_scale = excluded.quantize_scale,
         supported = excluded.supported`,
      [
        t.hk_identifier,
        t.kind,
        t.hae_regime,
        t.aggregation,
        t.canonical_unit ? unitId.get(t.canonical_unit) : null,
        t.quantize_scale,
        t.supported,
      ]
    );
  }

  const typeId = new Map(
    (await client.query('select id, hk_identifier from metric_types')).rows
      .map((r) => [r.hk_identifier, r.id])
  );

  let nCategoryValues = 0;
  for (const [hk, values] of Object.entries(taxonomy.metric_category_values)) {
    const tid = typeId.get(hk);
    if (tid === undefined) throw new Error(`metric_category_values references unknown type ${hk}`);
    for (const v of values) {
      await client.query(
        `insert into metric_category_values (type_id, raw_value, slug, hk_value)
         values ($1, $2, $3, $4)
         on conflict (type_id, raw_value) do update set
           slug = excluded.slug, hk_value = excluded.hk_value`,
        [tid, v.raw_value, v.slug, v.hk_value]
      );
      nCategoryValues++;
    }
  }

  await client.query('commit');
  console.log(
    `seeded ${unitNames.size} units, ${taxonomy.metric_types.length} metric types, ` +
    `${nCategoryValues} category values`
  );
} catch (err) {
  await client.query('rollback');
  throw err;
} finally {
  await client.end();
}
