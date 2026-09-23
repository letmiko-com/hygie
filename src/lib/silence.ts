// One threshold for "this device has gone quiet": the silence alert email
// (src/lib/ingest/silence-alert.ts) and the "behind" badges of the Devices
// and Sync screens read the same value, so the screen never says "up to date"
// about a device the server has just emailed about. HYGIE_SILENCE_ALERT_HOURS,
// 24 by default (decision of 2026-09-23); 0 turns the email off, the badges
// then fall back to the default.
const DEFAULT_HOURS = 24;

function configuredHours(): number | null {
  const raw = process.env.HYGIE_SILENCE_ALERT_HOURS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_HOURS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_HOURS;
}

/** Hours of silence before the email leaves; null when the email is turned off. */
export function silenceAlertHours(): number | null {
  const h = configuredHours();
  return h === 0 ? null : h;
}

/** Silence past this age flags a device as behind on screen. */
export function staleAfterMs(): number {
  return (silenceAlertHours() ?? DEFAULT_HOURS) * 60 * 60 * 1000;
}
