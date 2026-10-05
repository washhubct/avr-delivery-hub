// DELIVERY HUB — Notifiche push per gli utenti del gestionale (oggi: responsabili di zona).
// Stessa coppia VAPID e stessa collection pushSubscriptions dell'app driver; l'invio è
// server-side (CF pushRitorniDaConfermare alle 18:30). Il permesso viene chiesto al primo
// accesso del responsabile; su iPhone le push arrivano solo con il sito aggiunto alla Home.
var VAPID_PUBLIC_KEY = 'BEmajBtrystbgxXtkjHR2jtrpD2_M6JsJV7ua9ap0oN8fAH1P0c2S4BSKd-RLPKLFNqHJ4pibnW5Noi1OEXfi9w';

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(function(e) { console.warn('SW:', e.message); });
}

function b64ToU8(b) {
    var pad = '='.repeat((4 - b.length % 4) % 4);
    var raw = atob((b + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, function(c) { return c.charCodeAt(0); });
}

async function initPushGestionale() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
    if (Notification.permission === 'denied') return;
    if (!auth.currentUser) return;
    try {
        var reg = await navigator.serviceWorker.ready;
        var sub = await reg.pushManager.getSubscription();
        if (!sub) {
            if (Notification.permission !== 'granted') {
                var perm = await Notification.requestPermission();
                if (perm !== 'granted') return;
            }
            sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(VAPID_PUBLIC_KEY) });
        }
        var key = sub.endpoint.slice(-32);
        var saved = null;
        try { saved = localStorage.getItem('lmPushEndpoint'); } catch (e) {}
        if (saved === key) return;
        var profilo = state.userProfile || {};
        await db.collection('pushSubscriptions').add({
            email: (auth.currentUser.email || '').toLowerCase(),
            driver: (profilo.nome || '').toUpperCase(),
            ruolo: state.userRole || '',
            subscription: JSON.parse(JSON.stringify(sub)),
            userAgent: (navigator.userAgent || '').slice(0, 120),
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        try { localStorage.setItem('lmPushEndpoint', key); } catch (e) {}
        toast('Notifiche attivate 🔔', 'success');
    } catch (e) {
        console.warn('push init:', e.message);
    }
}
