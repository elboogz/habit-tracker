# Phase 1 Audit — Streak-to-Recovery Architecture

Audit of the existing habit tracker codebase against `docs/habit-tracker-evolution-plan.md`. Read-only; no code, schema, or copy was changed to produce this document.

---

## 1. Architecture Summary

The app is an Expo Router (SDK 54) React Native app with a **local-first** data layer:

- A single `HabitStoreProvider` (`lib/habit-store.tsx`) holds all app state (`habits`, `logs`, `challenges`, settings) in a `useReducer`, persisted to `AsyncStorage` under a per-user key. Every mutation lands in the reducer synchronously; there is no server round-trip on the interaction path.
- A background diff-and-sync layer (`lib/supabase-sync.ts` + `lib/sync-queue.ts`) compares state snapshots before/after each change, enqueues the minimal set of upsert/delete ops into a persisted outbox, and pushes them to Supabase Postgres. Pulls happen on sign-in and app-foreground (no realtime subscription). Conflict resolution is last-write-wins by an `updatedAt` timestamp on every row.
- Auth (`lib/auth-store.tsx`) wraps Supabase Auth (email/password, OTP-code password recovery — deliberately not link-based, to dodge email-client link-prefetching).
- All derived progress state (streaks, consistency, challenge completion) is computed by **pure functions over raw logs** in `lib/habit-stats.ts` — nothing is stored as a precomputed flag. This is a significant asset for Phase 2: the "never mutate raw history, only recompute" discipline already exists, it just needs new inputs (schedules, pauses) and new outputs (recovery, momentum).
- AI coaching (`lib/ai-coach.ts` + two Supabase Edge Functions) is **already partially deterministic**: both `supabase/functions/ai-insights/index.ts` and `supabase/functions/send-coaching-push/index.ts` compute streak/consistency in plain TypeScript and pass a small JSON summary to Claude, rather than raw logs. This is a good head start on Phase 5's "domain layer computes facts, model only narrates" requirement, but falls short of it in specific ways (see §6).
- There is currently **no scheduling or pause concept anywhere** — a `Habit` has no notion of which days it applies to, and no way to record that it's paused. Every progress calculation in the app assumes "every calendar day is a scheduled opportunity," which is exactly the assumption Phase 2 replaces.
- There are **no automated tests** in the project (no test runner in `package.json`, confirmed against CLAUDE.md's own note). Phase 9's "add tests" starts from zero coverage, not partial coverage.

---

## 2. File / Component / Service / Data Map

**Screens (`app/`)**
| File | Role |
|---|---|
| `app/_layout.tsx` | Root stack, auth/onboarding/password-recovery routing guards |
| `app/sign-in.tsx` | Email/password auth |
| `app/reset-password.tsx` | OTP-code password recovery |
| `app/onboarding.tsx` | First-run flow; creates habits + a 3-day challenge; references streaks in copy |
| `app/(tabs)/index.tsx` | **Today** — core loop, streak display, challenge-completion side effects |
| `app/(tabs)/progress.tsx` | **Progress** — AI Coach card, per-habit streak/consistency/heatmap |
| `app/(tabs)/challenges.tsx` | **Challenges** — start/track/list challenges, `DayDots` progress dots |
| `app/(tabs)/settings.tsx` | Reminders, AI Coach push prefs, sound, `__DEV__` simulation tools |
| `app/habit-form.tsx` | Create/edit habit modal |
| `app/habit/[id].tsx` | Habit History — streak, best streak, consistency%, calendar grid, recent logs |

**Components (`components/`)**
| File | Role |
|---|---|
| `habit-heatmap.tsx` | Row of filled/outline squares from `DayStatus[]` (Progress) |
| `habit-calendar.tsx` | Week-aligned calendar grid from `DayStatus[]` (Habit Detail) |
| `celebration-overlay.tsx` | Particle-burst + message; `big` flag for challenge completions |
| `reminder-times-editor.tsx` | Shared add/remove reminder-time UI (Settings + habit form) |
| `haptic-tab.tsx`, `parallax-scroll-view.tsx`, `themed-text.tsx`, `themed-view.tsx`, `ui/icon-symbol*` | Generic/theming primitives, no domain logic |

**Domain & services (`lib/`)**
| File | Role |
|---|---|
| `habit-types.ts` | `Habit`, `HabitLog`, `Challenge`, `HabitState` — **no schedule/pause fields** |
| `habit-store.tsx` | Reducer + mutators + hydration + sync wiring + dev-tools actions |
| `habit-stats.ts` | Pure calendar-day functions: `dayKey`, `streakForHabit`, `longestStreak`, `isDoneOnDay`, `recentHistory`, `consistency`, `challengeProgress` |
| `supabase.ts` | Supabase client singleton |
| `supabase-sync.ts` | Row↔domain-object mapping, diffing, push/pull |
| `sync-queue.ts` | Persisted outbox |
| `notifications.ts` | Local daily reminder scheduling; streak-referencing copy |
| `coach-push.ts` | Remote push registration/prefs for the AI Coach nudge |
| `ai-coach.ts` | Thin client for the `ai-insights` Edge Function |
| `use-celebration.ts`, `use-chime.ts` | Reward-channel primitives (haptics/sound/visual) — reusable as-is per spec Phase 3 |
| `confirm.ts`, `crypto-polyfill.ts` | Cross-platform utilities, no domain logic |

**Database (Postgres via Supabase)**
| Table | Defined in | Notes |
|---|---|---|
| `habits`, `habit_logs`, `challenges`, `user_settings` | `supabase/schema.sql` | Text PKs (client-generated UUIDs), RLS scoped to `auth.uid()`. `habit_logs` has no `deleted_at` — deletes are hard deletes. |
| `ai_insights` | `supabase/ai_insights_schema.sql` | Cached Claude output by `kind`/freshness window; no UPDATE/DELETE policy for users (abuse control) |
| `push_tokens` | `supabase/coach_push_schema.sql` | Expo push tokens; also adds `coach_push_*` columns to `user_settings` |

**Edge Functions (Deno, pasted manually into Supabase Dashboard, not CLI-deployed)**
| Function | Role |
|---|---|
| `ai-insights` | On-demand nudge/weekly/monthly insight, user-JWT-scoped, freshness cache + per-user rate limit |
| `send-coaching-push` | Cron-triggered (every 15 min), service-role, sends Expo push at each user's configured local time |

Both Edge Functions **duplicate** `dayKey`/`streakForHabit`/`consistency`/`sanitizeContent` from `lib/habit-stats.ts` (deliberate — Deno and RN don't share a module system per CLAUDE.md) — this duplication triples for every domain function Phase 2 adds unless a sharing strategy is decided (see §7).

---

## 3. Streak / Calendar-Day / Progress-Metric Dependency Map

Every one of these currently assumes a habit is scheduled on every calendar day. This is the full blast radius of introducing "scheduled opportunities":

- **Core calculators** (`lib/habit-stats.ts`): `dayKey`, `addDays`, `isDoneOnDay`, `isDoneToday`, `streakForHabit`, `longestStreak`, `recentHistory`, `consistency`, `challengeProgress`/`allDoneOnDay` — all calendar-day iteration, zero schedule awareness.
- **Today** (`app/(tabs)/index.tsx`): `streakForHabit` drives both the per-habit "🔥 N day streak" line and the `handleLog` celebration message (`STREAK_MESSAGES`, `🔥 ${streak} day streak!`); challenge banner copy ("log them all today to keep your run alive"); a `useEffect` auto-fails challenges via `challengeProgress(...).isFailed`.
- **Progress** (`app/(tabs)/progress.tsx`): `overallConsistency` header stat; per-habit streak/best/consistency%/heatmap; AI Coach card consumes the same streak-centric edge function output.
- **Habit Detail** (`app/habit/[id].tsx`): streak and best-streak stat cards are the first two of four stat tiles shown; `HabitCalendar` grid marks `day.done` per calendar day.
- **Challenges** (`app/(tabs)/challenges.tsx`): `challengeProgress` per-day dots, `STATUS_LABEL` (`'Didn't finish'` for `failed`), past-challenge list.
- **Onboarding** (`app/onboarding.tsx`): "How it works" copy explicitly sells "Streaks, your best-ever streak, and consistency charts."
- **Notifications** (`lib/notifications.ts`): `REMINDER_MESSAGES` includes `"Don't lose the streak"`; per-habit reminder body is `"Time to log ... — keep your streak going!"`.
- **Settings dev tools** (`app/(tabs)/settings.tsx`): `debugBackfillLogs`/`debugAdvanceChallenge`/`debugCompleteChallenge`/`debugFillHistory` all backfill calendar-day logs to simulate streaks/consistency/challenge completion; none simulate a schedule, pause, lapse, or recovery.
- **AI coaching** (both Edge Functions): compute `streakForHabit`/`consistency` server-side and instruct Claude, in the system prompt itself, to "call out one specific strength (**a streak or high consistency %**)" — streak-first framing is baked into the prompt text, not incidental.
- **Data model**: `Habit` has no `schedule`/`paused` field; `Challenge` has no partial-credit tolerance; there is no `lapse_reasons`, `recovery_events`, or `momentum_history` table or equivalent local type.

---

## 4. Existing Bugs, Technical Risks, and Migration Risks

1. **Challenge-failure logic contradicts the spec outright, independent of any schedule work.** `challengeProgress` (`lib/habit-stats.ts`) marks `isFailed: true` the moment any single non-today day in the window wasn't fully completed by every habit in the challenge — this is the exact "one miss invalidates everything" behavior Phase 7 explicitly prohibits. It's also triggered as a **UI-side effect** in `app/(tabs)/index.tsx` (a `useEffect` that calls `setChallengeStatus`), not from the domain/reducer layer — meaning a challenge only gets marked `failed` when the Today screen happens to be mounted. This logic should move into the domain layer regardless of the new tolerance rules.

2. **No scheduling/pause concept exists at any layer** — not in `habit-types.ts`, the reducer, the Postgres schema, or either Edge Function. This isn't a gap to patch; every calendar-day function needs a new "was this a scheduled opportunity" gate threaded through it, which is most of Phase 2's actual work.

3. **Business logic is triplicated today** (`lib/habit-stats.ts`, `ai-insights/index.ts`, `send-coaching-push/index.ts`) because Deno Edge Functions can't import from the Expo app's module graph. Phase 2 adding scheduled opportunities, recovery rate, and momentum state means either tripling all of that new logic by hand in three places, or making an explicit decision about how to keep them in sync (see §7 technical decisions) — this should be decided before Phase 2 starts, not discovered mid-phase.

4. **`habit_logs` are hard-deleted**, not soft-deleted (per CLAUDE.md, an intentional choice since they're leaf records). Any Phase 2+ analytics that wants to reconstruct "this completion existed and was later un-logged" (e.g. to distinguish a genuine miss from a same-day uncheck-then-recheck) cannot rely on log history alone once a delete has synced across devices. Recovery/lapse computation should be designed around this constraint rather than assuming full audit history.

5. **Zero automated tests today.** Phase 9's "add or update tests" is a from-scratch test suite, not incremental coverage — this changes the actual effort of Phase 9 relative to how the spec phrases it (see §8).

6. **Sync diffing relies on reference-identity comparisons** (`prevHabits.get(habit.id) !== habit` in `supabase-sync.ts`). This is safe today because the reducer always returns new objects, but any new Phase 2+ mutations (recovery events, lapse reasons, schedule changes) must follow the same immutable-update discipline or silently fail to sync.

7. **`resetAllData`'s local-only-reset guarantee** (`skipNextDiffRef`, so dev resets never mass-delete a real account) must be preserved as new tables/state slices (momentum history, lapse reasons, recovery events) are added to the reducer — easy to forget on a new action type.

8. **Notification copy directly violates Phase 8's explicit "avoid" list today** (`"Don't lose the streak"`, `"keep your streak going!"`) — not a future risk, an existing conflict (also listed in §6).

9. **AI Coach push is very recently added** (last commit) and has no equivalent of the in-app Coach card's Progress-screen manual testing — worth having a lower confidence bar on its current correctness (cron timing, timezone handling) than the rest of the app when it becomes an input/output surface for Phase 5's rewrite.

10. **Existing debug/simulation tools don't cover the new scenario list.** Phase 9 asks for pause/restart, rescheduled habits, retroactive entries, gradual improvement/decline, and an "unrealistic target" simulation. Today's tools (`debugBackfillLogs`, `debugFillHistory`, `debugAdvanceChallenge/CompleteChallenge`) only cover perfect/alternating fills and challenge fast-forwarding — none simulate a lapse-then-recovery pattern, a pause, or a schedule change, because those concepts don't exist yet.

---

## 5. Proposed Implementation Sequence, Phases 2–10

The spec's phase order (2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10) is technically sound against this codebase's actual dependency graph — I found no case where a later phase's spec content technically must precede an earlier one. One deviation is recommended:

- **Phase 2 → 3 → 4 → 5 → 6**: correctly sequenced. Phase 3 (Today/Progress UI) consumes Phase 2's domain layer outputs directly. Phase 4 (recovery flow, reduced completions, lapse reasons) extends Phase 2's types and Phase 3's celebration/UI patterns. Phase 5 (AI coach) explicitly depends on Phase 2's recovery events, momentum state, and habit-health signals as "facts" input, and Phase 4's lapse reasons as an input — must follow both. Phase 6 (reflections) reuses Phase 5's deterministic-facts pipeline.
- **Phase 7 (Challenges & Achievements)** technically only depends on Phase 2's scheduled-opportunity primitive — it does not need Phases 3–6 to function. The spec's placement after coaching/reflections appears to be a deliberate product-narrative choice (progress-experience-first, gamification-adjacent features later), not a technical constraint. Recommend confirming that ordering is intentional rather than assuming it (flagged again in §7 as a product decision) — but there's no harm in leaving it last among the content phases either way.
- **Phase 8 (Notifications & Analytics)** correctly depends on Phase 2 (what a "scheduled opportunity" is, for the morning-after notification and cooldown logic) and Phase 4 (lapse reasons feed analytics) — correctly sequenced after both.
- **Phase 9 (Migration & Testing)**: given finding §4.5 (zero existing tests) and §4.10 (no simulation coverage for any new concept), **recommend pulling forward a minimal slice of Phase 9 into Phase 2 itself**, rather than waiting until every other phase is built: specifically, unit tests for the new pure domain functions (scheduled opportunity, recovery rate including its sparse-data/no-lapse/paused edge cases, momentum state hysteresis) plus two or three of the simulated-history dev controls (three-day-lapse-then-recovery, a paused habit, a rescheduled habit). Rationale: Phase 2's domain layer is the foundation every later phase consumes; validating it for the first time at Phase 9 means six phases of UI, AI, reflection, and challenge work could be quietly built on an unverified or subtly wrong recovery/momentum calculation, and every one of those consumers would need to be revisited if Phase 9 finds a bug in the shared layer. This is the one concrete deviation recommended from the spec's literal phase order — everything else about the order stands as written.
- **Phase 10 (Polish & QA)**: correctly last: it explicitly depends on every replacement system already functioning, and on removing streak references only after replacements are confirmed working.

No phase reordering beyond the Phase 9 test-forwarding note above is recommended.

---

## 6. Conflicts Between Current Implementation and the Locked Specification

1. **Challenge failure tolerance** (`lib/habit-stats.ts`'s `challengeProgress`) — a single missed day currently fails a challenge outright. Directly contradicts Phase 7: "Missing one day must not automatically invalidate a challenge."
2. **Notification copy** (`lib/notifications.ts`) — `"Don't lose the streak"` and `"keep your streak going!"` are close paraphrases of Phase 8's explicit "Avoid" examples (`"You are about to lose your streak."`). Needs rewriting, not adapting.
3. **AI system prompts** (both Edge Functions) instruct Claude to independently "call out ... a streak or high consistency %" from a JSON summary it's handed — the domain layer computes the numbers correctly (good), but the *model* currently decides which fact is worth mentioning and drafts the entire message around it, with no output validation step. This is close to, but short of, Phase 5's "domain layer computes facts (including which are worth surfacing); model explains only; validate output rejects invented statistics." Needs a validation step added and the prompt's editorial latitude narrowed, not a full rewrite — the JSON-facts-in / short-copy-out shape is already right.
4. **Streak is the lead metric, not a secondary one**, in Today, Progress, and Habit Detail screens (e.g. "🔥 N day streak" is the first line under a habit's name on Today). Phase 3 requires leading with Momentum State narrative and treating streak, if kept at all, as secondary and non-dominant. Current UI is the inverse of that hierarchy today.
5. **Onboarding copy** sells "Track your progress: Streaks, your best-ever streak, and consistency charts" as a headline feature. Needs rewriting under Phase 3/10 to reflect the new philosophy ("progress is built by returning, not by never missing").
6. **Data model has no schedule/pause/lapse/recovery concepts at all** — this confirms (rather than contradicts) the spec's premise that Phase 2 is a genuine domain-model replacement, not an extension. Noted here so it isn't mistaken for a small gap during planning.
7. The **em-dash constraint** is already enforced for AI-generated copy (`sanitizeContent`'s em-dash stripping in both Edge Functions) — this is a reusable asset, not a conflict. Hardcoded UI copy elsewhere hasn't been audited for em dashes; worth a text sweep during Phase 3/10 polish rather than blocking Phase 1.

---

## 7. Decisions Required Before Phase 2

**Product decisions** (need a stakeholder call, not a default Claude Code should pick):

- Whether streaks remain visible anywhere in the UI as a secondary stat (spec permits this) or are removed entirely — affects how much of the current streak UI is refactored vs. deleted.
- Final Momentum State label wording (spec itself defers this: "a product decision to be confirmed before Phase 3") — flagged here so it's tracked, since it will otherwise surface unexpectedly mid-Phase-3.
- The actual numeric thresholds the spec gives only as examples/guidance: the "fewer than three lapse opportunities" sparse-data cutoff for Recovery Rate, and the minimum evidence window(s) for Momentum State hysteresis — these need concrete, committed values before Phase 2's domain functions can be implemented or tested.
- Default schedule for existing habits on upgrade: silently treat every existing habit as "every day" (preserves current behavior, no user action needed) vs. prompting users to configure a schedule post-migration. Has real retention implications and is a UX/product call, not a technical default.
- Where Recovery Rate is used outside the app (App Store / marketing copy, per Phase 3's note that it's "the product's signature differentiator for marketing") — outside this repo's scope but affects how the in-app edge-case rules (no lapses yet, sparse data) need to stay consistent with external claims.
- Achievement definitions for Phase 7 — the spec gives examples only ("Complete 20 sessions this month," etc.); the shipped list needs sign-off.
- Reduced-completion UX for simple (yes/no) habits — the spec's own examples ("Drink 8 glasses becomes focus on the next glass") are for count habits; what a "reduced" simple habit even means is still an open UX question.
- Whether Phase 7 (Challenges & Achievements) being sequenced after coaching/reflections is an intentional product-narrative choice or just spec-authoring order — confirm before treating it as fixed.

**Technical decisions** (Claude Code can propose a default, but they're real architectural forks worth surfacing rather than deciding silently):

- Schema shape for schedule/pause: new columns on `habits` (e.g. `schedule_days`, `paused_at`) vs. a separate `habit_schedules` table with history. Given the "reversible migrations, never delete history" constraint, additive nullable columns on `habits` are the lower-risk default.
- Whether recovery events, lapse reasons, and momentum-state history become dedicated tables vs. derived on read from `habit_logs` plus a couple of new small tables. The spec's own preference ("prefer calculating derived metrics ... instead of storing duplicate values, unless performance requires otherwise") argues for deriving Momentum State and Recovery Rate on read, but lapse reasons and recovery events are themselves *inputs* users provide (not derived), so they need real tables regardless.
- How the domain layer's logic reaches the two Deno Edge Functions without hand-duplicating every new function a third time — e.g., a small shared Deno-compatible module both functions import, vs. continuing manual duplication with a stronger cross-reference comment convention. This gets meaningfully harder as Phase 2 adds several new nontrivial functions (momentum hysteresis, recovery rate) versus today's two simple ones.
- Where challenge-failure (and future partial-credit) evaluation lives — currently a UI-side `useEffect`; should move into the domain layer / store so it's not dependent on which screen happens to be mounted.

---

## 8. Effort / Risk Outlier

**Phase 2 (Refactor the Core Domain Model) is the clear outlier**, on both effort and risk:

- It requires expanding the data model from scratch (schedule, paused state, reduced completions, lapse reasons, recovery events, momentum state — none of which have any existing analog in `habit-types.ts`), versus every later content phase (3–8) which primarily consumes Phase 2's output types.
- It touches every layer at once: local reducer, `AsyncStorage` persistence shape, Postgres schema + RLS, the sync/diff layer, and both independently-deployed Edge Functions' duplicated logic (§4.3).
- It defines genuinely hard algorithms with explicit, spec-mandated edge-case behavior and no existing precedent to adapt from: Momentum State hysteresis (must not flip on one day's data, needs defined evidence windows), Recovery Rate's multiple edge cases (no lapses yet, sparse data, paused periods, low-value shaming avoidance).
- Every one of Phases 3 through 8 is a direct consumer of Phase 2's output — a bug or missing edge case here doesn't surface locally, it silently propagates into recovery-celebration logic, coaching facts, reflections, challenge completion, and notification eligibility, all built on top.

**Phase 9 (Migration & Testing) is the secondary risk outlier** — starting from zero automated tests and zero simulation coverage for any of the new concepts, while also carrying the hard constraint of safely migrating real user data with fully reversible, non-destructive migrations. It's a smaller *effort* outlier than Phase 2 (it's largely additive tooling and test-writing against an already-built domain layer) but a comparable *risk* outlier, since it's the only phase touching real user data at rest. This is also why §5 recommends pulling a minimal slice of it forward into Phase 2, so the riskiest phase gets validated as it's built rather than seven phases later.

---

## Summary for Approval

This audit found the codebase well-positioned for the recovery-first rewrite in some respects (pure derived-state functions, already-partial fact/generation separation in AI coaching, reusable reward primitives) and genuinely greenfield in others (no scheduling/pause concept exists at all today). Three points need a decision before Phase 2 code is written:

1. Confirm the one recommended sequencing change: pulling a minimal set of domain-layer tests and simulation controls forward into Phase 2, rather than waiting for Phase 9.
2. Resolve the product decisions in §7 that block Phase 2's function signatures (sparse-data thresholds, hysteresis windows, default schedule for existing habits) — these are currently only example values in the spec text.
3. Confirm the technical decision on how new domain logic reaches the two Deno Edge Functions without silently drifting out of sync with `lib/`.

No code, schema, or copy has been changed. Waiting for approval before starting Phase 2.
