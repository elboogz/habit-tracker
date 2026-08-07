// Property-based / exhaustive verification for the Momentum State machine, kept separate from
// momentum.test.ts's fast, hand-picked fixtures because these sweep the full binary history space
// (a few seconds, not milliseconds). See docs/phase-4-completion-report.md's "Momentum confirmation
// mechanism" section for the full narrative: an exhaustive today-open-vs-today-completed search
// found that completing today could make the confirmed badge read *worse* than leaving it open
// (a real hysteresis-mechanism gap, not the earlier evaluation-precedence bug already fixed
// elsewhere), and the fix (`computeConfirmedMomentumState`'s trailing-window Rule 1/2/3, see its
// doc comment in momentum.ts) is verified here against every check that motivated it.
import type { Habit, HabitLog } from '../habit-types';
import { addDays } from './day-key';
import { candidateStateAt, computeConfirmedMomentumState, confirmedStateAt, type MomentumStateKey } from './momentum';

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

/**
 * Only these four `MomentumStateKey` values are chain-comparable -- see momentum.ts's
 * `EVIDENCE_CHAIN` doc comment for why `recovering`/`rebuilding`/`quiet` are deliberately excluded
 * (they're classified by lapse recency/length, not a rate bar, and the approved specification
 * gives no ordering between them and this chain, or against each other).
 */
const EVIDENCE_CHAIN: MomentumStateKey[] = ['insufficient_data', 'building', 'steady', 'thriving'];
const CHAIN_RANK: Partial<Record<MomentumStateKey, number>> = Object.fromEntries(
  EVIDENCE_CHAIN.map((state, index) => [state, index]),
);

function datesEndingToday(prefixLength: number, today: string): string[] {
  const start = addDays(today, -prefixLength);
  const dates: string[] = [];
  let cursor = start;
  for (let i = 0; i <= prefixLength; i += 1) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

/** Evaluates candidate/confirmed state as of `today`, once with today left open and once completed. */
function evalTodayOpenVsCompleted(prefix: number[]) {
  const today = '2026-01-01';
  const dates = datesEndingToday(prefix.length, today).slice(0, prefix.length).concat(today);
  const h = habit(dates[0]);
  const baseLogs = prefix.map((v, i) => (v ? log(dates[i]) : null)).filter((x): x is HabitLog => x !== null);
  const completedLogs = [...baseLogs, log(today)];
  return {
    prefix,
    today,
    openCandidate: candidateStateAt(h, [], baseLogs, today),
    completedCandidate: candidateStateAt(h, [], completedLogs, today),
    openConfirmed: confirmedStateAt(h, [], baseLogs, today),
    completedConfirmed: confirmedStateAt(h, [], completedLogs, today),
  };
}

describe('perfect_completion_history stays pinned to its locked transition opportunities', () => {
  // docs/phase-2-implementation-plan.md section 8's fixture table pins two numbers for this
  // fixture only: candidate reaches thriving at opportunity 8, confirmed reaches thriving at
  // opportunity 10. It does not pin intermediate confirmed values at any other opportunity, so
  // Rule 2's early "building" reading at opportunities 5-6 (new, informative, previously silently
  // insufficient_data) fills in previously-unpinned territory rather than breaching the contract.
  it('confirms steady at opportunity 7 and thriving at opportunity 10, exactly as locked', () => {
    const start = '2026-01-01';
    const dates = datesEndingToday(14, addDays(start, 14));
    const h = habit(start);
    const logs = dates.map(log);
    const confirmed = dates.map((d) => confirmedStateAt(h, [], logs, d));

    expect(confirmed[6]).toBe('steady'); // opportunity 7 (0-indexed 6)
    expect(confirmed[9]).toBe('thriving'); // opportunity 10 (0-indexed 9)
    // The locked candidate-level checkpoint from the same fixture row, unaffected by this change.
    expect(candidateStateAt(h, [], logs, dates[7])).toBe('thriving'); // opportunity 8
  });
});

describe('the target monotonicity violation is resolved', () => {
  it('4 days completed; completing today (day 5) now matches leaving it open, never ranks lower', () => {
    const r = evalTodayOpenVsCompleted([1, 1, 1, 1]);
    expect(r.openConfirmed).toBe('building');
    expect(r.completedConfirmed).toBe('building'); // previously insufficient_data -- the found bug
  });
});

describe('a confirmed state still only declines via 3 consecutive weaker candidates', () => {
  it('a genuinely-established thriving confirmation holds after a single miss', () => {
    const start = '2026-01-01';
    const dates = datesEndingToday(10, addDays(start, 10));
    const h = habit(start);
    const logs = dates.slice(0, 10).map(log); // the 11th (last) opportunity is missed
    expect(confirmedStateAt(h, [], logs, dates[10])).toBe('thriving');
  });
});

describe('required transition sequences (direct computeConfirmedMomentumState calls)', () => {
  it('insufficient_data, building, thriving: a non-adjacent upward move does not confirm from 2 samples', () => {
    expect(computeConfirmedMomentumState(['insufficient_data', 'building', 'thriving'])).toBe('insufficient_data');
  });

  it('building, recovering, building: an off-chain state interrupting a run breaks it, no bridging', () => {
    expect(computeConfirmedMomentumState(['building', 'recovering', 'building'])).toBe('insufficient_data');
  });

  it('building, building, insufficient_data, building: a downward move restarts the count', () => {
    expect(computeConfirmedMomentumState(['building', 'building', 'insufficient_data', 'building'])).toBe(
      'insufficient_data',
    );
  });
});

describe('exhaustive: today-open-vs-completed monotonicity over the evidence chain', () => {
  it('zero violations at both candidate and confirmed level, over every prefix up to 12 days', () => {
    const MAX_PREFIX_LEN = 12;
    let comparedCandidate = 0;
    let comparedConfirmed = 0;
    const violationsCandidate: ReturnType<typeof evalTodayOpenVsCompleted>[] = [];
    const violationsConfirmed: ReturnType<typeof evalTodayOpenVsCompleted>[] = [];
    const unrankedCandidate = new Set<string>();
    const unrankedConfirmed = new Set<string>();

    for (let prefixLen = 0; prefixLen <= MAX_PREFIX_LEN; prefixLen += 1) {
      for (let mask = 0; mask < 1 << prefixLen; mask += 1) {
        const prefix = Array.from({ length: prefixLen }, (_, i) => (mask >> i) & 1);
        const r = evalTodayOpenVsCompleted(prefix);

        const ocRank = CHAIN_RANK[r.openCandidate];
        const ccRank = CHAIN_RANK[r.completedCandidate];
        if (ocRank !== undefined && ccRank !== undefined) {
          comparedCandidate += 1;
          if (ccRank < ocRank) violationsCandidate.push(r);
        } else {
          unrankedCandidate.add(`${r.openCandidate} -> ${r.completedCandidate}`);
        }

        const ofRank = CHAIN_RANK[r.openConfirmed];
        const cfRank = CHAIN_RANK[r.completedConfirmed];
        if (ofRank !== undefined && cfRank !== undefined) {
          comparedConfirmed += 1;
          if (cfRank < ofRank) violationsConfirmed.push(r);
        } else {
          unrankedConfirmed.add(`${r.openConfirmed} -> ${r.completedConfirmed}`);
        }
      }
    }

    // Enumerated rather than dropped silently: every (openState -> completedState) pair the
    // partial order can't rank, across the whole swept space -- purely informational, not
    // asserted, since `quiet`/`recovering`/`rebuilding` are deliberately outside the chain.
    // eslint-disable-next-line no-console
    console.log('unranked candidate transitions:', [...unrankedCandidate].sort());
    // eslint-disable-next-line no-console
    console.log('unranked confirmed transitions:', [...unrankedConfirmed].sort());

    expect(comparedCandidate).toBeGreaterThan(0);
    expect(comparedConfirmed).toBeGreaterThan(0);
    expect(violationsCandidate).toEqual([]);
    expect(violationsConfirmed).toEqual([]);
  }, 60000);
});

describe('exhaustive: all 7 MomentumStateKey values remain reachable as a confirmed state', () => {
  it('finds a witness history for each state, up to length 14, unchanged from before this fix', () => {
    const allStates: MomentumStateKey[] = [
      'insufficient_data',
      'building',
      'steady',
      'recovering',
      'rebuilding',
      'thriving',
      'quiet',
    ];
    const witness: Partial<Record<MomentumStateKey, string>> = {};

    for (let len = 1; len <= 14; len += 1) {
      for (let mask = 0; mask < 1 << len; mask += 1) {
        const pattern = Array.from({ length: len }, (_, i) => (mask >> i) & 1);
        const start = '2026-01-01';
        const dates = datesEndingToday(len - 1, addDays(start, len - 1));
        const h = habit(start);
        const logs = dates.filter((_, i) => pattern[i] === 1).map(log);
        const state = confirmedStateAt(h, [], logs, dates[dates.length - 1]);
        if (!witness[state]) witness[state] = pattern.join('');
      }
      if (Object.keys(witness).length === allStates.length) break;
    }

    // Witnesses recorded here, unchanged from the pre-hysteresis-fix search (see the completion
    // report): rebuilding's shortest witness is still the 7-day '0000111' pattern.
    for (const state of allStates) {
      expect(witness[state]).toBeDefined();
    }
    expect(witness.rebuilding).toBe('0000111');
  }, 60000);
});
