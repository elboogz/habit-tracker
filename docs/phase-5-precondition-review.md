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

### A3. Two of the specification's ten named coach inputs are not derivable from stored data

| Specification input | Status |
|---|---|
| Recovery history, momentum, consistency, total completions, recovery time, scheduled opportunities | Derivable — `lib/domain/` already computes all of these |
| Lapse reasons | Stored since Phase 4, read by nothing except `lapseReasonSuppressionUntil` |
| Repeated drop-off patterns | Derivable from `recoverableLapseInstances` / `closedLapses` |
| **Habit difficulty and edits** | **Not derivable.** `Habit.updatedAt` is a scalar last-write-wins timestamp (`lib/habit-types.ts` line 20). No edit history exists, so "the user has lowered this target twice" is unanswerable. |
| **Reminder usage** | **Not derivable.** `Habit.reminderTimes` is configuration only. Nothing records delivery, dismissal, or action. |

Decision needed: capture them (additive schema, and the locked specification's global constraints require documenting any migration before running it), or scope them out of Phase 5 explicitly.

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

Nothing recorded here blocks Phase 5 permanently. Three decisions genuinely need making before a plan can be written (A1-A3). Six constraints should shape the plan rather than be discovered mid-build (B1-B6). The C-items were defects rather than design questions and have been handled separately: C1 fixed and deployed 2026-09-08, C3 fixed in `a442a03`, C2 still open and now more exposed than when it was recorded.

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
