let lastNotificationTs = 0;

export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try { return (await Notification.requestPermission()) === 'granted'; }
  catch { return false; }
}

export function notify(title: string, body: string, boundary = false): void {
  if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') return;
  const now = Date.now();
  if (!boundary && now - lastNotificationTs < 120_000) return;
  try {
    new Notification(title, { body, icon: '/icons/icon-192.png', tag: boundary ? 'focuslens-boundary' : 'focuslens-achievement' });
    lastNotificationTs = now;
  } catch { /* Notifications may be unavailable in a browser's private mode. */ }
}
