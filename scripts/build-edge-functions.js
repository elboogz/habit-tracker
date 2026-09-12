#!/usr/bin/env node
// Regenerates the shared-domain block inside both Deno Edge Functions from lib/domain/, so the
// same business logic (dayKey, addDays, isDoneOnDay, calendarStreakForHabit, calendarConsistency
// today; more as Phase 5 needs it) is never hand-duplicated a third time. calendarStreakForHabit
// and calendarConsistency, not streakForHabit/consistency: neither Edge Function fetches
// habit_schedule_periods, so they keep the pre-Scheduled-Opportunity calendar-day behavior under
// an honest name until that's addressed (see lib/domain/habit-stats.ts's doc comments on each).
// See
// docs/phase-2-implementation-plan.md section 2 for the full design: the Edge Functions are
// hand-pasted into the Supabase Dashboard, with no CLI deploy and no build step, so a live shared
// import isn't possible -- this is a deterministic text-splice generator instead. The remaining
// manual step is unchanged: paste the regenerated file into the Dashboard.
//
// Run with: npm run build:edge-functions
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DOMAIN_DIR = path.join(ROOT, 'lib', 'domain');

// Phase 5, Step 3 (docs/phase-5-plan.md section 6.1): extends the pre-Phase-5 whitelist with the
// transitive closure required by buildCoachFacts, hasGroundedInsight and validateCoachOutput,
// hand-enumerated (including private helpers) by an import-aware walk from those three roots --
// re-derived directly from the current source, not copied from any prior estimate. The pre-Phase-5
// entries below are kept exactly as they were: both Edge Functions' existing nudge/reflection
// prompts still call calendarStreakForHabit/calendarConsistency/etc. directly (no call site has
// been switched yet -- see the Step 3 boundary below), so removing them would silently break code
// that is still live. `momentum()` is deliberately excluded: it has zero non-test callers and does
// not appear in the computed closure -- see docs/phase-5-plan.md section 6.1, "momentum() stays
// excluded". `computeConfirmedState` (the generic, non-chain-aware hysteresis helper) is also
// excluded: `confirmedStateAt` no longer calls it (see CLAUDE.md's Momentum contracts section), so
// it is not part of the real closure despite living in the same file.
// Deliberately does not switch any call site -- the generated code becomes available here, nothing
// calls it yet. Each addition goes through the same import-safety check below before it can be
// generated.
const SOURCES = [
  { file: 'day-key.ts', names: ['dayKey', 'addDays', 'parseDayKeyParts', 'weekdayOf', 'localDayKeyOf', 'daysBetween'] },
  { file: 'schedule.ts', names: ['scheduleForDate', 'isScheduledOpportunity', 'scheduledOpportunitiesUpTo', 'scheduledOpportunitiesInWindow'] },
  {
    file: 'config.ts',
    names: ['RECOVERY_CONFIG', 'MOMENTUM_CONFIG', 'HABIT_HEALTH_CONFIG', 'CoachFactsKind', 'CONSISTENCY_WINDOW_DAYS_BY_KIND', 'FAILURE_SENTINEL_TTL_HOURS'],
  },
  {
    file: 'habit-stats.ts',
    names: [
      'logsForHabitOnDay',
      'countForDay',
      'isDoneOnDay',
      'totalCompletions',
      'calendarStreakForHabit',
      'DayStatus',
      'recentHistory',
      'consistency',
      'calendarConsistency',
    ],
  },
  {
    file: 'recovery.ts',
    names: [
      'OpportunityRecord',
      'opportunityRecords',
      'RecoverableLapseInstance',
      'RecoveryEvent',
      'ClosedLapse',
      'RecoveryRateResult',
      'RecoveryRateSummary',
      'recoverableLapseInstances',
      'recoveryEvents',
      'closedLapses',
      'averageRecoveryTime',
      'summarizeRate',
      'recoveryRate',
    ],
  },
  {
    file: 'momentum.ts',
    names: [
      'MomentumStateKey',
      'lastN',
      'isPending',
      'resolvedView',
      'completionRate',
      'meetsRateWindow',
      'meetsBuilding',
      'isCurrentlyQuiet',
      'isRecentShortRecoveryFromLapses',
      'isRebuildingFromLapses',
      'classifyFromRecords',
      'buildCompletionIndex',
      'confirmedStateAt',
      'EVIDENCE_CHAIN',
      'EVIDENCE_RANK',
      'rule2EvidenceRank',
      'computeConfirmedMomentumState',
    ],
  },
  { file: 'habit-health.ts', names: ['HabitHealthVerdict', 'blockCompletionRate', 'habitHealthVerdict'] },
  {
    file: 'coach-facts.ts',
    names: [
      'LapseReasonDistributionKey',
      'LAPSE_REASON_DISTRIBUTION_KEYS',
      'HabitCoachFacts',
      'CoachFacts',
      'RATE_FIELD_NAMES',
      'lapseReasonDistribution',
      'buildHabitCoachFacts',
      'buildCoachFacts',
      'QUALIFYING_MOMENTUM_STATES',
      'hasGroundedInsight',
      'selectLeadingHabit',
    ],
  },
  {
    file: 'coach-validation.ts',
    names: [
      'RATE_FIELD_NAME_SET',
      'ValidationResult',
      'ORDINAL_RE',
      'ISO_DATE_RE',
      'MONTH_NAMES',
      'MONTH_DAY_RE',
      'DAY_MONTH_RE',
      'NUMERAL_RE',
      'maskExemptSpans',
      'collectFactNumbers',
      'isGrounded',
      'validateCoachOutput',
    ],
  },
  {
    // Phase 5, Step 5 Part 3b: Part 1's orchestration is now a real caller (both Edge Functions'
    // ordinary generation paths), so its complete public surface enters SOURCES -- every symbol
    // here is either called directly by the hand-maintained call-site code or referenced by the
    // signature of one that is (resolveCoachGeneration's own parameter/return types, for
    // instance), never added for symmetry.
    file: 'coach-orchestration.ts',
    names: [
      'FallbackProvider',
      'CoachGenerationDeps',
      'CoachGenerationResult',
      'resolveCoachGeneration',
      'RejectionConsequenceDeps',
      'applyRejectionConsequences',
      'isWithinFailureBackoff',
      'shouldCronAttemptToday',
      'RejectionDiagnostic',
      'buildRejectionDiagnostic',
      'FailureSentinelRow',
      'buildFailureSentinelRow',
    ],
  },
  {
    // Phase 5, Step 5 Part 3b: the account-level deterministic fallback (Step 5 Part 2), now
    // actually wired into both Edge Functions. FALLBACK_MESSAGES and fnv1a32/selectFallbackIndex
    // are listed alongside buildFallbackProvider because its body calls them by name -- the
    // generator splices exactly the named declarations, not their transitive callees.
    file: 'coach-fallback.ts',
    names: ['FALLBACK_MESSAGES', 'fnv1a32', 'selectFallbackIndex', 'buildFallbackProvider'],
  },
  {
    // Phase 5, Step 5 Part 3b: the lexical backstop, now called alongside validateCoachOutput at
    // both ordinary generation call sites. escapeRegExp is listed because checkProhibitedLexicon's
    // body calls it by name; CLAUDE_MD_PROHIBITED_FRAMINGS/MOMENTUM_STATE_VALUES/
    // HABIT_HEALTH_VALUES are listed because PROHIBITED_LEXICON's own declaration references all
    // three by name (caught directly by this repository's own Step 1 strict type-check guard when
    // first omitted -- see docs/phase-5-plan.md section 10).
    file: 'coach-lexical-check.ts',
    names: [
      'CLAUDE_MD_PROHIBITED_FRAMINGS',
      'MOMENTUM_STATE_VALUES',
      'HABIT_HEALTH_VALUES',
      'PROHIBITED_LEXICON',
      'LexicalCheckResult',
      'escapeRegExp',
      'checkProhibitedLexicon',
    ],
  },
  {
    // Phase 5, Step 5 Part 3b, D1 fix: combinedValidate moved here from being hand-duplicated in
    // both Edge Functions, so both cache producers run the identical numeric+lexical check by
    // construction. Called directly at both ordinary generation call sites as
    // `deps.validateCoachOutput`.
    file: 'coach-output-check.ts',
    names: ['combinedValidate'],
  },
];

const TARGET_FILES = [
  path.join(ROOT, 'supabase', 'functions', 'ai-insights', 'index.ts'),
  path.join(ROOT, 'supabase', 'functions', 'send-coaching-push', 'index.ts'),
];

const BEGIN_MARKER = '// BEGIN GENERATED DOMAIN -- DO NOT EDIT BELOW. Regenerate with `npm run build:edge-functions`.';
const END_MARKER = '// END GENERATED DOMAIN';

// Deployment stamp (docs/phase-5-precondition-review.md, B6). Both Edge Functions are hand-pasted
// into the Supabase Dashboard, so the deployed copy can silently fall weeks behind the repo -- that
// has already happened once, undetected. Each file therefore carries two generated fingerprints:
//   block -- the generated domain block, identical in both files, so comparing the two answers
//            "are these two deployed functions from the same generated revision?"
//   file  -- the whole file with only its own stamp line neutralized, so comparing it against the
//            repository answers "is what's deployed the current revision?"
// The stamp line is blanked before hashing so a file's stamp never feeds its own fingerprint. That
// is what keeps regeneration idempotent and stops the freshness test above from failing after
// unrelated commits -- a git HEAD SHA would have broken both properties.
const STAMP_LINE_RE = /^const SOURCE_STAMP = .*$/m;
const STAMP_PLACEHOLDER_LINE = 'const SOURCE_STAMP = <PLACEHOLDER>;';

/** sha256 truncated to 12 hex chars: long enough to be unambiguous here, short enough to compare by eye. */
function fingerprint(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12);
}

/**
 * The file with only its stamp line neutralized. Everything else is included in the hash --
 * prompts, DB reads, the hand-maintained type shims, and the generated block. Fingerprinting only
 * the generated block would not be enough: the C1 prompt fix changed no generated code at all, so
 * a block-only stamp would have reported "current" while that fix sat undeployed.
 */
function blankStampLine(source, fileName) {
  if (!STAMP_LINE_RE.test(source)) {
    throw new Error(
      `${fileName} is missing its \`const SOURCE_STAMP = ...\` line -- seed it once by hand, ` +
        'after which this script owns its value and no human ever edits it.',
    );
  }
  return source.replace(STAMP_LINE_RE, STAMP_PLACEHOLDER_LINE);
}

function applyStamp(source, blockFingerprint, fileName) {
  const fileFingerprint = fingerprint(blankStampLine(source, fileName));
  const stamped = source.replace(
    STAMP_LINE_RE,
    `const SOURCE_STAMP = { block: '${blockFingerprint}', file: '${fileFingerprint}' };`,
  );
  return { source: stamped, fileFingerprint };
}

// Refuses to generate if the shared domain layer has picked up a dependency that would break
// either runtime. Enforced every time this script runs, not left to code-review discipline --
// the whole point is that a disallowed dependency can't silently enter the shared layer.
// import-line-only patterns: things that could only ever appear in an import specifier.
const DISALLOWED_IMPORT_PATTERNS = [/expo-/, /react-native/, /@supabase\//];
// whole-source patterns: Deno.* is a global, not an import, so it must be checked everywhere,
// not just on lines starting with `import`.
const DISALLOWED_ANYWHERE_PATTERNS = [/\bDeno\./];

function assertNoDisallowedDependencies(source, fileName) {
  const fail = (pattern, line) => {
    throw new Error(
      `lib/domain/${fileName} references something disallowed in the shared domain layer (matches ${pattern}): ${line.trim()}\n` +
        'The shared domain layer must stay dependency-free so it can be inlined into Deno Edge Functions unchanged.',
    );
  };

  for (const line of source.split('\n')) {
    if (/^\s*import\b/.test(line)) {
      for (const pattern of DISALLOWED_IMPORT_PATTERNS) {
        if (pattern.test(line)) fail(pattern, line);
      }
    }
    for (const pattern of DISALLOWED_ANYWHERE_PATTERNS) {
      if (pattern.test(line)) fail(pattern, line);
    }
  }
}

// Extracts exactly the named top-level `function`/`type`/`const` declarations from `source`,
// each with any contiguous comment block directly above it, in source order. Brace-depth and
// paren-depth are both tracked, outside of comments, to find each declaration's end; a same-line
// open+close (e.g. a one-line type alias) closes immediately. Paren-depth exists because a
// parameter list can contain an inline object-type annotation (e.g. `cfg: { a: number }`) whose
// braces would otherwise self-balance to zero before the declaration's real body has opened.
// Comment-awareness exists because prose can itself contain unbalanced parentheses (e.g. a
// half-open interval like "(3/14, 4/14]"), which must not be counted as code. This still does not
// understand every lexical construct -- brace/paren/comment-like characters inside a string,
// template, or regex literal are not specially handled -- see
// scripts/build-edge-functions.ast-equivalence.test.ts, which is the safeguard against that class.
function extractDeclarations(source, names) {
  const nameSet = new Set(names);
  const lines = source.split('\n');
  const found = new Set();
  const chunks = [];
  let i = 0;
  while (i < lines.length) {
    const match = lines[i].match(/^(?:export )?(function|type|const)\s+([A-Za-z0-9_]+)/);
    if (match && nameSet.has(match[2])) {
      found.add(match[2]);
      let start = i;
      while (start > 0 && /^\s*(\/\*\*|\*\/|\*|\/\/)/.test(lines[start - 1])) start -= 1;

      // `keyword` distinguishes `type` from `function`/`const` below: a `type` alias always
      // terminates with a semicolon at brace/paren depth 0 by TypeScript syntax, even when its
      // right-hand side is a multi-line union with more than one independent `{...}` member (e.g.
      // `type X = | {...} | {...} | {...};`) -- each member closes its own brace back to depth 0
      // on its own line, so "depth returned to 0 after opening" is true after the *first* member
      // and is not, by itself, evidence the declaration is complete. Confirmed directly: this
      // caused CoachGenerationResult (three `|`-joined members, the middle transition separated by
      // an interior doc comment) to truncate after its first member alone -- the same class of bug
      // as the Step 3 `meetsRateWindow` truncation, a different concrete trigger. `function`/
      // `const` bodies are unaffected by this distinction: a function/arrow body's own closing
      // brace *is* its true end, with no further semicolon-terminated content expected after it.
      const keyword = match[1];
      let depth = 0;
      let parenDepth = 0;
      let seenOpen = false;
      let inBlockComment = false;
      let semicolonAtDepthZero = false;
      let end = i;
      for (; end < lines.length; end += 1) {
        const line = lines[end];
        let idx = 0;
        while (idx < line.length) {
          if (inBlockComment) {
            const closeIdx = line.indexOf('*/', idx);
            if (closeIdx === -1) {
              idx = line.length;
              break;
            }
            inBlockComment = false;
            idx = closeIdx + 2;
            continue;
          }
          if (line.startsWith('/*', idx)) {
            inBlockComment = true;
            idx += 2;
            continue;
          }
          if (line.startsWith('//', idx)) break;
          const ch = line[idx];
          if (ch === '{') {
            depth += 1;
            seenOpen = true;
          } else if (ch === '}') {
            depth -= 1;
          } else if (ch === '(') {
            parenDepth += 1;
          } else if (ch === ')') {
            parenDepth -= 1;
          } else if (ch === ';' && depth === 0 && parenDepth <= 0) {
            semicolonAtDepthZero = true;
          }
          idx += 1;
        }
        if (keyword === 'type') {
          if (semicolonAtDepthZero) break;
        } else {
          if (seenOpen && depth === 0 && parenDepth <= 0) break;
          if (!seenOpen && parenDepth <= 0 && /;\s*$/.test(line)) break;
        }
      }

      chunks.push(lines.slice(start, end + 1).join('\n'));
      i = end + 1;
    } else {
      i += 1;
    }
  }

  const missing = names.filter((name) => !found.has(name));
  if (missing.length > 0) {
    throw new Error(`Could not find declaration(s) [${missing.join(', ')}] while extracting from the shared domain layer.`);
  }
  // Drop the `export` keyword -- these become plain local declarations inside the Edge Function's
  // single file, not a module of their own.
  return chunks.join('\n\n').replace(/^export (function|type|const)\b/gm, '$1');
}

function buildGeneratedBlock() {
  const sections = SOURCES.map(({ file, names }) => {
    const source = fs.readFileSync(path.join(DOMAIN_DIR, file), 'utf8');
    assertNoDisallowedDependencies(source, file);
    return `// -- from lib/domain/${file}, do not hand-edit --\n${extractDeclarations(source, names)}`;
  });
  return `${BEGIN_MARKER}\n\n${sections.join('\n\n')}\n\n${END_MARKER}`;
}

function spliceIntoFile(filePath, generatedBlock) {
  const original = fs.readFileSync(filePath, 'utf8');
  const beginIndex = original.indexOf(BEGIN_MARKER);
  const endIndex = original.indexOf(END_MARKER);
  if (beginIndex === -1 || endIndex === -1) {
    throw new Error(
      `${path.relative(ROOT, filePath)} is missing the generated-domain markers -- add them once by ` +
        'hand (see an already-migrated Edge Function for the pattern), then re-run this script.',
    );
  }
  const before = original.slice(0, beginIndex);
  const after = original.slice(endIndex + END_MARKER.length);
  return `${before}${generatedBlock}${after}`;
}

function main() {
  const generatedBlock = buildGeneratedBlock();
  const blockFingerprint = fingerprint(generatedBlock);
  for (const filePath of TARGET_FILES) {
    const relative = path.relative(ROOT, filePath);
    const spliced = spliceIntoFile(filePath, generatedBlock);
    const { source, fileFingerprint } = applyStamp(spliced, blockFingerprint, relative);
    fs.writeFileSync(filePath, source);
    // Printed so the repository-side values are readable without opening the files -- these are
    // what a live function's response should be compared against after a paste.
    console.log(`Regenerated ${relative}  block=${blockFingerprint} file=${fileFingerprint}`);
  }
}

// Exported for scripts/build-edge-functions.test.ts to unit-test the import-safety guard
// directly, rather than only checking it indirectly through the freshness test. SOURCES is
// exported so scripts/build-edge-functions.ast-equivalence.test.ts can derive its coverage from
// the generator's own whitelist rather than a hand-maintained copy that could drift from it.
module.exports = { assertNoDisallowedDependencies, extractDeclarations, fingerprint, blankStampLine, STAMP_LINE_RE, SOURCES };

if (require.main === module) {
  main();
}
