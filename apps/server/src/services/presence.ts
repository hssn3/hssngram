import { query } from '../db/pool.js';

const connections = new Map<string, Set<string>>();

export function addConnection(userId: string, socketId: string): boolean {
  const set = connections.get(userId) ?? new Set<string>();
  const wasOffline = set.size === 0;
  set.add(socketId);
  connections.set(userId, set);
  return wasOffline;
}

export function removeConnection(userId: string, socketId: string): boolean {
  const set = connections.get(userId);
  if (!set) return false;

  set.delete(socketId);
  if (set.size === 0) {
    connections.delete(userId);
    return true;
  }
  return false;
}

export function isOnline(userId: string): boolean {
  return (connections.get(userId)?.size ?? 0) > 0;
}

export function onlineUserIds(userIds: string[]): string[] {
  return userIds.filter(isOnline);
}

export function connectionCount(): number {
  let total = 0;
  for (const set of connections.values()) total += set.size;
  return total;
}

export async function persistLastSeen(userId: string): Promise<void> {
  await query('update users set last_seen_at = now() where id = $1', [userId]);
}
