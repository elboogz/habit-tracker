# Phase 5 Precondition Review

**Recorded 2026-08-23. Analysis only — Phase 5 has not been approved and has not been started. No code was changed to produce this document.**

Scope: what must be decided, designed around, or corrected before a Phase 5 plan (AI Coach rewrite plus Habit Health) can be written. Conducted by reading `scripts/build-edge-functions.js`, both Edge Functions, the `lib/domain/` import graph, the Edge Functions' hand-maintained type shims, and the Jest suite directly, rather than from the descriptions in `docs/phase-4-completion-report.md`.

Findings are classified as **blocking decisions** (A), **design constraints** (B), and **defects present today** (C). C exists independently of whether Phase 5 is approved.

---

## A. Blocking — decisions needed before a Phase 5 plan can be written

### A1. The two Edge Functions have different feasibility profiles, and the Phase 4 closure treats them as one item

`docs/phase-4-completion-report.md`'s closure records one precondition item covering both functions: extend the generated-domain whitelist, or pass the required facts in as data. That framing holds for `supabase/functions/ai-insights/index.ts` but **not** for `supabase/functions/send-coaching-push/index.ts`.

`send-coaching-push` is triggered by Supabase Cron, authenticates with `CRON_SECRET`, builds a service-role client, and iterates every opted-in user (`index.ts` lines 254-272). There is no client in the loop to compute facts and pass them in. "Pass facts as data" therefore resolves at most half the problem: the push path requires the whitelist extension regardless of what the in-app path does.

Second-order property, worth stating explicitly rather than discovering later: facts computed client-side and posted to an RLS-scoped Edge Function are user-forgeable. For a personal habit tracker that means a user can only mislead their own coach, but it is an acceptance rather than a non-issue.

### A2. Habit Health collides with a settled architectural rule

Habit Health has no existence in the codebase — zero references outside the locked specification and the roadmap. The specification requires it as deterministic domain signals ("this habit may be too ambitious", "this habit may be scheduled at the wrong time").

`CLAUDE.md` states: *"Hysteresis exists in exactly one place — `computeConfirmedMomentumState`'s fold over `candidateStateAt`'s output — and nowhere else in the domain layer."*

A signal telling the user their habit is too ambitious, which then does not hold the next day, is worse than no signal. Phase 5 must rule, before design: either Habit Health is a single-pass stateless computation and accepts that volatility, or it receives stability treatment, which introduces a second hysteresis site and contradicts a rule the project currently records as settled. Per `CLAUDE.md`'s own instruction, that is a contradiction to report rather than resolve unilaterally.

**Required opening for A2, per the A3 decision below.** A2 must begin by restating, explicitly and as a stated input to its own reasoning rather than as background, that **A3 has already narrowed its evidence set**: habit-edit history and reminder-interaction history do not exist and are deferred, so Habit Health in the initial implementation cannot depend on either. This weakens the available evidence for two of the three illustrative signals without blocking the required concept. See "A3 consequence" below. The constraint is settled and is not to be re-litigated or rediscovered inside A2; what remains open to A2 is which signals ship, on what evidence, and whether the concept takes stability treatment.

*(This obligation was met: the A2 analysis opened by restating A3's narrowing before any reasoning, and the MVP scope below is a direct consequence of it.)*

### A2 decision, approved 2026-09-08: no exception to the single-hysteresis rule

**No exception is granted, and none is needed.** The contradiction recorded above is apparent, not real.

**1. It dissolves the way the `Rhythm` question did, and for the same documented reason.** `CLAUDE.md`'s confirmed-or-not boundary already contemplates volatile non-Momentum signals and rules that volatility does not earn them the fold: *"Any behavioural signal that does not pass through that fold ... is a single-pass stateless computation and is not a Momentum State, **regardless of how volatile it is or how it's surfaced**."* Habit Health sitting on the unconfirmed side is coherent **by the rule's own text, not by extension of it**. It is not a new case the boundary fails to cover.

**2. Volatility is a property of the horizon chosen, not of the concept.** This is the durable finding and is recorded so that anyone extending Habit Health later does not reintroduce the problem by reaching for a short window. **One event in a window of N moves the value by exactly 1/N.** That is arithmetic, not an empirical accident. Measured across 21 consecutive days of a realistic 150-day history, running the real domain functions with each day taken in turn as `today`:

| Input | Max movement per day | Days it moved |
|---|---|---|
| Lifetime completion rate (N ≈ 146) | 0.6 pp | 20/20 |
| Reduced-completion share | 0.1 pp | 1/20 |
| Average Recovery Time | 0.07 d | 6/20 |
| Consistency, 60-day | 1.7 pp | 10/20 |
| Recovery Rate, lifetime | 2.8 pp | 8/20 |
| Consistency, 14-day | 7.2 pp ( = 1/14) | 13/20 |
| Recovery Rate, rolling (N = 10) | 10.0 pp ( = 1/10) | 2/20 |
| Consistency, 7-day | 14.3 pp ( = 1/7) | 12/20 |
| **Trend direction, `momentum(…, 5)`** | **0.45 on a [-1,1] scale** | **17/20** |

Habit Health built on long-horizon aggregates is therefore an order of magnitude more stable than the same concept built on a short trailing window. For contrast, the confirmed Momentum State — which *does* pass through the fold — still changed twice within the same 21 days. The fold does not produce constancy; it requires evidence for transitions.

**3. Input stability does not imply signal stability. This is the finding most likely to be forgotten and is recorded prominently for that reason.** A threshold applied to a slow-moving input can still chatter if the value sits near it. Probing an arbitrary boundary against the measured lifetime completion rate — an input that never moved more than **0.6 percentage points** in a day — produced **seven on/off flips in 21 days**. Stability of an input is necessary and not sufficient; what matters additionally is where any boundary sits relative to the operating range.

**4. A stateless minimum-sample gate is an approved mechanism.** It is a pure function of the current data and introduces no state, so it does not engage the single-hysteresis rule. Precedent exists in shipped code: `RECOVERY_CONFIG.minResolvedLapsesForPercentage` (3) and `RECOVERY_CONFIG.minClosedLapsesForRecoveryTime` (2) both gate display until evidence suffices, and `CLAUDE.md` names `recoveryRate` and `averageRecoveryTime` as stateless single-pass computations while they carry those gates.

**5. Tripwire, recorded so it is not crossed inside an implementation.** A **deadband** — entering at one threshold and exiting at another — makes the output depend on the previous output and therefore requires state. That would be a **genuine exception** demanding an **amendment to `CLAUDE.md`'s "hysteresis exists in exactly one place", not a reinterpretation of it**. It is **not needed on the current evidence**. Should it ever appear necessary, that is a decision to bring back to the account owner, **not one to take inside an implementation**.

### Habit Health MVP scope, approved 2026-09-08: one signal

**Ship exactly one signal in the initial implementation:**

> "This habit has become easier or more established over recent weeks."

**That sentence identifies *which* signal is being shipped. It is not the copy that will ship.** It is the locked specification's own illustrative phrasing, and decision 7 of the architecture below records that it overclaims relative to what the approved mechanism establishes. Final user-facing wording is deferred and must be derived from the mechanism.

Shipping a subset is not a specification deviation: the locked specification marks its three named signals as *"Examples of signals the coach may communicate"* (line 346), one of the eight explicitly illustrative markers catalogued under A3 above. The **Habit Health concept itself remains required** and is being built; only its signal set is scoped.

**Reasoning: it is the only one of the three that depends on nothing A3 excluded.** The other two lean on evidence A3 deliberately made unavailable — "this habit may be too ambitious" on habit-edit history, and the wrong-time reading of "scheduled at the wrong time or on the wrong days" on reminder-interaction history. **Building either on substitute evidence now would be exactly the weaker-evidence substitution that A3's decision forbade.** They are deferred with their inputs, not rejected.

**Constraint on how this signal is computed, following directly from the measurements above: it must not be built on `momentum(…, window)`.** That was the most volatile quantity measured — moving on 17 of 20 days and swinging 0.45 on a two-wide scale — precisely because it is a small-window quantity. A long-horizon comparison must be used instead, drawing only on evidence genuinely available after A3.

**The 60-day window used during the A2 probe, and every other horizon exercised there, was diagnostic instrumentation and carries no product authority.** Horizon lengths, numerical thresholds and any anti-chatter margin belong to the Phase 5 implementation design, after the architecture below is approved.

### Habit Health architecture, approved 2026-09-08

Approving the architecture only. **Block lengths, numerical thresholds, `CONFIG` values, enum member names and final user-facing wording are all deferred to Phase 5 implementation design and are not decided here.**

**1. Long-horizon comparison — approved.** Two adjacent, **equal-length** blocks of Scheduled Opportunities, comparing the recent block's completion rate against the immediately preceding block's. Block length is not decided here.

**Scheduled Opportunities are preserved as the denominator** so that non-daily schedules and pauses behave correctly: a paused stretch contributes no opportunities rather than a run of false misses, which a calendar-day denominator would produce.

Recorded so the shape is not mistaken for the thing A2 ruled against: this is `momentum()`'s *form* at a corrected horizon. The A2 constraint was against the small-N function, not against differencing two windows. With both denominators large, the difference moves at roughly 2/N per day rather than the 0.45-per-day swing measured at N=5.

**2. Minimum-sample architecture — approved.** Gate on the **Scheduled Opportunity count in the smaller of the two comparison blocks**, since the comparison is only as strong as its weaker side.

**Neither existing Recovery gate may be reused: they carry different denominators.** `minResolvedLapsesForPercentage` counts resolved pairwise lapse instances and `minClosedLapsesForRecoveryTime` counts closed lapses — both lapse-denominated, where this gate is opportunity-denominated. The codebase already exercised exactly this care once: `lib/domain/config.ts` records that the value 3 "was deliberately not reused" when the second gate was introduced.

**A distinct Habit Health `CONFIG` value will therefore be required**, in `lib/domain/config.ts` by convention. Its numerical value is not chosen here.

**3. Closed Habit Health value — approved.** A closed string-literal enum, one flat scalar per habit, **not a boolean** — because *insufficient evidence* must remain distinct from *evidence that does not support the positive signal*. Collapsing them would push that distinction into the presentation layer to re-derive, which is the `isNew` gating defect already removed once in Phase 4.

**Constraint: do not expand this into a broader Habit Health taxonomy.** The MVP contains one signal, so the closed value need only represent the distinctions that signal genuinely requires. Member names belong to implementation design.

**4. Supporting comparison rates are excluded from `CoachFacts` for the initial implementation — approved.** The deterministic domain layer owns the inference. `CoachFacts` transports the resulting verdict, not the underlying percentages, and so does not invite the model to re-derive the verdict from them.

**The accepted cost, recorded so it is not re-opened by accident:** this forgoes the validator coverage those numerals would have carried, since a number absent from `CoachFacts` is not in the enumerable set. That is a deliberate trade of validator surface for architectural clarity, not an oversight. If a later product decision gives the coach a genuine user-facing reason to quote those rates, their inclusion can be reconsidered then.

**5. No general semantic or characterisation validator — approved as a non-precondition for Phase 5.**

The limitation, recorded accurately: **numeric-membership validation cannot independently verify a non-numeric Habit Health characterisation.** The MVP signal contains no numeral, so the validator described in §D2 gives it no coverage.

**For the MVP, truthfulness is enforced structurally rather than by output inspection:** the deterministic domain layer derives the Habit Health verdict; `CoachFacts` transports that closed verdict; the coach may verbalise it but **may not independently infer Habit Health from underlying behavioural data**.

Prompt constraints and tests should prevent the coach from **inventing a Habit Health claim when the corresponding verdict is absent**, and from **extending the verdict into unsupported causal, predictive or exaggerated claims**. **Do not attempt to solve general natural-language entailment.** A general semantic validator is explicitly not a Phase 5 precondition and must not become one.

**6. The semantic qualification is preserved.** The approved comparison **directly establishes an improvement in completion rate** across Scheduled Opportunities between two adjacent blocks. It does **not** by itself establish that the habit subjectively feels *easier*, nor necessarily that it has become *established* in the broader sense of increased stability or fewer lapses.

The architecture is **not** to be redesigned around that wording. The distinction is recorded so that eventual user-facing copy is constrained to what the deterministic signal actually establishes.

**7. The specification's own phrasing of this signal is illustrative, and overclaims relative to the approved mechanism.** "This habit has become easier or more established over recent weeks" is one of the specification's explicitly illustrative examples (line 346, among the eight illustrative markers catalogued under A3). Measured against decision 6, it asserts subjective ease and broad establishment where the mechanism establishes a completion-rate improvement between two adjacent long-horizon blocks.

**The eventual user-facing wording must therefore be derived from the mechanism, not copied from the specification's example sentence.** Copying it would ship a claim the domain layer cannot support, and would land precisely in the space decision 5 identifies as unverifiable — a non-numeric characterisation whose intensity nothing mechanical bounds. The wording is additionally bound by `CLAUDE.md`'s user-facing copy contract. Final wording is deferred to implementation design.

### A3. Two of the specification's ten named coach inputs are not derivable from stored data

| Specification input | Status |
|---|---|
| Recovery history, momentum, consistency, total completions, recovery time, scheduled opportunities | Derivable — `lib/domain/` already computes all of these |
| Lapse reasons | Stored since Phase 4, read by nothing except `lapseReasonSuppressionUntil` |
| Repeated drop-off patterns | Derivable from `recoverableLapseInstances` / `closedLapses` |
| **Habit difficulty and edits** | **Not derivable.** `Habit.updatedAt` is a scalar last-write-wins timestamp (`lib/habit-types.ts` line 20). No edit history exists, so "the user has lowered this target twice" is unanswerable. |
| **Reminder usage** | **Not derivable.** `Habit.reminderTimes` is configuration only. Nothing records delivery, dismissal, or action. |

### A3 specification status, established by audit before deciding

**The ten inputs are requirements, not an illustrative set.** The locked specification marks illustrative lists explicitly and does so consistently — eight times, at lines 109 (`Examples:`), 157 (`Example states:`), 227 (`Example messages:`), 255 (`...such as:`), 272 (`For example:`), 346 (`Examples of signals the coach may communicate:`), 405 and 442 (`Examples:`). The Phase 5 input list carries no such marker; its lead-in is the bare imperative **"Use as inputs:"**.

There is also in-document precedent for how an unmarked list is read. Phase 2's Scheduled Opportunity list contains its own correction: *"Streak was omitted from this list in error when it was first written. The principle above is unqualified..."* That is the specification treating an unmarked list as normative and repairing an omission, rather than reading the list as loose.

`docs/implementation-roadmap.md`'s Phase 5 parenthetical names only five inputs, omitting these two among others. That is **not** a narrowing: the same document states that "The locked product specification (`docs/habit-tracker-evolution-plan.md`) remains the authority on what each phase builds. This roadmap governs sequencing only."

**A distinction that materially narrows what is being decided.** The specification separates *inputs to the coaching system* from *facts passed to the model*. Its Deterministic Architecture section enumerates the latter: "consistency, momentum, Momentum State, recovery events, recovery rate, lapse patterns, habit health signals, behavioural trend direction". Habit edits and reminder usage are **absent** from that enumeration; habit health signals are present. Neither excluded input was ever required to appear in the payload, so excluding them from `CoachFacts` is specification-compatible on its own terms and is not the substance of this decision.

### A3 decision, approved 2026-09-08: deferred, not removed

**Habit edit history and reminder usage remain requirements of the locked product specification. They are deferred from the initial Phase 5 implementation. This is a sequencing decision, not removal of either capability from the specification.** The locked specification is not amended, and must not be.

**Reason for deferral: the current data model cannot represent either concept truthfully.**

- **`Habit.updatedAt` must not be used or described as edit history.** It is a scalar last-write-wins timestamp (`lib/habit-types.ts` line 20) that records only *that* something changed, with no indication of *what*. A renamed emoji is indistinguishable from a lowered target.
- **`Habit.reminderTimes` must not be treated as reminder usage.** It is configuration. Nothing anywhere records delivery, dismissal, or action.

**These are not weak proxies for the concepts. They are raw fields that do not represent them at all.** Neither may be inferred or approximated from existing fields. The failure mode is specific: approximating edit history from `updatedAt` yields an invented **characterisation** rather than an invented **statistic**, which numeric-membership validation does not catch (§D2, caveat 4).

**Neither raw habit edit history nor raw reminder usage may appear in `CoachFacts` in the initial implementation.** This is compatible with the deterministic architecture rather than a departure from it: the model should receive deterministic behavioural facts and signals, not be handed fields that do not carry the concept and asked to infer it. Because the enumerable set is the leaf fields of `CoachFacts` (§D2), the exclusion holds structurally rather than by instruction.

**Future support requires explicit event capture and schema design. That is not designed here, and must not be designed as part of recording this decision.**

### A3 consequence: this narrows A2's initial evidence set

**Recorded explicitly because it must not be rediscovered later as though it were new.** Habit Health in the initial implementation cannot depend on habit-edit history or reminder-interaction history, because neither exists.

The exclusion **weakens the available evidence for two of the three illustrative Habit Health signals**: "this habit may be too ambitious", whose most direct evidence is repeated target lowering, and the reminder-related reading of "this habit may be scheduled at the wrong time or on the wrong days". It **does not block the required Habit Health concept**, which the specification requires as deterministic domain signals while marking its three named signals as examples (line 346, one of the eight illustrative markers above).

**What is deliberately not decided here:** no weaker evidence is substituted for either signal, and no ruling is made on which Habit Health signals should ship. Both belong to A2.

**A2 must open by restating this narrowing explicitly, as a stated input to its own reasoning rather than as background.** A3 was decidable on its own terms — its reasoning about `updatedAt` holds whatever A2 concludes — but it is not independent of A2 in consequence: it fixes part of the evidence available to Habit Health before Habit Health is defined. A2 is therefore to be taken up in explicit knowledge of that constraint, not to encounter it midway.

---

## B. Design constraints — these bind the plan but do not block it

### B1. Extending the whitelist has a silent failure mode

`scripts/build-edge-functions.js` uses a name whitelist with **no dependency resolution**. `extractDeclarations` throws only for names it cannot *find* (lines 116-119); it never detects an identifier the extracted code *references* but which was not itself whitelisted.

Reaching `momentum.ts` means hand-enumerating its transitive closure across `config.ts`, `schedule.ts`, `recovery.ts`, `habit-stats.ts`, and `day-key.ts`, including non-exported helpers: `recordsUpTo`, `lastN`, `isPending`, `resolvedView`, `completionRate`, `meetsRateWindow`, `meetsBuilding`, `isCurrentlyQuiet`, `isRebuilding`, `isRecentShortRecovery`, plus the `OpportunityRecord` type.

Miss one and the failure is silent through every existing gate: the generator succeeds; the freshness test in `scripts/build-edge-functions.test.ts` passes (it only diffs regenerated output against committed output); `tsc` skips the file (`@ts-nocheck`); Jest never imports it. It fails at Deno runtime, after the file has been hand-pasted into the Supabase Dashboard.

Related: the Edge Functions' local type shims are hand-maintained and outside the generator's reach. `type Habit = { id, type, targetCount? }` (`ai-insights/index.ts` line 165) has no `createdAt`, which `isScheduledOpportunity` requires; `HabitSchedulePeriod`, `ScheduleDays`, and `LapseReasonEntry` do not exist there at all. These types live in `lib/habit-types.ts`, outside the generator's `DOMAIN_DIR`, so the generator itself would need changing. This is the same fragility recorded as Phase 4's deviation 1.

See also B6, which is a related but distinct risk: B1 is about the generated block being **internally incomplete**, B6 is about the deployed file being **wholesale stale** relative to the repo. Neither detects the other.

### B2. The database reads must change under either route

Both functions fetch `habits` without `created_at`, and `habit_logs` filtered to a 7/14/30-day window (`ai-insights/index.ts` lines 269-272). `confirmedStateAt` walks from habit creation; `recoveryRate`'s lifetime horizon needs the full log history. Neither function reads `habit_schedule_periods` or `lapse_reasons` at all. The payload size of a lifetime log fetch should be sized before committing to the whitelist route.

### B3. Output validation has no testable home today

The specification requires rejecting responses containing statistics not present in the input. Only `sanitizeContent` exists, covering em dashes and emoji.

The Edge Functions are `@ts-nocheck` Deno files, not imported by any test and not runnable under `jest-expo` (npm: specifiers, `Deno` globals). A validator written inside them is untestable, while Phase 9 explicitly requires "Coaching output validation (rejecting invented statistics)" tests. The validator should therefore be a pure function under `lib/domain/`, tested by Jest, and inlined via the generator. That is a decision to settle before the plan, not after.

Also unspecified: what the user sees when validation rejects a response. `lib/ai-coach.ts` returns `null` on failure and the Progress screen renders nothing — a defensible default, but it should be a stated decision rather than inherited behaviour.

### B4. Structured outputs would be the natural mechanism, and may force a model change

Passing pre-computed facts and constraining the response maps directly onto the Claude API's `output_config.format` with a JSON schema. Per the current API reference, structured outputs are supported on Fable 5, Opus 5, Opus 4.8, Sonnet 5, and Haiku 4.5. `claude-sonnet-4-6`, which both Edge Functions currently use, is not on that list. Verify against live documentation before designing around it; if it is needed, the model changes.

### B5. Model choice is a Phase 5 decision, not a default

Both functions call `claude-sonnet-4-6` with `output_config: { effort }`. That parameter is generally available and correctly used, so nothing is broken today. But Sonnet 4.6 is previous-generation; Sonnet 5 and Opus 5 are current. If the model moves, the prompts need re-baselining rather than porting: newer models follow instructions more literally, so both the existing emphasis and the `sanitizeContent` safety net should be re-tested rather than assumed to carry over.

---

### B6. Deployment drift: the deployed Edge Functions can silently fall behind the repo, and nothing surfaces it

**Observed 2026-09-08, while preparing the C1 paste.** The versions actually running in the Supabase Dashboard had drifted several weeks behind the repository. They predated both `0850806` (schedule-aware Consistency) and `333884c` (schedule-aware streak), placing the deployed files at `100e518` or `76b4235` — that is, at Phase 4 commit 2, the last paste the completion report records as confirmed. Four commits had landed in those files since, and none of them had reached production.

**In this instance the consequence was benign, but only by luck of what happened to have changed.** Verified rather than assumed: normalising the two renames away and diffing the generated-block code between `100e518` and `HEAD` produces identical output, every function body unchanged. The `calendar*` change was a rename, so the deployed `streakForHabit`/`consistency` had byte-identical bodies to the repo's `calendarStreakForHabit`/`calendarConsistency`. The deployed functions were computing exactly what the repo intended them to compute. Of the four undeployed commits only one, `139638b` (the C1 fix), changed behaviour at all. Nothing about the process guaranteed that; a different set of commits would have produced a real divergence just as silently.

**Nothing in the project can detect this, and the existing safeguard structurally cannot.** The freshness check in `scripts/build-edge-functions.test.ts` regenerates the block from `lib/domain/` and diffs it against the committed file — it compares **the repository against itself**. It is a guard against a developer editing the generated block by hand or forgetting to regenerate, and it is sound for that. It has no knowledge of the Dashboard and cannot acquire any. Beyond it there is no CI, no deploy step, no version stamp in either file, and nothing recording which commit the running copy came from. The only way to establish what is deployed is to read the Dashboard by eye and match strings against git history, which is how the drift was found.

**Relationship to B1, stated precisely because the two are easy to conflate.** B1 is the generated block being *internally incomplete*: a whitelisted function references a dependency that was not itself whitelisted, so the file is wrong in the repo and fails at Deno runtime once pasted. B6 is the deployed file being *wholesale stale*: the file is entirely correct in the repo, and something older is running. They are different failure classes and **neither guard catches the other** — B1's proposed type-check guard validates the repository's copy, which says nothing about what is executing in production, and any deployment-freshness mechanism would say nothing about whether the file it is tracking is internally coherent.

**Why this matters more during Phase 5 than it did here.** The accepted sequence (§D4) changes both functions substantially: extended whitelist, new database reads, `buildCoachFacts`, and the output validator. Two specific hazards follow.

- A stale deploy during that sequence stops being benign. A Dashboard copy running old database reads against new fact-building code would not merely quote different numbers; it would build facts from a narrower window and the validator would faithfully certify them, because the validator checks the model's output against the facts object it was given, not against reality.
- **A partial paste reintroduces the exact problem §D1 exists to prevent.** The two functions share the `ai_insights` nudge cache in both directions. Pasting one and not the other leaves one producer grounded in new facts and the other in old, both writing into the same cache under `kind: 'nudge'` — nondeterministic provenance for a single user-visible artifact, arrived at temporally rather than architecturally. §D1 rules out deriving the facts differently per function; nothing currently rules out deploying them at different times, which has the same effect for as long as the skew lasts.

### B6 decision, approved 2026-09-08: a generated version stamp

**Adopted: a generated version stamp in both Edge Functions.** Implemented as a standalone pre-Phase-5 change; the mechanism is documented in `CLAUDE.md` under "Deployment stamp".

**Why the stale-pair case is decisive.** Two failure modes exist: a *mismatched pair* (the two functions live at different revisions, recreating §D1's provenance problem temporally through the shared `ai_insights` cache) and a *stale pair* (both at the same revision, both behind the repository). **Only the second has actually occurred here** — four commits behind, several weeks, undetected. During that incident the two functions *were* consistent with each other, so any mechanism guaranteeing only pairwise consistency would have solved the failure we have not had while missing the one we have. Detection of staleness against the repository is therefore the primary requirement, and it is what selected this option.

**Why the stamp must be generated.** A hand-maintained version value drifts from the content it claims to describe the first time someone edits a prompt and forgets to update it — reintroducing precisely the coupled-manual-acts failure that sinks Option 3. The generator owns the value; a human seeds the line once and never edits it again, and the test suite fails if a committed stamp does not match a freshly computed one.

**Why a content fingerprint rather than a git SHA.** A `HEAD` SHA changes on every commit, including commits that touch neither the Edge Functions nor `lib/domain/`. That would make regeneration non-idempotent and cause the existing regenerate-and-diff freshness test to fail after unrelated work. The stamp line is blanked before hashing so a file's stamp never feeds its own fingerprint, which makes the values stable exactly when the deployment-relevant content is stable.

**Why fingerprint the whole file and not just the generated block.** A block-only fingerprint would not have detected the C1 deploy: that change touched only prompts and payloads, and the generated block was byte-identical (verified during that pass). It would have reported "current" while the fix sat undeployed. Hence two values — `block` for cross-function comparison, `file` for repository comparison.

**Why Option 3 was rejected.** A checked-in deployment record is an assertion about deployment state rather than an observation of it, and it can be confidently wrong in the dangerous direction. **This project has already run that experiment informally and it already failed:** `docs/phase-4-completion-report.md` records at Phase 4 commit 2 that both functions were "already re-pasted and deployed ... confirmed during commit 2". Four commits then landed in those files and nothing updated it. The record was true when written and went stale silently, which is the same shape as the drift it was meant to catch.

**Why Supabase CLI deployment is deferred rather than rejected.** It is the preferred longer-term direction and prevents the mismatched-pair case by construction. It is deferred because it does not answer the current detection question — after deploying at a given revision, nothing later reports what is live (`functions list` gives a timestamp, not a revision) — and because it is the only option that is deployment infrastructure, with real setup cost and unverified interactions here: no `config.toml` or project linkage exists today, and these files were built around hand-pasting with `npm:` specifiers and `@ts-nocheck`. Adopt it when deploy cadence justifies the setup.

**What B6 blocks.** **Not Phase 5 implementation — the first substantive Edge Function deployment.** §D4's first two steps (the type-check guard, then `buildCoachFacts` and the validator) are repository-only and deploy nothing, so they can proceed in parallel. Step 3, the whitelist extension, is the first paste and must not happen until the stamp is deployed and verified.

The reason is the same attribution property that puts the type-check guard before the whitelist extension, against a sharper confusion: **B1 and B6 are confusable at exactly the same moment.** When the extended whitelist is first pasted and something fails, "the extension is internally incomplete" and "a stale file was pasted" are indistinguishable without a stamp. Because the stamp is itself a change to both functions, **it must be deployed and verified on its own first**, establishing the known-good baseline — deploying it alongside the whitelist extension would forfeit the very baseline that is the point of doing it first.

### Original framing, superseded by the decision above

**Not decided here.** Whether Phase 5 should address deployment drift, and by what mechanism, is a decision for the plan. Options worth weighing when it is written, none of them chosen: a commit stamp embedded in each function and echoed in its response or logs, so the running version is observable; replacing the hand-paste with a CLI deploy; or a checked-in record of the last-pasted commit per function, which is the cheapest and the weakest since nothing enforces that it is updated. The observation is recorded as a risk; the response belongs in the plan.

---

## C. Defects present today, independent of Phase 5

### C1. Both shipped prompts instruct the coach to lead with streaks

This is a live specification deviation, not merely something Phase 5 will rewrite.

- `ai-insights` nudge and `send-coaching-push` nudge: *"call out one specific strength (a streak or high consistency %)"*
- `ai-insights` monthly: *"summarize their strongest habit this month (with the % or streak)"*

Phase 3 demoted streaks to Habit Detail only, never Today or Progress. The AI coach was the one surface actively foregrounding them, in production, on every nudge.

**Resolved.** Fixed in `139638b` (prompt strings edited minimally, and `streakDays` dropped from both payloads, since a model shown a statistic will cite it whatever the instruction says), and **deployed 2026-09-08** once both functions were re-pasted. See `docs/phase-4-completion-report.md`'s post-closure entry for the full account, including why no richer instruction was written in its place.

### C2. The `calendar*` divergence, confirmed — and since strengthened by the C1 fix

Both functions call `calendarStreakForHabit` and `calendarConsistency` — the frozen, pre-schedule-aware behaviour — while every client call site uses the schedule-aware versions. This matches the Phase 4 closure's record exactly. One whitelist extension plus a `habit_schedule_periods` read resolves both.

**Still open, and now more exposed.** The C1 fix removed `streakDays` from both payloads, so `calendarConsistency` is the coach's only cited statistic. For any habit with a non-daily schedule or a pause, the coach quotes a percentage that disagrees with the one Progress shows for that same habit. The divergence predates the fix and was not introduced by it, but it was previously one of two numbers and is now the only one, which argues for the whitelist extension being early in the §D4 sequence rather than late.

### C3. CLAUDE.md drift, four items, all in the area Phase 5 touches — resolved in `a442a03`

1. `send-coaching-push`, `lib/coach-push.ts`, the `push_tokens` table, and `supabase/coach_push_schema.sql` are **entirely undocumented**. `CLAUDE.md`'s AI coaching section describes only `ai-insights`.
2. The Notifications section states *"there is no backend, so this is not remote push."* The app has a cron-driven Expo Push path posting to `https://exp.host/--/api/v2/push/send` (`send-coaching-push/index.ts` lines 215-222). The claim is true of `lib/notifications.ts` and false as a blanket statement.
3. The AI coaching section says freshness caching *"is the only rate limiting / cost control."* There is also an explicit per-user limit of 10 Claude calls per 24 hours (`ai-insights/index.ts` lines 249-263).
4. The `npm test` description omits `__tests__/harness.test.ts` and the generator's import-safety guard tests.

Item 1 matters most: Phase 5 must rewrite prompts in **both** functions, and `CLAUDE.md` currently gives a reader no reason to know the second one exists.

---

## Summary

Nothing recorded here blocks Phase 5 permanently. **All three decisions needed before a plan can be written are now made**: A1 (mechanism — whitelist extension for both functions, §D1), A3 (habit edits and reminder usage deferred, not removed), and A2 (no exception to the single-hysteresis rule, plus a one-signal Habit Health MVP). The Habit Health architecture those decisions gated is **also approved** (see "Habit Health architecture"). What remains is Phase 5 implementation design, which is deliberately un-started: block lengths, the Habit Health `CONFIG` value, enum member names, and final user-facing wording derived from the mechanism rather than from the specification's illustrative sentence. Six constraints should shape the plan rather than be discovered mid-build (B1-B6). The C-items were defects rather than design questions and have been handled separately: C1 fixed and deployed 2026-09-08, C3 fixed in `a442a03`, C2 still open and now more exposed than when it was recorded.

Phase 5 has not begun. This document does not authorize starting it.

---

# D. Mechanism decisions

**Follow-up analysis, 2026-08-24. All three conclusions below are accepted. Still analysis only — Phase 5 has not been started.**

A1 changes the shape of the mechanism question. Because `send-coaching-push` is cron-triggered with no client in the loop, "pass the facts in as data" cannot serve it, so the whitelist extension is required for that path regardless of what the in-app path does. That makes three questions live: whether the data route retains any purpose for `ai-insights`, how output validation gets its enumerable set if the functions compute their own facts, and what would make the whitelist extension safe enough to rely on given B1.

## D1. One mechanism for both functions, not two

**The `ai_insights` nudge cache is shared between the two functions, and that is decisive on its own.**

`send-coaching-push` checks `ai_insights` for a nudge created within `NUDGE_FRESHNESS_HOURS` (20) and reuses that row's content rather than generating (`index.ts` lines 281-292). When it does generate, it inserts a row with `kind: 'nudge'` (lines 297-306). `ai-insights` reads and writes the same rows under the same 20-hour window.

The nudge is therefore **one artifact with two producers**. A cron-generated nudge is served to the in-app Coach card for up to 20 hours, and an in-app-generated nudge is sent as the push. If the two producers ground on facts derived by different mechanisms, the single nudge a user sees on a given day has nondeterministic provenance: derived one way or the other depending on which producer ran first. Any validation would have checked it against whichever facts object that producer happened to hold. This is a correctness problem rather than an inelegance, and it is invisible in testing because each path looks correct in isolation.

Code reuse is the secondary argument: once the block is inlined it is spliced identically into both files by the same `buildGeneratedBlock()`, so `ai-insights` gains the capability whether it uses it or not.

Two genuine advantages of the data route were considered and rejected:

- *The client's local-first state can be newer than Postgres.* A just-logged completion may not have flushed, so server-computed facts could miss it. Rejected: the nudge caches for roughly 20 hours, so lagging the most recent log by minutes is immaterial at that cadence, and the Phase 4 current-day fix already makes today's unlogged opportunity read as pending rather than as a miss, which is precisely the failure this would otherwise produce.
- *It avoids widening `ai-insights`' database reads.* Rejected as a false saving: the read widening is required for `send-coaching-push` regardless, so the work happens once either way, and reusing it costs less in total than maintaining two paths.

**Decision: extend the whitelist for both functions. The data route is dropped.**

## D2. `buildCoachFacts` gives the enumerable set without the round trip

The property output validation needs was never "the payload came from the client". It is that **at validation time there exists a known, finite, enumerable set of numbers the model was permitted to state**. What guarantees that is a single pure producer with a declared return type. The transport is irrelevant to it.

With `buildCoachFacts(habits, logs, schedulePeriods, lapseReasons, today): CoachFacts` as the only producer:

- `CoachFacts` is a closed type, so the enumerable set is its leaf numeric fields: mechanically derivable, and pinnable by a test.
- `validateCoachOutput(text, facts)` receives the same object.
- Construction, generation, and validation happen in one process, one scope, one moment. There is no serialization boundary between building the facts and checking the output against them.

This is **stronger** than the client round trip on that last point, not merely equivalent: across a round trip the payload is JSON-parsed at the boundary, and nothing enforces at runtime that the received shape still matches `CoachFacts` without adding a schema check, which would be a validator written to protect the validator.

`buildCoachFacts` in `lib/domain/`, inlined into both functions, also means the client, `ai-insights`, and `send-coaching-push` produce byte-identical facts from identical inputs. That is the existing single-source-of-truth rule applied one level up from the individual metrics. Placing `validateCoachOutput` alongside it resolves B3 as a side effect: both are pure and Jest-testable before being inlined.

### Four caveats on enumerability

These are the actual design work, and belong in the Phase 5 plan rather than being met during implementation.

1. **Numeric normalization.** A rate of `0.6` may legitimately render as "60%", "60", or "0.6"; a count of `12` may render as "twelve". Membership checking needs an expansion and normalization step, not string equality against the raw values.
2. **Legitimately non-fact numerals.** Dates, durations ("3 days"), ordinals, and "the first week" are valid output containing numbers that are not in the facts object. Without an allowlist policy the validator rejects valid responses.
3. **Keep `CoachFacts` flat and numeric-leaved.** Enumerability degrades if the type carries free-form strings or unbounded nested structures. Per-habit arrays are acceptable provided each element's shape is fixed.
4. **The mechanism catches invented statistics, not invented characterizations.** "You have recovered more than half the time", derived from a rate of `0.6`, contains no numeral to check. This is the honest limit of numeric-membership validation. **It must be stated in the Phase 5 plan rather than discovered by a tester.** If characterization accuracy needs enforcing, that is separate work with a different mechanism, and it should be scoped explicitly or ruled out explicitly.

## D3. Making the whitelist extension safe: type-check the generated Edge Function

Three candidates were considered against B1's silent failure mode.

- **A dependency resolver in the generator.** Requires real scope analysis (locals, parameters, destructuring, shadowing) to avoid false positives. A regex approach is fragile, and a proper parser is a new dependency, which the locked specification's global constraints discourage. Disproportionate to the problem.
- **A test that imports the generated output.** Not possible. The Edge Functions use `npm:` specifiers, `Deno.serve`, and `@ts-nocheck`; an import fails under `jest-expo` for reasons unrelated to the whitelist, so a failure would carry no signal.
- **Type-checking the generated Edge Function.** The smallest change that works. A referenced-but-unextracted identifier is exactly `TS2304: Cannot find name 'X'`. No parser, no scope analysis, no Deno runtime, no new dependency.

Concretely: extend `scripts/build-edge-functions.test.ts`, which already shells out via `execFileSync`. Per target file, write a checkable copy to a temporary path (strip the `@ts-nocheck` line, replace the two `npm:` imports with local `any` stubs, prepend `declare const Deno: any`), run `npx tsc --noEmit --strict` against it, and assert exit 0.

**Check the whole file, not only the block between the markers.** The block alone references `Habit` and `HabitLog`, which are declared outside it; supplying those types from `lib/habit-types.ts` to make a block-only check pass would hide exactly the drift that matters. Checking the whole file catches both failure classes: the missing-dependency class B1 describes, and the stale-shim class (the `Habit` shim lacking `createdAt` when `isScheduledOpportunity` requires it) that produced Phase 4's deviation 1. A block-only check is the cheaper fallback if the full-file check proves noisy in practice.

What it does not catch is runtime semantics. Declaration ordering is not a genuine risk here, since module-level `const`s evaluate before any `Deno.serve` handler runs, but well-typed-and-wrong logic still needs the domain tests, which is where that belongs.

**Sequencing: build the guard before extending the whitelist, not after.** It should pass against the current `day-key.ts` + `habit-stats.ts` block first, so that a failure on the first extension is unambiguously attributable to the extension.

## D4. Accepted approach and ordering

1. **Single mechanism for both functions: extend the whitelist.** The shared nudge cache makes per-function mechanisms actively harmful.
2. **`buildCoachFacts` and `CoachFacts` in `lib/domain/`, with `validateCoachOutput` alongside**, both inlined by the generator.
3. **Build the type-check guard first.** It is a precondition to (1), not a follow-up to it.

Should Phase 5 be approved, the implementation order is: guard, then `buildCoachFacts` and the validator as pure tested functions, then the whitelist extension, then the database read widening, then the prompt rewrite. Each step is verifiable before the next depends on it, and the first three touch nothing user-facing.

This resolves the mechanism question only. **A2 (Habit Health and the single-hysteresis rule) and A3 (the two non-derivable coach inputs) remain open product decisions**, and C1 (the streak-leading prompts) is being handled separately. Phase 5 has still not begun, and nothing above authorizes starting it.
