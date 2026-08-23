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

## C. Defects present today, independent of Phase 5

### C1. Both shipped prompts instruct the coach to lead with streaks

This is a live specification deviation, not merely something Phase 5 will rewrite.

- `ai-insights` nudge and `send-coaching-push` nudge: *"call out one specific strength (a streak or high consistency %)"*
- `ai-insights` monthly: *"summarize their strongest habit this month (with the % or streak)"*

Phase 3 demoted streaks to Habit Detail only, never Today or Progress. The AI coach is currently the one surface actively foregrounding them, in production, on every nudge.

### C2. The `calendar*` divergence, confirmed

Both functions call `calendarStreakForHabit` and `calendarConsistency` — the frozen, pre-schedule-aware behaviour — while every client call site uses the schedule-aware versions. This matches the Phase 4 closure's record exactly. One whitelist extension plus a `habit_schedule_periods` read resolves both.

### C3. CLAUDE.md drift, four items, all in the area Phase 5 touches

1. `send-coaching-push`, `lib/coach-push.ts`, the `push_tokens` table, and `supabase/coach_push_schema.sql` are **entirely undocumented**. `CLAUDE.md`'s AI coaching section describes only `ai-insights`.
2. The Notifications section states *"there is no backend, so this is not remote push."* The app has a cron-driven Expo Push path posting to `https://exp.host/--/api/v2/push/send` (`send-coaching-push/index.ts` lines 215-222). The claim is true of `lib/notifications.ts` and false as a blanket statement.
3. The AI coaching section says freshness caching *"is the only rate limiting / cost control."* There is also an explicit per-user limit of 10 Claude calls per 24 hours (`ai-insights/index.ts` lines 249-263).
4. The `npm test` description omits `__tests__/harness.test.ts` and the generator's import-safety guard tests.

Item 1 matters most: Phase 5 must rewrite prompts in **both** functions, and `CLAUDE.md` currently gives a reader no reason to know the second one exists.

---

## Summary

Nothing recorded here blocks Phase 5 permanently. Three decisions genuinely need making before a plan can be written (A1-A3). Four constraints should shape the plan rather than be discovered mid-build (B1-B4). C1 is a shipping specification deviation worth deciding on independently of whether Phase 5 is approved.

Phase 5 has not begun. This document does not authorize starting it.
