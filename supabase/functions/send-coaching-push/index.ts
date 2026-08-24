// @ts-nocheck — Deno runtime: npm: specifiers and the Deno global are not recognised by the
// project's Node tsconfig. The code is type-safe under Deno's own checker (deno check).
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
  'Write in plain, natural sentences. Never use em dashes (—); use commas or split into separate ' +
  'sentences instead. Do not include any emoji in the text. Plain text only, no markdown.';

const NUDGE_SYSTEM_PROMPT =
  "You are an encouraging, perceptive habit-tracking coach. Given a user's recent habit data, write a short " +
  '1-3 sentence personalized message: call out one specific strength (a habit the user has been consistent ' +
  'with, citing its consistency %) and one area that could use attention, with a small, concrete suggestion. ' +
  `Be warm and specific, not generic. ${STYLE_RULES}`;

function sanitizeContent(text: string): string {
  return text
    .replace(/\s*[—–]\s*([A-Z])/g, '. $1')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

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

/**
 * A reduced ("smaller version") completion counts fully as done for the day -- not partial
 * credit -- so every downstream consumer (streaks, consistency, recovery, momentum, challenge
 * progress) automatically treats it as a completed day with no further changes (Phase 4, see
 * docs/phase-4-plan.md section 2.2). Additive and backward-compatible: no pre-Phase-4 HabitLog
 * has a `reduced` field, so every existing computation over existing data is byte-for-byte
 * unchanged.
 */
function isDoneOnDay(habit: Habit, logs: HabitLog[], date: string): boolean {
  const dayLogs = logsForHabitOnDay(logs, habit.id, date);
  if (dayLogs.some((log) => log.reduced)) return true;
  const total = dayLogs.reduce((sum, log) => sum + log.count, 0);
  return habit.type === 'count' ? total >= (habit.targetCount ?? 1) : total > 0;
}

/**
 * Calendar-day streak -- `streakForHabit`'s pre-Scheduled-Opportunity behavior, preserved verbatim
 * under an honest name. Exists only so scripts/build-edge-functions.js's generated block (see the
 * SOURCES list there) can keep inlining a function the two Edge Functions actually call (both
 * build a `streakDays` field for their coaching prompts) without silently changing their behavior:
 * neither Edge Function fetches habit_schedule_periods today, so they cannot call the
 * schedule-aware streakForHabit() above without a separate, deliberate change (the same Edge
 * Function integration gated in docs/phase-4-completion-report.md's Consistency entry). Not used
 * by any client screen -- every client call site reads the schedule-aware streakForHabit() instead.
 */
function calendarStreakForHabit(habit: Habit, logs: HabitLog[], asOfDate: string = dayKey()): number {
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

/**
 * Calendar-day consistency -- `consistency`'s pre-Scheduled-Opportunity behavior, preserved
 * verbatim under an honest name. Exists only so scripts/build-edge-functions.js's generated block
 * (see the SOURCES list there) can keep inlining a function the two Edge Functions actually call
 * (send-coaching-push's push eligibility, ai-insights' consistencyPct) without silently changing
 * their behavior: neither Edge Function fetches habit_schedule_periods today, so they cannot call
 * the schedule-aware consistency() above without a separate, deliberate change (extending the
 * generated-domain whitelist to include schedule.ts, plus a new DB read -- see the completion
 * report for the open questions that change is gated on). Not used by any client screen -- every
 * client call site reads the schedule-aware consistency() instead.
 */
function calendarConsistency(habit: Habit, logs: HabitLog[], days: number, asOfDate: string = dayKey()): number {
  const history = recentHistory(habit, logs, days, asOfDate);
  const doneCount = history.filter((entry) => entry.done).length;
  return history.length === 0 ? 0 : doneCount / history.length;
}

// END GENERATED DOMAIN

// Row shapes as returned by Supabase (snake_case, matching the Postgres columns directly) --
// adapted below to the shared domain layer's camelCase shape, mirroring the same job
// lib/supabase-sync.ts does client-side (rowToHabit/rowToLog) for the same reason: the generated
// functions above are written once against Habit/HabitLog and must not be reimplemented against a
// different field-naming convention here.
type HabitRow = { id: string; name: string; emoji: string; type: string; target_count: number | null };
type LogRow = { habit_id: string; date: string; count: number; reduced: boolean | null };
type Habit = { id: string; type: string; targetCount?: number };
type HabitLog = { habitId: string; date: string; count: number; reduced?: boolean };

function toDomainHabit(row: HabitRow): Habit {
  return { id: row.id, type: row.type, targetCount: row.target_count ?? undefined };
}

function toDomainLogs(rows: LogRow[]): HabitLog[] {
  return rows.map((row) => ({ habitId: row.habit_id, date: row.date, count: row.count, reduced: row.reduced ?? undefined }));
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
    supabase.from('habit_logs').select('habit_id, date, count, reduced').eq('user_id', userId).gte('date', windowStart),
  ]);

  if (!habits || habits.length === 0) return null;

  const summary = (habits as HabitRow[]).map((habit) => ({
    name: habit.name,
    emoji: habit.emoji,
    consistencyPct: Math.round(
      calendarConsistency(toDomainHabit(habit), toDomainLogs((logs ?? []) as LogRow[]), NUDGE_WINDOW_DAYS, today) * 100,
    ),
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

Deno.serve(async (req) => {
  // This function uses the service-role key and runs across all users — it must only
  // be callable by the Supabase Cron scheduler, not by arbitrary callers.
  // Set CRON_SECRET as a Supabase Edge Function secret and pass it as the
  // x-cron-secret header in the Supabase Cron scheduler configuration.
  // Reject any HTTP method other than POST (cron uses POST).
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const cronSecret = Deno.env.get('CRON_SECRET');
  if (!cronSecret) {
    // Fail closed: if the secret is not configured, refuse all requests rather than
    // accidentally running with service-role privileges for any caller.
    console.error('send-coaching-push: CRON_SECRET secret is not configured');
    return new Response(JSON.stringify({ error: 'Service misconfigured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (req.headers.get('x-cron-secret') !== cronSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

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
