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
