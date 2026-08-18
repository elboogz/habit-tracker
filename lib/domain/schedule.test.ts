import type { Habit } from '../habit-types';
import { addDays } from './day-key';
import {
  type HabitSchedulePeriod,
  isScheduledOpportunity,
  localDayKeyOf,
  nextScheduledOpportunityAfter,
  parseDayKeyParts,
  recentScheduledPatternDates,
  retroactiveEntryWindowStart,
  scheduleForDate,
  scheduledOpportunitiesInWindow,
  scheduledOpportunitiesUpTo,
  scheduledOpportunityFlags,
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

describe('scheduledOpportunitiesInWindow (windowed counterpart, motivated by Consistency)', () => {
  it('matches scheduledOpportunitiesUpTo when the window covers the habit\'s whole lifetime', () => {
    const h = habit({ createdAt: '2026-05-01T00:00:00.000Z' }); // a Friday
    const periods = [period({ effectiveFrom: '2026-05-01', days: [1, 3, 5] })];
    expect(scheduledOpportunitiesInWindow(h, periods, 6, '2026-05-06')).toEqual(
      scheduledOpportunitiesUpTo(h, periods, '2026-05-06'),
    );
  });

  it('does not extend past a habit\'s creation date even when the window nominally would', () => {
    const h = habit({ createdAt: '2026-05-04T00:00:00.000Z' });
    // A 14-day window ending 2026-05-06 would nominally start 2026-04-23, well before creation.
    expect(scheduledOpportunitiesInWindow(h, [], 14, '2026-05-06')).toEqual(['2026-05-04', '2026-05-05', '2026-05-06']);
  });

  it('is empty when the window contains zero Scheduled Opportunities', () => {
    const h = habit({ createdAt: '2026-05-04T00:00:00.000Z' }); // a Monday
    const periods = [period({ effectiveFrom: '2026-05-04', days: [0] })]; // Sundays only
    // First Sunday is 2026-05-10; viewed on 2026-05-06, none have occurred yet.
    expect(scheduledOpportunitiesInWindow(h, periods, 7, '2026-05-06')).toEqual([]);
  });

  it('excludes a paused sub-range from the window', () => {
    const h = habit({ createdAt: '2026-05-01T00:00:00.000Z' });
    const periods = [
      period({ effectiveFrom: '2026-05-01', days: 'daily', paused: false }),
      period({ id: 'p2', effectiveFrom: '2026-05-04', days: 'daily', paused: true }),
      period({ id: 'p3', effectiveFrom: '2026-05-06', days: 'daily', paused: false }),
    ];
    expect(scheduledOpportunitiesInWindow(h, periods, 7, '2026-05-07')).toEqual([
      '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-06', '2026-05-07',
    ]);
  });
});

describe("scheduledOpportunityFlags (per-date classification for HabitCalendar's third cell state)", () => {
  it('agrees with scheduledOpportunitiesInWindow -- every scheduled date true, every other false', () => {
    const h = habit({ createdAt: '2026-05-01T00:00:00.000Z' }); // a Friday
    const periods = [period({ effectiveFrom: '2026-05-01', days: [1, 3, 5] })];
    const flags = scheduledOpportunityFlags(h, periods, 6, '2026-05-06');
    const scheduledDates = new Set(scheduledOpportunitiesInWindow(h, periods, 6, '2026-05-06'));
    expect(flags.every((flag) => flag.scheduled === scheduledDates.has(flag.date))).toBe(true);
    expect(flags.map((flag) => flag.date)).toEqual([
      '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05', '2026-05-06',
    ]);
  });

  it('marks non-daily off-schedule weekdays false, for a Mon/Wed/Fri habit', () => {
    const h = habit({ createdAt: '2026-05-01T00:00:00.000Z' }); // a Friday
    const periods = [period({ effectiveFrom: '2026-05-01', days: [1, 3, 5] })];
    expect(scheduledOpportunityFlags(h, periods, 6, '2026-05-06')).toEqual([
      { date: '2026-05-01', scheduled: true }, // Fri
      { date: '2026-05-02', scheduled: false }, // Sat
      { date: '2026-05-03', scheduled: false }, // Sun
      { date: '2026-05-04', scheduled: true }, // Mon
      { date: '2026-05-05', scheduled: false }, // Tue
      { date: '2026-05-06', scheduled: true }, // Wed
    ]);
  });

  it('marks a paused sub-range false, indistinguishable from an ordinary off-schedule date', () => {
    const h = habit({ createdAt: '2026-05-01T00:00:00.000Z' });
    const periods = [
      period({ effectiveFrom: '2026-05-01', days: 'daily', paused: false }),
      period({ id: 'p2', effectiveFrom: '2026-05-04', days: 'daily', paused: true }),
      period({ id: 'p3', effectiveFrom: '2026-05-06', days: 'daily', paused: false }),
    ];
    // The paused dates (05-04, 05-05) resolve to the same `scheduled: false` an ordinary
    // off-schedule date would -- no field here distinguishes "paused" from "not scheduled today",
    // matching the product decision that they share one presentation state.
    expect(scheduledOpportunityFlags(h, periods, 7, '2026-05-07')).toEqual([
      { date: '2026-05-01', scheduled: true },
      { date: '2026-05-02', scheduled: true },
      { date: '2026-05-03', scheduled: true },
      { date: '2026-05-04', scheduled: false },
      { date: '2026-05-05', scheduled: false },
      { date: '2026-05-06', scheduled: true },
      { date: '2026-05-07', scheduled: true },
    ]);
  });

  it('marks pre-creation dates false regardless of the (absent) schedule', () => {
    const h = habit({ createdAt: '2026-05-04T00:00:00.000Z' });
    expect(scheduledOpportunityFlags(h, [], 7, '2026-05-06')).toEqual([
      { date: '2026-04-30', scheduled: false }, // before creation
      { date: '2026-05-01', scheduled: false },
      { date: '2026-05-02', scheduled: false },
      { date: '2026-05-03', scheduled: false },
      { date: '2026-05-04', scheduled: true }, // creation day itself
      { date: '2026-05-05', scheduled: true },
      { date: '2026-05-06', scheduled: true },
    ]);
  });

  it('the creation floor wins over a period whose effectiveFrom predates the habit (degenerate case)', () => {
    const h = habit({ createdAt: '2026-05-05T00:00:00.000Z' });
    // This period's effectiveFrom (05-01) predates the habit's own creation (05-05) -- shouldn't
    // occur through normal use, but isScheduledOpportunity's own doc comment calls out that the
    // creation floor must still win regardless of how a period got there. A daily, unpaused period
    // would otherwise mark every date in the window scheduled.
    const periods = [period({ effectiveFrom: '2026-05-01', days: 'daily', paused: false })];
    expect(scheduledOpportunityFlags(h, periods, 7, '2026-05-07')).toEqual([
      { date: '2026-05-01', scheduled: false }, // pre-creation -- floor wins despite the period covering this date
      { date: '2026-05-02', scheduled: false },
      { date: '2026-05-03', scheduled: false },
      { date: '2026-05-04', scheduled: false },
      { date: '2026-05-05', scheduled: true }, // creation day -- the period now applies
      { date: '2026-05-06', scheduled: true },
      { date: '2026-05-07', scheduled: true },
    ]);
  });
});

describe('recentScheduledPatternDates (schedule-pattern-only walk, no creation floor -- dev-tool date generation)', () => {
  it('returns the N most recent consecutive calendar days for a daily/unpaused schedule (no periods)', () => {
    expect(recentScheduledPatternDates('h1', [], 5, '2026-05-10')).toEqual([
      '2026-05-06', '2026-05-07', '2026-05-08', '2026-05-09', '2026-05-10',
    ]);
  });

  it('returns only Mon/Wed/Fri dates for a Mon/Wed/Fri schedule', () => {
    const periods = [period({ effectiveFrom: '2020-01-01', days: [1, 3, 5] })];
    // 2026-05-10 is a Sunday; walking back finds Fri 05-08, Wed 05-06, Mon 05-04.
    expect(recentScheduledPatternDates('h1', periods, 3, '2026-05-10')).toEqual([
      '2026-05-04', '2026-05-06', '2026-05-08',
    ]);
  });

  it('skips a paused sub-range entirely, reaching further back to find enough matches', () => {
    const periods = [
      period({ effectiveFrom: '2020-01-01', days: 'daily', paused: false }),
      period({ id: 'p2', effectiveFrom: '2026-05-08', days: 'daily', paused: true }),
    ];
    // Paused from 05-08 onward -- the 3 most recent non-paused days are 05-05, 05-06, 05-07.
    expect(recentScheduledPatternDates('h1', periods, 3, '2026-05-10')).toEqual([
      '2026-05-05', '2026-05-06', '2026-05-07',
    ]);
  });

  it('consults no habit creation date -- unlike isScheduledOpportunity, a habitId alone is enough', () => {
    // This function's signature doesn't even accept a Habit -- documenting the deliberate
    // omission described in its own doc comment, not just asserting a value.
    const periods = [period({ effectiveFrom: '2020-01-01', days: 'daily' })];
    expect(recentScheduledPatternDates('h1', periods, 2, '2026-05-10')).toEqual(['2026-05-09', '2026-05-10']);
  });

  it('returns fewer than requested, not an infinite loop, when the schedule never matches within the lookback bound', () => {
    const periods = [period({ effectiveFrom: '2020-01-01', days: 'daily', paused: true })];
    expect(recentScheduledPatternDates('h1', periods, 5, '2026-05-10', 30)).toEqual([]);
  });
});

describe('nextScheduledOpportunityAfter (Phase 4 -- recovery card suppression)', () => {
  it('returns the very next day for a daily habit', () => {
    expect(nextScheduledOpportunityAfter([], habit(), '2026-05-01')).toBe('2026-05-02');
  });

  it('skips ahead to the next matching weekday for a Mon/Wed/Fri habit', () => {
    const periods = [period({ days: [1, 3, 5] })]; // Mon/Wed/Fri
    // 2026-05-04 is a Monday -- next scheduled opportunity is Wednesday 05-06.
    expect(nextScheduledOpportunityAfter(periods, habit(), '2026-05-04')).toBe('2026-05-06');
    // From a Wednesday, next is Friday.
    expect(nextScheduledOpportunityAfter(periods, habit(), '2026-05-06')).toBe('2026-05-08');
  });

  it('returns null for a habit paused indefinitely with no future unpaused period', () => {
    const periods = [period({ paused: true })];
    expect(nextScheduledOpportunityAfter(periods, habit(), '2026-05-01', 30)).toBeNull();
  });

  it('finds the reopening date across a bounded pause', () => {
    const periods = [
      period({ id: 'p1', effectiveFrom: '2026-05-01', paused: true }),
      period({ id: 'p2', effectiveFrom: '2026-05-10', paused: false, days: 'daily' }),
    ];
    expect(nextScheduledOpportunityAfter(periods, habit(), '2026-05-02')).toBe('2026-05-10');
  });
});

describe('retroactiveEntryWindowStart (Phase 4 retroactive-entry-defect fix)', () => {
  it('is bounded by the 7-day window for a long-lived habit -- the window, not the creation date, is the floor', () => {
    const h = habit({ createdAt: '2020-01-01T00:00:00.000Z' });
    expect(retroactiveEntryWindowStart(h, '2026-05-10')).toBe('2026-05-04'); // today - 6
  });

  it('is bounded by the habit\'s own creation date when the habit is newer than the window', () => {
    const h = habit({ createdAt: '2026-05-08T00:00:00.000Z' }); // 2 days before "today"
    expect(retroactiveEntryWindowStart(h, '2026-05-10')).toBe('2026-05-08');
  });

  it('equals "today" for a habit created today -- no prior date is ever editable', () => {
    const h = habit({ createdAt: '2026-05-10T09:00:00.000Z' });
    expect(retroactiveEntryWindowStart(h, '2026-05-10')).toBe('2026-05-10');
  });

  it('agrees with the window exactly at the boundary (habit created exactly 6 days ago)', () => {
    const h = habit({ createdAt: '2026-05-04T00:00:00.000Z' });
    expect(retroactiveEntryWindowStart(h, '2026-05-10')).toBe('2026-05-04');
  });
});

describe('production retroactive-entry UI-path gating (regression coverage for the Phase 4 defect)', () => {
  // Mirrors components/habit-calendar.tsx's isEditable predicate exactly:
  //   day.date >= editableFrom && day.date < today
  // with editableFrom now always sourced from retroactiveEntryWindowStart, so this proves the UI
  // path cannot produce a pre-creation editable date, while every genuinely correctable day in the
  // window is still reachable.
  function isEditableThroughUi(h: Habit, date: string, today: string): boolean {
    const editableFrom = retroactiveEntryWindowStart(h, today);
    return date >= editableFrom && date < today;
  }

  it('a habit created today has no editable day at all -- no pre-creation log can be entered', () => {
    const h = habit({ createdAt: '2026-05-10T08:00:00.000Z' });
    for (let i = 0; i <= 10; i += 1) {
      expect(isEditableThroughUi(h, addDays('2026-05-10', -i), '2026-05-10')).toBe(false);
    }
  });

  it('a habit created 2 days ago only allows correcting the 2 days it has actually existed for', () => {
    const h = habit({ createdAt: '2026-05-08T08:00:00.000Z' });
    const today = '2026-05-10';
    expect(isEditableThroughUi(h, '2026-05-09', today)).toBe(true); // yesterday, post-creation
    expect(isEditableThroughUi(h, '2026-05-08', today)).toBe(true); // creation day itself
    expect(isEditableThroughUi(h, '2026-05-07', today)).toBe(false); // day before creation
    expect(isEditableThroughUi(h, '2026-05-04', today)).toBe(false); // well before creation, still inside the raw 7-day window
  });

  it('a long-lived habit keeps the full 7-day window editable, none of it pre-creation', () => {
    const h = habit({ createdAt: '2020-01-01T00:00:00.000Z' });
    const today = '2026-05-10';
    for (let i = 1; i <= 6; i += 1) {
      expect(isEditableThroughUi(h, addDays(today, -i), today)).toBe(true);
    }
    expect(isEditableThroughUi(h, addDays(today, -7), today)).toBe(false); // outside the window
  });

  it('today itself is never editable through this path regardless of creation date', () => {
    const h = habit({ createdAt: '2020-01-01T00:00:00.000Z' });
    expect(isEditableThroughUi(h, '2026-05-10', '2026-05-10')).toBe(false);
  });
});
