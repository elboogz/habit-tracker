# Phase 3 Completion Report — Recovery-First Experience Layer

Phase 3 is complete, following the approved commit sequence in the Phase 3 implementation instruction and `docs/phase-3-experience-plan.md` (including its three amendments: the Behaviour Snapshot rename, the Momentum State badge + sentence structure, and the Success Criteria section). This report covers what was built, deviations found during implementation, test/type-check results, success-criteria verification, and what remains open for later phases.

---

## Commits completed

| # | Commit | Summary |
|---|---|---|
| 1 | `806f4b7` | Add `totalCompletions(habitId, logs)` to `lib/domain/habit-stats.ts` — consolidates an existing inline pattern, plus a unit test |
| 2 | `2f95ce1` | Today screen: `handleLog` fires a stronger celebration on a Recovery Event (`isRecoveryEvent`); removes the per-habit streak subtitle |
| 3 | `da52bd8` | Progress screen: Behaviour Snapshot section (aggregate Total Completions/Consistency + per-habit Momentum badge/narrative, Recovery Rate + Count, Average Recovery Time) replaces the old streak/consistency-only presentation |
| 4 | `e303bc5` | Habit Detail: Total Completions leads as a full-width tile; Current + Best streak folded into one supporting tile; a Recovery tile (Rate or Time, whichever displays) added; no Habit Health placeholder rendered |
| 5 | `da01b1d` | Onboarding's "how it works" copy no longer sells streaks as the headline feature; milestone (every 25th Total Completions) celebration added at routine strength, never `big: true` |
| 6 | — | No new commit. Verified that insufficient_data display rules (§7.5), morning-after visual stability (§6.1), and recovery-independent-of-hysteresis copy (§6.2) were already fully satisfied by commits 2–4 (see "Commit 6" below) |
| — | *(pending)* | This documentation commit — completion report + CLAUDE.md update |

---

## Files changed

- `lib/domain/habit-stats.ts` — added `totalCompletions`
- `lib/domain/habit-stats.test.ts` — added `totalCompletions` tests
- `app/(tabs)/index.tsx` — recovery celebration branch, milestone celebration, streak subtitle removed, `streakForHabit` import removed
- `app/(tabs)/progress.tsx` — Behaviour Snapshot section, per-habit Momentum badge/narrative + Recovery Rate/Count/Time, insufficient-data raw-count Consistency, aggregate Total Completions/Consistency header, empty-state copy
- `app/habit/[id].tsx` — reordered/recombined stat tiles, Recovery tile, `totalCompletions` import
- `app/onboarding.tsx` — "how it works" copy rewritten
- `CLAUDE.md` — architecture notes updated to reflect the above (see "CLAUDE.md update" below)

No schema, migration, `lib/domain/` behavioural logic (beyond the `totalCompletions` consolidation), challenge behavior, notification copy, AI coaching prompts, reflection prompts, recovery-flow action menu, or schedule-editing UI was touched, per the instruction's constraints.

---

## Tests added or updated, and results

**Added:** 3 tests for `totalCompletions` in `lib/domain/habit-stats.test.ts` (zero-logs case, cross-habit isolation, cumulative counting for count-habit logs).

**Final verification, run after every commit and again at the end of the phase:**
- `npm test`: **96/96 passed** (93 pre-existing + 3 new), 8 suites, 0 failures — command actually run, output captured after each commit.
- `npx tsc --noEmit`: **clean, no errors** — run after every commit.
- `npx eslint .` (full repo): **7 errors, 1 warning**, all pre-existing and unrelated to Phase 3 (Deno `npm:` specifiers in both Edge Functions, `no-undef` on Node globals in two `scripts/*.js` files, and one stale `.expo/types/router.d.ts` disable-directive warning) — confirmed unchanged from the Phase 2 baseline by re-running against the same files; zero new lint findings from any Phase 3 file.
- `npx expo export --platform web`: succeeded — all 15 static routes, including `/progress`, `/habit/[id]`, `/onboarding`, and `/(tabs)`, bundled and statically pre-rendered without error. This confirms the modified screens import and render cleanly in their empty/no-param states; it does not exercise populated-data interaction (see limitation below).

**Known verification limitation, stated explicitly:** this repository has no component or integration test suite (`npm test` covers `lib/domain/` pure functions only, unchanged in this phase), and this environment has no simulator, device, or browser-automation tool available to click through the app interactively. The completion requirement "confirm the recovery celebration fires correctly on a Recovery Event and does not fire on a routine completion" and "confirm the Momentum State badge + sentence renders correctly in all seven states" are therefore verified by **code-path tracing against the already-tested domain layer**, not by live UI interaction:
- `isRecoveryEvent` (the only thing `handleLog`'s recovery branch reads) is itself covered by 18 tests in `lib/domain/recovery.test.ts`, unmodified by this phase.
- `handleLog`'s branch order was traced by hand: the recovery check sits after the early returns for "not yet done" and "bonus rep on an already-done day," so it can only evaluate on the completion that first makes today done — matching the spec's exclusions (no same-day re-trigger, no bonus-rep trigger). A brand-new habit's very first log can never register as recovery, because `recoverableLapseInstances` requires a prior Scheduled Opportunity to have been missed, which doesn't exist yet for a first-ever log — matching the spec's "newly created habits" exclusion. Paused/non-scheduled days never enter the Scheduled Opportunity sequence at all, so they can't be misclassified either.
- `confirmedStateAt` (what `MOMENTUM_COPY` keys off in Progress) is covered by 16 tests in `lib/domain/momentum.test.ts`, including one per candidate state and the hysteresis fixtures; `MOMENTUM_COPY` is a straightforward `Record<MomentumStateKey, ...>` covering all 7 keys, so it cannot fail to render a badge for any value `confirmedStateAt` can return — verified by direct inspection (a `Record` with all 7 keys populated is exhaustive by TypeScript's own checking, and `tsc --noEmit` passed).

If you have access to a simulator or the Expo Go app, I'd recommend a short manual pass logging a habit, missing a day (or using the Settings dev tools' `debugBackfillLogs`), and logging again to see the recovery celebration and Behaviour Snapshot in a real, populated state before wider testing.

---

## Deviations from the approved plan

Both were flagged individually at the time, in the relevant commit message, per the instruction's "report any deviation before continuing." Restated here together:

1. **Commit 2 — routine celebration message text.** The instruction's literal scope for commit 2 was "remove the per-habit streak subtitle" and "add the recovery branch." Today's routine-completion celebration also had its own streak-based fallback message (`🔥 N day streak!`), a second, separate piece of code from the row subtitle. Leaving it in place would have shown streak text on Today in celebration-popup form, directly contradicting §7.3 ("removed from Today ... entirely"), which this same instruction approved. I replaced it with the existing non-streak rotating messages, using Total Completions instead of streak length to pick which one rotates in. This is a required consequence of an already-approved decision, not scope creep, but it goes slightly beyond the commit's literal two-item list, so it's called out here.

2. **Commit 3 — no single aggregate Momentum State badge at the top of Progress.** The instruction places one Momentum State badge at the very top of the screen. `confirmedStateAt` and `recoveryRate` are both single-habit functions in `lib/domain/momentum.ts` / `lib/domain/recovery.ts` — there is no cross-habit aggregate. Inventing one (e.g. "worst state wins" or a majority vote) would be a new behavioural rule, which the instruction's own constraints forbid ("do not compute, derive, or redefine any behavioural metric in a screen component"; "flag a gap rather than design a calculation around it," per the approved plan's own §1.2/§9 methodology). Resolution: the top-of-screen summary aggregates only what's safe to sum/average across habits (Total Completions, Weekly/Monthly Consistency — matching this screen's pre-existing `overallConsistency` precedent), and the full Momentum State badge + narrative, Recovery Rate + Count, and Average Recovery Time are shown per habit, on each habit's own card — the granularity the domain layer actually supports. For a user with exactly one habit this reads almost identically to the literal instruction (that habit's real state is one card-scroll away); for multiple habits, each habit's own trajectory is told honestly rather than blended into a number that doesn't mean anything as an average.

No other deviations. Everything else — the five §7 decisions, the Behaviour Snapshot rename, the badge + sentence structure, streak placement, the insufficient-data rules, and the morning-after design — was implemented as specified.

---

## Commit 6 in detail — why no new code was needed

Re-reading all three of Commit 6's requirements against what commits 2–4 had already produced:

- **Insufficient-data display (§7.5)**: already fully implemented in commit 3. `HabitSnapshot`'s `isNew` branch (keyed off `confirmedStateAt(...) === 'insufficient_data'`) shows the "Getting started" badge, suppresses the Recovery Rate/Count/Time block entirely in favor of a single neutral line, and `consistencyText(..., showRawCount: isNew)` renders "N of M days" instead of a percentage. Total Completions is shown at its real, unmodified small value throughout, since `totalCompletions` never special-cases small numbers.
- **Morning-after visual stability (§6.1)**: this was never a matter of removing existing code — no banner, color change, or miss indicator was ever added anywhere in this codebase for a missed day. A missed habit's checkbox is, and always was, visually identical to "not yet logged today." Verified by inspecting `app/(tabs)/index.tsx`'s checkbox styling (color only changes on `done`, never on any miss/streak state) and `components/habit-calendar.tsx` (a missed day's cell uses a faint neutral border, `emptyColor + '33'`, never a warning color).
- **Recovery independent of hysteresis (§6.2)**: implemented in commit 2 by construction — the celebration branch reads `isRecoveryEvent` directly, never `confirmedStateAt`.
- **No "missed" as a headline word, no absence day-counter**: grepped the full `app/`, `components/`, and `lib/*.ts(x)` tree. The only user-facing occurrence of "missed" is inside the recovery celebration's reference copy ("You returned after a missed day...") — mid-sentence prose in a positive, forward-looking message reusing the plan's own §6.2 wording verbatim, not a headline. No absence day-counter exists anywhere.

Given all three requirements were already met, I did not fabricate a placeholder commit — there was no remaining diff to make.

---

## Phase 3 Success Criteria — verification

Against `docs/phase-3-experience-plan.md` §10:

| Criterion | Status |
|---|---|
| Understand what to do immediately | **Met.** Today's structure and copy are unchanged from before this phase — the only screen a first-time user needs to understand is the same one that worked before. |
| Complete a habit in one tap | **Met.** The checkbox interaction is byte-for-byte unchanged; only the post-tap celebration branch changed. |
| Understand how they are progressing in under 10 seconds | **Testable, not independently confirmable here.** The Behaviour Snapshot leads every Progress card with a plain-language badge + sentence before any number, structurally designed for this; whether it actually reads in under 10 seconds is a real-user-testing question this report can't answer on its own. |
| Recover from a missed opportunity without feeling punished | **Verified by code trace** (see "Commit 6" above and the deviation note in commit 2): no banner, no color change, no streak-based shame message; the only new behavior after a miss is that the *next* completion gets a stronger, explicitly validating celebration. |
| Minimum: understand that missing a day did not erase progress | **Verified by code trace.** Total Completions and the Recovery Rate/Count/Time block are computed fresh from the domain layer on every render and do not change from a miss alone — a single miss cannot move `confirmedStateAt` (hysteresis requires 3 consecutive agreeing candidates), so the Momentum badge is provably stable too. |
| Stretch: articulate the difference between Total Completions, Recovery Rate, and Momentum State after about a week | **Not testable yet.** This requires real usage over time; it's the comprehension stretch goal the plan itself frames as aspirational, not a gate. |

---

## Remaining risks and decisions deferred to later phases

- **No component/integration test coverage was added for the new UI logic** (the recovery-celebration branch, `MOMENTUM_COPY` rendering, the insufficient-data branches). This repository has no component testing infrastructure at all (`npm test` covers `lib/domain/` only, per CLAUDE.md, unchanged by this phase) — adding one was out of this phase's scope, but it's worth naming as the main reason this report relies on code-path tracing rather than automated UI assertions.
- **"Monthly Progress" was implemented as `consistency(habit, logs, 30)`** (a rolling 30-day percentage, reusing the existing `consistency` function at a different window) rather than "completions logged in the current calendar month." The plan's own §3.2/§7.4 name "Monthly Progress" without a precise definition, and adding a calendar-month-filter function would have been new domain logic beyond the one function this phase was scoped to add. Reusing `consistency(..., 30)` needed zero new code and stays fully within `lib/domain/`. Worth confirming this reading is what was intended before Phase 6 builds monthly reflections on top of it.
- **Habit Health remains an unrendered concept**, exactly as scoped — no tile, no placeholder, no "coming soon" element anywhere. The existing flex-wrap stat grid in Habit Detail already accommodates a future 4th tile without a layout rework.
- **Per-habit-only Momentum/Recovery granularity** (see Deviation 2 above) means a user with many habits never sees one blended "how am I doing overall" momentum number — only per-habit cards plus Total Completions/Consistency in aggregate. This is a considered, honest resolution to a real domain-layer gap, not an oversight, but it's a experience-shape decision worth the user's explicit awareness before broader testing, since it wasn't separately enumerated as one of the five approved §7 decisions.
- **Recovery Rate's rolling/lifetime split (§7.2)** is only half-realized: the "rolling on Progress/Habit Detail" half is built; the "lifetime in Reflection" half has no UI surface yet, because Reflection's content is server-generated text from the `ai-insights` Edge Function (Phase 5/6 scope), not a client-computed tile. Nothing in this phase needed to build that surface, but it doesn't exist yet either.
- **Milestone cadence** (every 25th Total Completions) was picked as "a small, low-stakes implementation detail" per the plan's own framing — not validated with users, easy to change in one place (`MILESTONE_STEP` in `app/(tabs)/index.tsx`).
- **No live/manual UI verification was performed** beyond a successful `expo export --platform web` static build (see "Known verification limitation" above). A manual pass on a simulator or device is recommended before this ships to real users.

---

## CLAUDE.md update

Updated to reflect Phase 3's architecture changes: the `progress` tab and `habit/[id]` route descriptions now describe the Behaviour Snapshot / reordered stat tiles instead of the old streak-first layout; the core-loop bullet documents the new recovery/milestone celebration branches; the shared-domain-layer section documents `totalCompletions`, the `MOMENTUM_COPY` label mapping (and that it lives in the screen, not the domain layer), and replaces the old "not yet wired into any screen" note with a description of exactly what's wired in now and what still isn't (Habit Health, reflection/coaching facts, notifications, challenge tolerance). No other files required updates per the locked master specification (README.md remains out of scope, as it was in Phase 2, for the same pre-existing reason).

---

## Confirmation

- All Phase 3 commits (1 through 5, plus this documentation commit) are scoped exactly as approved, with the two deviations above explicitly flagged rather than silently absorbed.
- No database schema, migration, challenge behavior, notification copy, AI coaching prompt, reflection prompt, recovery-flow action menu, or schedule-editing UI was touched.
- No `lib/domain/` behavioural logic was modified beyond the `totalCompletions` consolidation in commit 1.
- **Phase 4 has not begun.** No recovery-flow action menu ("Continue / smaller version / skip / adjust schedule / pause / reflect"), Reduced Completions, or Lapse Reasons UI exists anywhere in this codebase as a result of this phase.

Waiting for approval before beginning Phase 4.
