// Phase 5, Step 5 Part 3b (docs/phase-5-plan.md section 6.4's "Lexical backstop" addition):
// combines the numeric validator with the lexical backstop into the single check
// resolveCoachGeneration's `deps.validateCoachOutput` slot expects. Moved into lib/domain and
// SOURCES-listed rather than hand-duplicated in both Edge Functions (an earlier version of this
// step did hand-duplicate it) -- this is pure domain composition with no Edge Function dependency
// at all (no Deno global, no supabase client, no fetch), so both cache producers (ai-insights,
// send-coaching-push) running the identical implementation by construction is the safer
// guarantee, not merely a byte-identity test after the fact. See docs/phase-5-plan.md section
// 6.4's D1 note for why validation logic specifically is the highest-stakes thing to keep
// identical between the two writers to `ai_insights`.
//
// Numeric and lexical failures must stay distinguishable in the resulting diagnostic
// (buildRejectionDiagnostic reports invalidNumerals; conflating a rejected phrase like "getting
// back on track" into that field would misrepresent it as a numeral). ValidationResult's `false`
// branch carries an optional `matchedPhrases` field for exactly this, so `invalidNumerals` stays
// honestly empty on a purely lexical failure rather than being repurposed to hold phrase strings.
import type { CoachFacts } from './coach-facts';
import { validateCoachOutput, type ValidationResult } from './coach-validation';
import { checkProhibitedLexicon } from './coach-lexical-check';

export function combinedValidate(text: string, facts: CoachFacts): ValidationResult {
  const numeric = validateCoachOutput(text, facts);
  if (!numeric.valid) return numeric;
  const lexical = checkProhibitedLexicon(text);
  if (!lexical.valid) return { valid: false, invalidNumerals: [], matchedPhrases: lexical.matchedPhrases };
  return { valid: true };
}
