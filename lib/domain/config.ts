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
