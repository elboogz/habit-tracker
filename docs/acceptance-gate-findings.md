# Phase 5 Acceptance Gate — findings

Written per `docs/implementation-roadmap.md`'s Acceptance Gate instruction ("Write findings to `docs/acceptance-gate-findings.md` as a prioritised list"), against the corrected gate wording (`docs/phase-5-plan.md` §9, applied 2026-09-20). Findings are recorded with their evidence, resolution, and residual scope — not asserted as closed without the evidence that closed them.

Each finding also carries the roadmap's own classification (line 72-76: **critical** = blocks further phases, **important** = address before Product Polish, **cosmetic** = defer to Product Polish), added alongside the existing status language rather than replacing it — a finding's classification reflects its severity as found, independent of whether it has since been addressed. See "Acceptance Gate pass condition" at the end of this document.

## 1. CORS incident and resolution — Closed

**Roadmap classification: critical** (fully addressed). A total, live break of the web platform's AI-coach functionality — directly relevant to the gate's own review question ("are nudges grounded and specific, or generic?"), since no nudge could be shown at all. Classified by its severity as found, not downgraded for having since been fixed.

The Progress web build could not reach `ai-insights` from a browser after the Step 5 Part 3c cache clear (two `200 OPTIONS`, zero `POST`). Root cause, proven live: the deployed `ALLOWED_ORIGIN` secret held a launch placeholder, so the returned `Access-Control-Allow-Origin` never matched the browser's `http://localhost:8081`. Pre-existing since the function's original commit, not a Phase 5 regression — no Phase 5 change touched CORS handling before this fix.

**Fix, deployed and verified:** two independent, optional exact-match secrets (`ALLOWED_ORIGIN_DEV`, `ALLOWED_ORIGIN_PROD`), never a wildcard, never prefix/suffix matching; the request's `Origin` is echoed back only on an exact match. Live-verified: matching origin returns exactly that `Access-Control-Allow-Origin`; an unrelated origin returns none; a missing `Origin` header (curl, cron, B6) is unaffected. `send-coaching-push` has no CORS handling and was not touched. Full detail: `docs/phase-5-plan.md` §6.8.

## 2. B6 browser-CORS scope limitation — Accepted, recorded

**Roadmap classification: important.** A verification-process gap, not a currently-broken feature — it doesn't itself block Phase 6, but leaves a real blind spot (a similar future regression could pass every existing check) that should be closed with an explicit browser-origin check alongside B6, not indefinitely deferred.

Every B6 deployment check in this phase used `curl`, which performs no browser preflight and enforces no CORS policy. A clean stamp match and a successful no-Origin `curl` POST could pass while the web app remained unreachable from a real browser — exactly what happened above. **Accepted as a structural verification gap**, not fixed: `docs/phase-5-plan.md` §10 now carries this explicitly, with the practical implication that any browser-consumed Edge Function with CORS behavior needs an explicit browser-origin/OPTIONS check alongside the existing B6 stamp check going forward. Does not change what the `block`/`file` fingerprints mean.

## 3. Cross-kind fallback collision — Closed, deployed, browser-verified

**Roadmap classification: critical** (fully addressed). A live, user-visible product defect discovered during acceptance testing — two coaching cards showing byte-identical generic text reads as broken, and answers the gate's own "grounded and specific, or generic?" review question in the worst possible way. Classified by its severity as found, not downgraded for having since been fixed.

Coach (`nudge`) and Weekly reflection could show byte-identical fallback text on the same screen, since `buildFallbackProvider`'s seed ignored `kind`. A first fix (hashing `kind` into the seed) was proven insufficient before shipping — a direct search against that implementation found a 52% cross-kind collision rate over 30,000 sampled account/day pairs, matching what independent random draws into five buckets would produce.

**Fix, deployed and verified:** the base hash is unchanged from the original ruling (`userId + dayKey`); `kind` now applies one of three fixed, unique offsets (`KIND_OFFSETS`) afterward, guaranteeing pairwise-distinct selection for every account/day — proven exhaustively over all possible base values, not sampled. The fixed cyclic relationship this creates between kinds shown together is consciously accepted (message order is never shown to a user). Live: `block 91808f504d92`, B6-matched on both functions, and confirmed by a **predictive** browser check — the exact pair (`nudge` index 4, `weekly` index 0) was computed from the deployed logic before the load and appeared on the correct surfaces. Full detail: `docs/phase-5-plan.md` §6.5.

## 4. Legacy `SOURCES` cleanup — Closed, deployed

**Roadmap classification: cosmetic** (internal generated-block hygiene, zero user-visible or functional impact; "defer to Product Polish" doesn't literally apply since this is developer-facing cleanup already completed, not deferred). Fully addressed.

`countForDay`, `calendarStreakForHabit`, `DayStatus`, `recentHistory`, `calendarConsistency` were kept in the generated-domain whitelist only because both Edge Functions' pre-Phase-5 `calendar*` prompt code called them directly; that code no longer exists since Step 5's prompt rewrite. Reference search confirmed zero remaining hand-maintained call sites in either function. Removed from `SOURCES` only — domain implementations, barrel exports, client consumers (Habit Detail, heatmap components), and their own domain tests are untouched. Shipped in the same both-functions paste as finding 3 and verified by the same live B6 match (`block 91808f504d92`).

## 5. Grounded coaching — live-generation sample obtained; scope stated precisely

**Roadmap classification: critical** (addressed). Directly answers the gate's own review question ("are nudges grounded and specific, or generic?") — the Acceptance Gate could not honestly pass this question with zero live grounded evidence. Addressed by obtaining and passing one representative live sample; the six unexercised combinations below are each separately classified, and none rises to critical (see the table's own "roadmap classification" column).

Before 2026-09-20, every observed live generation had taken the deterministic fallback path (no account's habit state provided a qualifying `hasGroundedInsight`), leaving the grounded prompt, the numeric validator, the lexical backstop, the prompt's constraint rules (rule 7 named specifically — it has no independent mechanical backstop), and the validator/rejection path all unexercised against genuine live model output on the production path.

**Sample obtained, dedicated test account only, real account data untouched:**
- Diagnostic-confirmed pre-generation state: one habit, `momentumState: building`, `totalCompletions: 5`, `recoveryCount: 1`, `consistencyPct: 83`, `consistencyWindowOpportunities: 6`, `habitHealth: insufficient_evidence`, `hasGroundedInsight: true` — matched a prediction fixed in advance by running the real `scenarioPattern`/`buildCoachFacts` source, not asserted after the fact.
- One real `nudge` generation, one call, no retry. Accepted (non-sentinel) output: *"You are completing this habit consistently, with an 83% rate across 6 Scheduled Opportunities. Keeping a small, specific time set aside for it can help that consistency hold as you build further."*
- Checked against a checklist fixed **before** the call, derived from the committed `COACH_RULES`, the diagnostic `CoachFacts`, and the deployed validator/lexical rules — not reconstructed after seeing the output. All items passed: only the two supplied numbers used (`83%`, `6 Scheduled Opportunities`), no invented or derived number, the two absent recovery fields correctly never mentioned or inferred, rule 7 satisfied (both the no-softening-via-habitHealth clause and the no-literal-label clause), rule 8 satisfied (silent on Habit Health, correct for `insufficient_evidence`), rule 10 satisfied (silent on lapse cause, correct for all-zero `lapseReasonCounts`), no prohibited lexical term present, no habit-name leakage, returned `habit_id` matched the selected habit, deployed stamp unchanged (`91808f504d92` / `1000424b591c`).

**Exact evidence scope — what this closes and what it does not.** This demonstrates the production grounded-generation path end-to-end on one controlled, representative case. It does **not** by itself demonstrate every kind/state combination — see the classification below for each.

### Classification of the six unexercised combinations

Per the roadmap's Acceptance Gate instruction, each is assessed against existing automated coverage, the residual-risk register, and MVP criticality — not automatically escalated to a live-test requirement.

| Unexercised combination | Existing coverage | Assessment | Roadmap classification |
|---|---|---|---|
| Grounded `weekly`/`monthly` | Same `resolveCoachGeneration`/`combinedValidate` code path as `nudge`, kind-agnostic; `edge-function-prompts.test.ts` pins prompt content/byte-identity; the historical 90-call live measurement (`docs/phase-5-plan.md` §6.4, "3a.2 rerun") exercised multiple kinds against real Claude output, including the kind-relative `consistencyWindowOpportunities` fixture. | **Not a blocking gap.** No code-level reason the validated pipeline would behave differently by kind; substantial live evidence already exists on the shared layer. | Important |
| Other qualifying momentum states (`thriving`, `recovering`, `rebuilding`) | `hasGroundedInsight`/`candidateStateAt`/`confirmedStateAt` are exhaustively unit- and property-tested (`momentum.exhaustive.test.ts`). The 90-call measurement's confirmed false-positive analysis directly evidences real fixtures carrying `thriving` and `rebuilding` as genuine values. Rule 7 names all four states identically and is enforced by the same instruction regardless of which literal value is present. | **Not a blocking gap.** Two of the three already have direct live evidence; the fourth (`recovering`) is not independently evidenced but shares an identical, value-agnostic enforcement mechanism with the other three. Residual risk (rule 7's unproven effectiveness for the three lexically-unbacked values) is already accepted MVP-wide in §10, not specific to an untested state. | Important |
| `habitHealth: positive_recent_comparison` | Deterministic verdict computation is unit-tested (`habit-health.test.ts`). Rule 8's compliant-mention form is a fixed template, not free text; `positive_recent_comparison` is on `PROHIBITED_LEXICON` (a leak of the literal enum value would be mechanically caught, unlike the three removed momentum terms). Not independently confirmed among the 90-call measurement's six fixtures. | **Residual note, not a blocking gap.** The one live-untested branch closest to acceptance-relevant, given rule 8 is a positive instruction (state something correctly) rather than a silence instruction (already exercised by this session's sample). `positive_recent_comparison` being on `PROHIBITED_LEXICON` means a literal Habit Health enum leak has a mechanical backstop — this makes rule 8's residual risk here **materially lower** than rule 7's residual risk for the three momentum terms (`building`, `steady`, `quiet`) that were removed from that same list and now rely on the prompt instruction alone. Worth a future live sample opportunistically, not a Phase 5 blocker. | Important |
| A stated lapse reason (rule 10's positive branch) | Not independently confirmed among the 90-call measurement's fixtures. Rule 10's constraint (mention only as "a reason noted before," never a certain cause) is enforced by the same prompt-instruction mechanism as every other qualitative rule; no dedicated mechanical backstop, same class as rule 8/9. | **Residual note, not a blocking gap.** Symmetric in kind to the already-accepted qualitative-rule residual risk; no evidence of live divergent behavior. | Important |
| A live validator rejection through the deployed production path | `scripts/edge-function-wiring.test.ts` extracts and executes the **real** `generateInsight`/`processRecipient` source (not a reimplementation) against a mocked Anthropic rejection, exercising the actual sentinel-persistence and response-shape code. The 90-call measurement produced 24 real rejections (1 numeric, 23 lexical) against real model output, just not through this specific deployed Edge Function invocation. | **Not a blocking gap.** The rejection-handling code is validator-output-agnostic (it receives a string and a `ValidationResult`, regardless of whether a real or mocked call produced them); both halves — real rejection *content* and real *code path* — are independently well covered, just not simultaneously in one sample. | Important |

**Conclusion: no further live generation is required to close Phase 5** on this finding. The production path is demonstrated end-to-end; the untested combinations are covered by a combination of value-agnostic code, exhaustive unit tests, and a substantial pre-existing live measurement, with two items (`positive_recent_comparison`, a stated lapse reason) noted as good candidates for opportunistic future live confirmation rather than mandatory blockers.

## 6. Documentation reconciliation — Closed

**Roadmap classification: cosmetic** (informational accuracy only, zero functional impact; "defer to Product Polish" doesn't literally apply since this is documentation work already completed, not deferred). Fully addressed.

All seven rows of `docs/phase-5-plan.md` §12's reconciliation table are resolved as of 2026-09-20 (six corrected in this pass, one already corrected during the Step 5 Part 3 legacy cleanup). The Acceptance Gate wording correction (§9) is applied to `docs/implementation-roadmap.md:66`.

## Acceptance Gate pass condition

In the roadmap's own terms (line 78): **"Address all critical findings before proceeding."** Three findings are classified critical by severity as found: #1 (CORS), #3 (cross-kind fallback collision), #5 (grounded coaching live-generation gap). All three are fully addressed — #1 and #3 deployed and verified live; #5 by obtaining and passing one representative live sample, with every unexercised combination individually assessed as non-blocking (none classified critical). **No critical finding remains unaddressed. The Acceptance Gate pass condition is satisfied.**

## Remaining Phase 5 blockers

**None identified.** All eight `docs/phase-5-plan.md` §12 completion criteria are satisfied; this document exists as that criterion's own deliverable. The one item deliberately **not** on this list is fact-inspection-diagnostic removal — confirmed a Phase 6 entry precondition, not a Phase 5 closure requirement (§6.7/§12, "One obligation outlives Phase 5").

## Phase 6 inheritance

Pointers, not summaries — see the named section for detail on each.

- **Fact-inspection diagnostic removal** is a Phase 6 entry precondition, not optional cleanup. Mechanics (trigger, verification step, proof) are in `docs/phase-5-plan.md` §6.7, "The removal condition, named."
- **Open §10 residual risks, by name** (detail at `docs/phase-5-plan.md` §10): the digit-only numeric-validator blind spot (spelled-out/invented non-digit numbers pass unseen); the two named branch-attribution limitations (reads facts at inspection time, not generation time; covers `ai-insights` only, not `send-coaching-push`); the `isDoneOnDay`/`buildCompletionIndex` drift risk (no mechanism detects divergence); absent schema-drift/migration tooling; `send-coaching-push`'s discipline-only user-scoping (no automated enforcement); unchecked `ai_insights` insert results; cached grounded coaching potentially describing a no-longer-current habit under Route C; `lapseReasonCounts` as a lifetime aggregate not linked to a specific lapse.
- **Rule 7 has no mechanical backstop** for the three lexically-unbacked momentum terms (`building`, `steady`, `quiet`) — removed from `PROHIBITED_LEXICON` on confirmed false-positive evidence, leaving the prompt instruction as the sole control, with its effectiveness never independently demonstrated. Detail: `docs/phase-5-plan.md` §10, "Common-English momentum-enum leakage."
- **The `.env` publishable-key path is untested** — see `docs/phase-5-plan.md` §10, new row, and `CLAUDE.md`'s "Deployment stamp" section for the operational credential-handling detail.
- **§11's Class B debt register** (`docs/phase-5-plan.md` §11) — four items, unchanged by this closure.
- **Step 1 guard's two named blind spots** (`docs/phase-5-plan.md` §10): cannot detect an under-selected `.select()` string; row-type-shim coverage splits into converter-existence versus converter-correctness, and only the former is guarded.
