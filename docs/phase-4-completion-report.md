# Phase 4 Completion Report — The Recovery Flow

Implements `docs/phase-4-plan.md` (the approved plan, including the suppression revision) in full. All ten commits in the approved sequence (§9) are complete. Phase 5 has not begun — no AI coaching changes, no notification copy, no reflection-prompt rewrites, no challenge-tolerance changes.

## Commits completed

1. **`1dd192b`** — data model + migrations, no behaviour change. `LapseReasonKey`/`LapseReasonEntry`, `HabitState.lapseReasons`, `Habit.reducedTarget`, `HabitLog.reduced`, `migrateLapseReasons`, and `supabase/phase-4-recovery-flow-schema.sql`.
2. **`100e518`** — domain logic. `openLapse`, `lapseReasonSuppressionUntil` (`lib/domain/recovery.ts`), `nextScheduledOpportunityAfter` (`lib/domain/schedule.ts`), `reducedTargetFor` and reduced-aware `isDoneOnDay` (`lib/domain/habit-stats.ts`), new test fixtures, Edge Function regeneration + hand-fix (see Deviations).
3. **`c9179f2`** — sync plumbing. `lapse_reasons` row mapping, the two new habit/log columns, `mergeRemote` for `lapseReasons`, five new store actions (`addLapseReason`, `addSchedulePeriod`, `pauseHabit`, `logReducedCompletion`, `setLogAmountForDate`).
4. **`f46b3ad`** — recovery card shell. `components/recovery-card.tsx`, `lib/recovery-card-dismissals.ts`, wired into Today with Continue/Skip/Dismiss live, three stub rows.
5. **`b5bcdee`** — Do a smaller version. `habit-form.tsx` stepper, `logReducedCompletion` wiring, reduced-recovery celebration copy.
6. **`8c4b459`** — Pause this habit wiring.
7. **`c426f11`** — schedule editor in `habit-form.tsx`, "Adjust the schedule" wired to navigation.
8. **`4043758`** — Reflect flow (inline five-chip prompt + internal Skip).
9. **`1cd401e`** — retroactive entry (`HabitCalendar.onDayPress`, `DayCorrectionPanel`, `setLogAmountForDate` wiring).
10. **This commit** — documentation (this report + `CLAUDE.md` update).

## Files and schemas changed

**New files:** `components/recovery-card.tsx`, `lib/recovery-card-dismissals.ts`, `supabase/phase-4-recovery-flow-schema.sql`, `docs/phase-4-plan.md`, `docs/phase-4-completion-report.md`.

**Modified:** `lib/habit-types.ts`, `lib/domain/persistence.ts` (+ test), `lib/domain/recovery.ts` (+ test), `lib/domain/schedule.ts` (+ test), `lib/domain/habit-stats.ts` (+ test), `lib/habit-store.tsx`, `lib/supabase-sync.ts`, `lib/sync-queue.ts`, `app/(tabs)/index.tsx`, `app/habit-form.tsx`, `app/habit/[id].tsx`, `components/habit-calendar.tsx`, `supabase/functions/ai-insights/index.ts`, `supabase/functions/send-coaching-push/index.ts`, `CLAUDE.md`.

**Schema:** `lapse_reasons` table (RLS scoped to `auth.uid() = user_id`, append-only from the client) plus `habits.reduced_target` and `habit_logs.reduced` columns — all in `supabase/phase-4-recovery-flow-schema.sql`. **Confirmed applied** to the live database by the user during commit 1.

## Tests added or updated, and results

Extended `lib/domain/recovery.test.ts`, `lib/domain/schedule.test.ts`, `lib/domain/habit-stats.test.ts`, `lib/domain/persistence.test.ts` with fixtures for: `openLapse` mid-run and edge cases; a reduced completion closing a lapse identically to a full one; the §7.4 retroactive-removal worked example (a completion that had closed a lapse and fired a Recovery Event is removed, reopening the lapse and un-firing the event — proven directly, not just asserted); `nextScheduledOpportunityAfter` for daily, weekday-limited, and indefinitely-paused habits; `lapseReasonSuppressionUntil` across several `LapseReasonEntry` timings within an open lapse; `reducedTargetFor`'s derivation and clamping; `isDoneOnDay`'s reduced-awareness and backward compatibility with pre-Phase-4 logs.

**Final verification run** (after commit 9, repeated after the CLAUDE.md update in commit 10):
- `npx tsc --noEmit` — clean, no errors.
- `npx jest` — **124/124 tests passed**, 8 suites, including the pre-existing edge-function freshness check (`scripts/build-edge-functions.test.ts`), which passed because the regenerated Edge Functions were committed rather than left stale.
- `npm run lint` — clean, exit 0.

All three commands were actually run at each commit boundary, not assumed.

## Migration instructions and rollback

Already applied — included here for the record. Run in the Supabase SQL Editor:

```sql
create table if not exists public.lapse_reasons (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id text not null,
  missed_opportunity_date date not null,
  reason text check (reason in ('too_busy','forgot','low_energy','not_feeling_it','something_else')),
  note text,
  skipped boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lapse_reasons_user_id_updated_at_idx on public.lapse_reasons (user_id, updated_at);
create index if not exists lapse_reasons_habit_id_idx on public.lapse_reasons (habit_id);

alter table public.lapse_reasons enable row level security;
create policy "Individuals can manage their own lapse reasons" on public.lapse_reasons
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.habits add column if not exists reduced_target int;
alter table public.habit_logs add column if not exists reduced boolean not null default false;
```

**Rollback** (safe at any time — no other table depends on `lapse_reasons`, and the two columns fall back to the pre-Phase-4 default every consumer already treats as baseline):

```sql
drop table if exists public.lapse_reasons;
alter table public.habits drop column if exists reduced_target;
alter table public.habit_logs drop column if exists reduced;
```

## Edge Functions

`supabase/functions/ai-insights/index.ts` and `supabase/functions/send-coaching-push/index.ts` were regenerated (`npm run build:edge-functions`) at commit 2, because the reduced-aware `isDoneOnDay` is in the generated whitelist. **Already re-pasted and deployed** to the Supabase Dashboard by the user, confirmed during commit 2 — not a deferred action.

## Deviations from the approved plan

1. **Edge Function hand-fix beyond the generated block (commit 2).** The plan's edge-function regen step anticipated only the generated block changing. While verifying the regen, I found both Edge Functions also hand-maintain their own `LogRow`/`HabitLog` row-mapping types and explicit `.select()` column lists *outside* the generated markers. Without updating those, the new `reduced` field would never reach the regenerated `isDoneOnDay` server-side, silently defeating the point of the commit. I hand-fixed both (`LogRow.reduced`, `HabitLog.reduced`, and added `reduced` to both `.select()` calls). This is a correctness necessity for what commit 2 already required, not new scope, but it's a real deviation from "only the generated block changes" and is reported here per instruction.
2. **§7.1/§7.2 resolved textual ambiguity (commit 9).** §7.1's pressable-range formula (`date >= addDays(dayKey(), -6)`) literally includes today, but §7.2 explicitly reasons that today should be excluded from the retroactive panel ("today already has a first-class, always-visible editor and duplicating it here would be redundant"). I implemented the more explicitly-reasoned interpretation: the 6 days *before* today are pressable, today is not. This is a resolution of an internal inconsistency in the approved text, not a scope change — flagged here rather than silently picked.
3. **On-device/browser interaction verification.** Per an explicit question to the user after commit 4 (the app requires signing in against the real Supabase project, and I had no test credentials), the user chose "code + automated checks only" for commits 4–9. Every UI-touching commit's completion is therefore backed by TypeScript, automated tests, and code-path inspection, **not** a manual on-device pass — see "Verification methods" below for the one partial exception. A full on-device acceptance pass is still recommended before considering Phase 4 user-facing-ready; see "Remaining risks."

No other deviations. The commit order, all six approved product decisions (§8.1–§8.6), and the six-option list match the plan as written.

## Verification methods, per completion requirement

- **Recovery card appears only when `openLapse !== null` AND today `isScheduledOpportunity` AND not suppressed** — code-path inspection of `eligibleHabits` in `app/(tabs)/index.tsx`, matching §3.1's formula exactly. Not manually verified on-device.
- **All four card actions suppress until the next Scheduled Opportunity** — code-path inspection (`recoveryCardSuppressedUntil`, `handleRecoveryContinue`/`handleRecoverySkip`/`handleReflectChoice`/`handleReflectSkip`, all keyed through `nextScheduledOpportunityAfter` or `lapseReasonSuppressionUntil`). Not manually verified on-device.
- **Skip writes `skipped: true`; Reflect writes the selected reason** — code-path inspection + TypeScript validation of the `addLapseReason` call sites. Not manually verified on-device.
- **Continue and Dismiss record no behavioural fact** — code-path inspection; both call only the local `dismiss()` setter from `useRecoveryCardDismissals`, never `addLapseReason`.
- **Reduced completions available only for habits with measurable targets** — automated test (`reducedTargetFor` suite in `habit-stats.test.ts`) + code-path inspection of the `reducedTargetFor(habit) !== null` render guard in `recovery-card.tsx`.
- **Schedule editor creates new effective-dated periods without editing past periods** — code-path inspection (`addSchedulePeriod` always appends a new period via the reducer, never mutates an existing one) backed by the pre-existing Phase 2 append-only design and its test coverage in `schedule.test.ts`.
- **Retroactive entries limited to the last 7 days, correct recomputation** — code-path inspection of `editableFrom` in `habit-calendar.tsx` + automated test ("example G" in `recovery.test.ts`, which proves recomputation directly rather than asserting it).
- **Retroactive removal reopens a lapse and reverses a Recovery Event** — automated test, same "example G" fixture, asserting the before/after state of `recoverableLapseInstances`, `closedLapses`, and `recoveryEvents` explicitly.
- **No shame-framed messaging, absence day-counts, or warning-coloured elements** — manual copy review of every new user-facing string across `recovery-card.tsx`, `habit-form.tsx`, `habit/[id].tsx`, `index.tsx` (grepped for miss/fail/broke/streak/shame/behind/late/overdue framing — none found beyond the pre-existing, unmodified "streak" label); manual review of styling confirms no red/orange/warning colors were introduced, only the app's existing `tint`/`icon`/`background`/`text` theme colors.
- **Full test suite / TypeScript checks** — actually run at every commit boundary; see "Tests" above for the final results.
- **Web build sanity check (commit 4 only)** — after wiring `RecoveryCard` into Today, started `npx expo start --web` and drove it with headless Playwright: the app bundles and reaches the sign-in screen with zero console errors and zero page errors. This proves the new component and its imports compile and don't crash the bundle; it does **not** exercise the card's actual interactions (that requires a signed-in session against the real Supabase project, which I don't have credentials for).

## Remaining risks / deferred decisions

- **On-device acceptance pass.** Per the user's explicit choice, no interactive on-device/browser verification was performed for the recovery card, schedule editor, Reflect prompt, or retroactive-entry panel. All are backed by TypeScript + automated domain tests + careful code-path inspection, but a real device or authenticated-browser pass is the recommended next step before treating Phase 4 as user-facing-complete.
- **Cross-device / reinstall gap for Continue/Dismiss** — explicitly accepted in §8.6; bounded to at most one extra card appearance, one Scheduled Opportunity's worth of exposure.
- **`lib/recovery-card-dismissals.ts` storage is not scoped per-user**, unlike the main `habit-tracker/state-v1:<userId>` key. On a device shared across multiple signed-in accounts, a stale dismissal entry from one account is technically readable (though not writable in a way that matters) by another. Practically harmless — habit IDs are globally-unique UUIDs, so cross-account key collision is not a realistic concern — but it's an inconsistency with the rest of the app's per-user storage convention worth knowing about. Not fixed: the plan doesn't call for per-user scoping here, and §8.6 already frames this store's entries as harmless and orphan-tolerant by design.
- **Final copy** for the recovery card, reduced-completion celebration, and lapse-reason prompt is illustrative, per §12 — written on-brand with the existing app's tone (the codebase's own em-dash-forward style, no shame framing), not final-polished copy.
- **Phase 5 has not begun.** `lapse_reasons` is written but read by nothing yet, exactly as designed — it exists to feed Phase 5's coach.

## Confirmation

Working tree is clean as of this commit (verified before pushing). All Phase 4 commits are pushed to `origin/main`. An annotated tag `phase-4-complete` is created at this documentation commit and pushed to the remote.

## Post-completion manual testing fix

**Observed inconsistency.** During manual on-device testing after `phase-4-complete`, the Progress screen for a habit backfilled via the Settings developer tools (e.g. "Fill all") simultaneously showed substantial history (31 Total Completions, 12 of the last 14 days completed) and Momentum State "Getting started" / `insufficient_data` copy ("Still gathering enough days to show a pattern.") — an internally contradictory result for the same habit at the same moment.

**Root cause.** `lib/domain/schedule.ts`'s `scheduledOpportunitiesUpTo` (the foundation every Momentum and Recovery calculation is built on) never generates a Scheduled Opportunity before `localDayKeyOf(habit.createdAt)` — this floor is the correct, locked Phase 2 rule and was not changed. The developer simulation reducer cases in `lib/habit-store.tsx` (`debugBackfillLogs`, `debugAdvanceChallenge`, `debugCompleteChallenge`, `debugFillHistory`) backdated `HabitLog.date` into the past to simulate history, but never touched the habit's own `createdAt`, which stayed at its real value (the moment the habit was actually created via the app, typically "today" for a habit created solely to test these tools). As a result:
- `totalCompletions` and `consistency` (`lib/domain/habit-stats.ts`) read raw logs by calendar date and are unaffected by `createdAt` — they correctly reflected the full backfilled window.
- `candidateStateAt`/`confirmedStateAt` (`lib/domain/momentum.ts`) and the recovery functions in `lib/domain/recovery.ts` all derive their opportunity list from `scheduledOpportunitiesUpTo`, which only walked forward from "today" (the real `createdAt`) — so they saw exactly one Scheduled Opportunity and correctly, per the locked rules, reported `insufficient_data`.

Both readings were individually correct given their inputs; the inputs themselves (a backfilled log history paired with an unbackdated creation date) did not represent a coherent simulated habit. Progress was not caching or reading stale state, and no domain rule (Momentum thresholds, hysteresis, `insufficient_data`'s definition, Recovery Rate/Event semantics) was defective.

**Fix.** Added `lib/domain/dev-simulation.ts`'s `backdatedCreatedAt(createdAt, simulatedDates)` — a pure, dev-tool-only helper that computes the `createdAt` needed so every simulated date is a genuine Scheduled Opportunity (backdating to local midnight of the earliest simulated date, preserving the original time-of-day; a no-op if `createdAt` already covers the window; never moves `createdAt` *later*, so a habit whose real creation date already predates the simulated dates — e.g. "Simulate streak" on a month-old habit — is left untouched). Wired it into all four `lib/habit-store.tsx` debug reducer cases via a small `withSimulatedHistory` wrapper that also bumps `updatedAt` to `now` when `createdAt` actually changes, applied only to the specific habit(s) each action is already backfilling — no other habit's data is touched.

**Tests added** (`lib/domain/dev-simulation.test.ts`, 13 cases):
- `backdatedCreatedAt` unit behavior: no-op when already covered, backdates to the earliest date while preserving time-of-day, never moves `createdAt` later.
- A simulated 30-day habit history with 12-of-14 recent completions no longer reads `insufficient_data`, and matches a manually constructed genuine-history fixture's `candidateStateAt`/`confirmedStateAt`/`consistency`/`totalCompletions` output exactly (also reproduces the original bug against the un-fixed `createdAt` first, to prove the test actually exercises the failure).
- A sparse/new simulated habit (1 backfilled day) correctly remains `insufficient_data` — the fix doesn't weaken the threshold.
- A simulated recovery/lapse history produces identical `recoveryEvents`, `closedLapses`, and `recoveryRate` to an equivalent manually constructed genuine fixture.
- Simulated history still respects the habit creation-date floor (no opportunity generated before the backdated `createdAt`).
- A pause period inside the simulated window is still excluded correctly after backdating.
- Backdating never produces a Scheduled Opportunity after the real "today", and a simulated date later than `createdAt` can never push it forward.

Full suite: `npm test` — 9 suites, 137 tests, all passing (13 new). `npx tsc --noEmit` — clean. `npm run lint` — clean.

**Production impact: none.** The fix is confined to `lib/domain/dev-simulation.ts` (new file, not part of the generated Edge Function whitelist in `scripts/build-edge-functions.js`) and the four `debug*` reducer cases in `lib/habit-store.tsx`, which are reachable only from Settings' `__DEV__`-only developer tools section. No Momentum, Recovery, schedule, or consistency rule changed; no schema change; no Edge Function regeneration required (neither `day-key.ts` nor `habit-stats.ts` — the only two files the generator inlines — were touched). A real user's own habit history, created and logged entirely through normal app use, is completely unaffected.

## Post-completion fix 2: Momentum evaluation precedence + developer scenario simulator

**Second manual-testing report.** After confirming the createdAt fix above resolved the original stale-history issue (a "Simulate 30-day history" habit correctly left "Getting started"), a second report came from a fresh habit ("Read") backfilled with the Settings "+6-day streak" tool: Progress showed 6 Total Completions and 6-of-7 recent days completed, yet still displayed Momentum State "Getting started" / `insufficient_data`. The request was to determine whether this was the same class of bug (a debug tool bypassing the shared simulation path) and, if so, unify the tools; separately, to design a developer-only scenario simulator for recovery/momentum testing.

**Investigation: not a simulation-path bug.** `debugBackfillLogs` (the "+6-day streak" reducer case) already called the same `withSimulatedHistory`/`backdatedCreatedAt` helper as every other debug action — all four were fixed together in the previous commit. Reproducing the exact scenario with a **genuinely** 6-day-old habit (real `createdAt`, no dev tool involved at all) produced the identical "Getting started" result, proving the dev tool and real usage are behaviorally identical here. The actual cause: `confirmedStateAt`'s hysteresis requires 3 consecutive identical daily candidate readings before a new state displays. With 6 backfilled days plus an unlogged "today," the candidate sequence is `building, building, steady, steady, building` — the trailing open day reverts the reading before "steady" ever holds 3 in a row. A 7-day streak (one more day of margin) does confirm "Steady" — verified directly. This is a real, reproducible property of the existing (Phase-2-approved) Momentum thresholds, not a divergence between simulated and genuine history, so the "+6-day streak" tool itself was left unchanged.

**A genuine defect found during that investigation: `rebuilding` was unreachable as a *confirmed*, displayed Momentum State.** While constructing test histories to design the new scenario simulator's "Rebuilding" button, no history — of any length or shape — ever produced a confirmed `rebuilding` badge. Verified by exhaustively evaluating `confirmedStateAt` against **every possible daily hit/miss history up to 14 Scheduled Opportunities** (a full binary search, not a sample): zero histories confirmed `rebuilding`, despite `rebuilding` being a real, spec-named state (`docs/phase-2-implementation-plan.md` §3's threshold table, row `rebuilding`; the "long_term_improving_trajectory" fixture in §8 explicitly expects a confirmed sequence passing through `rebuilding`).

- **Root cause.** `candidateStateAt`'s evaluation order (`lib/domain/momentum.ts`) checked `building` before falling back to `rebuilding`. `building`'s bar is low (a 60% completion rate over just a 3-opportunity window, and only required to *improve* on the prior window when one exists) — low enough that it claimed nearly every day immediately following a qualifying (≥3-miss) lapse's recovery, before `rebuilding`'s own 3-opportunity confirmation window could ever complete. `rebuilding` was reachable as a one-day *candidate* (already covered by an existing test) but never as a 3-in-a-row *confirmed* state.
- **Verification against the approved definition, before changing anything.** Per the plan's own worked example (`long_term_improving_trajectory`: "confirmed sequence: `insufficient_data` → `quiet`/`rebuilding` → `building` → `steady` → `thriving`"), `rebuilding` is intended to be reachable as a confirmed state on the way up from a longer lapse. The evaluation-order line elsewhere in the same document (`insufficient_data → recovering → quiet → best of {thriving, steady, building} → rebuilding fallback`) is the textual source of the bug — read literally, `building` was always checked ahead of `rebuilding`, which the exhaustive search shows makes `rebuilding` unreachable in practice, contradicting the plan's own worked example. This is a defect in the implementation's fidelity to the plan's own stated intent, not a threshold value that needed changing.
- **Fix — the smallest change that resolves the contradiction.** In `candidateStateAt`, `isRebuilding` is now checked immediately after `thriving`/`steady` (which legitimately still take precedence — sustained strong evidence should supersede a trailing "still rebuilding" read) and *before* `meetsBuilding`. No threshold, window, confirmation count, or entry condition for `building`, `steady`, `thriving`, `recovering`, `quiet`, or `insufficient_data` was touched — only the position of one `if` relative to another.
- **Tests added** (`lib/domain/momentum.test.ts`, new "rebuilding evaluation precedence" describe block, 6 cases): a ≥3-miss lapse's recovery still reaches candidate `rebuilding` (pre-existing case, re-verified); `rebuilding` becomes confirmed only on the 3rd consecutive agreeing candidate, not before (both the "not yet" and "now confirmed" days asserted); a short (≤2-miss) lapse still resolves to `recovering`, never `rebuilding`, at both candidate and confirmed level; ordinary early progress with no preceding lapse still confirms `building`, unaffected; `steady`/`thriving` retain their existing classification; a currently-open lapse still confirms `quiet`. All pre-existing fixtures (137 tests across the full suite before this change) continued to pass unmodified — none of them had encoded the precedence bug as an expected value.
- **Reachability re-proof.** Re-ran the exhaustive search after the fix: every one of the 7 `MomentumStateKey` values (`insufficient_data`, `building`, `steady`, `recovering`, `rebuilding`, `thriving`, `quiet`) is now reachable as a confirmed state via some valid daily history at length ≤ 10 (witness patterns recorded in the commit; shortest for `rebuilding` is a 7-day history: 4 misses then 3 held completions).
- **Edge Function impact: none.** `momentum.ts` is not part of `scripts/build-edge-functions.js`'s `SOURCES` whitelist (only `day-key.ts` and `habit-stats.ts` are inlined into the Edge Functions) — no regeneration or re-paste needed. Confirmed by inspection, not assumed.
- **Production impact: real, and disclosed.** Unlike the createdAt fix above, this changes actual domain behavior: any real habit whose history matches the previously-misclassified shape (recovering from a lapse of 3+ missed days) will now correctly read "Rebuilding" on Progress instead of whatever it previously settled on (typically "Building" or "Steady," depending on what followed). This is a bug fix bringing behavior in line with the already-approved Phase 2 spec, not a new product decision — but it is a real, user-visible classification change and is called out explicitly here rather than folded silently into the dev-tools work that motivated finding it.

**Separately flagged, not fixed: `insufficient_data` persistence and "today" handling.** `docs/phase-2-implementation-plan.md` §3 defines a miss as "a Scheduled Opportunity for `date < today` with no qualifying Completion — **today is never classified as missed**." `lib/domain/recovery.ts`'s functions satisfy this by construction (today can only ever appear as the *resolving* side of a pairwise check, never the *missed* side, and `openLapse` explicitly evaluates only through yesterday). `lib/domain/momentum.ts`'s `candidateStateAt`, however, builds its rate-window records directly from `scheduledOpportunitiesUpTo` including today, and an unlogged today reads as `completed: false` in that window — actively lowering the day's own completion rate rather than being excluded, which is what produces the six-day-streak-plus-open-today "Getting started" behavior investigated above. This is a real, textual deviation from the spec's own "today is never classified as missed" wording, not merely a surprising-but-intentional threshold effect — but per explicit instruction it was **not** changed here: the "+6-day streak" tool was proven behaviorally faithful to real usage (not a simulation defect), and altering how Momentum treats today is a separate, more invasive change to `lib/domain/momentum.ts`'s core evaluation than the rebuilding-precedence fix, touching every candidate-state check rather than reordering two of them. Flagged for a future, deliberate review rather than bundled into this fix.

**Developer scenario simulator (new feature).** Added `lib/domain/dev-simulation.ts`'s `ScenarioKey`/`scenarioPattern`/`simulatedLogsFor` and a new `debugSimulateScenario(habitId, scenario)` store action, exposed in Settings' developer tools as a "Simulate a scenario" section (one row per habit, 8 scenario buttons each): **Miss yesterday**, **Miss 2 days** (both open a real, still-unresolved lapse and leave today unlogged, so the Recovery Card renders and a live tap on Today exercises the actual celebration), **Recover today**, **Recover after a lapse** (both close a lapse with today's own completion, for an instant Recovery Rate/Recovery Time/Recovery Count preview), and **Quiet stretch**, **Rebuilding**, **Building**, **Thriving** (each an "instant preview" history that confirms the matching Momentum State badge). Every pattern was derived empirically against the real domain functions (`openLapse`, `recoveryEvents`, `closedLapses`, `confirmedStateAt`) — not hand-guessed — and is proven in `lib/domain/dev-simulation.test.ts`'s new "scenario simulator" describe block (8 cases, one per scenario, each asserting the specific domain output the button exists to exercise). No scenario bypasses or special-cases the domain layer: each is a `SimulatedDay[]` pattern (dates + a completed flag) fed through the exact same `backdatedCreatedAt` + log-generation pipeline as the pre-existing debug tools, so it reads through `openLapse`/`momentum.ts`/`recovery.ts` exactly as real usage would.

As a byproduct — and directly addressing the original "unify the debug tools onto a single shared simulation mechanism" request, though the investigation above found no *behavioral* divergence to unify — `simulatedLogsFor` in `lib/domain/dev-simulation.ts` is now the one place that decides what a simulated completion log row looks like. All five debug reducer cases (`debugBackfillLogs`, `debugAdvanceChallenge`, `debugCompleteChallenge`, `debugFillHistory`, `debugSimulateScenario`) call it instead of five near-identical inline `.map(...)` blocks, removing the duplication that made the original "did one tool drift from the others" question hard to answer with confidence in the first place.

**Full verification.** `npm test` — 9 suites, 151 tests, all passing (14 new: 6 in `momentum.test.ts`, 8 in `dev-simulation.test.ts`). `npx tsc --noEmit` — clean. `npm run lint` — clean. `npx expo export --platform web` — bundles cleanly (1288 modules, all 15 static routes including `/settings` present), confirming the new Settings UI compiles into a real bundle, not just passing the type checker.

## Post-completion fix 3: Momentum confirmation mechanism (today-completion monotonicity)

**Request.** Alongside the exhaustive 7-state reachability search from fix 2, add a monotonicity check: for every history in the search space, completing the current day must never move the candidate or confirmed Momentum State to a less favourable trajectory solely because the day changed from open to completed — with the comparison relation defined explicitly and grounded in the approved specification, not assumed to be a total order.

**The comparison relation.** Only four of the seven `MomentumStateKey` values form a defensible chain: `insufficient_data < building < steady < thriving`, because each step requires strictly more/stronger positive evidence than the last (window 0/3/5/8 opportunities, minimum completion rate —/60%/80%/90%, per `MOMENTUM_CONFIG` — an explicit, nested design, not inferred). `recovering`, `rebuilding`, and `quiet` are classified by lapse recency/length, not a rate bar, and the product deliberately avoids a single "goodness" framing across all seven states (`docs/phase-3-experience-plan.md` §7.1's non-shame labeling) — so they were left out of the chain, not force-ranked. A narrower fallback invariant ("never enter `{quiet, recovering, rebuilding}` from outside that set purely by completing today") was tried and rejected: an exhaustive sweep showed it produces ~1000 "violations" that are `building → recovering`/`rebuilding`, which is not a bug — `recovering`/`rebuilding` are *defined* as "you just completed today, closing a recent lapse," so completing today is a structural precondition for earning that label, not a corruption of an otherwise-fine trajectory. Only the chain-comparable-pair check was kept.

**What the exhaustive check found.** Comparing `candidateStateAt`/`confirmedStateAt` with "today" left open vs. completed, over every possible daily hit/miss history up to a 12-day prefix (1027 candidate-level and 2053 confirmed-level comparable pairs): 0 violations at the candidate level, but **1 at the confirmed level** — a habit completed on days 1–4 (candidates `insufficient_data, insufficient_data, building, building`) reads confirmed `building` if day 5 ("today") is left open, but confirmed `insufficient_data` — strictly *lower* — if day 5 is completed instead. Root cause: `computeConfirmedState`'s pending-transition counter resets to 1 on *any* change of candidate value, even when the new candidate (`steady`, day 5's own reading once completed) is chain-comparable and *stronger* than the one it was tracking (`building`, at pending count 2/3) — discarding that progress rather than crediting it.

**A rejected first fix.** A version that let a pending run continue past a stronger candidate by tracking a "floor" (the lowest rung seen) and confirming it once held for 3 opportunities resolved the target case, but broke the **locked** `perfect_completion_history` fixture (`docs/phase-2-implementation-plan.md` §8: "confirmed at opportunity 10" for `thriving`) — traced and confirmed directly: `thriving` confirmed at opportunity 11 instead, and `steady` at opportunity 8 instead of 7. This wasn't an implementation slip; it's inherent to that design — any rung that "owns" and consumes 3 opportunities of confirmation necessarily delays the next, stronger rung's own fresh count, for *any* smoothly improving trajectory, not just the pathological case. Reverted; confirmed the revert restored all 151 tests and reproduced the exact original violation (open → `building`, completed → `insufficient_data`) before proceeding.

**The mechanism implemented instead — `computeConfirmedMomentumState`, replacing `computeConfirmedState` only for `confirmedStateAt`** (the generic, exact-match `computeConfirmedState` is untouched and still exported/tested for arbitrary synthetic sequences): confirmation as a property of the **trailing `transitionConfirmationOpportunities` (3) candidates**, evaluated fresh at every opportunity, not a stateful pending counter one rung consumes:

1. If all 3 trailing candidates are identical, confirm that value — unchanged from before; the *only* rule governing the off-chain states (`quiet`/`recovering`/`rebuilding`), and the *only* rule that can ever lower the confirmed state (a decline within the chain still needs 3 consecutive identical weaker candidates).
2. Otherwise, if all 3 trailing candidates *and* the current confirmed state are chain-comparable, take the window's minimum rank. If strictly higher than the confirmed state's rank, raise to it. Only ever raises; never fires against an off-chain confirmed state.
3. Otherwise, unchanged.

This doesn't weaken the 3-opportunity requirement: it's satisfied as "the trailing 3 opportunities each showed *at least* this much evidence" — Rule 2 takes the window's *minimum*, so it can only confirm a rung at or below what all 3 support, never stronger than any one of them individually earned (unlike the rejected first fix, which let a stronger state confirm off fewer than 3 of its own occurrences).

**Verification, all performed before committing:**
- `perfect_completion_history` traced opportunity-by-opportunity: `steady` confirms at opportunity 7, `thriving` at opportunity 10 — both **exactly the locked values**, unchanged. (`docs/phase-2-implementation-plan.md` §8 pins only these two numbers for this fixture, not the full intermediate sequence — the new mechanism does introduce an early, previously-unpinned `building` reading at opportunities 5–6, filling in territory the fixture never specified, not breaching it.)
- The target case: open and completed both now read confirmed `building` — equal, not worse.
- A genuinely-established `thriving` confirmation (10 perfect days) holds after a single subsequent miss — decline still requires 3 consecutive weaker candidates, proven directly, not just asserted.
- Three required transition sequences, run directly against `computeConfirmedMomentumState`: `insufficient_data, building, thriving` (a non-adjacent upward move) doesn't confirm off only 2 samples; `building, recovering, building` (an off-chain state interrupting a run) doesn't bridge across it; `building, building, insufficient_data, building` (a downward move) restarts the count from zero.
- The exhaustive today-open-vs-completed sweep re-run: **0 violations at both candidate and confirmed level**, over 1027 and 2053 comparable pairs respectively (up to 12-day prefixes).
- The 7-state reachability search re-run: every witness pattern is **identical** to before this fix, including `rebuilding`'s shortest witness (`0000111`, 7 days) — no state's reachability or shortest witness changed.
- All 22 existing `momentum.test.ts` tests pass **unmodified** (zero test files edited to accommodate the change) — the new mechanism reproduces every previously-approved fixture exactly, plus corrects the one found gap.

All of the above (plus the enumerated unranked candidate/confirmed transition pairs, informational, not asserted) are committed as permanent tests in `lib/domain/momentum.exhaustive.test.ts`, kept separate from `momentum.test.ts`'s fast fixtures since the exhaustive sweeps take ~7s.

**Production impact: real, and disclosed precisely.** Any real habit history where a chain-comparable, stronger candidate (e.g. `steady`) arrives while a weaker chain candidate (e.g. `building`) has partial (1–2 opportunity) pending progress will now show that weaker state as confirmed slightly earlier than before, instead of silently staying at `insufficient_data`/the prior confirmed value until the stronger state independently completes its own 3-in-a-row. This is strictly an *improvement* in information shown (never a regression per the exhaustive proof above) and never changes the timing of a transition that was already going to happen via 3 identical consecutive candidates (Rule 1, unchanged) — including both locked `perfect_completion_history` checkpoints, reproduced exactly.

**Edge Function impact: none**, for the same reason as fix 2 — `momentum.ts` is not in `scripts/build-edge-functions.js`'s `SOURCES` whitelist.

**Full verification.** `npm test` — 10 suites, 159 tests, all passing (8 new in `momentum.exhaustive.test.ts`). `npx tsc --noEmit` — clean. `npm run lint` — clean.

## Post-completion manual acceptance fixes (pre-Phase-5)

A targeted correctness pass over Progress/history issues found during manual on-device testing, requested before Phase 5 (AI Coach) begins consuming these behavioural outputs. Not a redesign; Phase 5 has still not begun.

### Item 0 — precondition

The approved current-day Momentum semantics (`docs/phase-2-implementation-plan.md` §3: "a miss is a Scheduled Opportunity for `date < today` with no qualifying Completion — today is never classified as missed") **remain unimplemented**. `lib/domain/momentum.ts`'s `recordsUpTo` builds its rate-window records from `scheduledOpportunitiesUpTo`, which includes today, and calls `isDoneOnDay` for it — an unlogged today reads as `completed: false` in every rate/quiet/building/rebuilding window, identically to a genuine miss. This was already flagged, and explicitly deferred, in "Post-completion fix 2" above (see the "Separately flagged, not fixed" paragraph). It is confirmed still unimplemented as of this pass. Per instruction, it was **not** implemented here.

Item 3's Recovery display fix (below) is independent of this defect — it corrects a presentation-layer bug (Progress borrowing Momentum's confirmed state as a readiness proxy for an unrelated metric) that exists regardless of whether Momentum's current-day semantics are ever fixed. Item 2's proposed narrative override has intentionally **not** been implemented, specifically because presentation logic should not be built on top of a domain calculation already known to be incorrect (see below).

### Item 1 — Progress "stale update": not a rendering defect

No store-subscription bug was found. `habit-store.tsx`'s reducer returns a new `state` object on every mutation; the memoized `store` object depends on `[state, hydrated]`; `progress.tsx` reads `useHabitStore()` with no local memoization and recomputes every derived value fresh on every render; the tab navigator uses default React Navigation behaviour (`enableFreeze` is never called), so no screen is frozen while off-screen. **What causes recomputation now:** any state change produces a new context value, and Progress re-renders from it on the very next render — there is nothing to fix here.

The perceived staleness is instead a downstream visual symptom of two independent, already-classified issues: item 2's confirmed-state hysteresis genuinely not updating for a day or more after a real change (by design — see Momentum contracts in `CLAUDE.md`), and item 3's presentation gate (below) hiding data that was, in fact, already fresh. Classified as domain-result / presentation-result symptoms, not stale-render.

### Item 2 — Quiet stretch semantics: deferred pending the current-day fix

**Investigation** (fully described in the prior turn, reproduced here for the record): a constructed history — 7 days completed, 3 missed (confirms `quiet`), then 2 genuine recoveries, with the 14th day ("today") left open — shows `candidateStateAt` at today reading `building` while `confirmedStateAt` remains `quiet`, and `openLapse(...)` at today is `null` (no unresolved miss run through yesterday). The badge and narrative both read as if the habit currently needs a return, when it does not. Root cause: today's own unlogged status breaks what would otherwise be a 3rd consecutive `rebuilding` candidate (days 12–14), which is item 0's defect manifesting at the confirmed level.

**Decision: the proposed narrative override is not implemented.** Building presentation logic that reads `openLapse`/today-completed signals to override the `quiet` narrative would be built directly on top of a candidate sequence that item 0 already established is generated from incorrect current-day handling. The override's condition (`openLapse === null`) would frequently be true for exactly the wrong reason (a real defect suppressing genuine miss-run detection into a benign-looking `building`/other candidate), not because the history is genuinely healthy.

**The proposed mapping is recorded here as a candidate solution only, not implemented, pending re-evaluation after the current-day fix** (see the follow-up proposal below, which found the specific scenario above no longer produces a `quiet` confirmed state at all once current-day semantics are corrected — suggesting the override may turn out to be unnecessary):

- Today already completed → acknowledge today's completion instead of urging a return.
- Today still open and `openLapse === null` → forward-looking, non-generic copy instead of "Today is a good day to return."
- Today still open and `openLapse !== null` (genuine unresolved miss run) → unchanged, existing copy is correct.

**Two problems with the specific copy proposed, recorded so they aren't re-proposed unchanged:**

1. `"You kept it going today — that's what counts."` contains an em dash, which this project's copy rules (see the new "User-facing copy" section in `CLAUDE.md`) now explicitly prohibit in any user-facing string.
2. `"Recent days have gone well — today's opportunity is still open."` (besides the same em-dash problem) overclaims what `openLapse === null` actually establishes. `openLapse` only judges through yesterday, so `null` means only "no unresolved miss run through yesterday" — it says nothing about days further back. In the exact day-14 example used to justify this branch, the same habit had a genuine 3-day miss four days earlier (days 9–11). Calling that "recent days have gone well" overstates the evidence the branch condition actually supports.

No wording change was made to `app/(tabs)/progress.tsx`'s `MOMENTUM_COPY` or `HabitSnapshot`'s narrative rendering in this pass.

### Item 3 — Writing Recovery discrepancy: fixed (presentation layer)

**Investigation:** a constructed 6-completion, alternating complete/miss history (a plausible real "gaps and returns" pattern) produces `recoverableLapseInstances`: 5 resolved, all recovered; `recoveryRate.rolling`: `{ resolvedCount: 5, recoveredCount: 5, rate: 1, displayAsPercentage: true }`; `averageRecoveryTime`: 1 day — genuinely ready to display a 100% recovery rate per Recovery Rate's own domain rule (`RECOVERY_CONFIG.minResolvedLapsesForPercentage = 3`, already met at 5). But the momentum candidate sequence for the same history oscillates `recovering ↔ quiet` every single day and never accumulates 3 identical trailing candidates, and since both are off-chain (absent from `EVIDENCE_CHAIN`), the confirmed-state raise rule never applies either — **confirmed Momentum State is permanently trapped at `insufficient_data`** for this history (see the "Trapped confirmed state" section below).

**The bug:** `app/(tabs)/progress.tsx`'s `HabitSnapshot` gated the entire Recovery Rate/Recovery Count/Average Recovery Time block behind `isNew = confirmedStateAt(...) === 'insufficient_data'`, showing "Come back after a few more days to see recovery and consistency here." instead whenever Momentum's confirmed state was `insufficient_data` — regardless of what Recovery Rate's own domain output actually had to say. **This is an architectural defect, not merely a UI inconvenience: it violates this project's core principle (`CLAUDE.md`, "Shared domain layer") that no screen may redefine or gate a behavioural concept using a rule that concept's own domain layer doesn't define.** Recovery Rate already owns its complete, correct readiness rule — `recoveryRateText` (same file) already reads `RecoveryRateResult.resolvedCount`/`displayAsPercentage` and degrades gracefully (`"Not enough recovery history yet"` when `resolvedCount === 0`; `"Recovery history still building"` when below the percentage threshold). The outer `momentumState === 'insufficient_data'` gate was a second, competing readiness rule for the same concept, invented in the screen and sourced from an unrelated domain output (Momentum State), which is exactly the "no screen may reimplement a concept that lives here" violation the domain layer's design is meant to prevent.

**The fix:** removed the `isNew` gate and its placeholder branch from `HabitSnapshot` entirely (`app/(tabs)/progress.tsx`). The Recovery Rate block now always renders, letting `recoveryRateText`/`avgRecoveryDays !== null`/`recoveryCount > 0` — Recovery Rate's own, already-correct domain output — decide what to show. No change to `lib/domain/recovery.ts` or `RECOVERY_CONFIG`. For the alternating-history case above, this now correctly surfaces "Recovery rate: 100% · 5 recoveries" and "Averages 1.0 day to bounce back" regardless of Momentum's confirmed state.

**Other occurrences of the same coupling — reported, not changed.** A grep of `app/(tabs)/progress.tsx` and `app/habit/[id].tsx` for every place a Momentum state gates a non-Momentum concept found exactly one more instance:

- `app/(tabs)/progress.tsx`, in the per-habit list (`ProgressScreen`'s render, ~line 299): `const isNew = confirmedStateAt(habit, schedulePeriods, logs, today) === 'insufficient_data'; const habitConsistencyText = consistencyText(habit, logs, days, isNew);` — Momentum's confirmed state chooses whether the below-heatmap Consistency line shows a raw count (`"2 of 7 days"`) or a percentage. `consistency()` (`lib/domain/habit-stats.ts`) has no "insufficient data" concept of its own — it's a plain fraction over a fixed window regardless of habit age — so this is the same pattern: Momentum State standing in as a readiness proxy for a metric that doesn't define that concept itself. Because this habit-list `isNew` also gets recomputed from the trapped-state history above, a habit like the Writing example would show a raw count instead of a consistency percentage indefinitely, for the same underlying reason as the Recovery bug.
- `app/habit/[id].tsx` has no Momentum import or usage at all — no coupling found there.

Per instruction, this second occurrence was **not** changed in this pass — listed here for separate review.

### Current-day Momentum semantics: confirmed defect, follow-up proposal (not implemented)

A local, uncommitted scratch change was made to `lib/domain/momentum.ts`'s `recordsUpTo` — excluding the record for `asOfDate` itself from the window when unlogged, rather than counting it as `completed: false` — to regenerate the Item 2 and Item 3 traces under corrected current-day semantics, then fully reverted (`git checkout -- lib/domain/momentum.ts`; confirmed clean via `git diff --stat`). **This diff was never committed and is not part of this pass's pushed changes.**

**New sequences under the scratch fix:**

Item 2's day-14 history (7 completed, 3 missed, 2 recovered, day 14 open):

| date | candidate (before fix) | confirmed (before) | candidate (after fix) | confirmed (after) |
|---|---|---|---|---|
| d9 | quiet | steady | building | steady |
| d10 | quiet | steady | quiet | steady |
| d11 | quiet | quiet | quiet | steady |
| d12 | rebuilding | quiet | rebuilding | steady |
| d13 | rebuilding | quiet | rebuilding | steady |
| d14 (today, open) | building | **quiet** | rebuilding | **rebuilding** |

Under corrected semantics, this history **never confirms `quiet` at all** — confirmed stays `steady` throughout the decline, then jumps directly to `rebuilding` once three consecutive `rebuilding` candidates (d12–d14) hold. This directly suggests the Item 2 narrative override may not even be needed for this class of scenario once the real fix lands — reinforcing the decision to defer it rather than build it against the current, known-incorrect candidates.

Item 3's alternating 6-completion history:

| date | candidate (before) | confirmed (before) | candidate (after) | confirmed (after) |
|---|---|---|---|---|
| d1–d2 | insufficient_data | insufficient_data | insufficient_data | insufficient_data |
| d3 | recovering | insufficient_data | recovering | insufficient_data |
| d4 | quiet | insufficient_data | recovering | insufficient_data |
| d5 | recovering | insufficient_data | recovering | **recovering** |
| d6–d11 | quiet/recovering (alternating) | insufficient_data (trapped) | recovering | recovering |

Under corrected semantics, the oscillation stops: `quiet` never triggers on an open "today" evaluation (once today's own unlogged record is excluded from its own window, the window's last visible entry is always an already-resolved past record, which for this alternating pattern is always a completion — failing `isCurrentlyQuiet`'s own-window-must-end-in-a-miss gate). Candidates converge to a stable `recovering` by day 5 and confirm there, never reaching `insufficient_data`'s trap. **This directly answers "is the `quiet` narrative override or the Recovery gate fix still needed after the domain fix": for this specific history, both symptoms disappear at the domain level once current-day semantics are corrected** — though Item 3's presentation fix remains independently correct regardless (a screen should never gate one domain concept's display on another's output, whether or not Momentum happens to be trapped).

**Critical finding — the naive fix is not safe to ship as-is.** Re-running the full suite under the scratch change found three regressions, not zero:

1. `momentum.test.ts`'s locked hysteresis test ("requires the new candidate to hold for 3 opportunities before the confirmed state changes") fails: expected `quiet`, got `steady` — the decline-to-`quiet` transition timing shifts by at least one opportunity, because excluding "today" from its own window during a live walk-forward reconstruction (`confirmedStateAt` calls `candidateStateAt` once per historical date, treating each in turn as if it were "today") delays how quickly a miss run's evidence counts in every affected day's own candidate reading, not only the literal current day's.
2. `momentum.exhaustive.test.ts`'s today-open-vs-completed monotonicity sweep, previously **0 violations**, now finds **3 new confirmed-level violations** (e.g. prefix `[1,1,1,0]`: leaving day 4 open reads confirmed `building`, completing it instead reads confirmed `insufficient_data` — strictly worse, the exact class of regression Post-completion fix 3 above was written to eliminate).
3. The 7-state reachability witness for `rebuilding` changes from the locked `'0000111'` to `'0000110'` — still reachable, but at a different history, breaking the exact-witness regression lock.

**Root cause of the naive fix's regressions:** `candidateStateAt(habit, periods, logs, asOfDate)` has no way to distinguish "the literal, real, live current day" from "a historical date being walked as if it were today" — `confirmedStateAt` calls it once per historical Scheduled Opportunity, and applying "exclude self if unlogged" uniformly at every one of those calls over-applies the "today is never classified as missed" rule to every day in the reconstruction, not just the one day it was written for.

**Recommendation for the actual follow-up implementation:** thread the real, live `today` (as received by `confirmedStateAt`) through to `candidateStateAt` as a value distinct from `asOfDate`, and apply the exclude-if-unlogged rule only when `asOfDate === today` (i.e., only for the final, live evaluation point of the walk — every earlier historical date is, by the time it's being scanned, a fully-resolved past fact and should keep today's existing "unlogged = miss" treatment). This is a `candidateStateAt`/`confirmedStateAt` signature change, not a one-line fix, and needs its own exhaustive monotonicity/reachability re-verification (the existing suites in `momentum.exhaustive.test.ts` are exactly the right tool for that) before it can be proposed for approval. Not implemented in this pass, per instruction.

### Trapped confirmed state: documented, not yet a fixed invariant

A characterization test was added — `lib/domain/momentum.test.ts`, describe block `"known issue (documented, not fixed by this pass): confirmed state can become permanently trapped at insufficient_data"` — asserting the exact 11-opportunity alternating-completion sequence from Item 3 stays at confirmed `insufficient_data` for its entire length, and pinning the full candidate sequence (`insufficient_data, insufficient_data, recovering, quiet, recovering, quiet, recovering, quiet, recovering, quiet, recovering`). It documents current, observed behaviour; it is explicitly **not** a locked contract and asserts no new invariant.

**This is a plausible real usage pattern, not merely a synthetic edge case** — any habit genuinely done every other day for an extended stretch (a common, deliberate cadence for some habits, not just an unlucky one) produces exactly this oscillation and would show "Getting started" / `insufficient_data` copy indefinitely on Progress, no matter how long the habit has actually been tracked or how well it's actually recovering.

**Why the existing monotonicity and reachability proofs don't detect this.** `momentum.exhaustive.test.ts`'s today-open-vs-completed monotonicity sweep only ever compares two histories that differ in whether the *final* day is open or completed — it says nothing about a habit that alternates for its entire lifetime, so a permanently-oscillating sequence is outside its comparison space entirely. The 7-state reachability sweep only asks whether each state is reachable *at all* within a bounded history length — it has no notion of "does the confirmed state ever get stuck," so a state (`insufficient_data`) that is trivially reachable (it's the starting value) passing that check says nothing about whether it can also become *inescapable*. Neither proof was designed to detect a state that is reachable, never left, and permanently retained regardless of how much further evidence accumulates — that is a different property (liveness/eventual-escape, not reachability or single-step monotonicity) than either existing suite checks.

**Recommendation:** a future product review should decide whether "every candidate-level trapping class must eventually be escapable given enough opportunities" should become a permanent behavioural invariant (with its own exhaustive proof, analogous to the existing two), and if so, whether the fix belongs in `computeConfirmedMomentumState`'s Rule 2 (extending chain-comparability to cover more off-chain transitions) or in the underlying candidate classification (`isRecentShortRecovery`/`isCurrentlyQuiet`'s oscillation-prone conditions themselves). Not decided or implemented here.

### Item 4 — Habit History UX improvements: recorded, not implemented

Recorded in `docs/implementation-roadmap.md`'s "Product Polish" section (previous-month calendar navigation, Recent Activity trimmed to ~5 entries) rather than implemented — `components/habit-calendar.tsx` has no month-boundary or paging concept today, so browsing earlier months is a structural addition, not a trivial config change, and trimming the Recent Activity list in isolation isn't independently justified without the calendar becoming the primary view first.

### Item 5 — Notification reference notes: recorded, not implemented

Recorded in `docs/implementation-roadmap.md`'s "Phase 8 — Notifications and analytics" section: context-aware notification patterns grounded in Momentum State / open lapse / recovery / today-still-open / recent history / time-of-day, and the existing shame-framing avoid-list. `lib/notifications.ts` untouched.

### Verification

- `npm test` — 10 suites, 161 tests, all passing (2 new: the Item 3 characterization test in `momentum.test.ts`, plus its own sub-assertions).
- `npx tsc --noEmit` — clean, no output.
- `npm run lint` — clean, no warnings or errors.
- `npx expo export --platform web` — bundles cleanly (1288 modules), all 15 static routes present including `/progress` and `/(tabs)/progress`.
- **Verification method per issue:** Item 1 (no code change) — code-path inspection of `habit-store.tsx`'s reducer/memoization and `progress.tsx`'s render, confirmed no memoization gap exists. Items 2 and 3's investigations, and the current-day-fix follow-up traces, were verified by **actually executing** the real domain functions against constructed fixtures (not manual reasoning alone) — see the temporary investigation file used during this pass (deleted before commit; the permanent characterization test in `momentum.test.ts` retains the Item 3 trace as a regression-locked assertion). Item 3's fix was verified the same way, plus a full suite run. None of this was verified on a physical device or in an authenticated runtime in this pass — that verification is still required before considering these fixes fully accepted.
