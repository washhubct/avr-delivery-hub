// Last Mile Delivery Hub — service worker minimo: SOLO notifiche push.
// Nessuna cache: il gestionale resta network-first (niente versioni stantie).
// Payload atteso dalle Cloud Functions: { title, body, url?, tag? }.
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function (e) {
  var payload = { title: 'Last Mile', body: '' };
  try { payload = Object.assign(payload, e.data.json()); } catch (err) { payload.body = e.data ? e.data.text() : ''; }
  e.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: './assets/icons/icon-192.png',
    badge: './assets/icons/icon-192.png',
    tag: payload.tag || undefined,
    data: { url: payload.url || './' }
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil((async function () {
    var url = (e.notification.data && e.notification.data.url) || './';
    var wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.length) { try { await wins[0].navigate(url); } catch (err) { /* stessa origine: ok */ } return wins[0].focus(); }
    return self.clients.openWindow(url);
  })());
});
