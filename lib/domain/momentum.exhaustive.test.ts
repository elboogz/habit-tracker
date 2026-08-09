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
    openCandidate: candidateStateAt(h, [], baseLogs, today, today),
    completedCandidate: candidateStateAt(h, [], completedLogs, today, today),
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
    expect(candidateStateAt(h, [], logs, dates[7], dates[7])).toBe('thriving'); // opportunity 8
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

  it('building, recovering, building: the positive-family evidence floor now bridges this, credited at building', () => {
    // Pre-floor behaviour (superseded -- see docs/phase-4-completion-report.md's "Confirmation-
    // mechanism blocker" and its resolution): recovering had no rank at all, so this window failed
    // chain-comparability outright and confirmed stayed at insufficient_data ("no bridging"). The
    // approved floor credits a positive-family off-chain candidate (recovering/rebuilding) as
    // affirmative evidence at the chain's weakest rung for Rule 2's minimum calculation only --
    // closing a lapse is not "an absence of evidence interrupting a run," it's evidence at least as
    // strong as building's own bar. All three window members now resolve to building's rank, so
    // confirmed raises to building. See the "positive-family evidence floor" describe block below
    // for the floor's exhaustive verification.
    expect(computeConfirmedMomentumState(['building', 'recovering', 'building'])).toBe('building');
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
  it('finds a witness history for each state, up to length 14, same shortest length as before this fix', () => {
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

    // Witnesses re-recorded here after the current-day Momentum fix (docs/phase-4-completion-
    // report.md, "Current-day design, settled" / its implementation section). Every state's
    // shortest witness LENGTH is unchanged from before this fix (insufficient_data 1, quiet/
    // building/recovering 5, rebuilding/steady 7, thriving 10) -- expected, since recordsUpTo
    // itself never changed and every window-size/sufficiency gate is unaffected by this fix.
    //
    // rebuilding's specific witness pattern changed from '0000111' (today completed) to '0000110'
    // (today open) -- predicted and pre-verified by an earlier scratch pass before this fix was
    // implemented (see the completion report). Both are genuine, independently valid 7-day
    // witnesses for rebuilding: with today open, its own record is now excluded from the trailing
    // rebuilding window's "must currently be completing again" evidence check (this fix's whole
    // point), so the window falls back to yesterday's completion instead and still qualifies --
    // today-open reaches rebuilding exactly as readily as today-completed does. The exhaustive mask
    // search (0, 1, 2, ...) simply finds the numerically smaller mask ('0000110' = 48) before the
    // other ('0000111' = 112); this is a search-order artifact, not a behavioural regression, and
    // does not reopen the rebuilding-precedence bug (Post-completion fix 2) -- rebuilding is still
    // only ever produced as a confirmed value via Rule 1's 3-identical-candidates match, unchanged.
    for (const state of allStates) {
      expect(witness[state]).toBeDefined();
    }
    expect(witness.rebuilding).toBe('0000110');
  }, 60000);
});

describe('positive-family evidence floor (Rule 2) -- approved resolution, docs/phase-4-completion-report.md "Confirmation-mechanism blocker"', () => {
  // The two cases the floor was derived to resolve (see the completion report's "value-bearing fix,
  // parked" writeup): min(building, building, X) = building requires X's floor rank <= building's;
  // min(rebuilding-as-X, rebuilding-as-X, steady) != steady requires X's floor rank < steady's.
  // building is the unique value satisfying both, which is exactly what rule2EvidenceRank assigns.
  it('[building, building, recovering] raises confirmed to building, crediting the closed lapse as at-least-building evidence', () => {
    expect(computeConfirmedMomentumState(['building', 'building', 'recovering'])).toBe('building');
  });

  it('[rebuilding, rebuilding, steady] raises confirmed only to building, never straight to steady off a single opportunity of steady evidence', () => {
    expect(computeConfirmedMomentumState(['rebuilding', 'rebuilding', 'steady'])).toBe('building');
  });

  it('quiet is untouched: any window containing quiet still blocks Rule 2 entirely, regardless of the other two members', () => {
    expect(computeConfirmedMomentumState(['thriving', 'thriving', 'quiet'])).toBe('insufficient_data');
    expect(computeConfirmedMomentumState(['quiet', 'recovering', 'quiet'])).toBe('insufficient_data');
  });

  it('an off-chain confirmed state can still only be left via Rule 1 -- the floor never raises out of one', () => {
    // Drive confirmed to quiet via 3 identical candidates (Rule 1, unaffected by the floor), then
    // present windows that would raise a *chain*-confirmed state -- EVIDENCE_RANK[confirmed] is
    // still undefined for an off-chain confirmed value regardless of the floor (the floor only ever
    // supplies a rank for window *members*, never for `confirmed` itself), so Rule 2 stays gated
    // off and quiet can only be left by 3 consecutive identical non-quiet candidates.
    const sequence: MomentumStateKey[] = ['quiet', 'quiet', 'quiet', 'rebuilding', 'rebuilding', 'steady'];
    expect(computeConfirmedMomentumState(sequence)).toBe('quiet');
  });

  it('exhaustive: no window containing recovering or rebuilding can raise confirmed above building, over every 3-candidate window drawn from all 7 states', () => {
    const allStates: MomentumStateKey[] = [
      'insufficient_data',
      'building',
      'steady',
      'recovering',
      'rebuilding',
      'thriving',
      'quiet',
    ];
    let checked = 0;
    for (const a of allStates) {
      for (const b of allStates) {
        for (const c of allStates) {
          const window: MomentumStateKey[] = [a, b, c];
          if (!window.includes('recovering') && !window.includes('rebuilding')) continue;
          // Rule 1 (3 identical candidates) can still confirm recovering/rebuilding/quiet directly
          // -- unaffected by the floor, and not what this check is about.
          if (window.every((s) => s === window[0])) continue;

          checked += 1;
          const result = computeConfirmedMomentumState(window);
          const rank = CHAIN_RANK[result];
          // Either the result is off-chain (Rule 2 never fired -- e.g. quiet also present), or its
          // rank is at or below building's -- never steady or thriving off a floor-contributed window.
          expect(rank === undefined || rank <= (CHAIN_RANK.building as number)).toBe(true);
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
