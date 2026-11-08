import { api } from './api';

type PushKeyResponse = { enabled: boolean; publicKey: string | null };

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index);
  }
  return output;
}

export type PushResult = 'ok' | 'unsupported' | 'denied' | 'disabled' | 'error';

export async function enablePushNotifications(): Promise<PushResult> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';

  try {
    const config = await api<PushKeyResponse>('/push/key');
    if (!config.enabled || !config.publicKey) return 'disabled';

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return 'denied';

    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.publicKey) as BufferSource,
      }));

    await api('/push/subscribe', {
      method: 'POST',
      body: { subscription: subscription.toJSON() },
    });

    return 'ok';
  } catch {
    return 'error';
  }
}
