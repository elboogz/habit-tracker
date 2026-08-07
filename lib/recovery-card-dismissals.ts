import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

// Phase 4 (docs/phase-4-plan.md section 8.6) -- device-local suppression for "Continue today" and
// dismiss (X), the two recovery-card actions that record no synced behavioural fact. Skip and
// Reflect don't use this: their suppression is derived live from the synced LapseReasonEntry they
// already write (see lib/domain/recovery.ts's lapseReasonSuppressionUntil). Never synced, never
// migrated, and never explicitly deleted -- a stale entry (today >= suppressUntil) is simply
// ignored by the read path, the same "harmless orphaned row" treatment used elsewhere in this plan.

const STORAGE_KEY = 'habit-tracker/recovery-card-dismissals-v1';

/** habitId -> the day key its recovery card suppression lifts. */
export type RecoveryCardDismissals = Record<string, string>;

async function loadDismissals(): Promise<RecoveryCardDismissals> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function persistDismissals(dismissals: RecoveryCardDismissals): void {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(dismissals)).catch(() => {});
}

/**
 * Loads the local dismissal map once on mount and exposes a setter that both updates local state
 * (so the recovery card reacts immediately) and persists to AsyncStorage in the background.
 */
export function useRecoveryCardDismissals(): {
  dismissals: RecoveryCardDismissals;
  dismiss: (habitId: string, suppressUntil: string | null) => void;
} {
  const [dismissals, setDismissals] = useState<RecoveryCardDismissals>({});

  useEffect(() => {
    let cancelled = false;
    loadDismissals().then((loaded) => {
      if (!cancelled) setDismissals(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = useCallback((habitId: string, suppressUntil: string | null) => {
    // No Scheduled Opportunity to reopen at (e.g. an indefinitely paused habit) -- nothing to
    // record. See lib/domain/schedule.ts's nextScheduledOpportunityAfter for this null case.
    if (suppressUntil === null) return;
    setDismissals((prev) => {
      const next = { ...prev, [habitId]: suppressUntil };
      persistDismissals(next);
      return next;
    });
  }, []);

  return { dismissals, dismiss };
}
