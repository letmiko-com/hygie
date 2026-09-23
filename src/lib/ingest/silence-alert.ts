// Silence alert (docs/architecture.md §3): a paired device that has sent
// nothing for HYGIE_SILENCE_ALERT_HOURS (src/lib/silence.ts) gets one email
// per silence episode, to the members of its subject AND to every instance
// admin. A device's silence is instance information, like the sync state the
// admin already sees: the message names the device, the subject and the time
// of the last batch, never a health value. Runs in the worker's hourly
// maintenance, so an alert leaves between the threshold and one hour after.
//
// State: devices.silence_alerted_at (migration 0009). An episode starts at
// coalesce(last_seen_at, created_at) and is alerted once silence_alerted_at is
// later than that start; the next batch moves last_seen_at past it, which
// re-arms the alert with no write on the ingest path. The claim is committed
// BEFORE sending, so two processes overlapping during a redeploy cannot both
// send, and it is rolled back when no recipient could be reached, so the next
// hour retries. Logs carry device ids and counts, never an address.
import { getDb } from '@/lib/db';
import { escapeHtml, sendMail } from '@/lib/auth/mailer';
import { getMessages, resolveLocale } from '@/lib/i18n';
import { silenceAlertHours } from '@/lib/silence';

/** Postgres undefined_column: the release runs ahead of migration 0009. */
const UNDEFINED_COLUMN = '42703';

interface ClaimedDevice {
  id: string;
  name: string;
  subject_id: string;
  subject_name: string;
  timezone: string;
  since: Date;
  never_sent: boolean;
  // Text, not Date: the rollback compares them with equality, and a JS Date
  // drops the microseconds Postgres stores.
  previous: string | null;
  claimed_at: string;
}

interface Recipient {
  email: string;
  locale: string;
  member: boolean;
}

let schemaPendingLogged = false;

/** Claims every device whose current silence episode has not been alerted yet. */
async function claimSilentDevices(hours: number): Promise<ClaimedDevice[] | null> {
  try {
    const { rows } = await getDb().query<ClaimedDevice>(
      `with candidates as (
         select d.id, d.silence_alerted_at::text as previous
         from devices d
         join subjects s on s.id = d.subject_id
         where d.revoked_at is null
           and s.purge_state = 'live'
           and coalesce(d.last_seen_at, d.created_at) < now() - $1::double precision * interval '1 hour'
           and (d.silence_alerted_at is null
                or d.silence_alerted_at < coalesce(d.last_seen_at, d.created_at))
         for update of d skip locked
       )
       update devices d
       set silence_alerted_at = now()
       from candidates c, subjects s
       where d.id = c.id and s.id = d.subject_id
       returning d.id, d.name, d.subject_id, s.display_name as subject_name, s.timezone,
                 coalesce(d.last_seen_at, d.created_at) as since,
                 d.last_seen_at is null as never_sent, c.previous,
                 d.silence_alerted_at::text as claimed_at`,
      [hours]
    );
    return rows;
  } catch (err) {
    if (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === UNDEFINED_COLUMN) {
      if (!schemaPendingLogged) {
        schemaPendingLogged = true;
        console.log('[worker] silence alert: waiting for migration 0009, check skipped');
      }
      return null;
    }
    throw err;
  }
}

/** The subject's members and every admin, enabled accounts only, one row per address. */
async function recipientsFor(subjectId: string): Promise<Recipient[]> {
  const { rows } = await getDb().query<Recipient>(
    `select u.email, u.locale,
            exists (select 1 from access_grants g
                    where g.user_id = u.id and g.subject_id = $1) as member
     from users u
     where u.disabled_at is null
       and (u.is_admin
            or exists (select 1 from access_grants g
                       where g.user_id = u.id and g.subject_id = $1))`,
    [subjectId]
  );
  return rows;
}

function buildMessage(device: ClaimedDevice, recipient: Recipient, hours: number) {
  const locale = resolveLocale(recipient.locale);
  const m = getMessages(locale).silenceMail;
  const intl = locale === 'fr' ? 'fr-FR' : 'en-GB';
  const since = new Intl.DateTimeFormat(intl, {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: device.timezone,
  }).format(device.since);
  const hoursText = new Intl.NumberFormat(intl, { maximumFractionDigits: 1 }).format(hours);
  const base = (process.env.HYGIE_BASE_URL ?? '').replace(/\/$/, '');
  const devicesUrl = base ? `${base}/devices` : null;

  const body = device.never_sent
    ? m.bodyNever(device.name, device.subject_name, since, hoursText)
    : m.body(device.name, device.subject_name, since, hoursText);

  // Members get the way to act; an admin outside the subject gets why they
  // received it (their own Devices screen would not show this device).
  const text: string[] = [m.greeting, '', body, ''];
  const html: string[] = [`<p>${escapeHtml(m.greeting)}</p>`, `<p>${escapeHtml(body)}</p>`];
  if (recipient.member) {
    text.push(m.memberHint);
    html.push(`<p>${escapeHtml(m.memberHint)}</p>`);
    if (devicesUrl) {
      text.push(m.devicesLine(devicesUrl));
      html.push(`<p><a href="${escapeHtml(devicesUrl)}">${escapeHtml(m.devicesLink)}</a></p>`);
    }
  } else {
    text.push(m.adminNote);
    html.push(`<p>${escapeHtml(m.adminNote)}</p>`);
  }
  text.push('', m.once);
  html.push(`<p>${escapeHtml(m.once)}</p>`);

  return {
    to: recipient.email,
    subject: m.subject(device.name),
    text: text.join('\n'),
    html: html.join('\n'),
  };
}

/** Hourly: emails about every device that has just crossed the silence threshold. */
export async function runSilenceAlerts(): Promise<void> {
  const hours = silenceAlertHours();
  if (hours === null) return;
  const claimed = await claimSilentDevices(hours);
  if (!claimed || claimed.length === 0) return;

  const db = getDb();
  for (const device of claimed) {
    const recipients = await recipientsFor(device.subject_id);
    let sent = 0;
    let failed = 0;
    for (const recipient of recipients) {
      try {
        await sendMail(buildMessage(device, recipient, hours));
        sent++;
      } catch {
        failed++;
      }
    }
    if (sent === 0 && failed > 0) {
      // Nobody reached: give the episode back so the next hour retries. The
      // guard on claimed_at leaves alone a claim a newer run has made since.
      await db.query(
        `update devices set silence_alerted_at = $2::timestamptz
         where id = $1 and silence_alerted_at = $3::timestamptz`,
        [device.id, device.previous, device.claimed_at]
      );
    }
    console.log(
      `[worker] silence alert: device ${device.id}, ${sent} sent, ${failed} failed${sent === 0 && failed > 0 ? ', retry next hour' : ''}`
    );
  }
}
