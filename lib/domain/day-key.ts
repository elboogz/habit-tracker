// Lowest-level, dependency-free date utilities shared by lib/domain/habit-stats.ts and
// lib/domain/schedule.ts (both import from here rather than from each other, which would create
// a circular import now that challengeProgress consults isScheduledOpportunity).

/** Local day key 'YYYY-MM-DD' — avoids UTC off-by-one issues from toISOString(). */
export function dayKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDays(key: string, amount: number): string {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(year, month - 1, day + amount);
  return dayKey(date);
}

export function parseDayKeyParts(key: string): { year: number; month: number; day: number } {
  const [year, month, day] = key.split('-').map(Number);
  return { year, month, day };
}

/**
 * 0 (Sunday) - 6 (Saturday) for a local day key, computed via the local Date constructor form
 * (never `new Date(key)`, which JS parses as UTC midnight and can report the wrong weekday for
 * roughly half the world's timezones once converted back to local time).
 */
export function weekdayOf(key: string): number {
  const { year, month, day } = parseDayKeyParts(key);
  return new Date(year, month - 1, day).getDay();
}

/** Local day key for an ISO timestamp (e.g. Habit.createdAt). */
export function localDayKeyOf(isoTimestamp: string): string {
  return dayKey(new Date(isoTimestamp));
}

/** Calendar days between two local day keys (UTC-anchored so DST transitions never skew a pure date-only difference). */
export function daysBetween(fromKey: string, toKey: string): number {
  const [fy, fm, fd] = fromKey.split('-').map(Number);
  const [ty, tm, td] = toKey.split('-').map(Number);
  const from = Date.UTC(fy, fm - 1, fd);
  const to = Date.UTC(ty, tm - 1, td);
  return Math.round((to - from) / (1000 * 60 * 60 * 24));
}
