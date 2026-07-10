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
