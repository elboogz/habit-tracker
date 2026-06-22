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

const DB_KIND: Record<InsightKind, string> = {
  nudge: 'nudge',
  weekly: 'weekly_reflection',
  monthly: 'monthly_reflection',
};

/**
 * Deletes this user's cached insight of this kind, then fetches a fresh one — bypassing the
 * Edge Function's freshness window. Dev-tools only: this calls Claude on every tap.
 */
export async function regenerateInsight(kind: InsightKind): Promise<Insight | null> {
  await supabase.from('ai_insights').delete().eq('kind', DB_KIND[kind]);
  return getInsight(kind);
}
