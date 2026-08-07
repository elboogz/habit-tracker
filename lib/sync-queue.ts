import AsyncStorage from '@react-native-async-storage/async-storage';

const QUEUE_KEY = 'habit-tracker/sync-queue-v1';

export type SyncTable = 'habits' | 'habit_logs' | 'challenges' | 'user_settings' | 'habit_schedule_periods' | 'lapse_reasons';

export type SyncOp = {
  id: string;
  table: SyncTable;
  op: 'upsert' | 'delete';
  /** Full row for 'upsert'. For 'delete', just the primary key column(s) needed to match it. */
  payload: Record<string, unknown>;
};

let cache: SyncOp[] | null = null;
let nextSeq = 1;

async function load(): Promise<SyncOp[]> {
  if (cache) return cache;
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  const parsed: SyncOp[] = raw ? JSON.parse(raw) : [];
  cache = parsed;
  return parsed;
}

async function persist(): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(cache ?? []));
}

export async function enqueue(table: SyncTable, op: 'upsert' | 'delete', payload: SyncOp['payload']): Promise<void> {
  const queue = await load();
  queue.push({ id: `op-${Date.now()}-${nextSeq++}`, table, op, payload });
  await persist();
}

export async function peekAll(): Promise<SyncOp[]> {
  return [...(await load())];
}

export async function dequeue(opId: string): Promise<void> {
  const queue = await load();
  cache = queue.filter((entry) => entry.id !== opId);
  await persist();
}
