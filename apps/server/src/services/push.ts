import webpush from 'web-push';
import { query } from '../db/pool.js';
import { env } from '../env.js';

const configured = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

if (configured) {
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
}

export function pushEnabled(): boolean {
  return configured;
}

export function publicVapidKey(): string | null {
  return env.VAPID_PUBLIC_KEY ?? null;
}

export async function saveSubscription(
  userId: string,
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
): Promise<void> {
  await query(
    `insert into push_subscriptions (user_id, endpoint, p256dh, auth)
     values ($1, $2, $3, $4)
     on conflict (endpoint) do update
       set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    [userId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth],
  );
}

export async function removeSubscription(userId: string, endpoint: string): Promise<void> {
  await query('delete from push_subscriptions where user_id = $1 and endpoint = $2', [
    userId,
    endpoint,
  ]);
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  chatId?: string;
};

export async function sendToUsers(userIds: string[], payload: PushPayload): Promise<void> {
  if (!configured || userIds.length === 0) return;

  const subscriptions = await query<{
    id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
  }>(
    `select id, endpoint, p256dh, auth from push_subscriptions where user_id = any($1::uuid[])`,
    [userIds],
  );
  if (subscriptions.length === 0) return;

  const body = JSON.stringify(payload);
  const stale: string[] = [];

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          body,
          { TTL: 60 * 60, urgency: 'high' },
        );
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) stale.push(subscription.id);
      }
    }),
  );

  if (stale.length > 0) {
    await query('delete from push_subscriptions where id = any($1::uuid[])', [stale]);
  }
}
