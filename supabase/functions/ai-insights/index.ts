// Paste this into Supabase Dashboard -> Edge Functions -> Create a new function ("ai-insights").
// Set the ANTHROPIC_API_KEY secret under Edge Functions -> Secrets before invoking.
import { createClient } from 'npm:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

function dayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(key: string, amount: number): string {
  const [year, month, day] = key.split('-').map(Number);
  return dayKey(new Date(year, month - 1, day + amount));
}

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

type HabitRow = { id: string; name: string; emoji: string; type: string; target_count: number | null };
type LogRow = { habit_id: string; date: string; count: number };

function isDoneOnDay(habit: HabitRow, logs: LogRow[], date: string): boolean {
  const total = logs
    .filter((log) => log.habit_id === habit.id && log.date === date)
    .reduce((sum, log) => sum + log.count, 0);
  return habit.type === 'count' ? total >= (habit.target_count ?? 1) : total > 0;
}

function streakForHabit(habit: HabitRow, logs: LogRow[], today: string): number {
  let cursor = isDoneOnDay(habit, logs, today) ? today : addDays(today, -1);
  let streak = 0;
  while (isDoneOnDay(habit, logs, cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

function consistency(habit: HabitRow, logs: LogRow[], today: string, days: number): number {
  let doneCount = 0;
  for (let i = 0; i < days; i += 1) {
    if (isDoneOnDay(habit, logs, addDays(today, -i))) doneCount += 1;
  }
  return days === 0 ? 0 : doneCount / days;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { kind } = (await req.json()) as { kind?: Kind };
    if (!kind || !KIND_CONFIG[kind]) {
      return new Response(JSON.stringify({ error: 'Invalid kind' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
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

    // 2. Pull the relevant window of habits/logs (RLS already scopes these to this user).
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

    // 3. Summarize stats per habit for the prompt.
    const summary = habits.map((habit: HabitRow) => ({
      name: habit.name,
      emoji: habit.emoji,
      streakDays: streakForHabit(habit, logs ?? [], today),
      consistencyPct: Math.round(consistency(habit, logs ?? [], today, config.windowDays) * 100),
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
