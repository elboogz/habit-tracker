import fs from 'fs';
import path from 'path';
import * as ts from 'typescript';
import { addDays, dayKey } from '../lib/domain/day-key';

// Phase 5, Step 5 Part 3b. Extracts and executes the REAL source of both ai_insights cache
// producers (everything above `Deno.serve(...)` in each file -- every hand-maintained utility
// plus the full generated domain block, with only the two `npm:` imports stripped: `Anthropic` is
// used there only as a type annotation, erased by transpilation, and `createClient` is never
// called inside the functions this file extracts), so these tests exercise the actual artefacts
// rather than a reimplementation of their wiring -- the same "prove we're checking the real thing"
// discipline as scripts/edge-function-mappers.test.ts, applied to processRecipient/generateInsight
// instead of a single mapper. This is the D1 parity mechanism (docs/phase-5-plan.md section 6.4):
// both writers to `ai_insights` are exercised here, not only one.

const ROOT = path.resolve(__dirname, '..');
const SEND_COACHING_PUSH_PATH = path.join(ROOT, 'supabase', 'functions', 'send-coaching-push', 'index.ts');
const AI_INSIGHTS_PATH = path.join(ROOT, 'supabase', 'functions', 'ai-insights', 'index.ts');

/** Extracts everything above `Deno.serve(` from a real Edge Function file and executes it as a
 * CommonJS module, returning the named exports requested. Shared by both loaders below so neither
 * reimplements the extraction mechanics differently. */
function loadRealExports<T>(filePath: string, exportNames: string[]): T {
  const source = fs.readFileSync(filePath, 'utf8');
  const withoutImports = source.replace(/^import .*$/gm, '');
  const denoServeIndex = withoutImports.indexOf('Deno.serve(');
  if (denoServeIndex === -1) throw new Error(`Could not find Deno.serve(...) in ${filePath} -- has the file been restructured?`);
  const executable = withoutImports.slice(0, denoServeIndex);

  const { outputText } = ts.transpileModule(executable, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const moduleObj = { exports: {} as Record<string, unknown> };
  // Minimal Deno stub: ai-insights/index.ts's module-level `corsHeaders` reads
  // `Deno.env.get('ALLOWED_ORIGIN')` at load time (before Deno.serve), which is the only
  // Deno-specific reference anywhere in the extracted region -- neither generateInsight nor
  // processRecipient reference Deno themselves, since Anthropic construction stays in the
  // (unextracted) Deno.serve handler.
  const denoStub = { env: { get: () => undefined } };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const runner = new Function('module', 'exports', 'Deno', `${outputText}\n${exportNames.map((n) => `module.exports.${n} = ${n};`).join('\n')}`);
  runner(moduleObj, moduleObj.exports, denoStub);
  return moduleObj.exports as T;
}

function loadRealModule(): { processRecipient: (...args: unknown[]) => Promise<boolean> } {
  return loadRealExports(SEND_COACHING_PUSH_PATH, ['processRecipient']);
}

function loadRealAiInsightsModule(): {
  generateInsight: (...args: unknown[]) => Promise<{ status: number; body: Record<string, unknown> }>;
} {
  return loadRealExports(AI_INSIGHTS_PATH, ['generateInsight']);
}

const AI_INSIGHTS_KIND_CONFIG = { dbKind: 'nudge', freshnessHours: 20, windowDays: 14, maxTokens: 300, effort: 'low' as const };

type MockConfig = {
  existingInsight?: { content: string; created_at: string; habit_id: string | null } | null;
  habits?: Record<string, unknown>[];
  logs?: Record<string, unknown>[];
  schedulePeriods?: Record<string, unknown>[];
  lapseReasons?: Record<string, unknown>[];
  insertError?: { code: string; message: string } | null;
};

/** Records every insert/update payload, keyed by table, so tests can assert on exactly what the
 * real code tried to write -- not on a re-derived expectation. */
function makeMockSupabase(config: MockConfig) {
  const inserts: { table: string; payload: Record<string, unknown> }[] = [];
  const updates: { table: string; payload: Record<string, unknown> }[] = [];

  function from(table: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      select: () => builder,
      eq: () => builder,
      is: () => builder,
      order: () => builder,
      gt: () => builder,
      limit: () => builder,
      maybeSingle: () => Promise.resolve({ data: table === 'ai_insights' ? (config.existingInsight ?? null) : null }),
      insert: (payload: Record<string, unknown>) => {
        inserts.push({ table, payload });
        return Promise.resolve({ error: config.insertError ?? null });
      },
      update: (payload: Record<string, unknown>) => {
        updates.push({ table, payload });
        return builder;
      },
      then: (resolve: (v: { data: unknown }) => void) => {
        if (table === 'habits') return resolve({ data: config.habits ?? [] });
        if (table === 'habit_logs') return resolve({ data: config.logs ?? [] });
        if (table === 'habit_schedule_periods') return resolve({ data: config.schedulePeriods ?? [] });
        if (table === 'lapse_reasons') return resolve({ data: config.lapseReasons ?? [] });
        if (table === 'push_tokens') return resolve({ data: [] }); // no tokens -- sendExpoPush becomes a no-op, no fetch mock needed
        return resolve({ data: null });
      },
    };
    return builder;
  }

  return { from, inserts, updates };
}

function makeMockAnthropic(text: string) {
  return { messages: { create: async () => ({ content: [{ type: 'text', text }] }) } };
}

const RECIPIENT = { user_id: 'user-1', coach_push_time: '08:00', coach_push_timezone: 'UTC', coach_push_last_sent_date: null };
const TODAY = dayKey(new Date('2026-09-12T12:00:00.000Z'));

/** A single habit with 30 unbroken daily completions -- comfortably past the locked
 * perfect_completion_history fixture's thriving@10 threshold (docs/phase-2-implementation-plan.md
 * section 8), so this reliably lands on a qualifying Momentum state without needing to
 * reverse-engineer exact recovery timing. */
function groundedScenario() {
  const createdDate = addDays(TODAY, -30);
  const habit = { id: 'h-grounded', name: 'Test Habit', emoji: '📚', type: 'simple', target_count: null, created_at: `${createdDate}T00:00:00.000Z` };
  const logs = [];
  for (let i = 0; i < 30; i++) {
    const d = addDays(createdDate, i);
    logs.push({ habit_id: habit.id, date: d, count: 1, reduced: false });
  }
  return { habits: [habit], logs };
}

describe('processRecipient (real send-coaching-push/index.ts source) -- insert-error handling', () => {
  const { processRecipient } = loadRealModule();
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('an ai_insights insert failure does not prevent the fallback push from being reported sent, and still stamps coach_push_last_sent_date', async () => {
    // No habits with any real history -- deterministically non-qualifying (hasGroundedInsight
    // false), so this exercises the fallback path with no dependency on momentum computation.
    const habit = { id: 'h-empty', name: 'Empty', emoji: '📚', type: 'simple', target_count: null, created_at: `${addDays(TODAY, -1)}T00:00:00.000Z` };
    const mock = makeMockSupabase({ existingInsight: null, habits: [habit], logs: [], insertError: { code: '42703', message: 'column "habit_id" does not exist' } });
    const anthropic = makeMockAnthropic('should never be called on the fallback path');

    const wasSent = await processRecipient({ from: mock.from }, anthropic, RECIPIENT, TODAY);

    expect(wasSent).toBe(true); // the fallback message still counts as sent
    expect(consoleErrorSpy).toHaveBeenCalled(); // the failure was logged
    const stamps = mock.updates.filter((u) => u.table === 'user_settings' && 'coach_push_last_sent_date' in u.payload);
    expect(stamps).toHaveLength(1); // stamping still happened despite the insert error
    expect(stamps[0].payload.coach_push_last_sent_date).toBe(TODAY);
  });

  it('an ai_insights insert failure on a validator rejection still stamps coach_push_last_sent_date via markCronPushHandledToday', async () => {
    const { habits, logs } = groundedScenario();
    const mock = makeMockSupabase({ existingInsight: null, habits, logs, insertError: { code: '42703', message: 'column "habit_id" does not exist' } });
    // "streak" is a closed-list lexical entry (docs/phase-5-plan.md section 6.4) -- guarantees a
    // rejection deterministically, independent of the numeric validator's own behaviour.
    const anthropic = makeMockAnthropic('Keep your streak going strong!');

    const wasSent = await processRecipient({ from: mock.from }, anthropic, RECIPIENT, TODAY);

    expect(wasSent).toBe(false); // nothing pushed on a rejection
    const stamps = mock.updates.filter((u) => u.table === 'user_settings' && 'coach_push_last_sent_date' in u.payload);
    expect(stamps).toHaveLength(1);
    expect(stamps[0].payload.coach_push_last_sent_date).toBe(TODAY);
  });
});

describe('processRecipient (real send-coaching-push/index.ts source) -- habit_id persistence semantics', () => {
  const { processRecipient } = loadRealModule();
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('account-level fallback: habit_id is null on the ai_insights insert', async () => {
    const habit = { id: 'h-empty', name: 'Empty', emoji: '📚', type: 'simple', target_count: null, created_at: `${addDays(TODAY, -1)}T00:00:00.000Z` };
    const mock = makeMockSupabase({ existingInsight: null, habits: [habit], logs: [] });
    const anthropic = makeMockAnthropic('should never be called on the fallback path');

    await processRecipient({ from: mock.from }, anthropic, RECIPIENT, TODAY);

    const insert = mock.inserts.find((i) => i.table === 'ai_insights');
    expect(insert?.payload.habit_id).toBeNull();
  });

  it('grounded success: habit_id is the selected habit id on the ai_insights insert', async () => {
    const { habits, logs } = groundedScenario();
    const mock = makeMockSupabase({ existingInsight: null, habits, logs });
    const anthropic = makeMockAnthropic('You have kept this consistent lately.');

    await processRecipient({ from: mock.from }, anthropic, RECIPIENT, TODAY);

    const insert = mock.inserts.find((i) => i.table === 'ai_insights');
    expect(insert?.payload.habit_id).toBe('h-grounded');
    expect(insert?.payload.content).toBe('You have kept this consistent lately.');
  });

  it('grounded rejection/sentinel: habit_id is the selected habit id on the failure-sentinel insert', async () => {
    const { habits, logs } = groundedScenario();
    const mock = makeMockSupabase({ existingInsight: null, habits, logs });
    const anthropic = makeMockAnthropic('Keep your streak going strong!'); // guaranteed lexical rejection

    const wasSent = await processRecipient({ from: mock.from }, anthropic, RECIPIENT, TODAY);

    expect(wasSent).toBe(false);
    const insert = mock.inserts.find((i) => i.table === 'ai_insights');
    expect(insert?.payload.habit_id).toBe('h-grounded');
    expect(insert?.payload.content).toBe(''); // the sentinel -- rejected prose is never persisted
  });
});

describe('generateInsight (real ai-insights/index.ts source) -- insert-error handling', () => {
  const { generateInsight } = loadRealAiInsightsModule();
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('an ai_insights insert failure does not prevent the fallback response from succeeding', async () => {
    const habit = { id: 'h-empty', name: 'Empty', emoji: '📚', type: 'simple', target_count: null, created_at: `${addDays(TODAY, -1)}T00:00:00.000Z` };
    const mock = makeMockSupabase({ existingInsight: null, habits: [habit], logs: [], insertError: { code: '42703', message: 'column "habit_id" does not exist' } });
    const anthropic = makeMockAnthropic('should never be called on the fallback path');

    const { status, body } = await generateInsight({ from: mock.from }, anthropic, 'user-1', 'nudge', AI_INSIGHTS_KIND_CONFIG, TODAY);

    expect(status).toBe(200);
    expect(typeof body.content).toBe('string');
    expect(body.content).not.toBe('');
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('an ai_insights insert failure on a validator rejection still returns a well-formed empty-content response', async () => {
    const { habits, logs } = groundedScenario();
    const mock = makeMockSupabase({ existingInsight: null, habits, logs, insertError: { code: '42703', message: 'column "habit_id" does not exist' } });
    const anthropic = makeMockAnthropic('Keep your streak going strong!'); // guaranteed lexical rejection

    const { status, body } = await generateInsight({ from: mock.from }, anthropic, 'user-1', 'nudge', AI_INSIGHTS_KIND_CONFIG, TODAY);

    expect(status).toBe(200);
    expect(body.content).toBe('');
  });
});

describe('generateInsight (real ai-insights/index.ts source) -- habit_id persistence and response-shape consistency', () => {
  const { generateInsight } = loadRealAiInsightsModule();
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('account-level fallback: habit_id is null on the insert, and habitId is absent from the response', async () => {
    const habit = { id: 'h-empty', name: 'Empty', emoji: '📚', type: 'simple', target_count: null, created_at: `${addDays(TODAY, -1)}T00:00:00.000Z` };
    const mock = makeMockSupabase({ existingInsight: null, habits: [habit], logs: [] });
    const anthropic = makeMockAnthropic('should never be called on the fallback path');

    const { body } = await generateInsight({ from: mock.from }, anthropic, 'user-1', 'nudge', AI_INSIGHTS_KIND_CONFIG, TODAY);

    const insert = mock.inserts.find((i) => i.table === 'ai_insights');
    expect(insert?.payload.habit_id).toBeNull();
    expect(body.habitId).toBeUndefined();
  });

  it('grounded success: habit_id is the selected habit id on the insert, and habitId matches in the response', async () => {
    const { habits, logs } = groundedScenario();
    const mock = makeMockSupabase({ existingInsight: null, habits, logs });
    const anthropic = makeMockAnthropic('You have kept this consistent lately.');

    const { body } = await generateInsight({ from: mock.from }, anthropic, 'user-1', 'nudge', AI_INSIGHTS_KIND_CONFIG, TODAY);

    const insert = mock.inserts.find((i) => i.table === 'ai_insights');
    expect(insert?.payload.habit_id).toBe('h-grounded');
    expect(body.habitId).toBe('h-grounded');
    expect(body.content).toBe('You have kept this consistent lately.');
  });

  it('grounded rejection/sentinel: habitId is present on the FRESH rejection response, matching the persisted sentinel habit_id -- not only on a later cache hit', async () => {
    // Regression test for the item 5 fix: the fresh rejection response previously omitted
    // habitId entirely, even though the sentinel it persisted, and a later cache-hit read of
    // that same sentinel, both carried the selected habit's id.
    const { habits, logs } = groundedScenario();
    const mock = makeMockSupabase({ existingInsight: null, habits, logs });
    const anthropic = makeMockAnthropic('Keep your streak going strong!'); // guaranteed lexical rejection

    const { body } = await generateInsight({ from: mock.from }, anthropic, 'user-1', 'nudge', AI_INSIGHTS_KIND_CONFIG, TODAY);

    const insert = mock.inserts.find((i) => i.table === 'ai_insights');
    expect(insert?.payload.habit_id).toBe('h-grounded'); // the persisted sentinel
    expect(body.content).toBe(''); // the sentinel -- rejected prose is never persisted or returned
    expect(body.habitId).toBe('h-grounded'); // the FRESH response, not just a later cache-hit read
    expect(body.habitId).toBe(insert?.payload.habit_id); // fresh and persisted-then-cached must agree
  });

  it('a later cache hit against that same sentinel returns the identical habitId the fresh rejection did', async () => {
    // Confirms the two response shapes (fresh rejection, cached sentinel re-read) stay consistent
    // for the exact same persisted row, using the real freshness-check code path a second time.
    const sentinelRow = { content: '', created_at: new Date().toISOString(), habit_id: 'h-grounded' };
    const mock = makeMockSupabase({ existingInsight: sentinelRow });
    const anthropic = makeMockAnthropic('should never be called on a cache hit');

    const { status, body } = await generateInsight({ from: mock.from }, anthropic, 'user-1', 'nudge', AI_INSIGHTS_KIND_CONFIG, TODAY);

    expect(status).toBe(200);
    expect(body.content).toBe('');
    expect(body.habitId).toBe('h-grounded');
  });
});

describe('D1 parity: the shared invariants hold identically for both ai_insights producers', () => {
  // Not a second integration harness and not a reimplementation of either function -- both real
  // functions are invoked with the same fixture and cross-checked against each other directly.
  const { generateInsight } = loadRealAiInsightsModule();
  const { processRecipient } = loadRealModule();
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('the same selector picks the same habit for the same facts in both producers', async () => {
    const { habits, logs } = groundedScenario();
    const aiInsightsMock = makeMockSupabase({ existingInsight: null, habits, logs });
    const sendPushMock = makeMockSupabase({ existingInsight: null, habits, logs });
    const anthropic = makeMockAnthropic('You have kept this consistent lately.');

    const { body } = await generateInsight({ from: aiInsightsMock.from }, anthropic, 'user-1', 'nudge', AI_INSIGHTS_KIND_CONFIG, TODAY);
    await processRecipient({ from: sendPushMock.from }, anthropic, RECIPIENT, TODAY);

    const pushInsert = sendPushMock.inserts.find((i) => i.table === 'ai_insights');
    expect(body.habitId).toBe('h-grounded');
    expect(pushInsert?.payload.habit_id).toBe('h-grounded');
    expect(body.habitId).toBe(pushInsert?.payload.habit_id); // same selector, same result
  });

  it('the same generated validation function rejects the same prohibited phrase in both producers', async () => {
    const { habits, logs } = groundedScenario();
    const aiInsightsMock = makeMockSupabase({ existingInsight: null, habits, logs });
    const sendPushMock = makeMockSupabase({ existingInsight: null, habits, logs });
    const anthropic = makeMockAnthropic('Keep your streak going strong!');

    const { body } = await generateInsight({ from: aiInsightsMock.from }, anthropic, 'user-1', 'nudge', AI_INSIGHTS_KIND_CONFIG, TODAY);
    const wasSent = await processRecipient({ from: sendPushMock.from }, anthropic, RECIPIENT, TODAY);

    expect(body.content).toBe(''); // rejected in ai-insights
    expect(wasSent).toBe(false); // rejected in send-coaching-push too
    const pushInsert = sendPushMock.inserts.find((i) => i.table === 'ai_insights');
    expect(pushInsert?.payload.content).toBe(''); // both persisted the same empty sentinel, never the rejected prose
  });

  it('both producers persist the same habit_id on a rejection sentinel for the same facts', async () => {
    const { habits, logs } = groundedScenario();
    const aiInsightsMock = makeMockSupabase({ existingInsight: null, habits, logs });
    const sendPushMock = makeMockSupabase({ existingInsight: null, habits, logs });
    const anthropic = makeMockAnthropic('Keep your streak going strong!');

    await generateInsight({ from: aiInsightsMock.from }, anthropic, 'user-1', 'nudge', AI_INSIGHTS_KIND_CONFIG, TODAY);
    await processRecipient({ from: sendPushMock.from }, anthropic, RECIPIENT, TODAY);

    const aiInsightsInsert = aiInsightsMock.inserts.find((i) => i.table === 'ai_insights');
    const pushInsert = sendPushMock.inserts.find((i) => i.table === 'ai_insights');
    expect(aiInsightsInsert?.payload.habit_id).toBe('h-grounded');
    expect(pushInsert?.payload.habit_id).toBe('h-grounded');
  });
});

describe('rejection diagnostic content: matchedPhrases vs invalidNumerals stay distinguishable in the real logged output', () => {
  const { generateInsight } = loadRealAiInsightsModule();
  const { processRecipient } = loadRealModule();
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  function loggedRejectionDiagnostic(): Record<string, unknown> {
    const call = consoleErrorSpy.mock.calls.map((args) => args[0]).find((arg) => typeof arg === 'string' && arg.includes('coach generation rejected'));
    if (!call) throw new Error('No "coach generation rejected" console.error call was captured');
    return JSON.parse(call as string);
  }

  it('ai-insights: a numeric-only rejection omits matchedPhrases and populates invalidNumerals', async () => {
    const { habits, logs } = groundedScenario();
    const mock = makeMockSupabase({ existingInsight: null, habits, logs });
    const anthropic = makeMockAnthropic('You completed this 999 times this month.'); // fabricated, no lexical-list word

    await generateInsight({ from: mock.from }, anthropic, 'user-1', 'nudge', AI_INSIGHTS_KIND_CONFIG, TODAY);

    const logged = loggedRejectionDiagnostic();
    expect(logged.invalidNumerals).toContain('999');
    expect(logged.matchedPhrases).toBeUndefined();
  });

  it('ai-insights: a lexical-only rejection has empty invalidNumerals and populates matchedPhrases', async () => {
    const { habits, logs } = groundedScenario();
    const mock = makeMockSupabase({ existingInsight: null, habits, logs });
    const anthropic = makeMockAnthropic('Keep your streak going strong!');

    await generateInsight({ from: mock.from }, anthropic, 'user-1', 'nudge', AI_INSIGHTS_KIND_CONFIG, TODAY);

    const logged = loggedRejectionDiagnostic();
    expect(logged.invalidNumerals).toEqual([]);
    expect(logged.matchedPhrases).toEqual(expect.arrayContaining(['streak']));
  });

  it('send-coaching-push: a numeric-only rejection omits matchedPhrases and populates invalidNumerals', async () => {
    const { habits, logs } = groundedScenario();
    const mock = makeMockSupabase({ existingInsight: null, habits, logs });
    const anthropic = makeMockAnthropic('You completed this 999 times this month.');

    await processRecipient({ from: mock.from }, anthropic, RECIPIENT, TODAY);

    const logged = loggedRejectionDiagnostic();
    expect(logged.invalidNumerals).toContain('999');
    expect(logged.matchedPhrases).toBeUndefined();
  });

  it('send-coaching-push: a lexical-only rejection has empty invalidNumerals and populates matchedPhrases', async () => {
    const { habits, logs } = groundedScenario();
    const mock = makeMockSupabase({ existingInsight: null, habits, logs });
    const anthropic = makeMockAnthropic('Keep your streak going strong!');

    await processRecipient({ from: mock.from }, anthropic, RECIPIENT, TODAY);

    const logged = loggedRejectionDiagnostic();
    expect(logged.invalidNumerals).toEqual([]);
    expect(logged.matchedPhrases).toEqual(expect.arrayContaining(['streak']));
  });
});
