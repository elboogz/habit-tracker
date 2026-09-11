import { supabase } from './supabase';

export type InsightKind = 'nudge' | 'weekly' | 'monthly';

export type Insight = { content: string; createdAt: string };

/**
 * Fetches an AI-generated coaching nudge or reflection. The Edge Function caches by
 * freshness window (nudge: ~daily, weekly/monthly: ~weekly/monthly), so this is cheap
 * to call on every relevant screen view. Returns null on any failure — this is
 * supplementary content, never something that should break the Progress screen.
 */
export async function getInsight(kind: InsightKind): Promise<Insight | null> {
  try {
    const { data, error } = await supabase.functions.invoke('ai-insights', { body: { kind } });
    // This truthiness check (not a nullish check) is load-bearing beyond the original "no
    // response at all" case: Phase 5 Step 5's validator-rejection failure sentinel is an
    // ai_insights row with content: '', and this is the only place that turns it into null
    // before it would otherwise reach the Progress screen's `?? 'No tip yet.'` render guard
    // (docs/phase-5-plan.md section 6.6, "Sentinel shape: the render path traced"; pinned by
    // lib/ai-coach.test.ts). Narrowing this to `data?.content == null` would let an empty-string
    // sentinel through unchanged and silently break that guard.
    if (error || !data?.content) return null;
    return { content: data.content, createdAt: data.createdAt };
  } catch {
    return null;
  }
}

/**
 * Fetches the current insight for this kind, bypassing no cache (the RLS policy no longer
 * grants DELETE, so forced regeneration via client is intentionally disabled to protect
 * against Claude API cost abuse). Dev-tools only.
 *
 * To force fresh generation during development: manually delete the row in the Supabase
 * dashboard (Table Editor → ai_insights) and then tap Regenerate again.
 */
export async function regenerateInsight(kind: InsightKind): Promise<Insight | null> {
  return getInsight(kind);
}
