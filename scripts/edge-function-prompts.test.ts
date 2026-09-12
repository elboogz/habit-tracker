import fs from 'fs';
import path from 'path';

// Phase 5, Step 5 Part 3b (docs/phase-5-plan.md section 6.3's "Prompt provenance" ruling): both
// Edge Functions hand-duplicate their shared prompt/style constants -- paste-in functions are
// deployed independently and share no live module system -- so a repository test asserting
// byte-identity is the agreed provenance mechanism. This detects drift, it does not prevent it,
// per that ruling's own recorded limitation: nothing stops a future hand-edit to one file's copy
// alone, this only fails loudly the next time the suite runs.

const ROOT = path.resolve(__dirname, '..');
const AI_INSIGHTS = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'ai-insights', 'index.ts'), 'utf8');
const SEND_COACHING_PUSH = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'send-coaching-push', 'index.ts'), 'utf8');

/** Extracts a `const NAME = ...;` declaration's full text, from its own line through the first
 * semicolon that terminates it at the top level (none of these declarations contain a literal
 * `;` inside their own value, so this simple scan is sufficient -- unlike the generator's own
 * extractDeclarations, this test does not need to handle arbitrary TypeScript syntax). */
function extractConst(source: string, name: string): string {
  const marker = `const ${name} =`;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`Could not find "${marker}" -- has the file been restructured?`);
  const end = source.indexOf(';\n', start);
  if (end === -1) throw new Error(`Could not find the terminating ";" for "${name}"`);
  return source.slice(start, end + 1);
}

describe('Edge Function prompt/style constants stay byte-identical across both functions', () => {
  it.each(['STYLE_RULES', 'ROLE_INTRO', 'COACH_RULES'])('%s is byte-identical between ai-insights and send-coaching-push', (name) => {
    const a = extractConst(AI_INSIGHTS, name);
    const b = extractConst(SEND_COACHING_PUSH, name);
    expect(a).toEqual(b);
  });

  it('the nudge system prompt (NUDGE_SYSTEM_PROMPT) is byte-identical between both functions', () => {
    const a = extractConst(AI_INSIGHTS, 'NUDGE_SYSTEM_PROMPT');
    const b = extractConst(SEND_COACHING_PUSH, 'NUDGE_SYSTEM_PROMPT');
    expect(a).toEqual(b);
  });

  it('sanity: the extracted NUDGE_SYSTEM_PROMPT text is non-trivial, so an empty-string false pass is impossible', () => {
    const a = extractConst(AI_INSIGHTS, 'NUDGE_SYSTEM_PROMPT');
    expect(a.length).toBeGreaterThan(400);
    expect(a).toContain('rule 3');
  });
});
