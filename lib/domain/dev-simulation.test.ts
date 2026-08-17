// Proves the bugfix for the Phase 4 post-completion issue: the developer simulation tools
// (lib/habit-store.tsx's debug* reducer cases) backdated HabitLog dates into the past without
// backdating the habit's createdAt, so Scheduled-Opportunity-based calculations (Momentum,
// Recovery) only ever saw a single opportunity (today) while raw-log calculations (Total
// Completions, Consistency) saw the full backfilled window -- the same underlying data producing
// two different effective histories. backdatedCreatedAt is the fix; these tests prove that
// applying it makes developer-simulated history behaviorally identical to genuine history, using
// the same domain functions (momentum.ts, recovery.ts, habit-stats.ts, schedule.ts) real user
// data goes through, per the Phase 4 bugfix instruction's requirement to reuse existing fixtures
// rather than inventing alternative definitions.
import type { Habit, HabitLog } from '../habit-types';
import { addDays } from './day-key';
import { backdatedCreatedAt, scenarioPattern, simulatedLogsFor, type ScenarioKey } from './dev-simulation';
import { consistency, totalCompletions } from './habit-stats';
import { candidateStateAt, confirmedStateAt } from './momentum';
import { closedLapses, openLapse, recoveryEvents, recoveryRate } from './recovery';
import { retroactiveEntryWindowStart, type HabitSchedulePeriod, scheduledOpportunitiesUpTo } from './schedule';

function habit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'h1',
    name: 'Drink Water',
    emoji: '💧',
    type: 'simple',
    createdAt: '2026-01-31T09:00:00.000Z',
    updatedAt: '2026-01-31T09:00:00.000Z',
    ...overrides,
  };
}

function log(date: string): HabitLog {
  return { id: `h1-${date}`, habitId: 'h1', date, count: 1, loggedAt: `${date}T12:00:00.000Z`, updatedAt: `${date}T12:00:00.000Z` };
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

/** Builds an ascending run of `count` dates starting at `start`. */
function datesFrom(start: string, count: number): string[] {
  const dates: string[] = [];
  let cursor = start;
  for (let i = 0; i < count; i += 1) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

describe('backdatedCreatedAt', () => {
  it('leaves createdAt unchanged when every simulated date is already on/after the creation date', () => {
    const createdAt = '2026-01-31T09:00:00.000Z'; // local day key 2026-01-31
    expect(backdatedCreatedAt(createdAt, ['2026-01-31'])).toBe(createdAt);
    expect(backdatedCreatedAt(createdAt, [])).toBe(createdAt);
  });

  it('backdates to the earliest simulated date, preserving time-of-day', () => {
    const createdAt = '2026-01-31T09:00:00.000Z';
    const dates = datesFrom('2026-01-01', 31); // includes today plus 30 days back
    const result = backdatedCreatedAt(createdAt, dates);
    const original = new Date(createdAt);
    const resolved = new Date(result);
    expect(resolved.getFullYear()).toBe(2026);
    expect(resolved.getMonth()).toBe(0);
    expect(resolved.getDate()).toBe(1);
    expect(resolved.getHours()).toBe(original.getHours());
    expect(resolved.getMinutes()).toBe(original.getMinutes());
  });

  it('never moves createdAt later than it already is (a genuinely older habit is left alone)', () => {
    // The habit's real creation date already predates every date the debug tool is simulating --
    // e.g. "Simulate streak" backfilling the last 6 days for a habit created a month ago.
    const createdAt = '2026-01-01T00:00:00.000Z';
    const recentDates = datesFrom('2026-01-25', 6);
    expect(backdatedCreatedAt(createdAt, recentDates)).toBe(createdAt);
  });

  it('does not backdate past a date later than the current creation date being requested alone', () => {
    // A defensive case: simulated dates that don't include anything earlier than createdAt at all.
    const createdAt = '2026-01-10T00:00:00.000Z';
    expect(backdatedCreatedAt(createdAt, ['2026-01-15', '2026-01-20'])).toBe(createdAt);
  });
});

describe('simulated history is behaviorally equivalent to genuine history', () => {
  // The reported bug: a habit whose real createdAt is "today" gets 30 days of backfilled logs
  // (31 total completions with today's own log), 12 of the last 14 days completed, and yet
  // Momentum State reads insufficient_data because scheduledOpportunitiesUpTo never looks earlier
  // than createdAt. Constructs that exact scenario and its genuine-history equivalent side by side.
  const today = '2026-01-31';
  const missedOffsets = new Set([3, 9]); // 2 misses among the last 14 days -> 12 of 14 completed
  const allDates = datesFrom(addDays(today, -29), 30); // 30-day backfill window, oldest first
  const completedDates = allDates.filter((date) => {
    const offsetFromToday = allDates.length - 1 - allDates.indexOf(date);
    return !missedOffsets.has(offsetFromToday);
  });

  function buildLogs(): HabitLog[] {
    return completedDates.map(log);
  }

  it('a genuinely 30-day-old habit with this history is not insufficient_data and reflects 12/14 recent days', () => {
    const genuine = habit({ createdAt: `${allDates[0]}T09:00:00.000Z` });
    const logs = buildLogs();
    // Daily habit, 30 days old -- the 14-day window fully postdates creation, so schedule-aware
    // consistency's denominator is the same 14 calendar-day-equivalent Scheduled Opportunities the
    // old calendar-day version used. Unchanged by the schedule-aware consistency() fix.
    expect(consistency(genuine, logs, 14, [], today)).toBeCloseTo(12 / 14);
    expect(candidateStateAt(genuine, [], logs, today, today)).not.toBe('insufficient_data');
  });

  it('the same logs backfilled today (bug reproduction) produce insufficient_data if createdAt is left at "today"', () => {
    const buggy = habit({ createdAt: `${today}T09:00:00.000Z` }); // debug tool's un-fixed behavior
    const logs = buildLogs();
    // Total Completions reads raw logs by date -- unaffected by createdAt either way.
    expect(totalCompletions('h1', logs)).toBe(completedDates.length);
    // Changed: consistency() is now schedule-aware (docs/phase-4-completion-report.md, "Consistency
    // becomes schedule-aware"), so it no longer ignores createdAt the way this test's original
    // comment described. With createdAt pinned to "today", the 14-day window has exactly one
    // Scheduled Opportunity (today itself), which this history has completed -- 1/1, not 12/14.
    // This is the same createdAt-floor bug the Momentum assertion below already demonstrates,
    // now also visible in Consistency rather than masked by it.
    expect(consistency(buggy, logs, 14, [], today)).toBe(1);
    // But Scheduled-Opportunity-based Momentum only sees today's single opportunity -- the bug.
    expect(candidateStateAt(buggy, [], logs, today, today)).toBe('insufficient_data');
  });

  it('applying backdatedCreatedAt to the simulated habit resolves the inconsistency identically to genuine history', () => {
    const simulated = habit({ createdAt: `${today}T09:00:00.000Z` });
    const logs = buildLogs();
    const fixedCreatedAt = backdatedCreatedAt(simulated.createdAt, completedDates);
    const fixed = { ...simulated, createdAt: fixedCreatedAt };

    const genuine = habit({ createdAt: `${allDates[0]}T09:00:00.000Z` });

    expect(candidateStateAt(fixed, [], logs, today, today)).toBe(candidateStateAt(genuine, [], logs, today, today));
    expect(confirmedStateAt(fixed, [], logs, today)).toBe(confirmedStateAt(genuine, [], logs, today));
    expect(consistency(fixed, logs, 14, [], today)).toBe(consistency(genuine, logs, 14, [], today));
    expect(totalCompletions('h1', logs)).toBe(completedDates.length);
    expect(candidateStateAt(fixed, [], logs, today, today)).not.toBe('insufficient_data');
  });
});

describe('simulated sparse/new habit history correctly remains insufficient_data', () => {
  it('backdating to cover only 1-2 simulated dates is still below the 3-opportunity floor', () => {
    const today = '2026-01-31';
    const sparseDates = [addDays(today, -1)]; // one backfilled day, plus today itself if logged
    const simulated = habit({ createdAt: `${today}T09:00:00.000Z` });
    const fixed = { ...simulated, createdAt: backdatedCreatedAt(simulated.createdAt, sparseDates) };
    const logs = sparseDates.map(log);
    // Only 2 Scheduled Opportunities exist (yesterday + today) -- genuinely insufficient.
    expect(scheduledOpportunitiesUpTo(fixed, [], today).length).toBe(2);
    expect(candidateStateAt(fixed, [], logs, today, today)).toBe('insufficient_data');
  });
});

describe('simulated recovery history matches an equivalent manually constructed genuine fixture', () => {
  it('produces identical Recovery Events, closed Lapses, and Recovery Rate', () => {
    const today = '2026-01-20';
    // Genuine history: created day 1, completed day 1, missed days 2-3, recovered day 4, then
    // completed through today.
    const genuineCreated = '2026-01-01';
    const genuineDates = [
      '2026-01-01',
      // 01-02, 01-03 missed
      ...datesFrom('2026-01-04', daysBetweenInclusive('2026-01-04', today)),
    ];
    const genuine = habit({ createdAt: `${genuineCreated}T00:00:00.000Z` });
    const genuineLogs = genuineDates.map(log);

    // Simulated equivalent: debug tool backfills the exact same completed dates but leaves
    // createdAt at "today" until backdatedCreatedAt fixes it.
    const simulated = habit({ createdAt: `${today}T09:00:00.000Z` });
    const fixedCreatedAt = backdatedCreatedAt(simulated.createdAt, genuineDates);
    const fixed = { ...simulated, createdAt: fixedCreatedAt };
    const simulatedLogs = genuineDates.map(log);

    expect(fixedCreatedAt.slice(0, 10)).toBe(genuineCreated);
    expect(recoveryEvents(fixed, [], simulatedLogs, today)).toEqual(recoveryEvents(genuine, [], genuineLogs, today));
    expect(closedLapses(fixed, [], simulatedLogs, today)).toEqual(closedLapses(genuine, [], genuineLogs, today));
    expect(recoveryRate(fixed, [], simulatedLogs, today)).toEqual(recoveryRate(genuine, [], genuineLogs, today));
  });

  function daysBetweenInclusive(start: string, end: string): number {
    let count = 1;
    let cursor = start;
    while (cursor < end) {
      cursor = addDays(cursor, 1);
      count += 1;
    }
    return count;
  }
});

describe('simulated history respects the habit creation-date floor', () => {
  it('no Scheduled Opportunity exists before the backdated createdAt even when logs predate it', () => {
    const today = '2026-01-31';
    const requestedDates = datesFrom('2026-01-10', 22); // 2026-01-10 .. 2026-01-31
    const simulated = habit({ createdAt: `${today}T09:00:00.000Z` });
    const fixed = { ...simulated, createdAt: backdatedCreatedAt(simulated.createdAt, requestedDates) };

    const opportunities = scheduledOpportunitiesUpTo(fixed, [], today);
    expect(opportunities[0]).toBe('2026-01-10');
    // A date one day before the earliest simulated/backdated date must still not be an opportunity.
    expect(scheduledOpportunitiesUpTo(fixed, [], addDays('2026-01-10', -1))).toEqual([]);
  });
});

describe('paused and non-scheduled dates are still excluded correctly after backdating', () => {
  it('a paused period within the simulated window still suppresses those dates as opportunities', () => {
    const today = '2026-01-20';
    const dates = datesFrom('2026-01-01', 20);
    const simulated = habit({ createdAt: `${today}T09:00:00.000Z` });
    const fixed = { ...simulated, createdAt: backdatedCreatedAt(simulated.createdAt, dates) };
    const periods = [
      period({ id: 'p1', effectiveFrom: '2026-01-01', days: 'daily', paused: false }),
      period({ id: 'p2', effectiveFrom: '2026-01-10', paused: true }), // paused mid-window
      period({ id: 'p3', effectiveFrom: '2026-01-15', days: 'daily', paused: false }), // resumes
    ];
    const opportunities = scheduledOpportunitiesUpTo(fixed, periods, today);
    expect(opportunities).not.toContain('2026-01-12'); // inside the paused stretch
    expect(opportunities).toContain('2026-01-09'); // before the pause
    expect(opportunities).toContain('2026-01-16'); // after resuming
  });
});

describe('developer simulation never creates future Scheduled Opportunities', () => {
  it('backdating createdAt earlier does not push any opportunity beyond the real "today" boundary', () => {
    const today = '2026-01-15';
    const dates = datesFrom('2026-01-01', 15);
    const simulated = habit({ createdAt: `${today}T09:00:00.000Z` });
    const fixed = { ...simulated, createdAt: backdatedCreatedAt(simulated.createdAt, dates) };
    const opportunities = scheduledOpportunitiesUpTo(fixed, [], today);
    expect(opportunities.every((date) => date <= today)).toBe(true);
    expect(opportunities[opportunities.length - 1]).toBe(today);
  });

  it('a simulated date later than "today" cannot be used to move createdAt forward past it', () => {
    const createdAt = '2026-01-01T00:00:00.000Z';
    // backdatedCreatedAt only ever moves createdAt earlier, so a future-dated entry is a no-op.
    expect(backdatedCreatedAt(createdAt, ['2099-01-01'])).toBe(createdAt);
  });
});

describe('backdatedCreatedAt never widens the retroactive-entry window past the simulated history it created (Phase 4 retroactive-entry-defect follow-up)', () => {
  // backdatedCreatedAt intentionally moves a dev-simulated habit's createdAt earlier so Momentum/
  // Recovery see the full simulated window (the original Phase 4 post-completion fix). That
  // earlier createdAt also feeds retroactiveEntryWindowStart (the production retroactive-entry
  // gate added by the follow-up fix), which takes the *later* of the fixed 7-day window and
  // localDayKeyOf(createdAt) -- so a widened createdAt can only ever raise or match that floor,
  // never lower it below the habit's own (possibly backdated) start. These tests prove that
  // holds for both a scenario shorter than the window and one longer than it.
  const today = '2026-02-20';

  it('a scenario longer than 7 days: the fixed window still caps it, never reaching back to the scenario\'s true (earlier) start', () => {
    // missYesterday spans today-8..today (9 entries) -- longer than the window, so the window
    // itself (today-6, more recent than the backdated creation date) is the binding floor.
    const pattern = scenarioPattern('missYesterday', today);
    const windowDates = pattern.map((day) => day.date);
    const simulated = habit({ createdAt: `${today}T09:00:00.000Z` });
    const fixed = { ...simulated, createdAt: backdatedCreatedAt(simulated.createdAt, windowDates) };

    expect(fixed.createdAt.slice(0, 10)).toBe(windowDates[0]); // createdAt backdated all the way to today-8...
    const editableFrom = retroactiveEntryWindowStart(fixed, today);
    expect(editableFrom).toBe(addDays(today, -6)); // ...but the edit floor is still capped at today-6
    expect(editableFrom > windowDates[0]).toBe(true); // strictly inside the simulated history, not before it
  });

  it('a scenario shorter than 7 days: the habit\'s own (backdated) creation date is the tighter, binding floor', () => {
    // building spans today-5..today (6 entries) -- creation date is more recent than today-6, so
    // this covers the "creation date wins" branch through the real scenario pipeline.
    const pattern = scenarioPattern('building', today);
    const windowDates = pattern.map((day) => day.date);
    const simulated = habit({ createdAt: `${today}T09:00:00.000Z` });
    const fixed = { ...simulated, createdAt: backdatedCreatedAt(simulated.createdAt, windowDates) };

    expect(fixed.createdAt.slice(0, 10)).toBe(windowDates[0]); // createdAt backdated to today-5
    const editableFrom = retroactiveEntryWindowStart(fixed, today);
    expect(editableFrom).toBe(windowDates[0]); // the scenario's own earliest date, today-5 -- not today-6
    // Nothing before the simulated history's start is exposed as editable.
    expect(scheduledOpportunitiesUpTo(fixed, [], addDays(windowDates[0], -1))).toEqual([]);
  });

  it('a 30-day debugFillHistory-style backfill: the fixed 7-day window still caps editability, despite createdAt now being 30 days back', () => {
    const dates = datesFrom(addDays(today, -29), 30);
    const simulated = habit({ createdAt: `${today}T09:00:00.000Z` });
    const fixed = { ...simulated, createdAt: backdatedCreatedAt(simulated.createdAt, dates) };

    // createdAt was pushed all the way back to cover the 30-day backfill...
    expect(fixed.createdAt.slice(0, 10)).toBe(dates[0]);
    // ...but the retroactive-entry floor never reaches that far -- it's still bounded to the
    // last 7 days, exactly as for a genuinely old habit. Widening createdAt for Momentum/Recovery
    // purposes never widens the production edit window beyond its fixed cap.
    expect(retroactiveEntryWindowStart(fixed, today)).toBe(addDays(today, -6));
  });

  it('a habit created and simulated entirely today (0-day scenario window) exposes no editable day at all', () => {
    const simulated = habit({ createdAt: `${today}T09:00:00.000Z` });
    const fixed = { ...simulated, createdAt: backdatedCreatedAt(simulated.createdAt, [today]) };
    expect(retroactiveEntryWindowStart(fixed, today)).toBe(today);
  });
});

describe('scenario simulator produces the domain output each scenario is meant to exercise', () => {
  // Runs each scenario through the exact same pipeline the debugSimulateScenario reducer case
  // uses (scenarioPattern -> backdatedCreatedAt -> simulatedLogsFor), then checks the result
  // against the real domain functions -- proving these buttons generate genuine, valid history
  // rather than special-cased data, per the "do not bypass the domain layer" requirement.
  const today = '2026-02-20';

  function applyScenario(scenario: ScenarioKey) {
    const pattern = scenarioPattern(scenario, today);
    const windowDates = pattern.map((day) => day.date);
    const simulated = habit({ createdAt: `${today}T09:00:00.000Z` });
    const fixed = { ...simulated, createdAt: backdatedCreatedAt(simulated.createdAt, windowDates) };
    const logs = simulatedLogsFor('h1', pattern, 1, `${today}T12:00:00.000Z`);
    return { habit: fixed, logs };
  }

  it('missYesterday opens a 1-day recoverable lapse, today left open for the Recovery Card', () => {
    const { habit: h, logs } = applyScenario('missYesterday');
    expect(openLapse(h, [], logs, today)).toEqual({
      habitId: 'h1',
      firstMissedDate: addDays(today, -1),
      missedOpportunityCount: 1,
    });
  });

  it('missTwoConsecutive opens a 2-day recoverable lapse, today left open', () => {
    const { habit: h, logs } = applyScenario('missTwoConsecutive');
    expect(openLapse(h, [], logs, today)).toEqual({
      habitId: 'h1',
      firstMissedDate: addDays(today, -2),
      missedOpportunityCount: 2,
    });
  });

  it('recoverToday fires a Recovery Event on today\'s date', () => {
    const { habit: h, logs } = applyScenario('recoverToday');
    expect(recoveryEvents(h, [], logs, today)).toEqual([{ habitId: 'h1', date: today }]);
  });

  it('recoverAfterMultipleMisses closes a >=3-opportunity lapse on today\'s date', () => {
    const { habit: h, logs } = applyScenario('recoverAfterMultipleMisses');
    const lapses = closedLapses(h, [], logs, today);
    expect(lapses).toHaveLength(1);
    expect(lapses[0].recoveredDate).toBe(today);
    expect(lapses[0].missedOpportunityCount).toBeGreaterThanOrEqual(3);
  });

  it('quietStretch confirms the quiet Momentum State', () => {
    const { habit: h, logs } = applyScenario('quietStretch');
    expect(confirmedStateAt(h, [], logs, today)).toBe('quiet');
  });

  it('rebuilding confirms the rebuilding Momentum State', () => {
    const { habit: h, logs } = applyScenario('rebuilding');
    expect(confirmedStateAt(h, [], logs, today)).toBe('rebuilding');
  });

  it('building confirms the building Momentum State', () => {
    const { habit: h, logs } = applyScenario('building');
    expect(confirmedStateAt(h, [], logs, today)).toBe('building');
  });

  it('thriving confirms the thriving Momentum State', () => {
    const { habit: h, logs } = applyScenario('thriving');
    expect(confirmedStateAt(h, [], logs, today)).toBe('thriving');
  });
});
