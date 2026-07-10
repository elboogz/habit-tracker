// @ts-nocheck — Deno runtime: npm: specifiers and the Deno global are not recognised by the
// project's Node tsconfig. The code is type-safe under Deno's own checker (deno check).
// Paste this into Supabase Dashboard -> Edge Functions -> Create a new function ("ai-insights").
// Set the ANTHROPIC_API_KEY secret under Edge Functions -> Secrets before invoking.
import { createClient } from 'npm:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk';

// Set the ALLOWED_ORIGIN secret in Supabase Edge Function secrets to your production
// web domain (e.g. https://your-app.expo.app). Falls back to localhost for local dev.
// The native iOS/Android app sends no Origin header so CORS is irrelevant there.
const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? 'http://localhost:8081',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Vary': 'Origin',
};

type Kind = 'nudge' | 'weekly' | 'monthly';

const KIND_CONFIG: Record<Kind, { dbKind: string; freshnessHours: number; windowDays: number; maxTokens: number; effort: 'low' | 'medium' }> = {
  nudge: { dbKind: 'nudge', freshnessHours: 20, windowDays: 14, maxTokens: 300, effort: 'low' },
  weekly: { dbKind: 'weekly_reflection', freshnessHours: 24 * 7, windowDays: 7, maxTokens: 700, effort: 'medium' },
  monthly: { dbKind: 'monthly_reflection', freshnessHours: 24 * 30, windowDays: 30, maxTokens: 700, effort: 'medium' },
};

// Shared style rules: em dashes are a recognizable "AI tell" — use commas or separate sentences
// instead. Emoji are handled by the app UI (section titles), not the body text.
const STYLE_RULES =
  'Write in plain, natural sentences — never use em dashes (—); use commas or split into separate ' +
  'sentences instead. Do not include any emoji in the text. Plain text only, no markdown.';

const SYSTEM_PROMPTS: Record<Kind, string> = {
  nudge:
    "You are an encouraging, perceptive habit-tracking coach. Given a user's recent habit data, write a short " +
    '1-3 sentence personalized message: call out one specific strength (a streak or high consistency %) and one ' +
    `area that could use attention, with a small, concrete suggestion. Be warm and specific, not generic. ${STYLE_RULES}`,
  weekly:
    'You are an encouraging, perceptive habit-tracking coach writing a brief weekly reflection from a user’s ' +
    'habit data. In 2-4 short sentences, name the habit they were most consistent with (with the %), one that ' +
    'dropped off or needs attention, and one specific, actionable suggestion for the coming week. Be warm, ' +
    `specific, and concise. ${STYLE_RULES}`,
  monthly:
    'You are an encouraging, perceptive habit-tracking coach writing a brief monthly reflection from a user’s ' +
    'habit data. In 3-5 short sentences, summarize their strongest habit this month (with the % or streak), one ' +
    'that needs more attention, any notable trend across the month, and one specific suggestion going forward. ' +
    `Be warm, specific, and concise. ${STYLE_RULES}`,
};

// BEGIN GENERATED DOMAIN -- DO NOT EDIT BELOW. Regenerate with `npm run build:edge-functions`.

// -- from lib/domain/day-key.ts, do not hand-edit --
/** Local day key 'YYYY-MM-DD' — avoids UTC off-by-one issues from toISOString(). */
function dayKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(key: string, amount: number): string {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(year, month - 1, day + amount);
  return dayKey(date);
}

// -- from lib/domain/habit-stats.ts, do not hand-edit --
function logsForHabitOnDay(logs: HabitLog[], habitId: string, date: string): HabitLog[] {
  return logs.filter((log) => log.habitId === habitId && log.date === date);
}

function countForDay(logs: HabitLog[], habitId: string, date: string): number {
  return logsForHabitOnDay(logs, habitId, date).reduce((sum, log) => sum + log.count, 0);
}

function isDoneOnDay(habit: Habit, logs: HabitLog[], date: string): boolean {
  const total = countForDay(logs, habit.id, date);
  return habit.type === 'count' ? total >= (habit.targetCount ?? 1) : total > 0;
}

/**
 * Consecutive days (ending `asOfDate` or the day before) where the habit's target was met.
 * `asOfDate` defaults to the caller's live local "today" -- the only case the client app ever
 * needs. It exists as an explicit parameter because the send-coaching-push Edge Function must
 * compute this per recipient's own local "today" (their timezone, not the server's) rather than
 * the server's current date; that per-recipient date is what's passed in there.
 */
function streakForHabit(habit: Habit, logs: HabitLog[], asOfDate: string = dayKey()): number {
  let cursor = isDoneOnDay(habit, logs, asOfDate) ? asOfDate : addDays(asOfDate, -1);

  let streak = 0;
  while (isDoneOnDay(habit, logs, cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

type DayStatus = { date: string; done: boolean; count: number };

/**
 * Most recent `days` days (oldest first) ending `asOfDate`, with completion status -- powers the
 * heatmap/bars. See streakForHabit's doc comment for why `asOfDate` is an explicit, defaulted
 * parameter rather than always "now".
 */
function recentHistory(habit: Habit, logs: HabitLog[], days: number, asOfDate: string = dayKey()): DayStatus[] {
  const result: DayStatus[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = addDays(asOfDate, -i);
    const count = countForDay(logs, habit.id, date);
    result.push({ date, count, done: isDoneOnDay(habit, logs, date) });
  }
  return result;
}

/** Fraction (0-1) of the last `days` days (ending `asOfDate`) the habit was completed. */
function consistency(habit: Habit, logs: HabitLog[], days: number, asOfDate: string = dayKey()): number {
  const history = recentHistory(habit, logs, days, asOfDate);
  const doneCount = history.filter((entry) => entry.done).length;
  return history.length === 0 ? 0 : doneCount / history.length;
}

// END GENERATED DOMAIN

// The prompt asks Claude to avoid em dashes and emoji in the body, but it doesn't always comply.
// This deterministically enforces both: dashes are replaced with commas/sentence breaks, and any
// emoji that slip through are stripped (the UI adds its own emoji to section titles).
function sanitizeContent(text: string): string {
  return text
    .replace(/\s*[—–]\s*([A-Z])/g, '. $1')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Row shapes as returned by Supabase (snake_case, matching the Postgres columns directly) --
// adapted below to the shared domain layer's camelCase shape, mirroring the same job
// lib/supabase-sync.ts does client-side (rowToHabit/rowToLog) for the same reason: the generated
// functions above are written once against Habit/HabitLog and must not be reimplemented against a
// different field-naming convention here.
type HabitRow = { id: string; name: string; emoji: string; type: string; target_count: number | null };
type LogRow = { habit_id: string; date: string; count: number };
type Habit = { id: string; type: string; targetCount?: number };
type HabitLog = { habitId: string; date: string; count: number };

function toDomainHabit(row: HabitRow): Habit {
  return { id: row.id, type: row.type, targetCount: row.target_count ?? undefined };
}

function toDomainLogs(rows: LogRow[]): HabitLog[] {
  return rows.map((row) => ({ habitId: row.habit_id, date: row.date, count: row.count }));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Validate request body before touching anything else.
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (typeof body !== 'object' || body === null) {
      return new Response(JSON.stringify({ error: 'Body must be a JSON object' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const { kind: kindRaw } = body as Record<string, unknown>;
    if (typeof kindRaw !== 'string' || !(kindRaw in KIND_CONFIG)) {
      return new Response(JSON.stringify({ error: 'Invalid kind' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const kind = kindRaw as Kind;
    const config = KIND_CONFIG[kind];

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const userId = userData.user.id;

    // 1. Reuse a fresh-enough existing insight rather than calling Claude again.
    const since = new Date(Date.now() - config.freshnessHours * 60 * 60 * 1000).toISOString();
    const { data: existing } = await supabase
      .from('ai_insights')
      .select('content, created_at')
      .eq('kind', config.dbKind)
      .gt('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      return new Response(
        JSON.stringify({ content: sanitizeContent(existing.content), createdAt: existing.created_at, kind }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // 2. Per-user rate limit: max 10 new Claude calls per user per 24 hours across all kinds.
    // Cached responses (returned above) never count against this limit. With 3 kinds and
    // their respective freshness windows the legitimate maximum is 3 calls/day; 10 gives
    // headroom for the cron nudge while blocking scripted multi-account abuse.
    const rl24hStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: recentCallCount } = await supabase
      .from('ai_insights')
      .select('id', { count: 'exact', head: true })
      .gt('created_at', rl24hStart);
    if ((recentCallCount ?? 0) >= 10) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded. Try again later.' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '3600' },
      });
    }

    // 4. Pull the relevant window of habits/logs (RLS already scopes these to this user).
    const today = dayKey(new Date());
    const windowStart = addDays(today, -config.windowDays);

    const [{ data: habits }, { data: logs }] = await Promise.all([
      supabase.from('habits').select('id, name, emoji, type, target_count').is('deleted_at', null),
      supabase.from('habit_logs').select('habit_id, date, count').gte('date', windowStart),
    ]);

    if (!habits || habits.length === 0) {
      const content =
        kind === 'nudge'
          ? "Add a habit and log it a few times to get your first personalized tip! \u{1F331}"
          : 'Once you’ve logged some habits, check back here for a personalized reflection.';
      return new Response(JSON.stringify({ content, createdAt: new Date().toISOString(), kind }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 5. Summarize stats per habit for the prompt.
    const summary = habits.map((habit: HabitRow) => ({
      name: habit.name,
      emoji: habit.emoji,
      streakDays: streakForHabit(toDomainHabit(habit), toDomainLogs(logs ?? [])),
      consistencyPct: Math.round(consistency(toDomainHabit(habit), toDomainLogs(logs ?? []), config.windowDays) * 100),
    }));

    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: config.maxTokens,
      output_config: { effort: config.effort },
      system: SYSTEM_PROMPTS[kind],
      messages: [
        {
          role: 'user',
          content: `Habit data for the last ${config.windowDays} days (today is ${today}):\n${JSON.stringify(summary, null, 2)}`,
        },
      ],
    });
    const content = sanitizeContent(response.content.find((block) => block.type === 'text')?.text ?? '');

    const periodEnd = today;
    const periodStart = kind === 'nudge' ? null : windowStart;

    await supabase.from('ai_insights').insert({
      id: crypto.randomUUID(),
      user_id: userId,
      kind: config.dbKind,
      period_start: periodStart,
      period_end: kind === 'nudge' ? null : periodEnd,
      content,
      model: 'claude-sonnet-4-6',
    });

    return new Response(JSON.stringify({ content, createdAt: new Date().toISOString(), kind }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('ai-insights error:', error);
    return new Response(JSON.stringify({ error: 'Failed to generate insight' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
