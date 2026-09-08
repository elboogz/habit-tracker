// Single source of truth for every Phase 2+ domain threshold (docs/phase-2-implementation-plan.md,
// Revision 2, section 3). No behavioral logic reads these yet as of this commit -- consumers are
// added in later Phase 2 commits (recovery, momentum). Values below are approved per the Phase 2
// approval instruction; adjust here only, never inline in the functions that use them.

export const RECOVERY_CONFIG = {
  /** Fewer resolved Recoverable Lapse Opportunities than this: never show a percentage. */
  minResolvedLapsesForPercentage: 3,
  /** Below this rate (even with enough samples): prefer Recovery Time / Total Completions over the percentage. */
  lowRecoveryRateShameThreshold: 0.3,
  /** Size of the rolling Recovery Rate window, in resolved Recoverable Lapse Opportunities (not calendar days). */
  rollingWindowOpportunities: 10,
  /**
   * Fewer closed Lapses than this: never show a Recovery Time average. A distinct denominator
   * from minResolvedLapsesForPercentage above (closed Lapses are maximal missed runs; resolved
   * Recoverable Lapse Opportunities are pairwise and can be several per Lapse) -- the value 3 was
   * deliberately not reused. An average from a single Lapse isn't an average; 2 is the minimum at
   * which the word means anything.
   */
  minClosedLapsesForRecoveryTime: 2,
} as const;

export const MOMENTUM_CONFIG = {
  /** Consecutive scheduled opportunities a new candidate state must hold before it becomes confirmed. Uniform across all states. */
  transitionConfirmationOpportunities: 3,
  insufficientData: { minScheduledOpportunities: 3 },
  thriving: { window: 8, minCompletionRate: 0.9 },
  steady: { window: 5, minCompletionRate: 0.8 },
  building: { window: 3, minCompletionRate: 0.6, requireImproving: true },
  recovering: { window: 3, maxPrecedingLapseLength: 2 },
  rebuilding: { window: 5, minPrecedingLapseLength: 3 },
  quiet: { window: 3, minMissedFraction: 2 / 3 },
} as const;

/**
 * Habit Health (Phase 5, docs/phase-5-plan.md section 4.1; approved per
 * docs/phase-5-precondition-review.md's A2 decision). Two adjacent, nominally
 * `comparisonBlockOpportunities`-length blocks of Scheduled Opportunities -- recent versus
 * immediately preceding -- compared as completion rates. The recent block fills first and is the
 * one that must reach full length; the preceding block may be shorter during ramp-up. Stateless:
 * every value below is a pure function of the current history, with no dependence on any
 * previous Habit Health verdict and no deadband (see the plan's "Required explanation 2" for the
 * full A2 argument, in particular why a fixed margin does not cross the tripwire that prohibits a
 * second hysteresis mechanism).
 */
export const HABIT_HEALTH_CONFIG = {
  /** Nominal length of each comparison block, in Scheduled Opportunities (not calendar days). */
  comparisonBlockOpportunities: 14,
  /**
   * Fewer Scheduled Opportunities than this in the *smaller* of the two comparison blocks: never
   * produce a verdict beyond insufficient_evidence. A distinct denominator from either Recovery
   * gate above -- Scheduled-Opportunity-block-denominated here, lapse-denominated there --
   * deliberately not reused, following the precedent set between minResolvedLapsesForPercentage
   * and minClosedLapsesForRecoveryTime. At comparisonBlockOpportunities = 14 this gate binds only
   * during a four-opportunity ramp-up window (resolved history length 24 through 27) and never
   * again once both blocks are permanently full; the margin below is the only ongoing control.
   */
  minOpportunitiesInSmallerBlock: 10,
  /**
   * Minimum recent-block-minus-preceding-block completion-rate difference required for the
   * positive verdict. At comparisonBlockOpportunities = 14 the achievable difference quantises in
   * steps of 1/14 (~7.14 percentage points: 0, 1/14, 2/14, ...), so 0.25 is equivalent to any
   * value in (3/14, 4/14] -- it means "at least 4 more completions in the recent block than the
   * preceding block", and a later adjustment inside that same interval would be a no-op, not a
   * fine-tune.
   */
  minRateImprovement: 0.25,
} as const;
