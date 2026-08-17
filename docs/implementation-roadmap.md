# Implementation Roadmap
**Version 2**  
**Approved after completion of Phase 3**  
**Supersedes the sequencing defined in the original product specification.**

This document replaces the original phase ordering from the locked product specification with the revised sequence approved after Phase 3 delivery. The product specification itself remains authoritative for what each phase builds; this document governs when and adds two new gates.

## Completed

### Phase 1 — Audit
Repository audit and dependency report. Tagged phase-2-complete (the audit preceded and enabled Phase 2).

### Phase 2 — Behaviour engine
Recovery-first domain layer: scheduled opportunities, Recovery Rate, Recovery Time, Momentum State with hysteresis, shared domain architecture. Tagged phase-2-complete.

### Phase 3 — Experience layer
Behaviour Snapshot, badge + sentence Momentum State, recovery celebration, metric reorder, streak demotion, onboarding copy. Tagged phase-3-complete.

---

# Remaining

## Phase 4 — Recovery flow

The complete missed-habit experience.

Continue / smaller version / skip / adjust schedule / pause / reflect.

Lapse reasons (stored facts feeding the AI coach).

Reduced completions for habits with measurable targets.

Schedule-editing and pause UI (the first time `habit_schedule_periods` gets real rows).

Retroactive entry UI (editing a past day's completion — the domain layer already supports this; Phase 4 adds the user-facing path).

---

## Phase 5 — AI Coach and Habit Health

Rewrite coaching prompts to use the full domain layer (recovery history, lapse reasons, momentum, consistency, scheduled opportunities).

Implement Habit Health as deterministic domain signals.

Output validation (reject responses containing statistics not in the input).

The coach becomes concise, pattern-aware, and grounded in computed facts rather than generic encouragement.

---

# Acceptance Gate — Functional UX review

A structured review against the Phase 3 Success Criteria, conducted on a physical device (not browser or Expo preview):

- Can a first-time user understand what to do immediately?
- Can they complete a habit in one tap?
- Can they understand how they are progressing in under 10 seconds?
- Can they recover from a missed opportunity without feeling punished?
- At minimum, do they understand that missing a day did not erase their progress?

Additionally review:

- The recovery celebration — does it register emotionally, or does it flash too quickly to land?
- The Behaviour Snapshot — does the badge + sentence hierarchy scan correctly?
- The morning-after experience — does a single miss produce near-total visual stability?
- Habit Health — does the new signal surface clearly in Habit Detail?
- The recovery flow — is returning after a lapse genuinely low-friction?
- The AI coach — are nudges grounded and specific, or generic?

Write findings to `docs/acceptance-gate-findings.md` as a prioritised list.

Classify each finding as:

- critical (blocks further phases)
- important (address before Product Polish)
- cosmetic (defer to Product Polish)

Address all critical findings before proceeding.

This gate produces a written document and has a pass condition; it is not an informal check.

---

# Product Polish — Premium experience

Scope:

- typography
- colour palette
- spacing
- corner radii
- animation timing (including celebration display duration)
- empty-state visual treatment
- icon consistency
- accessibility

The visual language established here is inherited by all subsequent phases.

Not in scope:

- new features
- new screens
- structural layout changes
- new domain logic
- new behavioural metrics

The content is locked; only the craft changes.

Includes fixes logged during the Acceptance Gate that were classified as cosmetic, plus any visual issues noted during Phase 3 delivery:

- Celebration animation duration — currently too brief to register; extend to 2–3 seconds minimum.
- Edit Habit modal — no back/cancel option; user can only save or delete.
- Habit Detail stat tile spacing — cramped layout, needs breathing room.
- Streak display truncation on smaller screens.
- **Habit History previous-month navigation** (logged during pre-Phase-5 manual acceptance testing, 2026-08-08). Users want to browse earlier months of completion history, ideally via a swipeable or otherwise simple calendar navigation model. `components/habit-calendar.tsx` currently has no such capability — it renders exactly the fixed-length `history: DayStatus[]` window it's given, with no month-boundary or paging concept, so this is a structural addition (new navigation state, a different date-range-fetch shape, header controls), not a config change. Not implemented in the pre-Phase-5 pass for that reason.
- **Habit Detail "Recent activity" list** (same session). The current textual list (`app/habit/[id].tsx`, capped at the last 10 log rows) is less useful than the calendar grid above it. Likely future direction: calendar becomes the primary historical view, previous months become browsable (per the item above), and Recent Activity shrinks to roughly the latest 5 entries. Deferred alongside the calendar-navigation item since trimming the list in isolation, without the calendar becoming the primary view, isn't an independently-justified change on its own.

---

## Phase 6 — Reflections

Rewrite weekly and monthly reflections using the full domain layer.

Momentum State context, recovery recognition, habit-health explanations, realistic adjustments.

Reflections distinguish between a temporary lapse, a badly scheduled habit, an unrealistic target, and a genuine improvement.

---

## Phase 7 — Challenge redesign

Replace the single-miss-fails-challenge model with participation and recovery-based goals.

Challenges reward consistency and recovery, not perfection.

---

## Phase 8 — Notifications and analytics

Rewrite notification copy (morning-after notifications, reminders, cooldowns).

Analytics recording (recovery events, momentum transitions, lapse reasons).

Notification frequency reduction after repeated misses.

**Reference notes (logged during pre-Phase-5 manual acceptance testing, 2026-08-08).** Competitor research (Daylio, Habitify, Me+) reinforces that notifications should eventually be context-aware rather than generic. Useful reference patterns: simple goal reminders, time-of-day context, "one habit left today" context, positive reminders after recent success, and return-oriented reminders reserved for a genuine lapse. The app's existing behavioural engine means future notification copy can be grounded in Momentum State, open lapse status, recovery, whether today's opportunity is merely still open (not yet a miss), recent completion history, and time of day — `quiet`, `recovering`, and `rebuilding` are context states, not "worse" ranks, and copy should reflect that (see CLAUDE.md's Momentum contracts). Per `docs/phase-1-audit.md` §6 and `docs/phase-4-plan.md` §11, the product must not copy streak-loss or shame framing such as "Don't lose your streak," "You've missed X for Y days," or "Get back on track." No notification changes were made in that pass — `lib/notifications.ts` is untouched; this is a reference note for whoever picks up Phase 8.

State-keyed copy variation

Notification copy is written as templates keyed to behavioural state rather than per habit. Each
behavioural state carries a set of interchangeable variants, and the notification path selects one deterministically. This gives notifications that stay fresh over months while remaining truthful about the user's actual behaviour, and it removes the need to author copy per habit.

Prerequisites: the notification path must receive behavioural state as data, since the Edge Functions cannot reference `momentum.ts` or `recovery.ts` under the current generated-domain boundary. Every variant set is bound by the user-facing copy variation contract in `CLAUDE.md`.

The equivalent variation on the Progress card is presentation-layer work and is not part of Phase 8. It can be done independently and earlier.

---

## Phase 9 — Final QA and optimisation

Full test suite.

Migration verification.

Performance benchmarking.

Expand and validate developer simulation controls to cover all supported behavioural scenarios.

Edge-case testing across the complete feature set.

Security audit pass.

---

## Phase 10 — Launch preparation

App Store and Play Store submission preparation.

Final copy review.

Privacy declarations.

Screenshots and marketing assets.

README and documentation update.

Final on-device testing across the complete flow.

---

# Notes

The locked product specification (`docs/habit-tracker-evolution-plan.md`) remains the authority on what each phase builds. This roadmap governs sequencing only.

Phases 4 and 5 are the last phases that add significant new UI and domain logic. The Acceptance Gate is placed immediately after them because that is the first point at which the complete user experience exists and can be meaningfully tested.

**Product Polish** is placed before Phases 6–8 so that reflections, challenges, and notifications inherit the established visual language rather than requiring a second polish pass afterward.

Retroactive entry editing is scoped into Phase 4 (Recovery Flow) rather than treated as standalone scope, because editing a past day is part of the same interaction family as the recovery experience.

**This roadmap intentionally favours shipping a usable product over completing every planned capability before testing with real users. Future sequencing may continue to evolve based on user feedback, provided the locked product philosophy remains intact.**
