// Phase 5, Step 5 Part 1 (docs/phase-5-plan.md section 6.6, "Sentinel shape: the render path
// traced"). Pins the existing client-side truthiness behaviour that a validator-rejection failure
// sentinel (an ai_insights row with content: '') deliberately relies on -- and must continue to
// rely on, unmodified. Does not change getInsight's logic or the render guard in
// app/(tabs)/progress.tsx; this test only proves the existing code already does what the sentinel
// design needs, exactly as that section calls for.
jest.mock('./supabase', () => ({ supabase: { functions: { invoke: jest.fn() } } }));

import { supabase } from './supabase';
import { getInsight } from './ai-coach';

const invoke = supabase.functions.invoke as jest.Mock;

describe('getInsight -- truthiness pin for the failure-sentinel design', () => {
  afterEach(() => {
    invoke.mockReset();
  });

  it('resolves empty sentinel content (data.content === "") to null, not to an empty-string Insight', async () => {
    invoke.mockResolvedValue({ data: { content: '', createdAt: '2026-09-12T10:00:00.000Z' }, error: null });
    const result = await getInsight('nudge');
    expect(result).toBeNull();
  });

  it('still resolves genuine content to a real Insight -- the pin is specific to emptiness, not to every response', async () => {
    invoke.mockResolvedValue({ data: { content: 'Real coaching text.', createdAt: '2026-09-12T10:00:00.000Z' }, error: null });
    const result = await getInsight('nudge');
    expect(result).toEqual({ content: 'Real coaching text.', createdAt: '2026-09-12T10:00:00.000Z' });
  });

  it('cannot let rejected AI prose reach rendering through this path: any non-null result is exactly what data.content held, so an empty sentinel can only ever surface as null, never as accidentally-truthy rejected text', async () => {
    // A rejection's whole point is that no prose crosses this boundary at all -- the Edge Function
    // response itself never contains rejected prose (docs/phase-5-plan.md section 6.6), and this
    // pin proves the one remaining risk (an empty string being treated as truthy) does not exist
    // in the current client code.
    invoke.mockResolvedValue({ data: { content: '', createdAt: '2026-09-12T10:00:00.000Z' }, error: null });
    const result = await getInsight('nudge');
    expect(result).not.toEqual(expect.objectContaining({ content: expect.any(String) }));
    expect(result).toBeNull();
  });
});
