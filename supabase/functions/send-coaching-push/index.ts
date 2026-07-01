// Paste this into Supabase Dashboard -> Edge Functions -> Create a new function ("send-coaching-push").
// Triggered by Supabase Cron every 15 minutes. Uses the service-role key (auto-provided to every
// Edge Function as SUPABASE_SERVICE_ROLE_KEY) since this reads/writes across all users rather than
// one RLS-scoped caller, unlike ai-insights. ANTHROPIC_API_KEY is already set as a project secret
// from the ai-insights setup, so nothing new needs to be added there.
import { createClient } from 'npm:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk';

const NUDGE_FRESHNESS_HOURS = 20;
const NUDGE_WINDOW_DAYS = 14;

// Duplicated from ai-insights/index.ts rather than shared -- paste-in Edge Functions are deployed
// independently and don't share a module system.
const STYLE_RULES =
  'Write in plain, natural sentences — never use em dashes (—); use commas or split into separate ' +
  'sentences instead. Do not include any emoji in the text. Plain text only, no markdown.';

const NUDGE_SYSTEM_PROMPT =
  "You are an encouraging, perceptive habit-tracking coach. Given a user's recent habit data, write a short " +
  '1-3 sentence personalized message: call out one specific strength (a streak or high consistency %) and one ' +
  `area that could use attention, with a small, concrete suggestion. Be warm and specific, not generic. ${STYLE_RULES}`;

function sanitizeContent(text: string): string {
  return text
    .replace(/\s*[—–]\s*([A-Z])/g, '. $1')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

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

function localDateKey(timezone: string, date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    date,
  );
}

function localTimeMinutes(timezone: string, date: Date): number {
  const formatted = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
  const [hour, minute] = formatted.split(':').map(Number);
  return hour * 60 + minute;
}

function timeToMinutes(time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
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

type Recipient = {
  user_id: string;
  coach_push_time: string;
  coach_push_timezone: string;
  coach_push_last_sent_date: string | null;
};

// deno-lint-ignore no-explicit-any
async function generateNudge(supabase: any, anthropic: Anthropic, userId: string, today: string): Promise<string | null> {
  const windowStart = addDays(today, -NUDGE_WINDOW_DAYS);

  const [{ data: habits }, { data: logs }] = await Promise.all([
    supabase.from('habits').select('id, name, emoji, type, target_count').eq('user_id', userId).is('deleted_at', null),
    supabase.from('habit_logs').select('habit_id, date, count').eq('user_id', userId).gte('date', windowStart),
  ]);

  if (!habits || habits.length === 0) return null;

  const summary = (habits as HabitRow[]).map((habit) => ({
    name: habit.name,
    emoji: habit.emoji,
    streakDays: streakForHabit(habit, (logs ?? []) as LogRow[], today),
    consistencyPct: Math.round(consistency(habit, (logs ?? []) as LogRow[], today, NUDGE_WINDOW_DAYS) * 100),
  }));

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    output_config: { effort: 'low' },
    system: NUDGE_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Habit data for the last ${NUDGE_WINDOW_DAYS} days (today is ${today}):\n${JSON.stringify(summary, null, 2)}`,
      },
    ],
  });
  const text = response.content.find((block) => block.type === 'text')?.text ?? '';
  return text ? sanitizeContent(text) : null;
}

async function sendExpoPush(tokens: string[], body: string) {
  if (tokens.length === 0) return;
  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(tokens.map((to) => ({ to, title: '🧠 AI Coach', body, sound: 'default' }))),
  });
}

Deno.serve(async (_req) => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });
  const now = new Date();

  const { data: recipients, error } = await supabase
    .from('user_settings')
    .select('user_id, coach_push_time, coach_push_timezone, coach_push_last_sent_date')
    .eq('coach_push_enabled', true)
    .not('coach_push_time', 'is', null)
    .not('coach_push_timezone', 'is', null);

  if (error) {
    console.error('send-coaching-push: failed to load recipients', error);
    return new Response(JSON.stringify({ error: 'Failed to load recipients' }), { status: 500 });
  }

  let sent = 0;

  for (const recipient of (recipients ?? []) as Recipient[]) {
    const today = localDateKey(recipient.coach_push_timezone, now);
    if (recipient.coach_push_last_sent_date === today) continue;

    const currentMinutes = localTimeMinutes(recipient.coach_push_timezone, now);
    if (currentMinutes < timeToMinutes(recipient.coach_push_time)) continue;

    try {
      // Reuse the same-day nudge if the in-app Coach card already generated one today.
      const since = new Date(Date.now() - NUDGE_FRESHNESS_HOURS * 60 * 60 * 1000).toISOString();
      const { data: existing } = await supabase
        .from('ai_insights')
        .select('content')
        .eq('user_id', recipient.user_id)
        .eq('kind', 'nudge')
        .gt('created_at', since)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      let content: string | null = existing?.content ? sanitizeContent(existing.content) : null;

      if (!content) {
        content = await generateNudge(supabase, anthropic, recipient.user_id, today);
        if (content) {
          await supabase.from('ai_insights').insert({
            id: crypto.randomUUID(),
            user_id: recipient.user_id,
            kind: 'nudge',
            period_start: null,
            period_end: null,
            content,
            model: 'claude-sonnet-4-6',
          });
        }
      }

      if (!content) continue; // no habits logged yet -- nothing worth pushing

      const { data: tokenRows } = await supabase.from('push_tokens').select('token').eq('user_id', recipient.user_id);
      const tokens = ((tokenRows ?? []) as { token: string }[]).map((row) => row.token);
      await sendExpoPush(tokens, content);

      await supabase.from('user_settings').update({ coach_push_last_sent_date: today }).eq('user_id', recipient.user_id);
      sent += 1;
    } catch (err) {
      console.error(`send-coaching-push: failed for user ${recipient.user_id}`, err);
    }
  }

  return new Response(JSON.stringify({ sent, checked: recipients?.length ?? 0 }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
