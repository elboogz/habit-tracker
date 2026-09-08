# Phase 5 Plan — AI Coach and Habit Health

**Draft for review. Planning only. No Phase 5 code has been written and Phase 5 has not begun.**

Produced against `a4e34c2` (documentation state) with the code baseline at `edafc3c`. Deployment baseline: `block=be472da09aa4` on both Edge Functions, `file=9042dc1c3d7c` (`ai-insights`) and `file=c88749f30503` (`send-coaching-push`), each matching the repository and verified live on 2026-09-08.

Inputs: the Phase 5 handover, `docs/phase-5-precondition-review.md` (preconditions A1-A3, B1-B6, C1-C3, D1-D4, all closed), and `docs/phase-5-verification-report.md` (evidence snapshot).

## Provenance convention

Because this plan mixes settled decisions with things still needing approval, every non-obvious position carries a marker:

- **[Ruled]** — a decision you have already made. Recorded, not re-argued.
- **[Report]** — originated as a verification-report recommendation, now adopted here. **You are approving these.**
- **[New]** — first raised in this plan, usually because writing it down exposed something. **You are approving these.**
- **[Superseded]** — a verification-report recommendation your rulings overrode. Recorded so the change is visible rather than silent.

---

# 1. Scope

Rewrite the AI Coach to be grounded in deterministic facts, and ship Habit Health as one deterministic domain signal with a closed three-state verdict.

## Non-goals, all deferred **[Ruled]**

Habit edit-history capture; reminder-usage event capture; additional Habit Health signals; semantic entailment validation; Momentum redesign; a standalone Habit Health UI; rich habit-specific educational content; health facts and HealthKit; the copy-polish pass; Supabase CLI deployment infrastructure; Phase 6 content redesign.

## Classification rule for anything found during implementation **[Ruled]**

**A** — correctness, user trust, or core differentiator blocker → resolve within Phase 5.
**B** — useful improvement → record as debt in §11.
**C** — feature expansion → defer.

---

# 2. Implementation sequence

Six steps. The first three touch nothing user-facing and deploy nothing.

| Step | Work | Deploys? |
|---|---|---|
| 1 | Generated Edge Function type-check guard | no |
| 2 | Pure deterministic domain work | no |
| **2a** | `confirmedStateAt` performance optimisation | no |
| 3 | Generated-domain whitelist extension | **first paste** |
| 4 | DB-read widening and deterministic call-site cutover | **second paste** |
| 5 | Prompt rewrite, validator integration, grounded-coach cutover | **third paste** |

## Cross-cutting paste discipline

**Every paste is both Edge Functions together, followed by stamp verification before the next step begins.** The two share the `ai_insights` nudge cache in both directions, so a partial paste recreates §D1's provenance problem temporally: one producer grounded in new facts, the other in old, both writing under `kind: 'nudge'`. B6's stamp makes this detectable; only the discipline prevents it.

Verification after each paste, per `docs/phase-5-precondition-review.md`'s "B6 live baseline verified":

- both `block` values equal each other → same generated revision;
- each `file` value matches the repository → neither is stale.

---

# 3. Step 1 — Generated Edge Function type-check guard

Repository only. Extends `scripts/build-edge-functions.test.ts`, which already shells out via `execFileSync`.

Per target file: write a checkable copy to a temp path (strip the `@ts-nocheck` line, replace the two `npm:` imports with minimal typed stubs, prepend a typed `Deno` declaration), run `tsc` against a dedicated tsconfig, assert exit 0.

## Validated configuration **[Report]**

The verification report exercised three variants. The draft's literal recipe fails, because passing files on the command line makes `tsc` ignore `tsconfig.json` — and `tsconfig.json` excludes `supabase/functions` in any case, so it could not be reused.

```json
{
  "compilerOptions": {
    "strict": true, "noEmit": true,
    "target": "ESNext", "lib": ["ESNext", "DOM"],
    "moduleResolution": "bundler", "module": "preserve",
    "moduleDetection": "force",
    "skipLibCheck": true, "types": []
  },
  "files": ["./<function>.check.ts"]
}
```

`types: []` is load-bearing: without it, `--lib DOM` pulls ambient `@types/*` from `node_modules` and produces 18 errors from babel, jest, react and undici-types that have nothing to do with the Edge Functions.

## Stubs must be typed, not `any` **[Report]**

With `const Anthropic: any`, `--strict` reports `TS7006` at `ai-insights/index.ts:315` on `response.content.find((block) => …)` — calling a method on an `any` value gives the callback an implicit-any parameter. That error does not exist under Deno with the SDK's real types, so an `any` stub manufactures a failure the guard then reports.

```ts
declare const Deno: {
  env: { get(k: string): string | undefined };
  serve(h: (req: Request) => Promise<Response>): void;
};
type TextBlock = { type: string; text?: string };
declare class Anthropic {
  constructor(o: any);
  messages: { create(a: any): Promise<{ content: TextBlock[] }> };
}
const createClient: any = …   // may stay `any`: nothing destructures its callbacks
```

## Two-function coverage is a Step 1 completion condition **[Ruled]**

The verification report exercised the configuration against `ai-insights` only. `send-coaching-push` was never put through it, and it contains code the other file does not: `localDateKey`, `localTimeMinutes`, `timeToMinutes`, `sendExpoPush`, the `Recipient` type, and a `fetch` to the Expo push API. Its clean pass is **assumed, not demonstrated**.

Step 1 is not complete until the guard passes on both files against the current whitelist. **Dropping the block-only fallback is not settled until then**, and this plan does not treat it as settled.

**Finding D closed by Step 1 implementation.** `send-coaching-push` passed the identical stub set and configuration that clears `ai-insights`, with no widening required despite the extra surface named above — all of it resolves against `ESNext`/`DOM` lib alone. Full-file checking worked cleanly for both; the block-only fallback was not needed and coverage was not reduced. The open half of finding D — the configuration having only ever been exercised against one function — is closed.

## What keeps the stubs honest **[New]**

Directly: **nothing.** The stubs are a hand-written assertion about an external API's shape. If `@anthropic-ai/sdk` or `@supabase/supabase-js` changes, the stub does not know, and the guard will keep passing against a shape that no longer exists. The guard verifies that the Edge Function is internally consistent *with the stub*, not that the stub is true.

This is an **accepted residual limitation**, recorded rather than solved. Two things bound it: the stubs are minimal, so they assert only the shapes actually used (two call sites), and a real SDK mismatch surfaces at Deno runtime on the next paste, which the stamp makes attributable.

**The stubs are a third maintained shim surface**, alongside the row-type shims (§7) and the duplicated prompt constants (§9). All three must be kept deliberate and minimal rather than widened whenever the guard complains.

## Sequencing

The guard must pass against the **current** whitelist before Step 3 touches it, so that a failure on the first extension is unambiguously attributable to the extension rather than to the guard.

---

# 4. Step 2 — Pure deterministic domain work

Repository only. Everything here is pure, Jest-tested, and inlined by the generator in Step 3.

## 4.1 `lib/domain/habit-health.ts`

### Mechanism

Two adjacent nominally equal-length blocks of Scheduled Opportunities, comparing the recent block's observed completion rate against the immediately preceding block's, gated on the smaller block's opportunity count, with a minimum rate difference required for the positive verdict.

Today's own Scheduled Opportunity is excluded from both blocks, consistent with the module-wide rule that today is never judged as missed.

### Naming: the verdict must not overclaim **[Ruled]**

The mechanism establishes only that **the recent Scheduled Opportunity block has a sufficiently higher observed completion rate than the immediately preceding block.** It does not establish persistent improvement, that the habit is becoming easier, establishment, causality, prediction, or a stable upward trend.

Approved closed enum, three distinct members:

```ts
export type HabitHealthVerdict =
  | 'insufficient_evidence'
  | 'no_positive_recent_comparison'
  | 'positive_recent_comparison';
```

**Each member must describe exactly what the comparison establishes and no more.**

`positive_recent_comparison` is chosen over `recent_rate_higher` because it names the *comparison* as the thing being reported rather than the raw inequality.

`no_positive_recent_comparison` is chosen over the shorter `no_positive_comparison`, which is under-specified: the mechanism is specifically a **recent-versus-preceding** comparison, and the member name carries that. Two alternatives were considered and rejected as overclaiming:

- **`no_recent_change`** — rejected. The mechanism does not establish that there was no recent change. It establishes only that the recent block did not exceed the preceding block by the approved positive-comparison threshold. There could still have been a smaller positive difference, a decline, or volatility within the blocks.
- **`steady`** — rejected. A habit can receive this verdict without being behaviourally steady.

**These are domain-internal identifiers. No member name may appear in, or shape, user-facing copy. [Ruled]** They exist to be branched on, not to be read. `no_positive_recent_comparison` in particular is negation-named, and rendering it — or letting it influence phrasing — would present the absence of a finding as a finding about the user, which §6.3 rule 4 and the transience rule both forbid.

Architecture decision 7 already ruled that the specification's own illustrative sentence ("This habit has become easier or more established over recent weeks") overclaims relative to the mechanism. The enum names must not repeat that error, and §6.3 governs user-facing wording separately and independently.

### Required explanation 1: the L / gate relationship **[Ruled — documentary]**

Definitions, for a habit `h` as of `today`:

- `resolved` = every Scheduled Opportunity for `h` from its creation through **yesterday**, ascending. Today's opportunity is excluded.
- **Recent block R** = the last `L` entries of `resolved`.
- **Preceding block P** = the `L` entries immediately before `R`.
- Therefore `|R| = min(L, |resolved|)` and `|P| = min(L, max(0, |resolved| − L))`.
- **Gate:** a verdict other than `insufficient_evidence` is produced only when `min(|R|, |P|) ≥ gate`.

**Can a block contain fewer than 14 Scheduled Opportunities?** Yes — but only `P`, and only during ramp-up. `R` fills first and is full once `|resolved| ≥ L`. `P` is short exactly while `L ≤ |resolved| < 2L`, that is while `|resolved|` is between 14 and 27.

**When can the smaller block contain exactly 10?** When `|resolved| = L + 10 = 24`. At that point `|R| = 14` and `|P| = 10`, and the gate is satisfied for the first time.

**Why the gate remains meaningful when L is 14.** Honestly stated: at `L = 14` the gate is **a time-to-first-verdict control, not an ongoing filter.** It binds only over the four-opportunity window `|resolved| ∈ [24, 27]`. From `|resolved| ≥ 28` onward both blocks are permanently full at 14, `min(|R|, |P|) = 14 > 10`, and the gate never binds again for the life of the habit.

Its entire practical effect is therefore the choice of when the signal first becomes available:

| Gate | Daily | Mon / Wed / Fri | Weekends only |
|---|---|---|---|
| 10 | 24 d | 57 d | 86 d |
| 14 (= L) | 28 d | 67 d | 100 d |

*(Measured in the verification report; both rows are from the same simulation.)*

**Consequence: the margin is the sole ongoing control on volatility. [Ruled]** Because the gate binds only over roughly four opportunities and never again, **it provides no ongoing protection once both blocks are full.** From `|resolved| ≥ 28` onward, the only thing standing between a random fluctuation and a positive verdict is the margin.

Read alongside the quantisation finding — that at `L = 14` the rate difference moves in steps of `1/14 = 7.14pp`, so only about four distinct margin behaviours exist across the plausible range — **Habit Health is a coarser instrument than three separately chosen constants would suggest.** In steady state it is effectively a one-parameter mechanism with roughly four settings.

This is stated plainly so that nobody later assumes the gate is providing ongoing protection it does not provide, and so that nobody attempts to reduce false positives by raising the gate, which after the first four weeks would do nothing at all.

**The apparent conflict with architecture decision 1, and its resolution. [New]** Decision 1 approves *"Two adjacent, **equal-length** blocks of Scheduled Opportunities"*. Read as a strict always-equal invariant, that forbids `gate < L`, because a short `P` is by definition not equal-length.

That reading cannot be right, because it makes decision 2 vacuous. Decision 2 approves gating on *"the Scheduled Opportunity count in the **smaller of the two comparison blocks**, since the comparison is only as strong as its weaker side."* If the blocks were always equal there would be no smaller block and no weaker side, and decision 2 would have nothing to gate on.

Decisions 1 and 2 read together therefore mean: **the nominal block length is `L` for both blocks; the preceding block may be short during ramp-up; and the gate is the mechanism that makes the short case safe.** That is the only reading on which both approved decisions carry content. No precondition is reopened by this; it is the two decisions read as one.

**The trade, stated plainly.** `gate = 10` permits a 14-against-10 comparison for four opportunities, where the preceding side carries more sampling noise than the recent side. `gate = 14` makes the blocks strictly equal at all times, at the cost of four extra days on a daily habit and ten on a Mon/Wed/Fri habit.

**`gate = 10`. [Ruled]** The asymmetric window is four opportunities long and occurs once in a habit's lifetime; the alternative costs ten days of silence on a non-daily habit for a benefit confined to those four.

### Required explanation 2: the margin against A2 **[Ruled — documentary]**

The margin was not part of the approved mechanism. It was identified during verification as a third constant the approved architecture implies. That assessment must be argued, not asserted.

**The A2 tripwire, verbatim** (`docs/phase-5-precondition-review.md`, A2 decision, point 5):

> **Tripwire, recorded so it is not crossed inside an implementation.** A **deadband** — entering at one threshold and exiting at another — makes the output depend on the previous output and therefore requires state. That would be a **genuine exception** demanding an **amendment to `CLAUDE.md`'s "hysteresis exists in exactly one place", not a reinterpretation of it**. It is **not needed on the current evidence**. Should it ever appear necessary, that is a decision to bring back to the account owner, **not one to take inside an implementation**.

**A2 point 4, verbatim:**

> **A stateless minimum-sample gate is an approved mechanism.** It is a pure function of the current data and introduces no state, so it does not engage the single-hysteresis rule. Precedent exists in shipped code: `RECOVERY_CONFIG.minResolvedLapsesForPercentage` (3) and `RECOVERY_CONFIG.minClosedLapsesForRecoveryTime` (2) both gate display until evidence suffices, and `CLAUDE.md` names `recoveryRate` and `averageRecoveryTime` as stateless single-pass computations while they carry those gates.

**A2 point 3, verbatim:**

> **Input stability does not imply signal stability. This is the finding most likely to be forgotten and is recorded prominently for that reason.** A threshold applied to a slow-moving input can still chatter if the value sits near it. Probing an arbitrary boundary against the measured lifetime completion rate — an input that never moved more than **0.6 percentage points** in a day — produced **seven on/off flips in 21 days**. Stability of an input is necessary and not sufficient; what matters additionally is where any boundary sits relative to the operating range.

**Is A2's constraint about statefulness, or about the existence of a band in which change is not reported?**

**It is about statefulness, and A2's own definition carries the argument on its own.** The tripwire defines a deadband as "entering at one threshold and exiting at another" and states the reason it is prohibited in the same sentence: it "makes the output depend on the previous output **and therefore requires state**." The prohibition attaches to the dependence on previous output. The two-threshold structure is named as the mechanism that produces that dependence — the diagnosis, not the offence.

**Is the margin permitted on that reading? Yes.** Applying A2's definition directly, a fixed comparison margin:

- **depends only on the current two-block comparison** — the verdict on any date is a pure function of that date's Scheduled Opportunity history;
- **does not depend on the previous Habit Health verdict** — no prior verdict is consulted, stored, or inferable, and re-evaluating from a cold process yields the identical answer;
- **does not introduce separate enter/exit thresholds** — the positive verdict holds when `(rate(R) − rate(P)) ≥ m` and does not hold when `(rate(R) − rate(P)) < m`, the same boundary in both directions;
- **therefore does not create a second hysteresis mechanism**, and does not engage `CLAUDE.md`'s "hysteresis exists in exactly one place".

It is a single-pass stateless computation. No amendment to `CLAUDE.md` is required.

**The stronger argument: there is no margin-free version of this mechanism. [New]**

Architecture decision 1 approves *comparing* two rates, but **a comparison is not a verdict until a predicate makes it one, and every such predicate carries a threshold.** A "margin-free" design is not an absence of a threshold; it is `m` set to the smallest representable difference, which at `L = 14` is `1/14 = 7.14pp`. **The choice is which threshold, not whether there is one.**

Framing the margin as an addition to the approved mechanism therefore overstates it. The approved mechanism was underspecified at exactly this point, and any implementation must supply the value. Choosing `0.25` rather than `1/14` is a calibration decision inside the approved architecture, not an extension of it.

**Consistent precedent, noted but not relied upon.** A2 point 4 approves `minResolvedLapsesForPercentage`, which also creates a region where a real value exists and is not reported — so A2 plainly does not treat "some real difference goes unreported" as itself disqualifying. **This is recorded as consistent, not as the primary justification**, because the two are different kinds of threshold: **a sample-size gate withholds a value because the data is insufficient; an effect-size margin withholds a verdict because the measured difference is too small.** The argument above does not depend on treating them as equivalent, and should not be read as doing so.

Two smaller confirmations, in the same supporting register: point 3 warns about *where a boundary sits relative to the operating range* and calls the probe's boundary "arbitrary" rather than forbidden, which presupposes boundaries are permitted; and point 1 makes volatility explicitly non-disqualifying, quoting `CLAUDE.md` that a signal outside the fold "is a single-pass stateless computation and is not a Momentum State, **regardless of how volatile it is or how it's surfaced.**"

**The one A2 concern that genuinely applies** is point 3 — where the boundary sits relative to the operating range — and the verification report's false-positive measurements across steady 85% and steady 60% histories are precisely that check, performed rather than assumed.

**What would cross the tripwire, recorded so it is not crossed later:** any design in which the verdict enters at one value and exits at another, or in which yesterday's verdict is an input to today's. That would require state and would be a genuine exception to bring back to you, not a decision to take inside an implementation.

### Constants — approved **[Ruled]**

```ts
export const HABIT_HEALTH_CONFIG = {
  comparisonBlockOpportunities: 14,
  minOpportunitiesInSmallerBlock: 10,
  minRateImprovement: 0.25,
} as const;
```

A distinct config value is required rather than reusing either Recovery gate: those are lapse-denominated where this is opportunity-denominated, and `lib/domain/config.ts` already records that `3` "was deliberately not reused" when the second Recovery gate was introduced.

**Margin quantisation, to record with the value.** At `L = 14` the rate difference moves in steps of `1/14 = 7.14pp`, so only about four distinct behaviours exist across the plausible range. `0.15` and `0.20` are behaviourally identical (both mean "at least 3 more completions in the recent block"), as are `0.30` and `0.35`. `0.25` means "at least 4 more completions". A later adjustment is therefore either a no-op or a full step, never a fine-tune.

### Phase resonance: a known limitation, not an invariant **[Ruled]**

The verification report measured that at `L = 21`, a habit with a 14-opportunity rhythm (seven on, seven off) produced 14.1 verdict changes per 100 days and a spurious positive verdict on 21% to 35% of days, at both margins tested. At `L = 14` and `L = 28` the same history produced zero.

**This is recorded as a known limitation of the mechanism, not as an architectural rule that `L` must be a multiple of 7.** The measurement supports choosing 14 and explains why 21 behaved badly *in the tested rhythm*. It does not establish a universal domain invariant. **Any block length can straddle phase for a habit whose rhythm is not a divisor of it** — a habit with a 10-opportunity cycle would resonate against `L = 14` in the same way and for the same reason. The mechanism compares two fixed-length windows and has no concept of the user's own period; that is the limitation, and it is inherent rather than tunable.

### Public surface

```ts
export function habitHealthVerdict(
  habit: Habit,
  periods: HabitSchedulePeriod[],
  logs: HabitLog[],
  today: string,
): HabitHealthVerdict;
```

No deadband. No dependence on `momentum(…, window)` — the A2 constraint is additionally enforced structurally in Step 3 by excluding `momentum()` from the whitelist entirely (§6.2).

### Tests

Fixture-driven, covering: below gate; exactly at gate with an asymmetric block pair; both blocks full; a genuine step improvement detected and its subsequent return to `no_positive_recent_comparison` as the change moves fully inside both blocks; a paused stretch contributing no opportunities to either block; a non-daily schedule; and the resonance case at `L = 14` asserted stable.

## 4.2 `lib/domain/coach-facts.ts`

```ts
export function buildCoachFacts(
  habits: Habit[],
  logs: HabitLog[],
  schedulePeriods: HabitSchedulePeriod[],
  lapseReasons: LapseReasonEntry[],
  today: string,
): CoachFacts;
```

`CoachFacts` is flat and numeric-leaved, with a fixed per-habit element shape, so the enumerable set of numbers the model may state is mechanically derivable from the type and pinnable by a test (§D2).

### Field closure **[Ruled]**

Every numeric fact requires an identified existing Phase 5 coaching purpose. Nothing is exposed because it is available.

| Field | Existing purpose | Included |
|---|---|---|
| Confirmed Momentum State | Primary in-app narrative since Phase 3 | yes |
| Recovery Rate — **rolling** | "Recover after missed days"; the horizon both screens display | yes |
| Recovery Rate — lifetime | **none identified** | **no** |
| Average Recovery Time | "Recover after missed days" | yes, gated |
| Total Completions | "Recognise genuine progress"; Phase 3 anchor metric | yes |
| Consistency, schedule-aware | The only statistic the coach cites today; resolves C2 | yes |
| Lapse-reason distribution | Spec: "prioritise stated reasons over inferred behaviour" | yes |
| Habit Health verdict (3-state) | The MVP signal | yes |
| Recovery count | Displayed on Progress today | yes |

**Lifetime Recovery Rate is excluded.** `recoveryRate()` returns both horizons, but `app/(tabs)/progress.tsx:113` and `app/habit/[id].tsx:38-39` both read `.rolling` and nothing anywhere reads `.lifetime`. Carrying rolling only also means the coach and the screens cannot quote different recovery numbers at each other. This saves no compute — `recoveryRate` computes both regardless, at 2.78 ms on a two-year habit — the justification is closure discipline. **[Ruled]**

**Scheduled Opportunity counts, reviewed under the same rule rather than included by default. [Ruled]** The verification report proposed two: a lifetime opportunity count and a window count. Applying the test:

- **Window opportunity count — include.** It is Consistency's own denominator. Without it the coach can state "82%" but cannot say what it is 82% *of*, and a percentage over an unstated denominator is exactly the kind of number the deterministic architecture exists to make honest.
- **Lifetime opportunity count — exclude. [Ruled]** No Phase 5 coaching goal requires it. Total Completions already carries the "recognise genuine progress" role as the Phase 3 anchor metric, and a lifetime opportunity count invites the ratio "you completed 308 of 365", which is a lifetime consistency figure no screen displays and no goal asks for. Excluded **unless a concrete existing Phase 5 coaching use is identified before implementation**, on the same condition as lifetime Recovery Rate.

**Spec compatibility check, because this touches one of A3's ten inputs. [New]** "Scheduled opportunities" is one of the ten inputs the locked specification lists under "Use as inputs:", and A3 established those are requirements rather than an illustrative set. Excluding the lifetime count does not breach that, on A3's own reasoning: A3 distinguishes *inputs to the coaching system* from *facts passed to the model*, and notes that the specification's Deterministic Architecture section enumerates the latter as "consistency, momentum, Momentum State, recovery events, recovery rate, lapse patterns, habit health signals, behavioural trend direction" — in which Scheduled Opportunities do not appear. They remain an input in the strongest sense: every domain calculation in `CoachFacts` is built on them. The window count is additionally retained in the payload as Consistency's denominator.

**Omit any rate whose display gate is false. [Ruled]** `RecoveryRateResult` carries both `rate` and `displayAsPercentage`. Passing a rate together with a flag saying it may not be shown as a percentage hands a display rule the domain layer already decided to the model, and puts a number in the enumerable set that the model was never permitted to state. When `displayAsPercentage` is false, the rate is **omitted from `CoachFacts`**. The same applies to `averageRecoveryTime`, which is already null below `minClosedLapsesForRecoveryTime`. A number absent from the payload cannot be validly quoted, and the validator needs no special case.

### Habit Health is carried as all three states **[Ruled — supersedes Report]**

**[Superseded]** The verification report recommended omitting the Habit Health field from `CoachFacts` unless the verdict was positive, so that "no positive signal" could not become negative coaching structurally. **That recommendation is not adopted.** `CoachFacts` carries the closed three-state verdict in every case; the states are not collapsed to simplify prompting.

**Consequence to record honestly. [New]** Enforcement of "verbalise only on the positive verdict" (§6.3) therefore rests on the prompt constraint and the validator rather than on the payload's shape. That is **weaker than structural omission**, and it is an accepted residual risk: a model that receives `no_positive_recent_comparison` can in principle verbalise it, and the numeric validator will not catch a non-numeric characterisation. §10 records it in the residual-risk register rather than leaving it implied.

### Excluded by A3, structurally **[Ruled]**

Habit edit history and reminder usage do not appear in `CoachFacts`. Because the enumerable set is the leaf fields of a closed type, the exclusion holds structurally rather than by instruction.

## 4.3 `lib/domain/coach-validation.ts`

```ts
export function validateCoachOutput(text: string, facts: CoachFacts): ValidationResult;
```

Scope and limits are in §6.4.

## 4.4 `lib/domain/coach-fallback.ts`

The generic habit-support fallback. Design in §6.5.

---

# 5. Step 2a — `confirmedStateAt` performance optimisation

Repository only. **Class A blocker, accepted. [Ruled]**

## The problem

`confirmedStateAt` walks every Scheduled Opportunity from habit creation, calling `candidateStateAt` once per opportunity. Each call re-derives `recordsUpTo` *and* `closedLapses` from creation, and `isDoneOnDay` filters the entire log array on every date. Cost is roughly O(n²·L). Measured on the real domain code:

| Habit age | `confirmedStateAt` | Every other measured fact |
|---|---|---|
| 365 d | 348 ms | ≤ 1.01 ms |
| 730 d | 2 158 ms | ≤ 2.78 ms |
| 1095 d | 6 650 ms | ≤ 5.79 ms |

Five habits at two years: 10.8 s CPU per invocation.

`lib/domain/momentum.ts:229` predicts this in its own doc comment and calls it "not a practical concern today" — true while it only ran on-device for one user's live screen, and false once both Edge Functions depend on it.

## Constraints on the optimisation **[Ruled]**

- preserve exact Momentum semantics;
- persist no additional state;
- introduce no second hysteresis mechanism;
- remain derived-on-read;
- optimise only within the pure-function call boundary.

## Approach

The doc comment names one remedy and rejects it — caching the last confirmed state and rescanning forward, which is stored state. **That rejection stands and is not revisited.**

A second remedy introduces no state. Within a single `confirmedStateAt` call, `recordsUpTo` and `closedLapses` are functions of `asOfDate` only, and the walk is strictly ascending. Both can be computed once over the full history and sliced per step, and `isDoneOnDay`'s repeated `logs.filter` can be replaced by an index built once per call. Every output is identical, nothing survives the call, and the calculation remains derived-on-read.

Profiling supports this being the whole cost: at 730 days a single `candidateStateAt` is 6.25 ms and a single `closedLapses` is 2.94 ms, paid repeatedly across 731 opportunities.

## Verification **[Ruled]**

**Semantic equivalence is the hard gate.** Required:

- `lib/domain/momentum.exhaustive.test.ts` passes unchanged;
- the locked `perfect_completion_history` fixture reproduces its specified transition timing exactly (`steady` at opportunity 7, `thriving` at 10, `docs/phase-2-implementation-plan.md` §8);
- every other locked behavioural fixture in §8 is unchanged;
- an equivalence test comparing pre- and post-optimisation output across a generated history corpus.

**Wall-clock timings are not a strict correctness assertion.** Before and after figures are recorded in the completion notes, with at most a loose regression expectation. A brittle timing assertion in `npm test` would fail on unrelated machines and would be deleted rather than fixed.

## Serial cron cost, recorded as a characteristic to watch **[Ruled]**

`send-coaching-push` iterates recipients **serially** inside a single cron invocation (`index.ts:302`, the `for (const recipient of …)` loop). Per-user cost therefore accumulates across the loop rather than being amortised, and the failure mode is a partial run in which later users are silently never reached.

This is **noted as a known characteristic to watch after Step 2a, not as a separate work item.** No parallelisation, batching, or invocation-splitting is planned for Phase 5. If Step 4's measurements show it materially binding, that is a report back under §8's stop rule rather than an in-flight redesign.

---

# 6. Steps 3-5

## 6.1 Step 3 — Generated-domain whitelist extension (first paste)

Extend `SOURCES` in `scripts/build-edge-functions.js`, hand-enumerating the transitive closure including private helpers, and extend the hand-maintained type shims in both Edge Functions.

**Deliberately does not switch any call site.** The code becomes available; nothing calls it yet. Switching to schedule-aware functions before Step 4 supplies `habit_schedule_periods` would silently default every habit to daily and unpaused — correct for daily habits, wrong for paused ones, and a correctness bug disguised as progress.

### Closure scope **[Ruled]**

**The required closure spans six existing domain modules, not four.** The draft named `config.ts`, `schedule.ts`, `recovery.ts` and `momentum.ts`; it omitted `day-key.ts` and `habit-stats.ts`, which are the two already in `SOURCES` and therefore the two a reader assumes are handled. Both need new symbols: `day-key.ts` needs `daysBetween`, `localDayKeyOf`, `parseDayKeyParts` and `weekdayOf`; `habit-stats.ts` needs `consistency` and `totalCompletions`.

**The six-module scope is the reliable claim. The exact symbol count is provisional. [Ruled]** The verification report's figure of 49 symbols follows from a *proposed* Step 4 call set and a token-based identifier walk matching the generator's own technique. It can over-approximate, and it will move if the Step 4 call sites differ — for example if `CoachFacts` ends up carrying open-lapse status, which adds `openLapse` and `OpenLapse`. Step 3 re-derives the closure against the call sites Step 4 actually uses.

### `momentum()` stays excluded **[Ruled]**

`momentum()` has zero non-test callers anywhere in the codebase and does not appear in the computed closure — `candidateStateAt` does not reach it. It is excluded by name, which makes A2's "not built on `momentum(…, window)`" structurally unreachable server-side rather than a prose commitment. No unused domain function is whitelisted "just in case".

### `OpportunityRecord` **[Ruled]**

`lib/domain/momentum.ts:21` and `lib/domain/recovery.ts:10` both declare `type OpportunityRecord = { date: string; completed: boolean }`, and the generator splices into one flat scope. The duplication is verified; the exact failure mode was reasoned rather than demonstrated.

**No new investigation.** Step 3 extends the whitelist and lets the Step 1 strict guard reveal any flat-scope collision. If it collides as expected, resolve it with the smallest existing-dependency change: **export the type from `recovery.ts` and import it in `momentum.ts`**, following the dependency direction that already exists (`momentum.ts` already imports `closedLapses` from `recovery.ts`). One export keyword, one import line, no new module or abstraction. `SOURCES` then lists `OpportunityRecord` under `recovery.ts` only.

### Type shims **[Ruled]**

The row-type shims need `Habit.createdAt` plus `HabitSchedulePeriod`, `ScheduleDays` and `LapseReasonEntry` shapes and their snake_case row counterparts. These live in `lib/habit-types.ts`, outside `DOMAIN_DIR`.

They stay **hand-maintained and guarded by the Step 1 type check.** The generator is not extended into `habit-types.ts` merely to remove the maintenance surface.

**This departs from B1's stated assumption**, recorded so the departure is visible rather than implicit. B1 concluded that "the generator itself would need changing". The justification for departing is a fact that did not exist when B1 was written: **the Step 1 guard converts a stale-shim failure from silent to loud.** A missing `createdAt` becomes a compile error in `npm test` — which is the failure mode the generator change was meant to prevent, obtained without generator complexity. B1's analysis was correct on the evidence available to it; the guard changes that evidence.

## 6.2 Step 4 — DB-read widening and call-site cutover (second paste)

- add `created_at` to the habits select in both functions;
- widen the `habit_logs` window (§8);
- add `habit_schedule_periods` and `lapse_reasons` reads;
- switch call sites from `calendarConsistency` to schedule-aware `consistency`;
- call `buildCoachFacts`.

**C2 resolves here, at Steps 3 and 4 together, not at Step 3 alone.**

**Preserve `send-coaching-push`'s branch order.** Authenticate first for every method, then branch: the authenticated `GET` returns the stamp before the Supabase client is constructed, before any database read, before Anthropic, and before any push. New reads must go **below** that branch. The no-side-effects property of reading the deployed version is load-bearing and was verified in production.

### Fact-inspection diagnostic **[Report]**

Extend the pattern already proven side-effect-free: `ai-insights` gains one authenticated diagnostic branch returning `buildCoachFacts(...)` as JSON, returning before Anthropic is touched and before any `ai_insights` write. Habit **ids** only, never names. Removal timing is set in §6.7 below.

**What it verifies, and what it does not. [Ruled]** This mechanism verifies **transport and input correctness** — that the DB reads return what is expected, that `created_at` is present and correct, that schedule periods are being read and applied, and that the call-site switch actually took effect. It **does not verify domain arithmetic.** Because expected values are established by reusing the authoritative `lib/domain/` implementation on both sides of the comparison, a domain bug produces identically wrong values on each side and the comparison passes.

**Domain correctness remains owned by Step 2's unit tests.** Step 4's diagnostic must not be read, or reported, as full verification of the facts themselves. That division of labour is stated here so it is not assumed away later.

`send-coaching-push` needs no equivalent: it computes the same facts from the same generated block, and its existing `GET` already proves it runs the same revision.

## 6.3 Step 5 — Prompts, validator, fallback, cutover (third paste)

Rewrite prompts in both functions to consume `CoachFacts`; wire `validateCoachOutput` before returning, before caching, and before pushing; wire the fallback orchestration; remove the Step 4 diagnostic; clear the affected cache at cutover.

### Coaching behaviour rules **[Ruled]**

1. **Momentum leads.** Confirmed Momentum State is the primary narrative and is never suppressed, reworded, or softened by the Habit Health verdict.
2. **Habit Health may be verbalised only when the verdict is `positive_recent_comparison`.**
3. **The coach must never describe Momentum and Habit Health as agreeing, conflicting, causing one another, or resolving one another.**
4. **Habit Health wording describes the observed recent-versus-previous pattern only and must not generalise it into a persistent trend.**

Semantic level wanted:

- "You've completed this habit more consistently in the recent period than in the period before it."
- "Your recent completion pattern is stronger than the previous comparison period."

Prohibited: "This habit is improving." / "This is becoming established." / "You're finding this easier." / "You're on an upward trend."

**The positive verdict is transient by construction.** Once the change sits fully inside both comparison blocks there is no longer a difference to report and the verdict returns to `no_positive_recent_comparison`. That is semantically correct and **must never be presented as decline or as something lost.** This is also why rule 4 matters: copy that generalises the comparison into a trend makes its own disappearance read as a reversal.

All Phase 5 coach output remains bound by `CLAUDE.md`'s user-facing copy rules, including no em dashes and the variation contract's prohibition on loss framing.

### Emphasis order among grounded facts **[Ruled]**

§6.5 governs grounded-versus-fallback. This governs selection *within* the grounded branch, so that **the model does not decide which behavioural fact deserves emphasis.**

**No new mechanism is introduced.** There is no ranking engine, no new `CoachFacts` field and no additional work item. Every condition below resolves to a value the domain layer has already determined and `CoachFacts` already carries, and the prompt keys on that value rather than judging it.

1. **Recovery and return lead when the return is the story.** The condition is **confirmed Momentum State being `recovering` or `rebuilding`**, and it is deterministic because those two states already require it: by their own `candidateStateAt` definitions, both demand that the window's most recent opportunity was itself a completion closing a lapse. `CLAUDE.md` states this directly — they are positive-family states where "both require the window's most recent opportunity to be a completion." **The model is therefore never asked whether recovery is the relevant story; the domain layer has already answered.**

   This is **not an exception to rule 1.** When Momentum State is `recovering` or `rebuilding`, recovery leading *is* Momentum leading. The two rules do not compete.

2. **Otherwise confirmed Momentum State is the primary ongoing behavioural narrative**, per rule 1.

3. **Positive Habit Health may be communicated when eligible, and never outranks Momentum.** It is supporting evidence added to the narrative, not a candidate to lead it. Rules 2 to 4 continue to bind its wording.

4. **Stated lapse reasons are contextual evidence, not a ranked item. [New]** They do not sit beneath Habit Health in an ordering, because they are not competing for the lead — they qualify whichever grounded insight is being given. The rule is preference, not position: **when a stated reason exists for the lapse under discussion, it is preferred to any inferred explanation, and the coach must not offer a cause of its own when none is stated.** This implements the specification's "Prioritise stated reasons over inferred behaviour" as a selection rule rather than only as a field justification (§4.2).

5. **Deterministic habit-support guidance is last**, reachable only through §6.5's `else` when no grounded insight is available.

### Scope boundary against Phase 6 **[Ruled]**

Phase 5 mechanically grounds **all three** existing coaching output kinds — nudge, weekly, monthly — in `CoachFacts`. Phase 6 redesigns reflection content and experience. **No existing coaching path may remain on the old factual mechanism merely because its content redesign belongs to Phase 6.**

Recorded: reflections are the most open-ended prose of the three, and are therefore where validator false rejects are most likely to concentrate.

### Prompt provenance **[Ruled — supersedes Report]**

**[Superseded]** The verification report recommended moving the shared prompt constants into a `lib/domain/` module so the generator would splice identical text into both functions. **Not adopted.** `lib/domain/` contains deterministic behavioural truth, not prompt copy, and that conceptual boundary is worth more than the mechanical guarantee.

Instead: **a repository test asserting the duplicated shared prompt and style constants are byte-identical across both Edge Functions.** Combined with B6's `file` fingerprints, which verify each deployed function matches repository source, that is sufficient MVP provenance — repository drift is caught by the test, deployment drift by the stamp.

Recorded limitation: this detects drift rather than preventing it, and the duplicated prompt text remains a maintained shim surface alongside the row-type shims and the Step 1 stubs.

## 6.4 The validator **[Ruled]**

A **deterministic numeric grounding safeguard**. Not a semantic entailment system.

**[Superseded]** The verification report proposed a closed Habit Health sentence lexicon checked by exact membership, presented as making the non-numeric rule "real rather than decorative". **Not adopted as a semantic trust boundary.** A closed lexicon does not solve paraphrase detection, and this plan does not claim it does.

The defence is layered, and each layer is named for what it actually does:

| Layer | What it provides |
|---|---|
| Deterministic facts | The model never sees raw history |
| Closed `CoachFacts` | The enumerable set is mechanically derivable |
| Prompt constraints | Reduce likelihood; not enforcement |
| Numeric validation | Deterministic, mechanical, the real boundary |
| Targeted tests | Pin the above against fixtures |
| Acknowledged residual risk | §10 |

### Validated

Decimal and percentage equivalence (`0.82` ↔ `82%` ↔ `82`); percentages; counts; **Recovery Time and other durations**; fabricated values; nearby-but-incorrect values; with narrow exceptions only for dates and ordinals.

**Durations are not generically exempt.** Recovery Time is itself a factual duration; "you usually return in 4 days" is a behavioural statistic and must be grounded like any other.

### Prompt rule, as defence in depth **[Ruled]**

> "Write any number describing the user's behaviour as a digit, not as a spelled-out number."

**This is defence in depth only.** The validator still deterministically handles supported spelled-out numeric forms where practical.

### Named residual failure case **[Ruled]**

**A spelled-out behavioural duration — for example "you usually return in three days" — is a Recovery Time claim that a digit-keyed validator never inspects.** The prompt rule reduces the likelihood; it does not close the case. Handling the supported spelled-out forms narrows it further but cannot exhaust the space of ways a number can be written in prose.

This is named here rather than left implied, and repeated in §10.

## 6.5 Fallback coaching mode **[Ruled]**

Absence of a positive Habit Health signal must not make the coach useless or silent. Habit Health must not become a negative diagnostic score.

### Design: deterministic selection, no model call **[Ruled]**

The smallest thing that satisfies the ruling is not a second generation path but **a closed set of static messages selected deterministically**, with no Anthropic call at all. This:

- structurally cannot contain a statistic, because no text is generated;
- needs no validator pass, because there is no model output to validate;
- costs nothing and cannot fail;
- satisfies `CLAUDE.md`'s variation contract rule 2 directly, by seeding selection on habit id plus day key.

Message topics, per your list: make the first step easier; reduce friction; use an existing routine as a cue; make a reduced version acceptable; place the cue where it will be encountered; return rather than continue.

**Copy constraint. [New]** The topics are permitted but the wording is still bound by the variation contract's rule 1. "Focus on returning rather than protecting a streak" names the right topic but must not be written with the loss framing it references — "protecting", "streak", "back on track" are all prohibited surface forms. The shipped variant states the positive half only.

**Not built:** a habit ontology, a health-facts database, a content-management system, free-form claims generated from the habit name, or schema for habit categories.

### Precedence is structural, not prompt-instructed **[Ruled]**

Because the fallback set is closed and deterministic, it is **always eligible** and sits outside the numeric validator. Without explicit precedence it could displace grounded behavioural content, inverting the product's positioning by offering generic tips instead of observations about the user's own returning.

The orchestration is therefore a single exclusive branch, evaluated before any generation:

```
facts = buildCoachFacts(...)
if (hasGroundedInsight(facts)) → generate + validate + (on pass) return/cache/send
else                          → deterministic fallback message; no model call
```

`hasGroundedInsight(facts)` is a pure predicate over `CoachFacts` alone, defined and unit-tested in Step 2. **The fallback path is unreachable whenever grounded facts exist.** It is not a prompt instruction, not a model choice, and not a ranking — it is an `else`.

**Interaction with validator rejection, stated explicitly. [New]** A validation rejection is **not** a route into the fallback. Rejection means the grounded path was taken and failed, and §6.6 governs what happens then. Allowing rejection to fall through to a generic tip would let a validator failure silently downgrade the product's core surface, and would make rejection invisible in exactly the case worth noticing.

If this minimal fallback materially complicates Step 5, the retained scope is the orchestration hook and a very small closed message set only. Anything richer is Phase 6 or Product Polish.

## 6.6 Validator rejection and retry **[Ruled]**

Fail closed. **No automatic second Anthropic generation attempt.**

**[Superseded]** The verification report proposed one retry before the sentinel. Not adopted: no concrete correctness reason for a second attempt was identified, and it doubles worst-case spend on exactly the pathological input that triggered the first rejection.

| Stage | Behaviour |
|---|---|
| Generate | Once. Validate. |
| Pass | Normal sanitize / cache / return / send flow. |
| Reject | Discard the generated text. Persist a short-lived failure sentinel. Return and display no AI insight. Push path sends nothing and marks the day's push attempt handled. |

**Rejected prose is never cached, displayed or pushed.**

Diagnostics kept minimal: coaching kind, deployment stamp, validator reason, offending numerals, and the enumerable allowed set. **Not the rejected prose.**

### Sentinel shape: the render path traced **[New — corrects the verification report]**

You were right that the report treated two distinct paths as one, and right that `{nudge?.content ?? 'No tip yet.'}` at `app/(tabs)/progress.tsx:245` would not fire its fallback for an empty string. Tracing the actual retrieval path shows the conclusion nevertheless comes out differently, in two directions:

**Interactive path — already correct, by an undocumented guard.**

1. `ai-insights/index.ts:253` — `if (existing)` is truthy for any returned row, so a sentinel row short-circuits regeneration as intended.
2. `index.ts:255` returns `content: sanitizeContent('')`, i.e. `''`.
3. **`lib/ai-coach.ts:16` — `if (error || !data?.content) return null;`** This is a **truthiness** check, not nullish. `''` is falsy, so `getInsight` returns `null`.
4. `progress.tsx:166` — `setNudge(null)`; `progress.tsx:245` renders **"No tip yet."**

So an empty-content sentinel renders the neutral copy correctly, because `lib/ai-coach.ts:16` converts it to `null` before it ever reaches the `??`. **No change is needed, and neither a different sentinel shape nor a truthiness render guard is required.** The report's proposal and the interactive path happen to be compatible; the reasoning that connected them was missing.

**That guard is load-bearing and currently incidental. [New]** Nothing documents `lib/ai-coach.ts:16` as the reason the sentinel renders correctly, and narrowing it to `data?.content == null` would silently produce the empty card. Step 5 adds a test pinning it, and a comment naming the sentinel as the reason.

**Cron path — the sentinel does not suppress it, and something else must.**

`send-coaching-push/index.ts:322` is `let content: string | null = existing?.content ? sanitizeContent(existing.content) : null;` — also truthiness. An empty-content sentinel therefore leaves `content` null, and `index.ts:324`'s `if (!content)` **regenerates**. The sentinel is invisible to the cron reuse check.

Suppression on the push path must therefore come from **`coach_push_last_sent_date`**, stamped on the rejection path as well as the success path, which `index.ts:304`'s `if (recipient.coach_push_last_sent_date === today) continue;` already honours. This is what the ruling's "marks the day's push attempt handled" resolves to concretely. Missing one day's push is strictly better than regenerating every 15 minutes for the rest of the day.

### Sentinel TTL, proposed explicitly **[Ruled]**

**Not inherited from the successful-content TTL.** Inheriting would suppress retry for 30 days on monthly content.

| Kind | Success TTL | Proposed sentinel TTL |
|---|---|---|
| nudge | 20 h | **3 h** |
| weekly | 7 d | **24 h** |
| monthly | 30 d | **24 h** |

Implementation note: the freshness query at `ai-insights/index.ts:243-251` filters on a single `since` computed from `config.freshnessHours`, so a distinct sentinel TTL requires distinguishing sentinel rows in that query rather than reusing one window. Settled in Step 5.

### Rate-limit interaction **[Ruled]**

`ai-insights/index.ts:265-269` counts rows in `ai_insights` within 24 hours via `count: 'exact', head: true`. **A sentinel row is a row, so it counts**, and a persistently failing user is bounded by the existing limit of 10 rather than generating unmetered.

Residual gap, recorded as debt rather than fixed with a schema change: a rejected generation that occurs when a sentinel already exists is not separately counted. Exact attempt counting would need a dedicated column. **Class B.**

### UI **[Ruled]**

Keep "No tip yet." No error state, no retry affordance.

### Cache invalidation at cutover **[Ruled]**

Clearing the affected `ai_insights` rows is an **explicit Step 5 cutover action**, not a manual afterthought, so testers do not spend up to 30 days evaluating pre-rewrite content. No general cache-versioning infrastructure is built.

**The exact operation and its scope will be shown for approval before execution**, per your ruling. It is not stated here because it is a destructive production operation and belongs in the execution step, not in a plan document.

## 6.7 Branch attribution for testing **[Ruled]**

### The limitation this exists to address

After Step 5 the Coach card has three possible outcomes, and **a tester cannot distinguish them from the card**:

1. a grounded behavioural insight;
2. deterministic fallback text, selected without a model call (§6.5);
3. nothing shown, because generated output failed validation and was suppressed (§6.6).

Outcomes 2 and 3 both present as an unremarkable card — the fallback looks like ordinary coaching, and a suppression looks like "No tip yet." **Tester feedback that the coaching "felt generic" is therefore not attributable to a branch on its own.** The same complaint is consistent with four distinct faults:

| # | Fault | Branch it presents as |
|---|---|---|
| 1 | The fallback fired correctly — no grounded facts were available | fallback |
| 2 | `hasGroundedInsight` was too strict — facts were available and the predicate rejected them | fallback |
| 3 | Grounded output fired and genuinely reads as generic | grounded |
| 4 | Repeated silent validator rejections | suppressed |

**Correction to the pairing. [New]** An earlier statement of this had faults 2 and 3 collapsing into "grounded insight fired". That is wrong: fault 2 is a predicate that returned *false*, so it presents as **fallback**, not as grounded. The genuine collision is between **faults 1 and 2** — both present as the fallback branch, and separating them requires knowing what facts were available at the moment the predicate rejected them.

### Requirement

**The existing fact-inspection diagnostic must make the fired branch observable for a sampled user**, distinguishing at minimum those three outcomes. This is **for test attribution only**.

Constraints, all of which the existing mechanism already satisfies:

- it stays **inside** the existing diagnostic branch — no new endpoint, product surface, workstream, schema or infrastructure;
- it reports which branch fired, not the content that resulted;
- it remains authenticated, RLS-scoped, side-effect-free, and non-user-facing;
- it carries no habit names and no rejected prose.

### Does this separate four faults or three branches? **[New]**

**All four are separable, using only what the diagnostic already computes and already returns — no extension.**

The diagnostic's entire purpose is to return `buildCoachFacts(...)` as JSON (§6.2). So when the fallback branch is reported, **the facts object that `hasGroundedInsight` rejected is already in the same response.** Fault 1 shows an facts object with nothing to ground on; fault 2 shows one with usable facts that the predicate declined. Distinguishing them is reading a payload that is already there, not adding a field.

Given that, the branch label separates {fallback, grounded, suppressed}, and the already-returned facts separate 1 from 2 within the fallback branch and give fault 3 the context to judge it. Nothing further is needed.

**Two limitations on that separability, recorded rather than closed:**

- **Timing.** The diagnostic reads facts at the moment it is called, not at the moment the impression the tester is complaining about was generated. A nudge caches for roughly 20 hours, so the facts may have moved between generation and inspection. Closing this would mean persisting the branch and its facts at generation time, which is more than a field already being computed. **Recorded as a limitation.**
- **Path coverage.** The diagnostic lives on `ai-insights`. `send-coaching-push` runs the same orchestration independently, so the branch behind a **push-delivered** impression is not directly observable. Closing this would mean adding the same diagnostic to the second function, which is a mechanism extension. **Recorded as a limitation.**

### Removal timing: a change to an approved decision **[New]**

**This is a change to a decision you approved, not an implementation detail, and is recorded as such.** You approved the diagnostic as temporary and removed at the Step 5 paste. That removal point has moved. The reasoning is decisive rather than preferential — **all three branches only come into existence at Step 5**, so a diagnostic removed in the Step 5 paste could never once report a branch, and the attribution is needed at the Acceptance Gate, which runs after Phase 5 closes — but the basis on which the branch was approved has changed, and the change is stated here rather than absorbed into §12.

Everything else about the diagnostic is unchanged: still temporary, still one branch, still non-user-facing, still side-effect-free, still verifiable through the `file` stamp.

Recorded consequence: the diagnostic branch ships to production for the duration of the Acceptance Gate rather than being removed at cutover. It performs no write, sends nothing, calls no model, and is reachable only by an authenticated request scoped by RLS to the caller's own data.

### The removal condition, named **[Ruled]**

"A post-Acceptance-Gate action" is a phrase, not a condition, and would drift indefinitely if the gate were never formally closed. The condition is therefore named, with a trigger, a verification step, a proof of completion, and a hard downstream gate.

**Trigger event.** The Acceptance Gate reaching its own stated pass condition: `docs/acceptance-gate-findings.md` written, every finding classified, and **all critical findings addressed**. That is the roadmap's existing pass condition, not a new one — the gate "produces a written document and has a pass condition; it is not an informal check."

**Responsible verification step.** Remove the diagnostic branch from `supabase/functions/ai-insights/index.ts`, run `npm run build:edge-functions` (which rewrites `SOURCE_STAMP`), run `npm test` so the stamp freshness assertions pass, and paste **both** Edge Functions per the cross-cutting paste discipline in §2.

**Proof of completion — the `file` stamp comparison is the deployment verification.** Removal is proven, not asserted, when:

- the live `ai-insights` `file` stamp, read from the `stamp` field on any authenticated 200 response, equals the post-removal repository value;
- the live `send-coaching-push` `file` stamp, read from its authenticated `GET`, equals its post-removal repository value;
- both live `block` values still equal each other.

A checked-in claim that the diagnostic was removed is explicitly **not** proof. B6 records that this project has already run that experiment: a completion report asserted both functions were deployed, four commits then landed, and nothing updated it. The stamp is the observation; the assertion is not.

**Hard downstream gate. [Ruled]** **Phase 6 does not begin while the diagnostic branch is still deployed.** This is a Phase 6 entry precondition, and the proof above is what satisfies it. If the Acceptance Gate closes and the diagnostic has not been removed and verified, Phase 6 is blocked — not delayed by convention, blocked by a precondition, in the same way Phase 5's own preconditions blocked it.

---

# 7. Model **[Ruled]**

**`claude-sonnet-4-6` is retained. No model change in Phase 5.**

`output_config.format` is not adopted: structured output constrains shape, not factual truthfulness, and does not prevent an invented statistic — `validateCoachOutput` is the safeguard for the property that matters. A model change is additionally a coach-voice change, affecting `CLAUDE.md`'s copy contract and requiring broader review.

Structured outputs are deferred post-MVP and revisited only if measured rejection behaviour gives a concrete reason. This decouples the model question from validator rejection behaviour entirely.

---

# 8. Step 4 data horizon **[Ruled]**

**Lifetime metrics remain lifetime metrics.** No metric semantics change for performance convenience.

Production DB sizing is **unverified**. The verification report's figures come from synthetic histories driven through the real domain layer; the database was never queried, and no production row counts, habit ages or opted-in user counts exist. Its payload figures are computed from an estimate, not measured.

During Step 4, measure realistic available DB volume and payload shape. If full-history reads are reasonable, use them.

**Stop rule.** If a material issue is observed, **stop before changing metric semantics** and report the measured problem and the options.

**Small-dataset rule.** Today's small or development dataset is not evidence that long-term scaling is solved. If current volume is too small to be representative, report the **shape** rather than an all-clear: rows per habit per day, habits per user, and the projected read at a plausible tester cohort.

---

# 9. Acceptance Gate correction **[Ruled]**

`docs/implementation-roadmap.md:66` currently reads:

> "Habit Health — does the new signal surface clearly in Habit Detail?"

This adds a Habit Detail UI requirement the authoritative specification does not support. The locked specification names exactly two surfaces for Habit Health — the coach (line 346) and reflections (line 352) — and never a screen; the roadmap states at line 262 that it "governs sequencing only".

**Corrected wording**, to be applied as part of Phase 5:

> "Habit Health: does the coach communicate the signal clearly, and only when the deterministic domain verdict supports it?"

**No Habit Health screen is added to Phase 5** merely to satisfy the old gate wording. The absence of a tester-facing Habit Health screen is a **product-validation limitation, not a Phase 5 correctness blocker**. Developer verification uses the Step 4 fact-inspection mechanism, within the limits §6.2 records.

Not yet applied. The roadmap is unmodified as of this draft.

---

# 10. Residual risk register

Named here so none is discovered by a tester.

| Risk | Status |
|---|---|
| A spelled-out behavioural duration ("you usually return in three days") is a Recovery Time claim a digit-keyed validator never inspects | Accepted. Prompt rule reduces likelihood only. |
| Non-numeric characterisations generally are outside numeric-membership validation | Accepted, per §D2 caveat 4. No semantic validator is built. |
| `CoachFacts` carries `no_positive_recent_comparison`, so "verbalise only on positive" rests on prompt plus validator rather than payload shape | **Explicitly accepted and ruled** (§14 item #7). An additional instance of the already-accepted non-numeric semantic risk, not a new exposure. Not to be recovered by a new mechanism. |
| Step 1 stubs assert an external API shape nothing verifies | Accepted. Bounded by minimality; surfaces at Deno runtime. **Containment rule, implemented and recorded in the guard's own comments as of Step 1:** narrowness (each stub is typed only for what its call site actually uses, never the SDK's full surface) and attribution (a widening must be justified by a real call site that needs it, never by an unrelated compiler complaint it happens to silence). No mechanism enforces this beyond code review; it is a rule for whoever next touches the stub, not a check that runs. |
| Step 4 fact inspection verifies transport, not domain arithmetic | By design. Domain correctness owned by Step 2 tests. |
| A tester cannot distinguish grounded coaching, deterministic fallback, and validator suppression from the Coach card, so "felt generic" is not attributable to a branch unaided | Mitigated for sampled users by §6.7's branch attribution, which separates all four faults using facts already returned. Not resolved for unsampled tester feedback. |
| Branch attribution reads facts at inspection time, not at generation time; a nudge caches ~20 h, so the facts may have moved since the impression complained about | Accepted. Closing it needs the branch persisted at generation time — more than a field already computed. |
| Branch attribution covers `ai-insights` only; the branch behind a push-delivered impression is not directly observable | Accepted. Closing it needs the same diagnostic in `send-coaching-push` — a mechanism extension. |
| **`buildCompletionIndex`** (`lib/domain/momentum.ts`, Step 2a) intentionally duplicates `isDoneOnDay`'s completion semantics for performance, rather than calling it — it is the performance mirror that must stay behaviourally aligned with that authority. **`isDoneOnDay` remains the behavioural authority for per-day completion semantics** — any change to it (reduced-completion handling, target semantics, day-boundary rules, or any other completion-semantic detail) requires review and, where necessary, a matching update to `buildCompletionIndex`. **`lib/domain/habit-health.ts` (Step 2 part 1) is a second, direct consumer of `isDoneOnDay`** — unlike `buildCompletionIndex`, it calls `isDoneOnDay` itself rather than mirroring it, so it carries no independent drift risk of its own, but it means a change to `isDoneOnDay`'s semantics now has two places to check: `buildCompletionIndex`'s mirror for continued alignment, and `habit-health.ts` for the direct behavioural consequence of the changed rule. **No dedicated mechanism currently detects divergence between `isDoneOnDay` and its mirror.** The domain and exhaustive Momentum tests may incidentally catch some future divergence, but they are not a synchronisation mechanism and must not be relied on as one. The index carries a comment at its definition naming `isDoneOnDay` as the authority it must track. Not a defect in either Step 2a or Step 2 part 1; not being closed by building a drift-detection mechanism. |
| Phase resonance: any block length can straddle phase for a habit whose rhythm is not a divisor of it | Known limitation of the mechanism, not tunable. |
| Habit Health false positive on a steady low-completion habit (~7.5% of days at 60% completion, measured) | Accepted cost of a stateless signal without a deadband. |
| Duplicated prompt text drift between the two functions | Detected by repository test plus `file` stamp, not prevented. |

---

# 11. Debt register (Class B)

- Exact generation-attempt counting for the rate limit would need a dedicated column; the sentinel row provides bounding, not precision.
- `docs/implementation-roadmap.md:161`'s Phase 8 prerequisite becomes false after Step 3 (§12).
- Habit Health has no in-app surface; adding one would be a specification amendment, not a Phase 5 gap.
- `send-coaching-push`'s serial recipient loop (§5).

---

# 12. Phase 5 completion criteria

Phase 5 is not closed until all of the following hold.

1. Steps 1 through 5 complete, with both functions pasted together and stamps verified after each of Steps 3, 4 and 5.
2. Step 1's guard passes on **both** Edge Functions.
3. Step 2a's semantic-equivalence gate passes: exhaustive Momentum tests and every locked §8 fixture unchanged.
4. The fact-inspection diagnostic **carries branch attribution** (§6.7) and is **retained through the Acceptance Gate**. Its removal is governed by the named condition in §6.7, not by this criterion. *(Amended from "removed in the Step 5 paste" — see §6.7 for why that was impossible, and for the record that this changes an approved decision.)*
5. The `ai_insights` cutover invalidation has been executed, having been approved beforehand.
6. `npx tsc --noEmit`, `npm run lint` and `npm test` all clean.
7. The Acceptance Gate wording at `docs/implementation-roadmap.md:66` is corrected (§9).
8. **Documentation reconciliation complete** (below).

## One obligation outlives Phase 5 **[Ruled]**

Phase 5 can close with the diagnostic branch still deployed — that is the point of §6.7's retention. The obligation does not lapse with the phase:

> **Phase 6 entry precondition: Phase 6 does not begin while the fact-inspection diagnostic branch is still deployed.**

Trigger, verification step and proof are in §6.7's "The removal condition, named". Proof is the live-versus-repository `file` stamp comparison on both functions, never a checked-in assertion that removal happened.

## Documentation reconciliation **[Ruled]**

Not a separate architecture phase — a completion criterion.

| Location | Claim that becomes false | Breaks at |
|---|---|---|
| `CLAUDE.md:146` — "Phase 5 constraint" | the block includes only `day-key.ts` and `habit-stats.ts`; neither function can access `momentum.ts` or `recovery.ts` | Step 3 |
| `CLAUDE.md:85` | "regenerates a whitelisted subset of `day-key.ts` + `habit-stats.ts`" | Step 3 |
| `CLAUDE.md:30` — copy-variation contract rule 4 | same whitelist claim, as a stated Phase 8 prerequisite | Step 3 |
| `docs/implementation-roadmap.md:161` — Phase 8 | same claim, as a stated prerequisite | Step 3 |
| `CLAUDE.md`, AI coaching section | `calendar*` usage, the 7/14/30-day windows, absence of output validation, the rate-limit description | Steps 4-5 |
| `lib/domain/habit-stats.ts` doc comments on both `calendar*` functions | "neither Edge Function fetches `habit_schedule_periods` today" | Step 4 |
| `scripts/build-edge-functions.js` header comment | same claim, plus the `SOURCES` rationale paragraph | Steps 3-4 |

**The Phase 8 line is a substantive consequence, not wording drift. [Ruled]** Phase 8's state-keyed notification copy is justified by the claim that the Edge Functions cannot reference `momentum.ts` or `recovery.ts`. After Step 3 that is false: `send-coaching-push` holds the whole behaviour engine, and the stated prerequisite dissolves. **Correcting the line authorises no Phase 8 work.**

---

# 13. Approval status of the five §13 items

Four of the five were answered by the rulings that accompanied this revision. They are recorded here with their consequence and their effect on already-settled decisions, and are no longer open questions.

| # | Item | Provenance | Status |
|---|---|---|---|
| 1 | Habit Health constants `L=14 / gate=10 / margin=0.25` | [Report] values, [New] L/gate reading | **Approved** — ruling 3 |
| 2 | A2 permits the margin | [New] argument, [Report] assessment | **Approved** — ruling 1 |
| 3 | Enum member names | [New] | **Approved with substitution** |
| 4 | Excluding the lifetime Scheduled Opportunity count | [New] | **Approved, conditional** — ruling 6 |
| 5 | Fallback as deterministic selection, no model call | [New] | **Approved** — ruling 5 |

## Effect on already-settled decisions

**Item 1 settles an ambiguity in architecture decision 1 rather than overriding it.** Decision 1 approves "equal-length" blocks; decision 2 gates on "the smaller of the two comparison blocks". Approving `gate = 10` adopts the reading in §4.1 under which decision 1 states the nominal design and decision 2 governs ramp-up. Nothing is amended; an ambiguity is closed in the only way that leaves both decisions with content.

**Item 1 also extends the approved architecture by one constant.** Decisions 1 and 2 named block length and the gate. The margin is a third. §4.1 argues this is calibration inside the architecture rather than an extension of it, since no margin-free version exists — but the constant count moves from two to three, and that is recorded rather than absorbed silently.

**Item 2 interprets A2; it does not amend it.** The tripwire remains intact and unweakened: any design in which the verdict enters at one value and exits at another, or in which yesterday's verdict is an input to today's, still requires state and still demands an amendment to `CLAUDE.md` brought back to the account owner. Nothing here licenses that.

**Item 4 goes one field further than the verification report proposed** and touches one of A3's ten named inputs. The compatibility check is in §4.2 and turns on A3's own distinction between inputs to the system and facts passed to the model.

**Item 5 adds scope no precondition contemplated.** No precondition discusses a fallback mode; it enters via your ruling. Consequence to note for tester interpretation: some Coach card impressions will be static, deterministically selected text rather than model output, and a tester cannot tell the difference from the card alone.

## Item 3 — resolved

Approved with one substitution: the middle member is `no_positive_recent_comparison`, not `no_positive_comparison`, because the mechanism is specifically a recent-versus-preceding comparison and the name must carry that. `no_recent_change` and `steady` were considered and rejected as overclaiming. Full reasoning, including what each rejected name would have asserted that the mechanism does not establish, is recorded with the enum in §4.1, along with the rule that no member name may appear in or shape user-facing copy.

**Effect on settled decisions: none.** Architecture decision 3 explicitly places member names in implementation design, and requires only that the three states stay distinct and that the value not expand into a broader taxonomy. Three flat members satisfy both.

**All five §13 items are now closed.**

---

# 14. Register of `[New]` positions

Every position in this plan that originated with the author rather than with your rulings or with the verification report, in document order. **Count correction:** an earlier report of "15" came from a raw marker count that included the convention definition at line 15 and counted §13's table rows, which are cross-references rather than distinct positions. There are **twelve distinct `[New]` positions**.

The **⚠** column marks positions that change, extend or narrow something already approved.

| # | § | Position | ⚠ |
|---|---|---|---|
| 1 | 3 | Nothing verifies the Step 1 SDK stubs against the real SDK; accepted residual limitation rather than a solved problem | |
| 2 | 4.1 | Architecture decisions 1 and 2 read together permit a short preceding block during ramp-up; the strict "equal-length" reading makes decision 2 vacuous | **⚠** |
| 3 | 4.1 | There is no margin-free version: every predicate carries a threshold, and "margin-free" is the margin at 1/14 | **⚠** |
| 4 | 4.1 | Enum member names `insufficient_evidence` / `no_positive_recent_comparison` / `positive_recent_comparison` *(proposed here; you substituted the middle member)* | |
| 5 | 4.2 | Excluding the lifetime Scheduled Opportunity count, one field beyond what the report proposed | **⚠** |
| 6 | 4.2 | Spec compatibility check: the exclusion does not breach A3's ten inputs, on A3's own input-versus-payload distinction | **⚠** |
| 7 | 4.2 | Carrying all three Habit Health states means "verbalise only on positive" rests on prompt plus validator, weaker than the structural omission it replaced — **raised here, explicitly accepted; see below** | **⚠ accepted** |
| 8 | 6.5 | Fallback as deterministic selection with no model call, rather than a second generation path | **⚠** |
| 9 | 6.5 | Fallback copy constraint: the topics are permitted but "protecting a streak" phrasing is prohibited by the variation contract | |
| 10 | 6.5 | A validator rejection is not a route into the fallback | |
| 11 | 6.6 | `lib/ai-coach.ts:16`'s truthiness guard is load-bearing and incidental; it must be pinned by a test | |
| 12 | 6.7 | The diagnostic cannot be removed in the Step 5 paste, and its removal point moves | **⚠** |

## What each flagged position moves

- **2** — settles an ambiguity in approved architecture decision 1. Does not amend it; closes it in the only way leaving both decisions with content.
- **3** — supports adding a third constant to a two-constant approved architecture. The constant count moves from two to three.
- **5, 6** — narrows `CoachFacts` past the report's proposal and touches one of A3's ten named inputs. Ratified by your ruling 6.
- **7** — **explicitly accepted and ruled.** See the trade-off record immediately below.
- **8** — adds scope no precondition contemplated. Ratified by your ruling 5.
- **12** — changes the basis on which you approved the branch, from removal at the Step 5 paste to removal under the named condition in §6.7. The most consequential of the twelve.

Positions 1, 4, 9, 10 and 11 change nothing already approved.

## Item #7, accepted — the recorded trade-off **[Ruled]**

Keeping all three Habit Health states in `CoachFacts` means the rule "Habit Health may be verbalised only when the verdict is `positive_recent_comparison`" (§6.3 rule 2) is **no longer enforced by payload absence.** It is instead enforced through:

- the deterministic three-state domain verdict;
- the closed `CoachFacts` payload;
- explicit prompt constraints;
- targeted tests;
- the existing output-validation boundary, to the extent that validation can mechanically cover the generated claim.

**This is weaker than omitting the field for non-positive states, and that is accepted.** It is a deliberate consequence of the ruling to preserve all three deterministic states in `CoachFacts` — architecture decision 3's distinction between *insufficient evidence* and *evidence without the positive signal* is worth more than the structural guarantee it costs — **not a newly discovered architecture defect.**

The residual risk is specifically **non-numeric semantic misuse of a non-positive Habit Health verdict**: a model that receives `no_positive_recent_comparison` verbalising it, in a form carrying no numeral for the validator to check. **That class of risk was already accepted for MVP when general semantic and entailment validation was deferred** (§D2 caveat 4, §6.4). It is not a new exposure; it is an additional instance of an exposure already on the register.

**Explicitly not to be recovered.** No projection layer, no second facts payload, no semantic validator, and no other mechanism may be introduced to restore the previous structural guarantee. If a future phase takes up general characterisation validation, this instance is covered by that work rather than by a bespoke fix here.

---

**Planning only. No Phase 5 code has been written. Sign-off on this plan is not authorisation to begin Step 1.**
