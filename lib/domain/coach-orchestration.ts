// Phase 5, Step 5 Part 1 (docs/phase-5-plan.md sections 6.5 "Fallback coaching mode" and 6.6
// "Validator rejection and retry"): the orchestration, validator invocation, rejection handling,
// failure-sentinel, and cron-suppression machinery, built and
// tested as pure, repository-only domain logic. Deliberately not wired into either Edge
// Function's ordinary generation path yet -- ai-insights/index.ts and send-coaching-push/index.ts
// are untouched by this module and by Step 5 Part 1 entirely. The current ordinary generation
// path still builds the old summary/prompt shape; wiring real CoachFacts-grounded validation
// around output the prompt was never designed to produce would be a knowingly incoherent runtime
// path. Part 3 is the first point this module gets a real caller.
//
// Every function below is a plain `function`, never `async function`: scripts/build-edge-functions.js's
// extractDeclarations only recognises `(export )?(function|type|const)` at the start of a line,
// so an `async function` declaration would fail loudly (a "Could not find declaration(s)" throw,
// confirmed directly -- see docs/phase-5-plan.md section 10) rather than extract, once this module
// is added to SOURCES (Part 3). Asynchronous behaviour is expressed with explicit Promise chaining
// instead, with identical runtime semantics. Note for whoever wires this in: a `const name = async
// (...) => {...}` arrow function would also have worked, and extracts correctly today with no
// generator change at all (confirmed directly, including with an inline object-type parameter) --
// plain-`function`-with-`.then()` was a style choice here, not the only available option.
import { type CoachFacts, type CoachFactsKind, hasGroundedInsight } from './coach-facts';
// collectFactNumbers is exported (Phase 5 Step 5 Part 1) so buildRejectionDiagnostic below can
// report the same enumerable allowed set validateCoachOutput actually checked against, rather
// than re-deriving it -- no behavioural change to that function itself. This explanation lives
// here, not as a comment on the declaration in coach-validation.ts: that function is already a
// SOURCES-listed symbol, so a comment placed directly above it there would be swept into the
// generated block on next regeneration (the extractor's leading-comment back-scan has no way to
// distinguish "this documents the function" from "this documents why it was exported"), moving
// the block fingerprint for a documentation-only change. See docs/phase-5-plan.md section 10.
import { type ValidationResult, collectFactNumbers } from './coach-validation';
import { FAILURE_SENTINEL_TTL_HOURS } from './config';

/**
 * Supplies fallback text for a message with no grounded insight (`hasGroundedInsight(facts) ===
 * false`). Deliberately an injected collaborator, not implemented here: Part 1 only defines this
 * boundary so Part 2 can supply the real deterministic fallback message set without this module
 * changing shape. A Part 1 test fake stands in for it; there is no default implementation and no
 * `throw new Error('TODO')` placeholder on any reachable branch -- a caller without a real
 * provider simply cannot construct valid `CoachGenerationDeps`.
 */
export type FallbackProvider = (facts: CoachFacts, kind: CoachFactsKind) => string;

export type CoachGenerationDeps = {
  /** Calls the model exactly once. Invoked only on the grounded path, never on fallback, never twice. */
  generateGroundedText: () => Promise<string>;
  fallbackProvider: FallbackProvider;
  /**
   * Injected rather than a hard import of the real `validateCoachOutput`, so a test can capture
   * the exact `facts` reference it was called with and assert identity (`===`) against the
   * `facts` this function itself received (see coach-orchestration.test.ts). Production callers
   * (Part 3) pass the real `lib/domain/coach-validation.ts#validateCoachOutput` unmodified.
   */
  validateCoachOutput: (text: string, facts: CoachFacts) => ValidationResult;
};

export type CoachGenerationResult =
  | { path: 'grounded'; content: string }
  | { path: 'fallback'; content: string }
  /**
   * Deliberately carries no text/content field of any kind -- the rejected prose is never
   * propagated past this point structurally (the type has nowhere to put it), not merely by
   * caller discipline.
   */
  | { path: 'rejected'; validation: Extract<ValidationResult, { valid: false }> };

/**
 * The single structural precedence rule for Step 5 message generation (docs/phase-5-plan.md
 * section 6.5): the fallback path fires if and only if `hasGroundedInsight(facts)` is false. The
 * grounded path attempts generation exactly once -- there is no automatic second attempt -- and
 * validates the result against the exact same `facts` object supplied here, never a recomputed
 * copy. Rejection is a third, terminal outcome, not a fallthrough into fallback: a validator
 * rejection is not the same claim as "no grounded insight available" (docs/phase-5-plan.md
 * section 6.6), so the `rejected` and `fallback` branches are mutually exclusive by construction
 * -- there is no code path that reaches `fallbackProvider` after a rejection.
 */
function resolveCoachGeneration(facts: CoachFacts, kind: CoachFactsKind, deps: CoachGenerationDeps): Promise<CoachGenerationResult> {
  if (!hasGroundedInsight(facts)) {
    return Promise.resolve({ path: 'fallback', content: deps.fallbackProvider(facts, kind) });
  }
  return deps.generateGroundedText().then((generatedText) => {
    const validation = deps.validateCoachOutput(generatedText, facts);
    if (validation.valid) return { path: 'grounded' as const, content: generatedText };
    return { path: 'rejected' as const, validation };
  });
}

export type RejectionConsequenceDeps = {
  /** Writes an ai_insights row with empty content, dated now -- the retry-backoff sentinel. */
  persistFailureSentinel: () => Promise<void>;
  /**
   * Present only for the cron/push caller. Stamps that user's `coach_push_last_sent_date` for
   * today. Load-bearing (docs/phase-5-plan.md section 6.6, "Sentinel shape: the render path
   * traced"): without it, a persistently rejected
   * user would be re-attempted (a real Anthropic call each time) on every subsequent cron tick
   * that day, since an empty-content sentinel alone produces no push and therefore never reaches
   * `send-coaching-push`'s own later `if (!content) continue` skip.
   */
  markCronPushHandledToday?: () => Promise<void>;
};

/**
 * The complete, caller-context-aware consequence of a validator rejection. Always persists the
 * failure sentinel; additionally marks the day's cron push attempt handled only when that
 * dependency is supplied (the push/cron caller) -- never for the interactive `ai-insights`
 * caller, which has no "day's push attempt" concept to mark.
 */
function applyRejectionConsequences(deps: RejectionConsequenceDeps): Promise<void> {
  return deps.persistFailureSentinel().then(() => {
    if (deps.markCronPushHandledToday) return deps.markCronPushHandledToday();
    return undefined;
  });
}

/**
 * Whether a live failure sentinel (an empty-content `ai_insights` row) is still within its retry
 * backoff window -- pure date arithmetic, no I/O. Mirrors the shape of the existing freshness
 * check (`created_at > since`) so Part 3 can slot this in alongside it rather than invent a
 * different comparison style. A failure sentinel is retry backoff, not content caching
 * (`FAILURE_SENTINEL_TTL_HOURS`'s own doc comment), so this is checked against that constant, not
 * against `COACH_CONTENT_FRESHNESS_HOURS_BY_KIND`.
 */
function isWithinFailureBackoff(sentinelCreatedAtIso: string, kind: CoachFactsKind, nowIso: string): boolean {
  const cutoffMs = new Date(nowIso).getTime() - FAILURE_SENTINEL_TTL_HOURS[kind] * 60 * 60 * 1000;
  return new Date(sentinelCreatedAtIso).getTime() > cutoffMs;
}

/**
 * The existing `send-coaching-push` per-user-per-day dedup rule, currently inline as
 * `recipient.coach_push_last_sent_date === today` in that function's main loop, extracted as a
 * named, independently testable primitive rather than left implicit and untested. Part 3 should
 * replace that inline comparison with a call here rather than duplicate the rule a second time.
 */
function shouldCronAttemptToday(lastSentDate: string | null, today: string): boolean {
  return lastSentDate !== today;
}

export type RejectionDiagnostic = {
  kind: CoachFactsKind;
  invalidNumerals: string[];
  allowedPlain: number[];
  allowedPct: number[];
};

/**
 * Minimal, structurally prose-free rejection diagnostics (docs/phase-5-plan.md section 6.6):
 * coaching kind, the validator's own reason (which numerals were rejected), and the enumerable
 * allowed set it checked against -- reusing `collectFactNumbers` rather than re-deriving it, so
 * this can never silently drift from what the validator actually used. Deliberately does not
 * accept the generated text as a parameter at all: the rejected prose cannot leak into this
 * diagnostic because there is nowhere in this function's signature for it to enter. Deployment/
 * version metadata (the Edge Function's own `SOURCE_STAMP`) is added by the caller around this
 * object where useful, not by this domain-layer function, which has no access to it.
 */
function buildRejectionDiagnostic(
  kind: CoachFactsKind,
  facts: CoachFacts,
  validation: Extract<ValidationResult, { valid: false }>,
): RejectionDiagnostic {
  const { plain, pct } = collectFactNumbers(facts);
  return {
    kind,
    invalidNumerals: validation.invalidNumerals,
    allowedPlain: [...plain].sort((a, b) => a - b),
    allowedPct: [...pct].sort((a, b) => a - b),
  };
}

/**
 * The row `persistFailureSentinel` (an injected I/O callback this module never performs itself)
 * should insert into `ai_insights`. Confirms, structurally, that a sentinel needs no new table,
 * no new column, and no dedicated counting logic: it is an ordinary `ai_insights` row like any
 * successful one, distinguished only by `content: ''`, so it is automatically included by the
 * existing rate-limit count query (`select('id', { count: 'exact', head: true }).gt('created_at',
 * ...)`), which does not filter on `content` or `kind` at all. `id` is intentionally omitted --
 * generated by the caller (`crypto.randomUUID()`), matching how every other domain-layer type in
 * this codebase leaves ID generation to its caller rather than performing it itself.
 */
export type FailureSentinelRow = {
  user_id: string;
  kind: string;
  period_start: string | null;
  period_end: string | null;
  content: '';
  model: string;
  created_at: string;
};

function buildFailureSentinelRow(dbKind: string, userId: string, model: string, nowIso: string): FailureSentinelRow {
  return {
    user_id: userId,
    kind: dbKind,
    period_start: null,
    period_end: null,
    content: '',
    model,
    created_at: nowIso,
  };
}

export {
  resolveCoachGeneration,
  applyRejectionConsequences,
  isWithinFailureBackoff,
  shouldCronAttemptToday,
  buildRejectionDiagnostic,
  buildFailureSentinelRow,
};
