'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

const RESEND_API_KEY = defineSecret('RESEND_API_KEY');

const ALLOWED_ORIGINS = [
    'https://dashboard.avrlogisticarl.com',
    'https://appdriver.avrlogisticarl.com',
    'https://avr-logistic-dashboard.firebaseapp.com',
    'https://avr-logistic-dashboard.web.app',
];

// Rate limiting in-memory (resetta ad ogni cold start)
const rateLimitMap = new Map();
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 5;

function checkRateLimit(email) {
    const now = Date.now();
    const entry = rateLimitMap.get(email);
    if (!entry || (now - entry.windowStart) > RATE_WINDOW_MS) {
        rateLimitMap.set(email, { windowStart: now, count: 1 });
        return true;
    }
    if (entry.count >= RATE_MAX) return false;
    entry.count++;
    return true;
}

exports.requestPasswordReset = onRequest(
    {
        secrets: [RESEND_API_KEY],
        region: 'europe-west1',
        cors: ALLOWED_ORIGINS,
    },
    async (req, res) => {
        const origin = req.headers.origin || '';
        const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

        res.set('Access-Control-Allow-Origin', allowedOrigin);
        res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type');

        // Preflight
        if (req.method === 'OPTIONS') {
            res.status(204).send('');
            return;
        }

        if (req.method !== 'POST') {
            res.status(405).json({ error: 'Method not allowed' });
            return;
        }

        const email = ((req.body && req.body.email) || '').trim().toLowerCase();

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            res.status(400).json({ error: 'Email non valida' });
            return;
        }

        if (!checkRateLimit(email)) {
            console.warn('[requestPasswordReset] rate limit:', email);
            res.json({ success: true });
            return;
        }

        try {
            const link = await admin.auth().generatePasswordResetLink(email, {
                url: 'https://dashboard.avrlogisticarl.com/auth/action/',
                handleCodeInApp: false,
            });
            await sendResendEmail({
                apiKey: RESEND_API_KEY.value(),
                to: email,
                link,
            });
        } catch (err) {
            // Non propagare — no user enumeration
            console.error('[requestPasswordReset] errore:', err.code || err.message);
        }

        // SEMPRE risposta generica
        res.json({ success: true });
    }
);

// ═══════════════════════════════════════════════════════════════════
// INVIA CREDENZIALI DRIVER (admin-only, idempotente)
// Trova o crea l'utente Auth per l'email indicata, genera reset link
// brandizzato e lo manda via Resend. Risolve il bug dove il flow admin
// usava auth.sendPasswordResetEmail del client SDK (mail da dominio
// firebaseapp.com, spesso bloccata da Gmail come spam).
// ═══════════════════════════════════════════════════════════════════
exports.inviaCredenzialiDriver = onRequest(
    {
        secrets: [RESEND_API_KEY],
        region: 'europe-west1',
        cors: ALLOWED_ORIGINS,
    },
    async (req, res) => {
        const origin = req.headers.origin || '';
        const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
        res.set('Access-Control-Allow-Origin', allowedOrigin);
        res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
        if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

        // Verifica caller = admin/staff
        const authHeader = req.headers.authorization || '';
        const idToken = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : '';
        if (!idToken) { res.status(401).json({ error: 'Token mancante' }); return; }
        let callerEmail = '';
        try {
            const decoded = await admin.auth().verifyIdToken(idToken);
            callerEmail = (decoded.email || '').toLowerCase();
        } catch (e) {
            res.status(401).json({ error: 'Token non valido' });
            return;
        }
        const ADMIN_EMAILS = ['amministrazione@avrlogisticarl.com', 'michela@avrlogisticarl.com', 'alessandra@avrlogisticarl.com'];
        if (!ADMIN_EMAILS.includes(callerEmail)) { res.status(403).json({ error: 'Non autorizzato' }); return; }

        const email = ((req.body && req.body.email) || '').trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            res.status(400).json({ error: 'Email non valida' });
            return;
        }

        try {
            let user;
            let created = false;
            try {
                user = await admin.auth().getUserByEmail(email);
            } catch (e) {
                if (e.code !== 'auth/user-not-found') throw e;
                // Password random — il driver la sostituirà subito col link di reset
                const tempPw = 'AVR_' + require('crypto').randomBytes(12).toString('base64').replace(/[+/=]/g, '') + '!';
                user = await admin.auth().createUser({
                    email,
                    password: tempPw,
                    emailVerified: false,
                    disabled: false,
                });
                created = true;
            }

            const link = await admin.auth().generatePasswordResetLink(email, {
                url: 'https://dashboard.avrlogisticarl.com/auth/action/',
                handleCodeInApp: false,
            });
            await sendResendEmail({
                apiKey: RESEND_API_KEY.value(),
                to: email,
                link,
            });

            console.log(`[inviaCredenzialiDriver] ${created ? 'creato + inviato' : 'reinviato'} per ${email} (caller=${callerEmail})`);
            res.json({ success: true, created, sent: true, uid: user.uid });
        } catch (err) {
            console.error('[inviaCredenzialiDriver] errore:', err.code || err.message);
            res.status(500).json({ error: err.code || err.message || 'Errore interno' });
        }
    }
);

async function sendResendEmail({ apiKey, to, link }) {
    const html = buildEmailHtml(link);
    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            from: 'AVR Logistic <noreply@avrlogisticarl.com>',
            to: [to],
            reply_to: 'amministrazione@avrlogisticarl.com',
            subject: 'Reimposta la tua password — AVR Logistic',
            html,
        }),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Resend error: ${res.status} ${body.substring(0, 200)}`);
    }
}

// ═══════════════════════════════════════════════════════════════════
// LEADERBOARD — precalcolo schedulato
// Sostituisce il rebuild client-side della dashboard. Gira ogni ora in
// Europe/Rome, ricalcola mese corrente sempre + mese precedente nei
// primi 10 giorni del mese (per catturare scritture late).
//
// Scrive due doc per mese:
//   • leaderboard/{YYYY-MM}     → letto da app driver (anonimo, solo cognome)
//   • leaderboardFull/{YYYY-MM} → letto da dashboard admin (con nome reale)
// ═══════════════════════════════════════════════════════════════════

function meseInRome(date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Rome',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);
    const y = parts.find(p => p.type === 'year').value;
    const m = parts.find(p => p.type === 'month').value;
    const d = parts.find(p => p.type === 'day').value;
    return { mese: `${y}-${m}`, year: parseInt(y, 10), month: parseInt(m, 10), day: parseInt(d, 10) };
}

function mesePrecedente(meseStr) {
    const [y, m] = meseStr.split('-').map(Number);
    const prev = new Date(Date.UTC(y, m - 2, 1));
    return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function buildLeaderboardForMese(mese, prevMesePositions, anagByCognome) {
    // Consegne del mese
    const repSnap = await db.collection('reportDriver').where('mese', '==', mese).get();
    const consegnePerDriver = {};
    repSnap.forEach(doc => {
        const d = doc.data();
        const drv = ((d.driver || '') + '').toUpperCase().trim();
        if (!drv) return;
        consegnePerDriver[drv] = (consegnePerDriver[drv] || 0) + (d.numConsegne || 0);
    });

    // Danni del mese (filtra annullati; deriva mese da campo data se mancante)
    const danniSnap = await db.collection('danni').get();
    const danniPerDriver = {};
    danniSnap.forEach(doc => {
        const d = doc.data();
        if (d.stato === 'annullato') return;
        let m = d.mese;
        if (!m) {
            const dt = d.data;
            if (dt && typeof dt.toDate === 'function') m = dt.toDate().toISOString().slice(0, 7);
            else if (typeof dt === 'string') m = dt.substring(0, 7);
        }
        if (m !== mese) return;
        const drv = ((d.driver || '') + '').toUpperCase().trim();
        if (!drv) return;
        danniPerDriver[drv] = (danniPerDriver[drv] || 0) + 1;
    });

    // Costruisci classifica + score
    const drivers = Object.keys(consegnePerDriver).map(drv => {
        const consegne = consegnePerDriver[drv];
        const numDanni = danniPerDriver[drv] || 0;
        let score = consegne;
        if (numDanni === 0) score += 50;
        score -= numDanni * 30;
        return {
            driver: drv,
            consegne,
            danni: numDanni,
            bonusZeroDanni: numDanni === 0,
            score: Math.max(0, score),
        };
    });
    drivers.sort((a, b) => b.score - a.score);

    // Attacca trend: posizione mese precedente (1-indexed)
    drivers.forEach((d, i) => {
        const posPrec = prevMesePositions ? prevMesePositions[d.driver] : null;
        d.posPrec = posPrec || null;
    });

    // Versione anonima (letta dai driver): solo campi neutri
    const anon = drivers.map(d => ({
        driver: d.driver,
        consegne: d.consegne,
        danni: d.danni,
        bonusZeroDanni: d.bonusZeroDanni,
        score: d.score,
        posPrec: d.posPrec,
    }));

    // Versione full (letta da admin): include nome reale dall'anagrafica
    const full = drivers.map(d => {
        const a = anagByCognome[d.driver];
        return {
            driver: d.driver,
            cognome: a && a.cognome ? a.cognome : d.driver,
            nome: a && a.nome ? a.nome : '',
            email: a && a.email ? a.email : '',
            citta: a && a.citta ? a.citta : '',
            consegne: d.consegne,
            danni: d.danni,
            bonusZeroDanni: d.bonusZeroDanni,
            score: d.score,
            posPrec: d.posPrec,
        };
    });

    return { anon, full };
}

async function loadPrevMesePositions(mesePrec) {
    try {
        const doc = await db.collection('leaderboard').doc(mesePrec).get();
        if (!doc.exists) return null;
        const arr = doc.data().drivers || [];
        const map = {};
        arr.forEach((d, i) => { map[d.driver] = i + 1; });
        return map;
    } catch (e) {
        console.warn('[leaderboard] prev mese load:', e.message);
        return null;
    }
}

async function precalcoloMese(mese, anagByCognome) {
    const prevPositions = await loadPrevMesePositions(mesePrecedente(mese));
    const { anon, full } = await buildLeaderboardForMese(mese, prevPositions, anagByCognome);

    // Guard: non scrivere doc vuoto se non c'è nulla da rappresentare
    if (anon.length === 0) {
        console.log(`[leaderboard] ${mese}: 0 driver — skip write`);
        return { mese, nDrivers: 0, skipped: true };
    }

    const ts = admin.firestore.FieldValue.serverTimestamp();
    const batch = db.batch();
    batch.set(db.collection('leaderboard').doc(mese), {
        mese,
        drivers: anon,
        totalDrivers: anon.length,
        lastUpdate: ts,
    });
    batch.set(db.collection('leaderboardFull').doc(mese), {
        mese,
        drivers: full,
        totalDrivers: full.length,
        lastUpdate: ts,
    });
    await batch.commit();
    console.log(`[leaderboard] ${mese}: ${anon.length} driver aggiornati`);
    return { mese, nDrivers: anon.length, skipped: false };
}

async function eseguiPrecalcolo() {
    const now = meseInRome(new Date());

    // Anagrafica letta una sola volta (cardinalità bassa)
    const anagByCognome = {};
    try {
        const snap = await db.collection('driverAnagrafica').get();
        snap.forEach(doc => {
            const data = doc.data();
            const k = ((data.cognome || '') + '').toUpperCase().trim();
            if (k) anagByCognome[k] = data;
        });
    } catch (e) {
        console.warn('[leaderboard] anagrafica load:', e.message);
    }

    const mesi = [now.mese];
    // Nei primi 10 giorni del mese, aggiorna anche il mese precedente
    // per catturare consegne/danni inseriti in ritardo
    if (now.day <= 10) mesi.push(mesePrecedente(now.mese));

    const results = [];
    for (const m of mesi) {
        try {
            results.push(await precalcoloMese(m, anagByCognome));
        } catch (e) {
            console.error(`[leaderboard] errore ${m}:`, e.message);
            results.push({ mese: m, error: e.message });
        }
    }
    return results;
}

exports.precalcolaLeaderboard = onSchedule(
    {
        schedule: 'every 1 hours',
        timeZone: 'Europe/Rome',
        region: 'europe-west1',
        memory: '256MiB',
        timeoutSeconds: 120,
    },
    async () => {
        const results = await eseguiPrecalcolo();
        console.log('[leaderboard] schedule done:', JSON.stringify(results));
    }
);

// Trigger manuale (admin): utile per backfill o test post-deploy.
// Accetta opzionalmente { mese: 'YYYY-MM' } per ricalcolare un mese specifico.
exports.rebuildLeaderboard = onRequest(
    {
        region: 'europe-west1',
        cors: ALLOWED_ORIGINS,
    },
    async (req, res) => {
        const origin = req.headers.origin || '';
        const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
        res.set('Access-Control-Allow-Origin', allowedOrigin);
        res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
        if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

        // Solo superadmin/staff possono triggerare manualmente
        const authHeader = req.headers.authorization || '';
        const idToken = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : '';
        if (!idToken) { res.status(401).json({ error: 'Token mancante' }); return; }

        let email = '';
        try {
            const decoded = await admin.auth().verifyIdToken(idToken);
            email = (decoded.email || '').toLowerCase();
        } catch (e) {
            res.status(401).json({ error: 'Token non valido' });
            return;
        }
        const ADMIN_EMAILS = ['amministrazione@avrlogisticarl.com', 'michela@avrlogisticarl.com', 'alessandra@avrlogisticarl.com'];
        if (!ADMIN_EMAILS.includes(email)) { res.status(403).json({ error: 'Non autorizzato' }); return; }

        const meseSpecifico = (req.body && req.body.mese) || null;

        try {
            if (meseSpecifico && /^\d{4}-\d{2}$/.test(meseSpecifico)) {
                const anagByCognome = {};
                const snap = await db.collection('driverAnagrafica').get();
                snap.forEach(doc => {
                    const data = doc.data();
                    const k = ((data.cognome || '') + '').toUpperCase().trim();
                    if (k) anagByCognome[k] = data;
                });
                const r = await precalcoloMese(meseSpecifico, anagByCognome);
                res.json({ success: true, result: r });
            } else {
                const results = await eseguiPrecalcolo();
                res.json({ success: true, results });
            }
        } catch (e) {
            console.error('[rebuildLeaderboard]', e);
            res.status(500).json({ error: e.message });
        }
    }
);

function buildEmailHtml(link) {
    return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reimposta la tua password — AVR Logistic</title>
</head>
<body style="margin:0;padding:0;background:#060910;font-family:'Helvetica Neue',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#060910;padding:40px 16px">
  <tr><td align="center">
    <table width="100%" style="max-width:520px;background:#111620;border-radius:16px;border:1px solid rgba(148,163,184,0.10);overflow:hidden">

      <!-- Header -->
      <tr>
        <td style="background:#0d1117;padding:28px 40px;text-align:center;border-bottom:1px solid rgba(56,189,248,0.15)">
          <div style="font-size:13px;letter-spacing:3px;font-weight:700;color:#38bdf8;text-transform:uppercase;margin-bottom:4px">AVR LOGISTIC</div>
          <div style="font-size:11px;color:#7c8db5;letter-spacing:1px">DELIVERY HUB</div>
        </td>
      </tr>

      <!-- Body -->
      <tr>
        <td style="padding:36px 40px">
          <h1 style="margin:0 0 14px;font-size:22px;font-weight:700;color:#e2e8f0;line-height:1.3">
            Reimposta la tua password
          </h1>
          <p style="margin:0 0 28px;font-size:14px;color:#7c8db5;line-height:1.7">
            Abbiamo ricevuto una richiesta di reimpostazione della password per il tuo account
            AVR Logistic Delivery Hub. Clicca sul bottone qui sotto per impostarne una nuova.
          </p>

          <!-- CTA -->
          <table cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td align="center" style="padding-bottom:32px">
                <a href="${link}"
                   style="display:inline-block;background:linear-gradient(135deg,#38bdf8 0%,#22d3ee 100%);color:#080b12;font-weight:700;font-size:15px;text-decoration:none;border-radius:10px;padding:14px 40px;letter-spacing:0.3px">
                  Reimposta password
                </a>
              </td>
            </tr>
          </table>

          <!-- Link fallback -->
          <p style="margin:0 0 6px;font-size:12px;color:#7c8db5;line-height:1.6">
            Se il bottone non funziona, copia e incolla questo link nel browser:
          </p>
          <p style="margin:0 0 28px;font-size:11px;color:#4a5878;word-break:break-all;line-height:1.8;background:#0d1117;padding:10px 14px;border-radius:6px;border:1px solid rgba(148,163,184,0.08)">
            ${link}
          </p>

          <!-- Avvisi -->
          <div style="border-top:1px solid rgba(148,163,184,0.08);padding-top:20px">
            <p style="margin:0;font-size:12px;color:#4a5878;line-height:1.8">
              ⏱️ Il link è valido per <strong style="color:#7c8db5">1 ora</strong> dal momento della richiesta.<br>
              🔒 Se non hai richiesto il reset della password, ignora questa email — il tuo account rimane al sicuro.
            </p>
          </div>
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="background:#0d1117;padding:18px 40px;text-align:center;border-top:1px solid rgba(148,163,184,0.08)">
          <p style="margin:0;font-size:11px;color:#4a5878;line-height:1.7">
            AVR Logistic S.r.l. — Gestionale Delivery Hub<br>
            <a href="https://dashboard.avrlogisticarl.com" style="color:#38bdf8;text-decoration:none">
              dashboard.avrlogisticarl.com
            </a>
          </p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}
