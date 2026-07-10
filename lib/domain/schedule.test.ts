import type { Habit } from '../habit-types';
import {
  type HabitSchedulePeriod,
  isScheduledOpportunity,
  localDayKeyOf,
  parseDayKeyParts,
  scheduleForDate,
  scheduledOpportunitiesUpTo,
  weekdayOf,
} from './schedule';

function habit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'h1',
    name: 'Read',
    emoji: '📚',
    type: 'simple',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function period(overrides: Partial<HabitSchedulePeriod> = {}): HabitSchedulePeriod {
  return {
    id: 'p1',
    habitId: 'h1',
    effectiveFrom: '2026-01-01',
    days: 'daily',
    paused: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('weekdayOf -- timezone independence (resolves the new Date(dayKey) UTC-shift bug)', () => {
  // Reference dates with independently well-known weekdays, not derived from this implementation:
  // 2024-01-01 was a Monday, 2024-07-04 was a Thursday, 2000-01-01 was a Saturday.
  const cases: [string, number][] = [
    ['2024-01-01', 1], // Monday
    ['2024-07-04', 4], // Thursday
    ['2000-01-01', 6], // Saturday
  ];

  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it.each(['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati'])('is stable under TZ=%s', (tz) => {
    process.env.TZ = tz;
    for (const [key, expected] of cases) {
      expect(weekdayOf(key)).toBe(expected);
    }
  });
});

describe('parseDayKeyParts', () => {
  it('splits a day key into numeric parts', () => {
    expect(parseDayKeyParts('2026-03-05')).toEqual({ year: 2026, month: 3, day: 5 });
  });
});

describe('localDayKeyOf', () => {
  it('extracts the local day key from an ISO timestamp', () => {
    expect(localDayKeyOf('2026-01-01T00:00:00.000Z')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('scheduleForDate', () => {
  it('defaults to daily/unpaused with no periods -- the entire migration story for existing habits', () => {
    expect(scheduleForDate([], 'h1', '2026-05-01')).toEqual({ days: 'daily', paused: false });
  });

  it('resolves a weekday schedule', () => {
    const periods = [period({ days: [1, 3, 5] })]; // Mon/Wed/Fri
    expect(scheduleForDate(periods, 'h1', '2026-05-01')).toEqual({ days: [1, 3, 5], paused: false });
  });

  it('resolves a paused period', () => {
    const periods = [period({ paused: true })];
    expect(scheduleForDate(periods, 'h1', '2026-05-01').paused).toBe(true);
  });

  it('picks the latest effectiveFrom <= date, never a future period', () => {
    const periods = [
      period({ id: 'p1', effectiveFrom: '2026-01-01', days: 'daily' }),
      period({ id: 'p2', effectiveFrom: '2026-06-01', days: [1, 3, 5] }),
    ];
    expect(scheduleForDate(periods, 'h1', '2026-03-01')).toEqual({ days: 'daily', paused: false });
    expect(scheduleForDate(periods, 'h1', '2026-07-01')).toEqual({ days: [1, 3, 5], paused: false });
  });

  it('breaks an effectiveFrom/createdAt tie deterministically by id', () => {
    const periods = [
      period({ id: 'aaa', effectiveFrom: '2026-01-01', createdAt: '2026-01-01T00:00:00.000Z', days: 'daily' }),
      period({ id: 'zzz', effectiveFrom: '2026-01-01', createdAt: '2026-01-01T00:00:00.000Z', paused: true }),
    ];
    // 'zzz' > 'aaa' lexicographically, so it wins the tie regardless of call order.
    expect(scheduleForDate(periods, 'h1', '2026-01-01').paused).toBe(true);
    expect(scheduleForDate([...periods].reverse(), 'h1', '2026-01-01').paused).toBe(true);
  });
});

describe('isScheduledOpportunity', () => {
  it('is true for a daily habit on any date on/after creation', () => {
    expect(isScheduledOpportunity([], habit(), '2026-06-15')).toBe(true);
  });

  it('respects a weekday-restricted schedule', () => {
    const periods = [period({ days: [1, 3, 5] })]; // Mon/Wed/Fri
    // 2026-05-04 is a Monday, 2026-05-05 is a Tuesday.
    expect(isScheduledOpportunity(periods, habit(), '2026-05-04')).toBe(true);
    expect(isScheduledOpportunity(periods, habit(), '2026-05-05')).toBe(false);
  });

  it('is false for any date while paused', () => {
    const periods = [period({ paused: true })];
    expect(isScheduledOpportunity(periods, habit(), '2026-06-15')).toBe(false);
  });

  it('never treats a date before habit creation as a scheduled opportunity, even under a matching period', () => {
    const h = habit({ createdAt: '2026-03-01T00:00:00.000Z' });
    const periods = [period({ effectiveFrom: '2020-01-01', days: 'daily' })]; // predates creation
    expect(isScheduledOpportunity(periods, h, '2026-02-15')).toBe(false);
    expect(isScheduledOpportunity(periods, h, '2026-03-01')).toBe(true);
  });

  it('a mid-history schedule change does not recalculate the meaning of past dates', () => {
    const h = habit({ createdAt: '2026-01-01T00:00:00.000Z' });
    const periods = [
      period({ id: 'p1', effectiveFrom: '2026-01-01', days: 'daily' }),
      period({ id: 'p2', effectiveFrom: '2026-02-01', days: [1, 3, 5] }), // Mon/Wed/Fri from Feb onward
    ];
    // 2026-01-17 is a Saturday: daily period was in effect, so it was an opportunity then...
    expect(isScheduledOpportunity(periods, h, '2026-01-17')).toBe(true);
    // ...and still is when re-evaluated after the later schedule change exists, because the old
    // period governs it forever -- the new period only governs dates from 2026-02-01 onward.
    // 2026-02-14 is a Saturday, now governed by the new Mon/Wed/Fri period, so no opportunity.
    expect(isScheduledOpportunity(periods, h, '2026-02-14')).toBe(false);
  });
});

describe('scheduledOpportunitiesUpTo', () => {
  it('returns an empty list for a habit created after "today"', () => {
    const h = habit({ createdAt: '2026-06-01T00:00:00.000Z' });
    expect(scheduledOpportunitiesUpTo(h, [], '2026-05-01')).toEqual([]);
  });

  it('returns every daily date from creation through today, inclusive', () => {
    const h = habit({ createdAt: '2026-01-01T00:00:00.000Z' });
    const result = scheduledOpportunitiesUpTo(h, [], '2026-01-05');
    expect(result).toEqual(['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05']);
  });

  it('skips non-scheduled weekdays for a Mon/Wed/Fri habit', () => {
    const h = habit({ createdAt: '2026-05-01T00:00:00.000Z' }); // a Friday
    const periods = [period({ effectiveFrom: '2026-05-01', days: [1, 3, 5] })];
    // 05-01 Fri, 05-02 Sat, 05-03 Sun, 05-04 Mon, 05-05 Tue, 05-06 Wed
    const result = scheduledOpportunitiesUpTo(h, periods, '2026-05-06');
    expect(result).toEqual(['2026-05-01', '2026-05-04', '2026-05-06']);
  });
});
