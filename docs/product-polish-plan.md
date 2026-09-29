# Product Polish — status and design system record

This document is the durable record of Product Polish (`docs/implementation-roadmap.md`'s "Product Polish — Premium experience" section, sequenced before Phase 6 so reflections/challenges/notifications inherit the finished visual language). It records decisions, current state, and reasoning — not a session-by-session chronology. Written so someone picking this up cold, without chat history, can continue correctly.

Throughout, every item is marked one of:
- **Implemented** — shipped, on `main`.
- **Approved, not yet implemented** — a decision has been made but no code reflects it.
- **Deferred / outside Product Polish** — explicitly ruled out of this phase, with the reason recorded.

## 1. Scope as ruled

**In scope** (from `implementation-roadmap.md`): typography, colour palette, spacing, corner radii, animation timing (including celebration display duration), empty-state visual treatment, icon consistency, accessibility. "The content is locked; only the craft changes."

**Not in scope, ever, for Product Polish**: new features, new screens, structural layout changes, new domain logic, new behavioural metrics.

**Specific rulings made during scoping, recorded here so they aren't re-litigated:**

- **Progress rings deferred.** Progress rings are deferred because `react-native-svg` is absent from the dependency tree (verified: no match in `package.json`, `package-lock.json`, or `node_modules`) and unverified against the version-pinned Expo Go client this project targets (see `CLAUDE.md`'s Compatibility note on the SDK-54 pin). If revisited: rings show value against target only, with no evaluative colour states.
- **Handwritten/script accent text deferred.** The mockups use a cursive/handwritten typeface for small annotation-style copy ("Progress lives here", "Keep going"). `display` typography was deliberately built on `Fonts.serif`, a *system* font (iOS `ui-serif`, Android/web `Georgia`/serif fallback) specifically to avoid bundling a font asset or paying a load-time/licensing cost. No platform ships a system handwritten/script face, so matching the mockups here would require bundling a third-party font — the same cost `display` was designed to avoid. Deferred on that basis, not implemented in any step to date.
- **Illustrations may only be static within Product Polish**, and **no illustration assets currently exist** in the repository (verified: `assets/images/` contains only the unmodified Expo starter-template React logo files). Any illustrated treatment (the mockups' plant/hill/sun motifs) is blocked on asset creation or sourcing, independent of the animation-vs-static ruling. The resulting **illustration-free baseline is a deliberate, called-out departure from the mockups**, not an oversight — record it as such at every visual review rather than letting it pass unremarked.
- **Habit badges use deterministic hashing from `habit.id`**, not list index, computed at render time with **no new stored field on `Habit`** — the colour is derived, never persisted. Deterministic `habit.id` hashing remains the authoritative algorithm. Index-based assignment was explicitly considered and **remains explicitly rejected** — it breaks visual-identity consistency the moment the list order changes. **Badge colour collisions between adjacent habits remain accepted** — the treatment is decorative identity, not a uniqueness guarantee, so occasional adjacent repeats are the accepted lesser cost versus an allocation system that would require stored state.
- **Palette ruling** (verbatim): "Palette changes must work in both themes with contrast verified in both."
- **Benchmark/reference products, secondary craft references only** — Headspace, Finch, Duolingo, Habitify, and Me+ — used to sanity-check treatment quality (spacing, card softness, tone), never as a source of product features, mechanics, or scope expansion.
- **No streak mechanics, loss framing, guilt framing, or disappointment mechanics are to be borrowed** from any reference product, mockup, or competitor pattern — this is a firm carry-over from the locked product decision already governing all copy (`CLAUDE.md`'s user-facing copy rules) and applies to visual treatment too (e.g., no "broken chain" streak iconography, no red/warning colour for a miss).
- **Mockup ruling** (verbatim): "Primary visual target, not a pixel-perfect spec. Departures must be called out explicitly, not made silently." A departure is identified and justified when it actually occurs, not pre-authorised in advance by a list of acceptable grounds.
- **Product Polish is judged visually, not by tests/type-check/lint passing.** Every step to date has passed the full test suite, `tsc`, and lint — none of that has ever been treated as evidence the visual result is acceptable. Visual review of an actual render is a separate, required gate.

**Explicitly deferred / not Product Polish** — visible in the mockups but out of scope entirely, not merely sequenced later:

- dedicated Reflect screen
- Habit Detail Overview / Insights / Notes tab structure
- Notes data surface
- aggregate multi-habit completion/Momentum trend
- genuine 3-month reflection tier
- Featured Habit selection/CTA
- Coach content moved onto Today
- "A kinder perspective" as a new content surface
- new charting capability

`docs/design-references/Reflect-screen-v1-ref.png` **depicts this deferred scope and is not itself a Product Polish implementation target** — it should not be treated as a screen Product Polish is working toward.

## 2. Progress to date

Each entry states what design-system state the step *established*, not a change log.

### Step 1 — Typography (`591d39c7a4d1a69eb4023e05229796cec0692c74`)

Added a `display` type to `ThemedText`, built on `Fonts.serif` (a pre-existing, previously-unused system-font token — see §1's font-licensing note). Migrated exactly the 13 genuine screen/section-title call sites to `display` (verified by grep at the time, re-verified now — see §3). Left `title` (and all 5 of its stat-number uses, all in Habit Detail) untouched — deliberately, since large numeric figures need `title`'s sans, tabular proportions, not a display serif's. This established the rule still in force: **`display` = headings, `title` = numbers, never mixed.**

### Step 2 — Colour palette (`0dbb45b181ed788b4389f67972f0364ef6135cfb`)

Re-valued `tint` (blue → sage green, both themes) and light `background` (white → warm cream); added `surface` and `tintSoft` as new tokens; added a 4-entry `BADGE_ACCENTS` set (token only — not yet wired into any UI, see §5); fixed `ThemedText`'s `link` type to resolve through `tint` instead of a hardcoded hex. Values were derived from pixel-sampling the six mockup PNGs (quantized colour histograms), not chosen and justified after the fact. This established the palette in §3.

### Step 3 — Spacing and radius scale (`0015370266c9c03fee9a3535557a5b7f329c4c84`)

Added `Spacing` (10 values) and `Radius` (4 values) to `constants/theme.ts`, derived from counting actual repeated padding/margin/gap/borderRadius values already in use across the touch-set touched by Steps 1–2 — not a scale chosen first and matched to the app afterward. Migrated every call site in that touch-set whose literal value matched one of the derived tokens; left non-repeating or role-inconsistent values as literals (see §3 for the exact evidence and exclusions). This established the numeric rhythm in §3.

### Step 4 — Shared card/surface treatment, plus three correction passes

Four commits so far — three implemented, one proposed — because the first implementation had a real defect the visual review caught, and the review process itself kept finding more:

- **`703426e75827d9a9a2ced0f277c5edf1167c13f2`** — added a `variant` prop to `ThemedView` (`'default' | 'card'`), applied `'card'` to the ordinary-card surfaces on Today, Progress, and Habit Detail (habit rows, per-habit cards, stat tiles). No shadow/elevation.
- **`c30bb6f130c7d795bbc18130959994184e58d23e`** — correction 1. The visual review found cards were still reading cream-on-cream in most places: nested `ThemedView` layout wrappers *inside* those cards had no `variant` of their own and were painting their own `background` (cream) on top of the parent's now-correctly-white `surface`. Added a third variant, `'transparent'`, and a fourth, `'accent'` (resolves `tintSoft`, for the genuinely compact hero/state surfaces — Today's challenge banner, RecoveryCard's outer card), and applied them to the 15 nested wrappers responsible for the defect (see §4 — Round 1 of a recurring defect class).
- **`0bd8a89a2120dd9a67523b68f2e9f6280abc00f6`** — correction 2, after a further visual review. Fixed one more missed instance of the same defect (Today's count-habit `−`/`+` stepper row, missed because only one of four sample habits is count-type — Round 2 of the same defect class, see §4); softened the four ordinary-card neutral borders from full-opacity `colors.icon` to `colors.icon + '33'` (reusing an alpha suffix already present elsewhere in the codebase, not a newly chosen value); added a `cellSurfaceColor` prop to `HabitCalendar` so ordinary day cells fill white instead of implicit cream; reverted Progress's Coach card from `'accent'` back to `'card'` (its current content density — heading, tip, divider, segmented control, reflection prose — doesn't suit a full-card tintSoft wash the way the two genuinely compact accent cards do). Restructuring the Coach card's internal content to a density that *would* suit `accent` is **Phase 6 work, not Product Polish** — Product Polish's own "no structural layout changes" rule rules it out here regardless of visual merit. A conditional-branch audit run during this pass found and fixed two more unconditional instances of the same defect (`momentumBadge`, RecoveryCard's `list` wrapper) and found one genuinely ambiguous case left untouched (see §4).
- **Correction 3 — surface-language sweep and the light/dark border/shadow split — proposed, awaiting approval, not implemented.** A full classification of every rounded container on the remaining screens (Challenges, habit-form, Settings, onboarding, sign-in, reset-password) against the existing `surface`/`tintSoft`/control-treatment rules, plus a proposed per-theme ordinary-card treatment (light: remove the border, add a small restrained shadow; dark: keep the current border, no shadow), has been proposed but not approved or implemented. This is **Step 4 correction 3, not a separate step** — it closes out Step 4's own scope (consistent card/surface treatment) rather than starting new work.

This established the current card/surface/border state recorded in §3.

## 3. Current design system as implemented

All values below read directly from `constants/theme.ts`, `components/themed-text.tsx`, `components/themed-view.tsx` as of `0bd8a89`.

### Palette

```
light: { text: '#11181C', background: '#FAF7F2', surface: '#FFFFFF', tint: '#587058',
         tintSoft: '#E9F0E6', icon: '#687076', tabIconDefault: '#687076', tabIconSelected: '#587058' }
dark:  { text: '#ECEDEE', background: '#151718', surface: '#1E2120', tint: '#8FBF95',
         tintSoft: '#26302A', icon: '#9BA1A6', tabIconDefault: '#9BA1A6', tabIconSelected: '#8FBF95' }
```

Dark `background` was deliberately left unchanged (pre-existing near-black) — no mockup evidence covers dark mode, so nothing there was guessed at. `text`/`icon` were left unchanged in both themes — they still clear AA contrast against the new backgrounds without re-valuing.

### `BADGE_ACCENTS`

```
light: ['#D8E0F0', '#F0D8C8', '#B0C0A8', '#F0E0B8']
dark:  ['#2E3B4A', '#4A3B32', '#3A4536', '#4A4230']
```

Sampled from the mockups' pastel badge circles (light); dark values are a fresh, unsampled darken/desaturate adaptation, lowest-confidence values in the palette. **Token exists; not consumed by any UI yet** — habit badges themselves are unimplemented (§5).

### Spacing scale (and the evidence that produced it)

Derived by counting every `padding*`/`margin*`/`gap` literal across the Step 1–2 touch-set before proposing anything:

| Token | Value | Occurrences found | Role |
|---|---|---|---|
| `micro` | 2 | 9 | label/value text-stack gap |
| `xs` | 4 | 12 | tightest general gap |
| `compact` | 6 | 9 | form-field-group stack gap |
| `sm` | 8 | 36 | base unit — the app's default gap |
| `md` | 12 | 20 | input/chip/segment/tap-target padding |
| `row` | 14 | 14 | list-row/secondary-panel/secondary-button padding |
| `lg` | 16 | 18 | primary button/card padding, section top padding |
| `section` | 20 | 6 | top-level content-column gap between sections |
| `screen` | 24 | 12 | screen-edge gutter, card/section padding |
| `scrollEnd` | 40 | 4 | bottom scroll-content padding |

**Left as literals, deliberately, despite some repetition:** `10` (7 occurrences, no consistent role — badge padding, segment padding, chip padding, generic gaps, all unrelated to each other); `18` (1 occurrence, true one-off); `22` (2 occurrences, both near-misses of the `section` tier at different screens — folding them in would have silently rounded a value rather than represented it); `28` (2 occurrences, two unrelated roles at different screens, one of them itself a near-miss of `screen`).

### Radius scale

| Token | Value | Occurrences | Role |
|---|---|---|---|
| `sm` | 6 | 2 | small controls (checkbox, 24×24) |
| `md` | 12 | 12 | medium controls (inputs, chips, segments, tap targets) |
| `row` | 14 | 5 genuine (6th excluded, see below) | list rows, secondary panels/buttons |
| `lg` | 16 | 16 | cards, primary buttons |

**Left as literals:** `8` (1 occurrence, dimension-tied to one specific 30px button, not a rhythm value); `10` (2 occurrences, two unrelated shapes — a padding-based dev button and a fixed 40×40 stepper — coincidental match, not a real shared decision); `999` (1 occurrence, the "full round" pill idiom — categorically different from a linear corner-radius scale, not folded in). One raw `borderRadius: 14` in Challenges' `dot` component (`width:28, height:28`) was **excluded from the `row` count above** even though it numerically matches — it's an exact half-of-dimension circle, not corner-radius rhythm, and migrating it would have misrepresented its actual nature.

### `ThemedView` variants (`components/themed-view.tsx`)

| Variant | Paints |
|---|---|
| `default` (omitted) | `background` — unchanged from before any Product Polish work; every call site that doesn't pass `variant` is unaffected by anything below |
| `card` | `surface` — ordinary card-like containers |
| `accent` | `tintSoft` — genuinely compact hero/state surfaces (Today's challenge banner, RecoveryCard's outer card) |
| `transparent` | no fill at all (literal `'transparent'`) — nested layout wrappers that must let a parent card/accent surface show through |

`useThemeColor` is called exactly once, unconditionally, every render regardless of variant (Rules-of-Hooks-safe by construction — only the colour name passed to it, and whether its result is used, varies by variant).

### Typography

`display` type added to `ThemedText`, built on `Fonts.serif`. **13 genuine heading call sites migrated** (verified by grep, current): Today, Progress, Settings, Challenges (`app/(tabs)/*.tsx`), Habit Detail, sign-in (2 headers), reset-password (2 headers), habit-form, onboarding (4 sites, including one shared dynamic-title component). **5 call sites deliberately remain on `title`, all in Habit Detail** (`app/habit/[id].tsx`), all large numeric stat figures: Total Completions (`fontSize:40`), Current/Best streak (`fontSize:22` ×2), Recovery/Consistency (`fontSize:28` ×2) — `title`'s sans, tabular proportions were judged correct for numbers; `display`'s serif was judged correct only for headings.

### Ordinary-card border/surface treatment (current, both themes)

Cards use `variant="card"` (→ `surface` fill) with an explicit `borderColor: colors.icon + '33'` (softened from full opacity) on exactly four surfaces: Today's `habitRow`, Progress's per-habit card, Habit Detail's `totalCard` and `statCard`. This is the **current implemented state in both light and dark mode** — no per-theme split exists in code yet.

No `shadowColor`, `shadowOpacity`, or `elevation` usage was found in the audited `app/`/`components/` code (the same grep also checked `shadowOffset`/`shadowRadius`; none found). No other shadow mechanism was searched for — this is not a claim that no shadow mechanism could exist anywhere in the dependency tree, only that none was found in the app's own screen/component code.

A per-theme split (light: no border, small restrained shadow; dark: keep the current border, no shadow) is the **proposed, not-yet-approved-or-implemented** content of Step 4 correction 3 — see §2's Step 4 entry and §5.

## 4. Defect class: nested themed surfaces

A recurring, now well-understood defect, not three unrelated bugs:

**Mechanism.** Each `ThemedView` resolves and paints its *own* background independently via its own `useThemeColor` call. There is no cascading "inherit the parent's resolved colour" behaviour the way ordinary DOM/CSS background inheritance might lead someone to assume — a `variant="transparent"` (or `"card"`/`"accent"`) on a parent has zero effect on any child `ThemedView` that doesn't set its own `variant`. A nested wrapper with no explicit `variant` always paints `background`, regardless of what it's sitting inside.

**Why it was invisible until Step 2.** Before Step 2, `background` and `surface` were both pure white — a default-painting nested wrapper was a white box inside a white box, indistinguishable. Step 2 re-valued `background` to cream while `surface` stayed white, which is what made every pre-existing instance of this pattern suddenly visible as a cream patch inside a white card.

**Three rounds this has surfaced:**

1. **`c30bb6f`** — the first, largest round: 15 nested wrappers found in one audit pass across Today, Progress, and RecoveryCard, all fixed with the new `transparent` variant.
2. **`0bd8a89`**, instance A — Today's count-habit stepper row (`countStepper`), missed in round 1 specifically because **the wrapper only renders conditionally** (`habit.type === 'count'`), and the sample data used for inspection had only one count-type habit among four, so the branch wasn't exercised when the original audit was compiled by reading code rather than every rendered state.
3. **`0bd8a89`**, instances B and C, found via a follow-up conditional-branch audit prompted by the countStepper miss — Progress's `momentumBadge` (unconditional, but missed due to nesting depth) and RecoveryCard's `list` wrapper (conditional on `expanded === true`, a state not exercised by the screenshot under review at the time). Both fixed the same way.

**Left deliberately unresolved:** `HabitHeatmap`'s individual day-cell `ThemedView`s paint `background` when `!entry.done`. Unlike every instance above, this was judged **genuinely ambiguous** rather than a clear instance of the same defect — an undone cell's cream fill could plausibly be an intentional "recede toward the page" signal, parallel to `HabitCalendar`'s own `isReceded` treatment, rather than an oversight. It has not been fixed, and it has not been declared correct — it is an open item pending an actual visual judgement call, not a forgotten one.

## 5. Remaining Product Polish work

**Step 4 correction 3** (surface-language sweep of the remaining screens, plus the light/dark ordinary-card border/shadow split) is the immediate next implementation item — see §2 and §3 — proposed, awaiting approval, not started.

**Steps 5–9, as currently planned** (not yet started):

- **Step 5 — habit badges.** Wire `BADGE_ACCENTS` into actual habit-badge UI using the deterministic `habit.id`-hash algorithm ruled in §1 (no new stored field, collisions accepted, index-based assignment rejected).
- **Step 6 — icon-usage convention.** Emoji for user-chosen habit identity; `IconSymbol` for system chrome. Addresses the broader icon-language question relative to the mockups' colored-circle-badge convention, separately from the badge-colour work in Step 5.
- **Step 7 — empty-state visual treatment.** Untouched so far; Progress's `emptyState` box was explicitly excluded from every Step 4 pass.
- **Step 8 — accessibility verification.** Contrast-ratio math was done as part of the Step 2 palette design work (documented inline in that step's own proposal), but the manual on-device checks (VoiceOver/TalkBack, dynamic type scaling, reduced-motion, etc.) have not been performed.
- **Step 9 — celebration timing.** The roadmap's own recorded defect ("currently too brief to register; extend to 2–3 seconds minimum") is still true as measured in code: `components/celebration-overlay.tsx:65` currently sets `duration = celebration.big ? 1500 : 1000` (milliseconds) — unchanged by any Product Polish step to date. The overlay has already been confirmed non-blocking and pass-through (`pointerEvents="none"` on both the overlay container and every particle, `components/celebration-overlay.tsx`), so extending the duration is a pure timing change, not an interaction-risk change.

**The mockup scope decision** (§6) comes after Step 5 (badges), against an actual render — not decided in the abstract now, and not gated on Step 4 correction 3.

**Required secondary-screen coverage.** Steps 1–4 covered three *priority* screens (Today, Progress, Habit Detail) end-to-end plus partial typography coverage everywhere. Product Polish's visual language is not fully applied until Step 4 correction 3's screen sweep (Challenges, habit-form, Settings, onboarding, sign-in, reset-password) actually lands — until then, those screens read as an inconsistent mix of the old and new treatment, as the most recent visual review already flagged.

**Recovery Card discoverability** (`docs/implementation-roadmap.md`'s Product Polish punch-list, logged 2026-09-11) remains an explicit, unaddressed remaining item. The problem: the Recovery Card's header reads as a dismissible notification rather than an interactive entry point on first encounter. Not a Phase 5 defect — nothing is functionally broken — but weighted heavily because "returning after a lapse" is the product's core premise and this banner is where a returning user meets it.

The direction, not just the problem:
- make the banner read as an interactive entry point (visual treatment, not a new interaction model)
- preserve the existing × dismissal affordance and its existing behaviour unchanged
- preserve existing expand/collapse behaviour unchanged
- preserve all six existing recovery actions unchanged: Continue today, Do a smaller version (conditional on the habit having a measurable target), Skip for today, Pause this habit, Adjust the schedule, Reflect (`components/recovery-card.tsx`)

This remains presentational/discoverability work, not a behavioural rewrite.

**Completion criterion.** Product Polish is not complete when the three priority screens look right — it is complete only once the visual language has been checked across the *required coverage* (all screens above, not a subset), and only after an actual visual review of that full coverage, not merely once code/tests/lint pass for it.

## 6. Mockup-fidelity assessment

Specific mockup elements visible in `docs/design-references/`, and their status. **None of these is classified as achievable within current Product Polish scope** — all five are outside Product Polish as currently scoped, pending the scope decision noted in §5 (after Step 5, against a render). The notes below record what each would factually require, not a pre-authorisation to build it.

| Mockup element | Status | What it would require |
|---|---|---|
| Status pills ("Due today" / "Done yesterday" / "Paused until Fri") replacing the checkbox-style tap target | Outside Product Polish as scoped | The underlying facts (scheduled, done, paused) already exist in the domain layer, but the checkbox is the primary tap-to-complete control, and a stateful pill changes the row's structure, not just its colour/spacing. |
| Habit subtitles ("Aim for 6–8 cups today", "A few pages is enough") | Outside Product Polish as scoped | `Habit` has no subtitle/description field today. Adding one is a data-model change — new domain logic, ruled out of Product Polish by §1. |
| Illustrated hero cards (plant/hill/sun motifs behind hero/coach cards) | Outside Product Polish as scoped | Ruled static-only if ever implemented (§1), and no illustration assets exist in the repository at all (verified). |
| Handwritten/script accent text | Outside Product Polish as scoped, deferred (§1) | Would require bundling a non-system font, the exact cost `display`'s system-serif choice was designed to avoid. |
| Header framing (a small eyebrow label + a short tagline/icon beside the display heading) | Outside Product Polish as scoped | Would require new copy (a tagline not currently in the app), and content is locked for Product Polish (§1's in-scope/not-in-scope split — "the content is locked, only the craft changes"). |

## 7. Mockup references

The six mockup PNGs live at `docs/design-references/` (`Today-screen-v1-ref.png`, `Today-screen-v2-ref.png`, `Progress-screen-v1-ref.png`, `Reflect-screen-v1-ref.png`, `Habit-screen-v1-ref.png`, `Habit-screen-v2-ref.png`). `Reflect-screen-v1-ref.png` specifically depicts deferred, out-of-scope work — see §1.

**These files are deliberately untracked** (not committed to git) as of this writing. Anyone reading this document from the repository alone — a fresh clone, a CI checkout, a teammate without the original chat session's attachments — will **not** have access to them. This document's descriptions of mockup content are not a substitute for the actual images; treat any fidelity judgement made without the real files in hand as provisional.

## 8. Resume-from-here state

- **Next permitted implementation step:** Step 4 correction 3 — the surface-language sweep of the remaining screens and the light/dark ordinary-card border/shadow split (§2, §3, §5) — but only once that proposal is explicitly approved; nothing in it is authorized to implement yet based on this document alone.
- **Must not be started yet:** Step 5 (habit badges), Step 6 (icon-usage convention), Step 7 (empty states), Step 8 (accessibility verification), Step 9 (celebration timing), and everything in §1's explicitly-deferred list and §6's mockup-fidelity table.
- **Next visual-review checkpoint:** after Step 4 correction 3 lands (both the screen-sweep and the border/shadow split), across dark mode first, then light mode, on the full required-coverage screen set — not just the three priority screens.
- **Visual review remains a gating input.** No Product Polish step is to be treated as settled — regardless of test/type-check/lint status — until an actual rendered screenshot has been reviewed and accepted. This has been true for every step so far and is not being relaxed going forward.
