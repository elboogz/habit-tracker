#!/usr/bin/env node
// Regenerates the shared-domain block inside both Deno Edge Functions from lib/domain/, so the
// same business logic (dayKey, addDays, isDoneOnDay, streakForHabit, calendarConsistency today;
// more as Phase 5 needs it) is never hand-duplicated a third time. calendarConsistency, not
// consistency: neither Edge Function fetches habit_schedule_periods, so they keep the
// pre-Scheduled-Opportunity calendar-day behavior under an honest name until that's addressed
// (see lib/domain/habit-stats.ts's doc comment on calendarConsistency). See
// docs/phase-2-implementation-plan.md section 2 for the full design: the Edge Functions are
// hand-pasted into the Supabase Dashboard, with no CLI deploy and no build step, so a live shared
// import isn't possible -- this is a deterministic text-splice generator instead. The remaining
// manual step is unchanged: paste the regenerated file into the Dashboard.
//
// Run with: npm run build:edge-functions
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DOMAIN_DIR = path.join(ROOT, 'lib', 'domain');

// Only these named declarations are inlined today -- the specific functions the two Edge
// Functions currently hand-duplicate. lib/domain/habit-stats.ts also exports challengeProgress
// and friends, which depend on Challenge/HabitSchedulePeriod/isScheduledOpportunity that have no
// equivalent in either Edge Function -- deliberately excluded, not just "everything in the file".
// Phase 5's AI coach rewrite will extend this list when it needs the newer recovery/momentum
// functions server-side; each addition goes through the same import-safety check below before it
// can be generated.
// Kept to exactly the functions each Edge Function actually calls plus their own direct
// dependencies (not "everything available") -- e.g. weekdayOf/localDayKeyOf/daysBetween/
// isDoneToday/longestStreak exist in the same source files but aren't pulled in here, since
// neither Edge Function uses them today and including them would be unused, speculative code.
const SOURCES = [
  { file: 'day-key.ts', names: ['dayKey', 'addDays'] },
  { file: 'habit-stats.ts', names: ['logsForHabitOnDay', 'countForDay', 'isDoneOnDay', 'streakForHabit', 'DayStatus', 'recentHistory', 'calendarConsistency'] },
];

const TARGET_FILES = [
  path.join(ROOT, 'supabase', 'functions', 'ai-insights', 'index.ts'),
  path.join(ROOT, 'supabase', 'functions', 'send-coaching-push', 'index.ts'),
];

const BEGIN_MARKER = '// BEGIN GENERATED DOMAIN -- DO NOT EDIT BELOW. Regenerate with `npm run build:edge-functions`.';
const END_MARKER = '// END GENERATED DOMAIN';

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
// each with any contiguous comment block directly above it, in source order. Brace-depth is
// tracked to find each declaration's end; a same-line open+close (e.g. a one-line type alias)
// closes immediately.
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

      let depth = 0;
      let seenOpen = false;
      let end = i;
      for (; end < lines.length; end += 1) {
        for (const ch of lines[end]) {
          if (ch === '{') {
            depth += 1;
            seenOpen = true;
          } else if (ch === '}') {
            depth -= 1;
          }
        }
        if (seenOpen && depth === 0) break;
        if (!seenOpen && /;\s*$/.test(lines[end])) break;
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
  for (const filePath of TARGET_FILES) {
    const next = spliceIntoFile(filePath, generatedBlock);
    fs.writeFileSync(filePath, next);
    console.log(`Regenerated ${path.relative(ROOT, filePath)}`);
  }
}

// Exported for scripts/build-edge-functions.test.ts to unit-test the import-safety guard
// directly, rather than only checking it indirectly through the freshness test.
module.exports = { assertNoDisallowedDependencies, extractDeclarations };

if (require.main === module) {
  main();
}
