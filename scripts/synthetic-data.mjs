// Synthetic demo dataset: one subject, about 400 days of plausible measures,
// sessions and nights, for screenshots, demos and self-hosters who want to see
// the screens before importing their own export. Nothing here comes from a
// real person: every value is drawn from a seeded generator, so two runs with
// the same seed produce the same database.
//
//   node scripts/synthetic-data.mjs --email demo@example.com [--name "Demo"]
//                                   [--days 400] [--seed 42] [--yes]
//                                   [--database-url <url>]
//
// Creates a user (the login email for the magic link), a subject with an owner
// grant, one source, one import run, then writes observations (heart rate at
// rest and in sessions, resting HR, HRV, respiratory rate, SpO₂, wrist
// temperature, VO₂ max, weight and body composition, steps, active energy,
// distance), workouts and nights. Run `npm run rollups -- --subject <uuid>`
// afterwards (printed at the end) so windows wider than a month read fast.
//
// Dry run by default: prints the plan and the target host, writes with --yes.
// Never point it at a production database: it adds a subject that nobody asked
// for and hundreds of thousands of rows.
import pg from 'pg';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const email = opt('--email', null);
const name = opt('--name', 'Demo');
const days = Number.parseInt(opt('--days', '400'), 10);
const seed = Number.parseInt(opt('--seed', '42'), 10);
const yes = args.includes('--yes');
const databaseUrl = opt('--database-url', process.env.DATABASE_URL);
if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) {
  console.error('usage: node scripts/synthetic-data.mjs --email <login email> [--name X] [--days N] [--seed N] [--yes]');
  process.exit(2);
}
if (!databaseUrl) {
  console.error('DATABASE_URL not set and --database-url not given');
  process.exit(2);
}
const TZ = 'Europe/Paris';

// --- deterministic randomness --------------------------------------------------
let state = seed >>> 0 || 1;
function rand() {
  // mulberry32
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (a, b) => a + (b - a) * rand();
const gauss = (mean, sd) => {
  const u = 1 - rand();
  const v = rand();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const pick = (xs) => xs[Math.floor(rand() * xs.length)];

// --- time helpers (subject-local days in TZ, timestamps in UTC) -----------------
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const offsetFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'shortOffset' });
function tzOffsetMin(date) {
  const part = offsetFmt.formatToParts(date).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+1';
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(part);
  if (!m) return 60;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}
/** UTC instant of a local wall-clock time on a local day. */
function localToUtc(day, hour, minute = 0, second = 0) {
  const guess = new Date(`${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}Z`);
  return new Date(guess.getTime() - tzOffsetMin(guess) * 60_000);
}
function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const today = dayFmt.format(new Date());
const firstDay = addDays(today, -(days - 1));

// --- the person: slow trends, weekly rhythm, a few events --------------------------
function dayIndex(day) {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${firstDay}T00:00:00Z`)) / 86_400_000);
}
const season = (i) => Math.sin(((i / 365) * 2 - 0.4) * Math.PI); // -1 winter, +1 summer
const fitness = (i) => Math.min(1, i / days); // steady progress across the window
const weekday = (day) => new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 Sunday

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
const host = new URL(databaseUrl).host;

try {
  const types = new Map();
  const { rows: typeRows } = await client.query(
    `select mt.id, mt.hk_identifier, mt.quantize_scale, u.name as unit
     from metric_types mt left join units u on u.id = mt.canonical_unit_id`
  );
  for (const r of typeRows) types.set(r.hk_identifier, r);
  const T = (hk) => {
    const t = types.get(`HKQuantityTypeIdentifier${hk}`);
    if (!t) throw new Error(`type ${hk} missing from the taxonomy: run npm run seed first`);
    return t;
  };
  const HR = T('HeartRate');
  const RHR = T('RestingHeartRate');
  const HRV = T('HeartRateVariabilitySDNN');
  const WALK_HR = T('WalkingHeartRateAverage');
  const RESP = T('RespiratoryRate');
  const SPO2 = T('OxygenSaturation');
  const WRIST = T('AppleSleepingWristTemperature');
  const VO2 = T('VO2Max');
  const MASS = T('BodyMass');
  const FAT = T('BodyFatPercentage');
  const LEAN = T('LeanBodyMass');
  const STEPS = T('StepCount');
  const ENERGY = T('ActiveEnergyBurned');
  const DIST = T('DistanceWalkingRunning');

  console.log(`target        : ${host}`);
  console.log(`subject       : "${name}" for ${email}, ${days} days (${firstDay} → ${today}), seed ${seed}`);
  if (!yes) {
    console.log('dry run: nothing written. Re-run with --yes to create the dataset.');
    process.exit(0);
  }

  await client.query('begin');
  const { rows: [user] } = await client.query(
    `insert into users (email, display_name, is_admin, locale) values ($1, $2, false, 'fr')
     on conflict (email) do update set display_name = excluded.display_name returning id`,
    [email, name]
  );
  const { rows: [subject] } = await client.query(
    `insert into subjects (display_name, timezone) values ($1, $2) returning id`,
    [name, TZ]
  );
  await client.query(`insert into access_grants (user_id, subject_id, role) values ($1, $2, 'owner')`, [user.id, subject.id]);
  const { rows: [source] } = await client.query(
    `insert into sources (name) values ('Demo Watch') on conflict (name) do update set name = excluded.name returning id`
  );
  const { rows: [run] } = await client.query(
    `insert into import_runs (subject_id, importer_version, source_sha256, status, finished_at, counts)
     values ($1, 'synthetic-data/1', decode(md5($2), 'hex'), 'done', now(), '{}') returning id`,
    [subject.id, `synthetic:${seed}:${days}`]
  );

  // --- observation buffer, flushed in batches -------------------------------------
  const buffer = [];
  let written = 0;
  const key = (type, v) => (type.quantize_scale === null ? null : String(Math.round(v * type.quantize_scale)));
  function obs(type, startTs, value, endTs = null) {
    buffer.push([subject.id, type.id, source.id, startTs, endTs, value, key(type, value), tzOffsetMin(startTs), run.id]);
  }
  async function flush(force = false) {
    if (buffer.length === 0 || (!force && buffer.length < 2000)) return;
    const values = [];
    const params = [];
    let i = 0;
    for (const row of buffer) {
      values.push(`(${row.map(() => `$${++i}`).join(',')}, 'health_xml')`);
      params.push(...row);
    }
    await client.query(
      `insert into observations (subject_id, type_id, source_id, start_ts, end_ts, value, value_key, tz_offset_min, import_run_id, origin)
       values ${values.join(',')}`,
      params
    );
    written += buffer.length;
    buffer.length = 0;
  }

  // --- day by day ------------------------------------------------------------------
  let weight = 76.5;
  let vo2 = 44.0;
  let workouts = 0;
  let nights = 0;
  let sleepEndPrev = null;
  for (let i = 0; i < days; i++) {
    const day = addDays(firstDay, i);
    const dow = weekday(day);
    const weekend = dow === 0 || dow === 6;
    const fit = fitness(i);
    const sea = season(i);

    // Night ending this morning (wake date = day), except the very first day.
    if (i > 0) {
      // Bedtime in local hours since the previous day's midnight; 24.5 is half past midnight.
      const bedHour = Math.min(26.5, 22.5 + gauss(0.6, 0.5) + (weekend ? 0.7 : 0));
      const durationH = Math.max(4.8, Math.min(9.2, gauss(7.1 + 0.4 * (weekend ? 1 : 0), 0.7)));
      const bedDay = bedHour >= 24 ? day : addDays(day, -1);
      const bedLocal = bedHour >= 24 ? bedHour - 24 : bedHour;
      const startTs = localToUtc(bedDay, Math.floor(bedLocal), Math.floor((bedLocal % 1) * 60));
      const endTs = new Date(startTs.getTime() + durationH * 3600_000);
      const asleepS = Math.round(durationH * 3600 * between(0.9, 0.96));
      const awakeS = Math.round(durationH * 3600) - asleepS;
      const deepS = Math.round(asleepS * between(0.12, 0.2));
      const remS = Math.round(asleepS * between(0.18, 0.26));
      const coreS = asleepS - deepS - remS;
      await client.query(
        `insert into sleep_daily (subject_id, night_date, channel, night_timezone, asleep_s, core_s, deep_s, rem_s, awake_s, in_bed_s, sleep_start, sleep_end)
         values ($1, $2, 'hae', $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [subject.id, day, TZ, asleepS, coreS, deepS, remS, awakeS, asleepS + awakeS, startTs, endTs]
      );
      nights++;
      sleepEndPrev = endTs;
      // Night-borne markers, timestamped inside the night.
      for (let k = 0; k < 6; k++) obs(SPO2, new Date(startTs.getTime() + ((k + 0.5) / 6) * durationH * 3600_000), Math.round(Math.max(91, Math.min(100, gauss(96.8, 1.1)))));
      for (let k = 0; k < 4; k++) obs(RESP, new Date(startTs.getTime() + ((k + 0.5) / 4) * durationH * 3600_000), +Math.max(11, gauss(14.2 - 0.3 * fit, 0.6)).toFixed(1));
      obs(WRIST, new Date(startTs.getTime() + 2 * 3600_000), +gauss(35.9 + 0.15 * sea, 0.12).toFixed(2));
      obs(HRV, new Date(startTs.getTime() + 3 * 3600_000), Math.round(Math.max(20, gauss(48 + 14 * fit - (weekend ? 3 : 0), 8))));
      obs(RHR, new Date(endTs.getTime() - 600_000), Math.round(Math.max(44, gauss(60 - 5 * fit + (weekend ? 1 : 0), 2.2))));
    }

    // Morning body measures, three times a week.
    if (dow === 1 || dow === 3 || dow === 6) {
      weight += gauss(-0.006, 0.18);
      obs(MASS, localToUtc(day, 7, 12), +weight.toFixed(1));
      const fat = Math.max(12, 20.5 - 2.2 * fit + gauss(0, 0.35));
      obs(FAT, localToUtc(day, 7, 12), +fat.toFixed(1));
      obs(LEAN, localToUtc(day, 7, 12), +(weight * (1 - fat / 100)).toFixed(1));
    }
    if (i % 10 === 3) {
      vo2 += gauss(0.08, 0.25);
      obs(VO2, localToUtc(day, 9, 30), +vo2.toFixed(1));
    }

    // A session on about 45 % of the days, more at the weekend.
    let session = null;
    if (rand() < (weekend ? 0.7 : 0.38)) {
      const kind = pick(weekend ? ['run', 'run', 'ride', 'hike', 'walk'] : ['run', 'run', 'run', 'ride', 'walk']);
      const startHour = weekend ? between(9, 11) : pick([between(6.8, 7.6), between(12, 13), between(18, 19.5)]);
      const start = localToUtc(day, Math.floor(startHour), Math.floor((startHour % 1) * 60));
      let durationS, distanceM, energyKj, climb, type, hrMean, indoor = false;
      if (kind === 'run') {
        distanceM = Math.round(Math.max(3000, gauss(8000 + 3000 * fit, 2500)));
        const paceSPerKm = Math.max(255, gauss(330 - 35 * fit, 18));
        durationS = Math.round((distanceM / 1000) * paceSPerKm);
        energyKj = Math.round((distanceM / 1000) * weight * 1.03 * 4.184); // about 1 kcal per kg per km
        climb = Math.round(between(20, 140));
        type = 'HKWorkoutActivityTypeRunning';
        hrMean = 152 + 6 * (1 - fit);
      } else if (kind === 'ride') {
        distanceM = Math.round(Math.max(15000, gauss(38000 + 12000 * fit, 12000)));
        durationS = Math.round(distanceM / (1000 / 3600) / Math.max(20, gauss(26 + 3 * fit, 2.5)));
        energyKj = Math.round(durationS * 0.68 * 4.184 / 60 * 10);
        climb = Math.round(between(150, 700));
        type = 'HKWorkoutActivityTypeCycling';
        hrMean = 138;
      } else if (kind === 'hike') {
        distanceM = Math.round(between(9000, 18000));
        durationS = Math.round(distanceM / (1000 / 3600) / between(3.6, 4.6));
        energyKj = Math.round(durationS / 60 * 6.5 * 4.184);
        climb = Math.round(between(300, 1100));
        type = 'HKWorkoutActivityTypeHiking';
        hrMean = 118;
      } else {
        distanceM = Math.round(between(2500, 6000));
        durationS = Math.round(distanceM / (1000 / 3600) / between(4.8, 5.6));
        energyKj = Math.round(durationS / 60 * 4.2 * 4.184);
        climb = Math.round(between(0, 60));
        type = 'HKWorkoutActivityTypeWalking';
        hrMean = 98;
        indoor = false;
      }
      const end = new Date(start.getTime() + durationS * 1000);
      await client.query(
        `insert into workouts (subject_id, activity_type, source_id, start_ts, end_ts, tz_offset_min, is_indoor, duration_s, distance_m, energy_kj, elevation_up_m, stats)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, '{}')`,
        [subject.id, type, source.id, start, end, tzOffsetMin(start), indoor, durationS, distanceM, energyKj, climb]
      );
      workouts++;
      session = { start, end, hrMean };
      // Heart rate every ten seconds: warm-up ramp, plateau with drift, a final push on runs.
      const n = Math.floor(durationS / 10);
      for (let k = 0; k < n; k++) {
        const f = k / n;
        const ramp = Math.min(1, f / 0.08);
        const push = kind === 'run' && f > 0.9 ? 10 * ((f - 0.9) / 0.1) : 0;
        const bpm = 70 + (hrMean - 70) * ramp + 6 * Math.sin(f * 9) + push + gauss(0, 2.2);
        obs(HR, new Date(start.getTime() + k * 10_000), Math.round(Math.max(60, Math.min(198, bpm))));
      }
    }

    // Daytime heart rate every three minutes outside the session, steps, energy, distance per hour.
    const wake = sleepEndPrev && dayFmt.format(sleepEndPrev) === day ? sleepEndPrev : localToUtc(day, 7);
    const bedtime = localToUtc(day, 23, 15);
    for (let t = wake.getTime(); t < bedtime.getTime(); t += 180_000) {
      const ts = new Date(t);
      if (session && ts >= session.start && ts < session.end) continue;
      const hourLocal = ((t - localToUtc(day, 0).getTime()) / 3600_000) % 24;
      const active = hourLocal > 8 && hourLocal < 20 ? 1 : 0.4;
      obs(HR, ts, Math.round(Math.max(48, gauss(66 - 4 * fit + 8 * active, 6))));
    }
    let daySteps = 0;
    for (let h = 0; h < 24; h++) {
      const hourStart = localToUtc(day, h);
      const hourEnd = new Date(hourStart.getTime() + 3600_000);
      if (hourEnd <= wake || hourStart >= bedtime) continue;
      const lunch = h === 12 || h === 13 ? 1.6 : 1;
      const commute = h === 8 || h === 18 ? 1.8 : 1;
      let steps = Math.max(0, gauss(330 * lunch * commute * (weekend ? 1.3 : 1), 130));
      let distance = steps * 0.74;
      let kj = Math.max(0, gauss(95 * lunch * commute, 30));
      if (session && session.start < hourEnd && session.end > hourStart) {
        const overlap = (Math.min(session.end, hourEnd) - Math.max(session.start, hourStart)) / 3600_000;
        steps += overlap * (session.hrMean > 130 ? 8600 : 5200);
        distance += overlap * (session.hrMean > 130 ? 10500 : 4800);
        kj += overlap * 2600;
      }
      daySteps += steps;
      obs(STEPS, hourStart, Math.round(steps), hourEnd);
      obs(ENERGY, hourStart, Math.round(kj), hourEnd);
      // Distance in the type's canonical unit (kilometres in the taxonomy).
      obs(DIST, hourStart, +(DIST.unit === 'km' ? distance / 1000 : distance).toFixed(3), hourEnd);
    }
    obs(WALK_HR, localToUtc(day, 17, 40), Math.round(Math.max(80, gauss(104 - 6 * fit, 5))));
    await flush();
  }
  await flush(true);
  await client.query('commit');
  console.log(`written       : ${written} observations, ${workouts} sessions, ${nights} nights`);
  console.log(`subject uuid  : ${subject.id}`);
  console.log(`next          : npm run rollups -- --subject ${subject.id}`);
  console.log(`login         : request a magic link for ${email}`);
} catch (e) {
  await client.query('rollback').catch(() => {});
  throw e;
} finally {
  await client.end();
}
