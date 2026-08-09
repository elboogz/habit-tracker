import type { Habit, HabitLog } from '../habit-types';
import { addDays } from './day-key';
import { candidateStateAt, computeConfirmedState, confirmedStateAt, momentum } from './momentum';

function habit(createdAt: string): Habit {
  return {
    id: 'h1',
    name: 'Read',
    emoji: '📚',
    type: 'simple',
    createdAt: `${createdAt}T00:00:00.000Z`,
    updatedAt: `${createdAt}T00:00:00.000Z`,
  };
}

function log(date: string): HabitLog {
  return { id: `h1-${date}`, habitId: 'h1', date, count: 1, loggedAt: `${date}T12:00:00.000Z`, updatedAt: `${date}T12:00:00.000Z` };
}

/** Builds logs for every date in `completedDates` starting from `start`, walking `count` days. */
function datesFrom(start: string, count: number): string[] {
  const dates: string[] = [];
  let cursor = start;
  for (let i = 0; i < count; i += 1) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

describe('candidate state -- individual scenarios', () => {
  it('insufficient_data for a brand-new habit with fewer than 3 opportunities', () => {
    const h = habit('2026-01-01');
    const logs = [log('2026-01-01')];
    expect(candidateStateAt(h, [], logs, '2026-01-02', '2026-01-02')).toBe('insufficient_data');
  });

  it('building once a short window clears its completion-rate bar with no prior window to compare against', () => {
    const h = habit('2026-01-01');
    const days = datesFrom('2026-01-01', 3);
    const logs = days.map(log);
    expect(candidateStateAt(h, [], logs, days[2], days[2])).toBe('building');
  });

  it('steady once a 5-opportunity window clears 80% with no open lapse', () => {
    const h = habit('2026-01-01');
    const days = datesFrom('2026-01-01', 5);
    const logs = days.map(log);
    expect(candidateStateAt(h, [], logs, days[4], days[4])).toBe('steady');
  });

  it('thriving once an 8-opportunity window is entirely completed', () => {
    const h = habit('2026-01-01');
    const days = datesFrom('2026-01-01', 8);
    const logs = days.map(log);
    expect(candidateStateAt(h, [], logs, days[7], days[7])).toBe('thriving');
  });

  it('recovering right after closing a short (<=2 opportunity) lapse', () => {
    const h = habit('2026-01-01');
    const logs = [log('2026-01-01'), log('2026-01-03')]; // 01-02 missed, 01-03 recovers it
    expect(candidateStateAt(h, [], logs, '2026-01-03', '2026-01-03')).toBe('recovering');
  });

  it('rebuilding right after closing a longer (>=3 opportunity) lapse', () => {
    const h = habit('2026-01-01');
    const logs = [log('2026-01-01'), log('2026-01-05')]; // 01-02..01-04 missed (3), 01-05 recovers it
    expect(candidateStateAt(h, [], logs, '2026-01-05', '2026-01-05')).toBe('rebuilding');
  });

  it('quiet while currently inside an open lapse covering most of the recent window', () => {
    const h = habit('2026-01-01');
    const logs = [log('2026-01-01')]; // 01-02, 01-03, 01-04 all missed and still open
    expect(candidateStateAt(h, [], logs, '2026-01-04', '2026-01-04')).toBe('quiet');
  });
});

describe('momentum trend', () => {
  it('is neutral (0) when there is no prior window to compare against', () => {
    const h = habit('2026-01-01');
    const days = datesFrom('2026-01-01', 3);
    const logs = days.map(log);
    expect(momentum(h, [], logs, days[2], days[2], 3)).toBe(0);
  });

  it('is positive when the recent window improves on the prior one', () => {
    const h = habit('2026-01-01');
    // Prior 3 (01-01..01-03): 1 of 3 completed. Recent 3 (01-04..01-06): 3 of 3 completed.
    const logs = [log('2026-01-01'), log('2026-01-04'), log('2026-01-05'), log('2026-01-06')];
    expect(momentum(h, [], logs, '2026-01-06', '2026-01-06', 3)).toBeGreaterThan(0);
  });
});

describe('confirmed-state hysteresis -- a single anomaly does not change a confirmed state', () => {
  it('stays steady immediately after one missed opportunity, before any recovery has happened yet', () => {
    const h = habit('2026-01-01');
    // 7 perfect days establishes confirmed = steady (see the module header's trace for why).
    const perfectDays = datesFrom('2026-01-01', 7);
    const day8 = addDays(perfectDays[6], 1); // missed, no recovery yet

    const logsThroughDay7 = perfectDays.map(log);
    expect(confirmedStateAt(h, [], logsThroughDay7, perfectDays[6])).toBe('steady');
    expect(confirmedStateAt(h, [], logsThroughDay7, day8)).toBe('steady');
  });

  it('a quick recovery from that single miss reaches confirmed "recovering" as soon as its own 3-opportunity window elapses', () => {
    // Finding worth recording explicitly: recovering's own candidate window
    // (MOMENTUM_CONFIG.recovering.window = 3) equals the transition confirmation count (also 3),
    // so a qualifying recovery event's candidate value persists as 'recovering' for exactly the 3
    // consecutive opportunities during which it stays within that window -- which is always
    // enough to confirm, once those 3 opportunities have elapsed. This is consistent with the
    // product intent (a recovery is meant to register clearly, not be delayed indefinitely behind
    // hysteresis -- see the spec's recovery-celebration language), unlike the decline-direction
    // states (quiet/rebuilding), where hysteresis is what actually matters and is exercised by the
    // "transition only takes effect after 3 consecutive candidates" test below.
    const h = habit('2026-01-01');
    const perfectDays = datesFrom('2026-01-01', 7);
    const day8 = addDays(perfectDays[6], 1); // missed
    const day9 = addDays(day8, 1); // recovers it -- candidate becomes 'recovering' starting here
    const day10 = addDays(day9, 1);
    const day11 = addDays(day10, 1);

    const logsThroughDay9 = [...perfectDays.map(log), log(day9)];
    // Only the first of 3 required consecutive 'recovering' candidates so far -- still pending.
    expect(confirmedStateAt(h, [], logsThroughDay9, day9)).toBe('steady');

    const logsThroughDay11 = [...logsThroughDay9, log(day10), log(day11)];
    // Days 9, 10 and 11 all evaluate to candidate 'recovering' (the event stays within its own
    // 3-opportunity window for each of them, with no new lapse since) -- 3 in a row, confirmed.
    expect(confirmedStateAt(h, [], logsThroughDay11, day11)).toBe('recovering');
  });
});

describe('confirmed-state hysteresis -- a transition only takes effect after 3 consecutive agreeing candidates', () => {
  it('requires the new candidate to hold for 3 opportunities before the confirmed state changes', () => {
    const h = habit('2026-01-01');
    const perfectDays = datesFrom('2026-01-01', 7); // confirmed = steady by day 7
    let cursor = perfectDays[6];
    const declineDays: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      cursor = addDays(cursor, 1);
      declineDays.push(cursor); // all 4 subsequent days missed -- no log added for any of them
    }

    const logs = perfectDays.map(log);

    // After 2 consecutive missed days (days 8-9), the candidate has changed but not yet held long
    // enough -- confirmed must still read steady.
    expect(confirmedStateAt(h, [], logs, declineDays[1])).toBe('steady');

    // By the 3rd/4th consecutive missed day, the new candidate (quiet) has held for 3 straight
    // opportunities and the confirmed state changes.
    expect(confirmedStateAt(h, [], logs, declineDays[3])).toBe('quiet');
  });
});

describe('confirmed-state hysteresis -- flapping between two values never confirms a transition', () => {
  it('never changes the confirmed value when the candidate alternates every step, proven with a synthetic sequence', () => {
    const flapping = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? 'A' : 'B'));
    expect(computeConfirmedState(flapping, 'A', 3)).toBe('A');
  });

  it('does confirm a transition once a synthetic sequence holds steady for the confirmation count', () => {
    const sequence = ['B', 'B', 'B', 'C', 'C']; // 3 consecutive B's confirm; C only reaches 2, doesn't confirm
    expect(computeConfirmedState(sequence, 'A', 3)).toBe('B');
  });
});

describe('long-term trajectories', () => {
  it('improving: confirmed state progresses insufficient_data -> building -> steady -> thriving, never earlier than the evidence allows', () => {
    const h = habit('2026-01-01');
    const days = datesFrom('2026-01-01', 12);
    const logs = days.map(log);

    // Day 2 (index 1): still insufficient_data (fewer than 3 opportunities so far).
    expect(confirmedStateAt(h, [], logs, days[1])).toBe('insufficient_data');
    // Day 12: enough sustained perfect history to have confirmed all the way to thriving.
    expect(confirmedStateAt(h, [], logs, days[11])).toBe('thriving');
  });

  it('declining: confirmed state degrades steady -> quiet only after sustained (3+ opportunity) evidence, never on the first bad day', () => {
    const h = habit('2026-01-01');
    const perfectDays = datesFrom('2026-01-01', 7);
    const logs = perfectDays.map(log);
    const firstBadDay = addDays(perfectDays[6], 1);

    expect(confirmedStateAt(h, [], logs, perfectDays[6])).toBe('steady');
    // The very next opportunity (a single miss) must not have changed the confirmed state yet.
    expect(confirmedStateAt(h, [], logs, firstBadDay)).toBe('steady');
  });
});

// Post-completion fix (see docs/phase-4-completion-report.md, "Momentum evaluation precedence"):
// isRebuilding is now checked ahead of meetsBuilding in candidateStateAt, so a qualifying (>=3-miss)
// lapse's recovery can actually hold 'rebuilding' for its own 3-opportunity confirmation window
// instead of building's much looser bar claiming those same days first. Exhaustively verified
// against every binary history up to 14 opportunities before writing these fixtures.
describe('rebuilding evaluation precedence (post-completion fix)', () => {
  it('a >=3-miss lapse followed by resumed completion reaches candidate rebuilding', () => {
    const h = habit('2026-01-01');
    const logs = [log('2026-01-01'), log('2026-01-05')]; // 01-02..01-04 missed (3), 01-05 recovers it
    expect(candidateStateAt(h, [], logs, '2026-01-05', '2026-01-05')).toBe('rebuilding');
  });

  it('rebuilding becomes the confirmed state once its candidate holds for 3 consecutive opportunities, not before', () => {
    const h = habit('2026-01-01');
    // Fresh habit, 4 missed opportunities, then 3 held completions: candidates run
    // insufficient_data, insufficient_data, quiet, quiet, rebuilding, rebuilding, rebuilding.
    const dates = datesFrom('2026-01-01', 7);
    const logs = [dates[4], dates[5], dates[6]].map(log); // days 5-7 completed, days 1-4 missed

    // Only 2 consecutive rebuilding candidates so far (days 5-6) -- not yet confirmed.
    expect(confirmedStateAt(h, [], logs, dates[5])).toBe('insufficient_data');
    // The 3rd consecutive rebuilding candidate (day 7) confirms it.
    expect(confirmedStateAt(h, [], logs, dates[6])).toBe('rebuilding');
  });

  it('a short (<=2-miss) lapse still resolves to recovering at both candidate and confirmed level, never rebuilding', () => {
    const h = habit('2026-01-01');
    const perfectDays = datesFrom('2026-01-01', 7);
    const day8 = addDays(perfectDays[6], 1); // missed
    const day9 = addDays(day8, 1); // recovers it
    const day10 = addDays(day9, 1);
    const day11 = addDays(day10, 1);
    const logs = [...perfectDays.map(log), log(day9), log(day10), log(day11)];

    expect(candidateStateAt(h, [], logs, day9, day9)).toBe('recovering');
    expect(confirmedStateAt(h, [], logs, day11)).toBe('recovering');
  });

  it('ordinary early progress with no preceding lapse still confirms building, unaffected by the precedence change', () => {
    const h = habit('2026-01-01');
    // 4 completions then a single miss -- no lapse ever reaches the 3-miss rebuilding floor, so
    // isRebuilding is never even in contention here; building claims it exactly as before the fix.
    const dates = datesFrom('2026-01-01', 5);
    const logs = [dates[0], dates[1], dates[2], dates[3]].map(log);
    expect(confirmedStateAt(h, [], logs, dates[4])).toBe('building');
  });

  it('steady and thriving histories retain their existing classification', () => {
    const h = habit('2026-01-01');
    const sevenDays = datesFrom('2026-01-01', 7);
    expect(confirmedStateAt(h, [], sevenDays.map(log), sevenDays[6])).toBe('steady');
    const tenDays = datesFrom('2026-01-01', 10);
    expect(confirmedStateAt(h, [], tenDays.map(log), tenDays[9])).toBe('thriving');
  });

  it('a currently-open lapse still confirms quiet, retained from before the fix', () => {
    const h = habit('2026-01-01');
    const baseline = datesFrom('2026-01-01', 7);
    const missDates = datesFrom(addDays(baseline[6], 1), 5); // 5 further, still-open missed days
    const logs = baseline.map(log);
    expect(confirmedStateAt(h, [], logs, missDates[4])).toBe('quiet');
  });
});

describe('regression: original manually-reproduced monotonicity violation (day 5 open vs. completed)', () => {
  it('habit created day 1, completed days 1-4: completing day 5 too must not lower the confirmed state below leaving it open', () => {
    const h = habit('2026-01-01');
    const [day1, day2, day3, day4, day5] = datesFrom('2026-01-01', 5);
    const completedThroughDay4 = [day1, day2, day3, day4].map(log);
    const completedThroughDay5 = [...completedThroughDay4, log(day5)];

    // Expected, day 5 left open: days 1-4 clear insufficient_data's 3-opportunity floor, and the
    // trailing 3 opportunities (days 2-4) are a 100% window -- candidate and confirmed both read
    // 'building' (matches the "ordinary early progress" case above, same data).
    expect(confirmedStateAt(h, [], completedThroughDay4, day5)).toBe('building');

    // Expected, day 5 also completed: per the monotonicity contract, completing today must never
    // make the confirmed badge read *worse* than leaving it open, so this must also read 'building'.
    // Before the Rule 2 fix in computeConfirmedMomentumState, this was the manually-reproduced bug --
    // it read 'insufficient_data' instead, because the plain pending-counter mechanism discarded
    // the 'building' candidate's already-accumulated run the moment 'steady' appeared as the new
    // (stronger) candidate. See docs/phase-4-completion-report.md's "Momentum confirmation
    // mechanism" section and computeConfirmedMomentumState's doc comment above.
    expect(confirmedStateAt(h, [], completedThroughDay5, day5)).toBe('building');
  });
});

// Characterization test only -- documents an observed, known behaviour; it is not a locked
// contract and does not assert a new invariant. See docs/phase-4-completion-report.md's
// "Post-completion manual acceptance fixes" section ("Trapped confirmed state") for the full
// writeup, including why the existing monotonicity and reachability proofs do not detect this
// case and a recommendation that a future product review decide whether trapped-state avoidance
// should become a permanent behavioural invariant.
describe('known issue (documented, not fixed by this pass): confirmed state can become permanently trapped at insufficient_data', () => {
  it('an alternating complete/miss/complete/miss history never accumulates 3 identical trailing candidates, so confirmed never leaves insufficient_data', () => {
    const h = habit('2026-01-01');
    // A plausible real usage pattern -- not a contrived synthetic edge case -- e.g. a habit
    // genuinely done every other day for weeks. 6 completions, 5 misses, all interspersed.
    const days = datesFrom('2026-01-01', 11);
    const completedDates = [days[0], days[2], days[4], days[6], days[8], days[10]];
    const logs = completedDates.map(log);

    // The raw candidate sequence oscillates between the two off-chain states 'recovering' and
    // 'quiet' (each qualifying lapse is exactly 1 opportunity long, and each recovery is
    // immediately followed by a new miss) -- it never repeats the same value 3 times in a row
    // (Rule 1 never fires), and 'recovering'/'quiet' are both absent from EVIDENCE_CHAIN, so Rule
    // 2's chain-raise never applies either (some candidate in every trailing window is always
    // chain-incomparable). Confirmed is therefore permanently retained at its initial value,
    // 'insufficient_data', for the entire trace below -- even though this habit has 5 resolved
    // Recoverable Lapse Opportunities, 5 Recovery Events, and a 100% rolling Recovery Rate by the
    // final day (verified directly against lib/domain/recovery.ts in the completion report).
    const confirmedSequence = days.map((d) => confirmedStateAt(h, [], logs, d));
    expect(confirmedSequence).toEqual(Array(11).fill('insufficient_data'));

    // Expected value changed by the current-day Momentum fix (docs/phase-4-completion-report.md,
    // "Current-day design, settled" / the follow-up implementation section): this line calls
    // candidateStateAt(..., d, d), i.e. treats each day as its own live "today" -- not the same
    // question confirmedSequence above asks, where every day is judged as a resolved past fact
    // relative to the walk's one real anchor (days[10]). Under the fix, an odd day's own record is
    // now unlogged-and-pending exactly when it's evaluated as its own "today", so it's set aside
    // from that day's evidence judgment entirely (docs/phase-2-implementation-plan.md's "today is
    // never classified as missed") rather than counted as the miss that used to make
    // isCurrentlyQuiet's window-must-end-in-a-miss gate fire every other day. The oscillation
    // collapses to a steady 'recovering' from day 3 onward as a direct, expected consequence -- not
    // a new candidate-level rule and not evidence of the trap resolving (confirmedSequence above,
    // the value that actually drives the displayed badge, is unchanged and still permanently
    // trapped at 'insufficient_data', exactly as this test documents).
    const candidateSequence = days.map((d) => candidateStateAt(h, [], logs, d, d));
    expect(candidateSequence).toEqual([
      'insufficient_data',
      'insufficient_data',
      'recovering',
      'recovering',
      'recovering',
      'recovering',
      'recovering',
      'recovering',
      'recovering',
      'recovering',
      'recovering',
    ]);
  });
});
