'use strict';
// LAST MILE — Lettura Gmail (Google Workspace last-mile.it) con delega a livello
// di dominio SENZA chiavi: la Cloud Function firma il JWT con la propria identità
// (IAM Credentials signJwt sul service account runtime, che deve avere il ruolo
// Service Account Token Creator su se stesso) e lo scambia con un access token
// Gmail per la casella indicata (sub). Il client ID del SA runtime è autorizzato
// in Google Admin → Controlli API → Delega a livello di dominio, scope gmail.readonly.

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const META = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/';

async function metadata(path) {
    const r = await fetch(META + path, { headers: { 'Metadata-Flavor': 'Google' } });
    if (!r.ok) throw new Error('metadata ' + path + ' HTTP ' + r.status);
    return r;
}

async function identitaRuntime() {
    const email = (await (await metadata('email')).text()).trim();
    const tok = await (await metadata('token')).json();
    return { email, accessToken: tok.access_token };
}

// Access token Gmail per la casella `casella` (utente del dominio)
async function tokenGmail(casella) {
    const me = await identitaRuntime();
    const now = Math.floor(Date.now() / 1000);
    const claims = { iss: me.email, sub: casella, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
    const s = await fetch('https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/' + encodeURIComponent(me.email) + ':signJwt', {
        method: 'POST', headers: { Authorization: 'Bearer ' + me.accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: JSON.stringify(claims) }),
    });
    if (!s.ok) throw new Error('signJwt HTTP ' + s.status + ' (manca il ruolo Service Account Token Creator al SA ' + me.email + '?): ' + (await s.text()).slice(0, 200));
    const { signedJwt } = await s.json();
    const t = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + encodeURIComponent(signedJwt),
    });
    const j = await t.json();
    if (!t.ok || !j.access_token) throw new Error('token Gmail per ' + casella + ' negato: ' + (j.error_description || j.error || t.status) + ' (delega a livello di dominio per il client ID del SA con scope gmail.readonly?)');
    return j.access_token;
}

function creaGmail(casella, token) {
    const base = 'https://gmail.googleapis.com/gmail/v1/users/' + encodeURIComponent(casella) + '/';
    async function get(path) {
        const r = await fetch(base + path, { headers: { Authorization: 'Bearer ' + token } });
        if (!r.ok) throw new Error('Gmail ' + path.split('?')[0] + ' HTTP ' + r.status + ': ' + (await r.text()).slice(0, 200));
        return r.json();
    }
    return {
        // Tutti gli id dei messaggi che soddisfano la query (paginato)
        async cercaMessaggi(q, max) {
            const out = [];
            let pageToken = '';
            do {
                const j = await get('messages?maxResults=100&q=' + encodeURIComponent(q) + (pageToken ? '&pageToken=' + pageToken : ''));
                (j.messages || []).forEach((m) => out.push(m.id));
                pageToken = j.nextPageToken || '';
            } while (pageToken && out.length < (max || 500));
            return out;
        },
        messaggio(id) { return get('messages/' + id + '?format=full'); },
        async allegato(messageId, attachmentId) {
            const j = await get('messages/' + messageId + '/attachments/' + attachmentId);
            return Buffer.from(String(j.data || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
        },
    };
}

module.exports = { tokenGmail, creaGmail, SCOPE };
