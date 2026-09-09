import type { CoachFacts, HabitCoachFacts } from './coach-facts';
import { validateCoachOutput } from './coach-validation';

// Behavioural-contract fixtures for validateCoachOutput, per docs/phase-5-plan.md sections 6.4 and
// D2. These build CoachFacts fixtures directly rather than through buildCoachFacts -- the
// validator's own contract is "checks text against whatever CoachFacts object it is given," which
// is exactly as well tested by a hand-built object as by one buildCoachFacts produced, and keeps
// this file's tests independent of coach-facts.ts's own domain wiring (covered separately in
// coach-facts.test.ts).

function habitFacts(overrides: Partial<HabitCoachFacts> = {}): HabitCoachFacts {
  return {
    habitId: 'h1',
    momentumState: 'steady',
    totalCompletions: 47,
    recoveryCount: 3,
    lapseReasonCounts: {
      too_busy: 0,
      forgot: 0,
      low_energy: 0,
      not_feeling_it: 0,
      something_else: 0,
      skipped_without_reason: 0,
    },
    habitHealth: 'no_positive_recent_comparison',
    ...overrides,
  };
}

function facts(...habits: HabitCoachFacts[]): CoachFacts {
  return { habits };
}

describe('percentage and decimal equivalence', () => {
  const f = facts(habitFacts({ recoveryRatePct: 82 }));

  it('accepts the percent form', () => {
    expect(validateCoachOutput('Your recovery rate is 82%.', f)).toEqual({ valid: true });
  });

  it('accepts the bare-integer form (no percent sign)', () => {
    expect(validateCoachOutput('Your recovery rate is 82.', f)).toEqual({ valid: true });
  });

  it('accepts the decimal form', () => {
    expect(validateCoachOutput('Your recovery rate is 0.82.', f)).toEqual({ valid: true });
  });

  it('rejects a nearby-but-incorrect percent -- fuzzy matching must not apply', () => {
    expect(validateCoachOutput('Your recovery rate is 81%.', f)).toEqual({ valid: false, invalidNumerals: ['81%'] });
    expect(validateCoachOutput('Your recovery rate is 83%.', f)).toEqual({ valid: false, invalidNumerals: ['83%'] });
  });

  it('rejects a nearby-but-incorrect decimal', () => {
    expect(validateCoachOutput('Your recovery rate is 0.81.', f)).toEqual({ valid: false, invalidNumerals: ['0.81'] });
  });
});

describe('rounding: exactly one rounding step, applied once at fact construction, not as validator tolerance', () => {
  it('accepts only the single canonical rounded percent for a non-round underlying rate (e.g. 3/14)', () => {
    // 3/14 = 0.2142857... rounds to 21 -- coach-facts.ts is responsible for that rounding; the
    // validator here only ever sees the already-rounded fact and checks it exactly.
    const f = facts(habitFacts({ consistencyPct: 21 }));
    expect(validateCoachOutput('Consistency is 21% this period.', f)).toEqual({ valid: true });
    expect(validateCoachOutput('Consistency is 20% this period.', f)).toEqual({ valid: false, invalidNumerals: ['20%'] });
    expect(validateCoachOutput('Consistency is 22% this period.', f)).toEqual({ valid: false, invalidNumerals: ['22%'] });
  });
});

describe('counts', () => {
  const f = facts(habitFacts({ totalCompletions: 47 }));

  it('accepts an exact count', () => {
    expect(validateCoachOutput('You have 47 total completions.', f)).toEqual({ valid: true });
  });

  it('rejects a nearby-but-incorrect count', () => {
    expect(validateCoachOutput('You have 48 total completions.', f)).toEqual({ valid: false, invalidNumerals: ['48'] });
    expect(validateCoachOutput('You have 46 total completions.', f)).toEqual({ valid: false, invalidNumerals: ['46'] });
  });

  it('rejects a wholly fabricated count', () => {
    expect(validateCoachOutput('You have 200 total completions.', f)).toEqual({ valid: false, invalidNumerals: ['200'] });
  });
});

describe('Recovery Time is a factual duration, not generically exempt', () => {
  const f = facts(habitFacts({ averageRecoveryTimeDays: 4 }));

  it('accepts the true duration', () => {
    expect(validateCoachOutput('You usually return in 4 days.', f)).toEqual({ valid: true });
  });

  it('rejects a false duration -- the word "days" does not itself exempt the number', () => {
    expect(validateCoachOutput('You usually return in 12 days.', f)).toEqual({ valid: false, invalidNumerals: ['12'] });
  });

  it('accepts a non-integer duration exactly as rounded by coach-facts.ts, and rejects the unrounded neighbours', () => {
    const half = facts(habitFacts({ averageRecoveryTimeDays: 4.3 }));
    expect(validateCoachOutput('You usually return in 4.3 days.', half)).toEqual({ valid: true });
    expect(validateCoachOutput('You usually return in 4 days.', half)).toEqual({ valid: false, invalidNumerals: ['4'] });
    expect(validateCoachOutput('You usually return in 5 days.', half)).toEqual({ valid: false, invalidNumerals: ['5'] });
  });
});

describe('units never automatically exempt a number', () => {
  it('"days" does not exempt an incorrect duration claim', () => {
    const f = facts(habitFacts({ averageRecoveryTimeDays: 4 }));
    expect(validateCoachOutput('It typically takes 9 days.', f)).toEqual({ valid: false, invalidNumerals: ['9'] });
  });

  it('"%" does not exempt an incorrect percentage claim', () => {
    const f = facts(habitFacts({ consistencyPct: 60 }));
    expect(validateCoachOutput('Consistency sits at 61%.', f)).toEqual({ valid: false, invalidNumerals: ['61%'] });
  });

  it('"times" does not exempt an incorrect count claim', () => {
    const f = facts(habitFacts({ recoveryCount: 3 }));
    expect(validateCoachOutput('You have recovered 5 times.', f)).toEqual({ valid: false, invalidNumerals: ['5'] });
  });
});

describe('narrow date exceptions', () => {
  const f = facts(habitFacts()); // no numeric facts beyond the fixed base fields (47, 3)

  it('an ISO-shaped date is never checked against the facts', () => {
    expect(validateCoachOutput('This started on 2026-03-05.', f)).toEqual({ valid: true });
  });

  it('a month-then-day date is never checked', () => {
    expect(validateCoachOutput('Since March 5 you have kept it up.', f)).toEqual({ valid: true });
  });

  it('a day-then-month date is never checked', () => {
    expect(validateCoachOutput('Since the 5th of March you have kept it up.', f)).toEqual({ valid: true });
  });

  it('a date exception does not blanket-exempt an unrelated real numeral in the same sentence', () => {
    // 200 is fabricated (fact is 47); the date must not shield it.
    expect(validateCoachOutput('Since March 5 you have logged 200 completions.', f)).toEqual({
      valid: false,
      invalidNumerals: ['200'],
    });
  });
});

describe('narrow ordinal exceptions', () => {
  const f = facts(habitFacts());

  it('a digit-form ordinal is never checked against the facts', () => {
    expect(validateCoachOutput('This was your 21st day.', f)).toEqual({ valid: true });
  });

  it('an ordinal exception does not blanket-exempt an unrelated real numeral in the same sentence', () => {
    expect(validateCoachOutput('On your 21st day you had already logged 200 completions.', f)).toEqual({
      valid: false,
      invalidNumerals: ['200'],
    });
  });
});

describe('ordinary temporal language that contains no numeral is never flagged', () => {
  it('"over the next few days" and "this week" pass through untouched, since they contain no digit to check', () => {
    const f = facts(habitFacts());
    expect(validateCoachOutput('Over the next few days, keep this up. This week has gone well.', f)).toEqual({ valid: true });
  });

  it('does not accidentally validate everything -- a real fabricated numeral in the same message is still caught', () => {
    const f = facts(habitFacts({ totalCompletions: 47 }));
    expect(
      validateCoachOutput('Over the next few days, keep this up. You have logged 200 completions this week.', f),
    ).toEqual({ valid: false, invalidNumerals: ['200'] });
  });
});

describe('fabricated and nearby-but-incorrect values, general cases', () => {
  it('rejects a statistic invented from nothing', () => {
    const f = facts(habitFacts());
    expect(validateCoachOutput('Your streak is 15 days long.', f)).toEqual({ valid: false, invalidNumerals: ['15'] });
  });

  it('rejects every invalid numeral in a message, not only the first', () => {
    const f = facts(habitFacts({ totalCompletions: 47 }));
    expect(validateCoachOutput('You have 200 completions and a 99% rate.', f)).toEqual({
      valid: false,
      invalidNumerals: ['200', '99%'],
    });
  });
});

describe('multi-habit facts: a claim may be grounded by any habit\'s record', () => {
  it('accepts a number that is a real fact for a different habit in the same payload', () => {
    const f = facts(habitFacts({ habitId: 'h1', totalCompletions: 47 }), habitFacts({ habitId: 'h2', totalCompletions: 12 }));
    expect(validateCoachOutput('One of your habits has 12 completions.', f)).toEqual({ valid: true });
  });
});

describe('edge cases', () => {
  it('an empty facts payload rejects any numeral', () => {
    const f = facts();
    expect(validateCoachOutput('You have 3 completions.', f)).toEqual({ valid: false, invalidNumerals: ['3'] });
  });

  it('an empty facts payload accepts text with no numeral at all', () => {
    const f = facts();
    expect(validateCoachOutput('Keep going, you are doing well.', f)).toEqual({ valid: true });
  });

  it('text with no numeral is always valid regardless of what facts exist', () => {
    const f = facts(habitFacts({ totalCompletions: 47 }));
    expect(validateCoachOutput('Keep going, you are doing well.', f)).toEqual({ valid: true });
  });
});

describe('KNOWN ACCEPTED RESIDUAL -- spelled-out numerals are not inspected (docs/phase-5-plan.md section 6.4 and section 10)', () => {
  it('ACCEPTED RESIDUAL, NOT COVERAGE: a true spelled-out duration claim is reported valid only because no digit was found to check, not because the claim was verified', () => {
    const f = facts(habitFacts({ averageRecoveryTimeDays: 3 })); // the claim below happens to be TRUE
    const result = validateCoachOutput('You usually return in three days.', f);
    // This is the residual limitation named verbatim in docs/phase-5-plan.md's "Named residual
    // failure case": the validator recognises only digit-form numerals, so "three" is invisible to
    // it entirely. A caller must not read `valid: true` here as evidence that "three days" was
    // checked against averageRecoveryTimeDays -- it was never inspected in the first place.
    expect(result).toEqual({ valid: true });
  });

  it('ACCEPTED RESIDUAL, NOT COVERAGE: a FALSE spelled-out duration claim is equally reported valid, which is the actual shape of the risk', () => {
    const f = facts(habitFacts({ averageRecoveryTimeDays: 3 })); // the real fact is 3 days
    const result = validateCoachOutput('You usually return in ten days.', f); // the claim below is FALSE
    // The digit-keyed validator cannot distinguish a true spelled-out claim from a false one,
    // because it does not parse spelled-out numbers at all. This is the sharper demonstration of
    // the residual: it is not merely "unchecked," it is "wrong and still passes." The prompt rule
    // ("write behavioural numbers as digits") is the only defence against this, and it is defence
    // in depth, not closure -- see the residual-risk register, docs/phase-5-plan.md section 10.
    expect(result).toEqual({ valid: true });
  });
});
