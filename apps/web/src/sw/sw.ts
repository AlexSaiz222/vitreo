/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

/**
 * The service worker (A7, D91): it caches the app shell so it opens offline
 * (as before, docs/05), and now also receives web push and opens the app on
 * what a notification is about.
 */
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: (string | { url: string; revision: string | null })[];
};

// A new version takes over at once (registerType: autoUpdate).
void self.skipWaiting();
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
// Every page is the app shell, but the hub's API is never served from here,
// nor the demo's notebook (D113), a page of its own read online.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/api\//, /^\/cuaderno/],
  }),
);

// The journal's photos (A8): kept once seen, so the journal shows them while
// the hub is down. A photo never changes (a new one gets a new id).
const PHOTO_CACHE = 'journal-photos';
const PHOTOS_KEPT = 300;
registerRoute(
  ({ url, request }) =>
    request.method === 'GET' && /\/api\/v1\/journal\/[^/]+\/photo$/.test(url.pathname),
  async ({ request }) => {
    const cache = await caches.open(PHOTO_CACHE);
    const hit = await cache.match(request);
    if (hit) return hit;
    const response = await fetch(request);
    if (response.ok || response.type === 'opaque') {
      await cache.put(request, response.clone());
      // The oldest go first once there are too many.
      const keys = await cache.keys();
      for (const old of keys.slice(0, Math.max(0, keys.length - PHOTOS_KEPT))) {
        await cache.delete(old);
      }
    }
    return response;
  },
);

// Ambient sound (A9): never precached (nothing downloads while sound is
// off); once fetched, kept, so it plays offline too. Requests carry the
// file's hash (?v=), and an older version of the same file is dropped.
registerRoute(
  ({ url, request }) => request.method === 'GET' && /^\/audio\/[\w-]+\.ogg$/.test(url.pathname),
  async ({ request }) => {
    const cache = await caches.open('ambient-audio');
    const hit = await cache.match(request);
    if (hit) return hit;
    const response = await fetch(request);
    if (response.ok) {
      const path = new URL(request.url).pathname;
      for (const old of await cache.keys()) {
        if (new URL(old.url).pathname === path) await cache.delete(old);
      }
      await cache.put(request, response.clone());
    }
    return response;
  },
);

interface PushMessage {
  title: string;
  body: string;
  tag: string;
  url: string;
  renotify: boolean;
  critical: boolean;
}

self.addEventListener('push', (event) => {
  let message: PushMessage;
  try {
    message = event.data?.json() as PushMessage;
  } catch {
    return;
  }
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      // Same tag: it replaces the earlier notification of that situation.
      tag: message.tag,
      // A new warning or a reminder sounds; "Resuelto" replaces it quietly.
      renotify: message.renotify,
      requireInteraction: message.critical,
      icon: '/icons/icon-192.png',
      data: { url: message.url },
    } as NotificationOptions & { renotify: boolean }),
  );
});

/** Tapping a notification opens the app on that plant, the tank or the air. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data as { url?: string } | null;
  const url = new URL(data?.url ?? '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows[0];
      if (open) {
        await open.focus();
        await open.navigate(url);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
