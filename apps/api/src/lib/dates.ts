/**
 * Today's date in India (YYYY-MM-DD). Training days follow IST, not the server's time zone.
 * Tests pin "today" with VTA_TODAY so fixed demo dates keep working as real time passes.
 * VTA_TODAY is ignored in production.
 */
export function todayIst(now = new Date()): string {
  const pinned = process.env.VTA_TODAY;
  if (pinned && process.env.NODE_ENV !== 'production' && /^\d{4}-\d{2}-\d{2}$/.test(pinned)) return pinned;
  return new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

/** "12 Nov 2026, 10:30 am" in India time, for notification text. */
export function formatIstDateTime(d: Date): string {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(d);
}

/** "2026-11-12" → "12 Nov 2026". */
export function formatDay(day: string): string {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
}
