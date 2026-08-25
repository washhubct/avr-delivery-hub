'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const crypto = require('crypto');
const webpush = require('web-push');

admin.initializeApp();
const db = admin.firestore();

const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
const VAPID_PUBLIC_KEY = defineSecret('VAPID_PUBLIC_KEY');
const VAPID_PRIVATE_KEY = defineSecret('VAPID_PRIVATE_KEY');

const ALLOWED_ORIGINS = [
    'https://dashboard.last-mile.it',
    'https://app.last-mile.it',
    'https://appdriver.last-mile.it',
    'https://dashboard.last-mile.it',
    'https://appdriver.avrlogisticarl.com',
    'https://app.avrlogisticarl.com',
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
                url: 'https://dashboard.last-mile.it/auth/action/',
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
// Autorizzazione "gestione personale" (accessi driver, anagrafica):
// superadmin/staff hardcoded + amministratore/HR attivi dalla collection utenti.
// Allineato alle Firestore rules canManageAnagrafica().
const STAFF_ADMIN_EMAILS = ['amministrazione@avrlogisticarl.com', 'michela@avrlogisticarl.com', 'alessandra@avrlogisticarl.com', 'guido@last-mile.it'];
async function canManageDriverAccess(callerEmail) {
    if (STAFF_ADMIN_EMAILS.includes(callerEmail)) return true;
    try {
        const doc = await db.collection('utenti').doc(callerEmail).get();
        if (!doc.exists) return false;
        const d = doc.data();
        return (d.mansione === 'amministratore' || d.mansione === 'risorse_umane') && d.attivo !== false;
    } catch (e) {
        console.error('[canManageDriverAccess] lookup error:', e.message);
        return false;
    }
}

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
        if (!(await canManageDriverAccess(callerEmail))) { res.status(403).json({ error: 'Non autorizzato' }); return; }

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
                const tempPw = 'LM_' + require('crypto').randomBytes(12).toString('base64').replace(/[+/=]/g, '') + '!';
                user = await admin.auth().createUser({
                    email,
                    password: tempPw,
                    emailVerified: false,
                    disabled: false,
                });
                created = true;
            }

            const link = await admin.auth().generatePasswordResetLink(email, {
                url: 'https://dashboard.last-mile.it/auth/action/',
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
            from: 'Last Mile <noreply@last-mile.it>',
            to: [to],
            reply_to: 'risorse.umane@last-mile.it',
            subject: 'Reimposta la tua password — Last Mile',
            html,
        }),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Resend error: ${res.status} ${body.substring(0, 200)}`);
    }
}

// ═══════════════════════════════════════════════════════════════════
// CREA UTENZA GESTIONALE (superadmin-only)
// Crea account Firebase Auth (se manca), salva doc utenti/{email}
// con mansione + province, manda email di invito con link "imposta password".
// Idempotente: se esiste già, aggiorna solo doc utenti/ e (opzionale) rinvia link.
// ═══════════════════════════════════════════════════════════════════
const VALID_MANSIONI = ['amministratore', 'risorse_umane', 'responsabile'];
const VALID_PROVINCE = ['CT', 'SR', 'ME', 'PA', 'EN'];

exports.creaUtenzaGestionale = onRequest(
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

        // Verifica caller = superadmin hardcoded
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
        const SUPERADMIN_EMAILS = ['amministrazione@avrlogisticarl.com', 'guido@last-mile.it'];
        if (!SUPERADMIN_EMAILS.includes(callerEmail)) {
            res.status(403).json({ error: 'Solo il Superadmin può creare utenze' });
            return;
        }

        const body = req.body || {};
        const email = (body.email || '').trim().toLowerCase();
        const nome = (body.nome || '').trim();
        const mansione = (body.mansione || '').trim();
        const province = Array.isArray(body.province) ? body.province.filter(p => VALID_PROVINCE.includes(p)) : [];
        const rinviaSoloEmail = !!body.rinviaSoloEmail;

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { res.status(400).json({ error: 'Email non valida' }); return; }
        if (SUPERADMIN_EMAILS.includes(email)) { res.status(400).json({ error: 'Superadmin gestito hardcoded — non registrabile qui' }); return; }
        if (!nome && !rinviaSoloEmail) { res.status(400).json({ error: 'Nome obbligatorio' }); return; }
        if (!rinviaSoloEmail) {
            if (!VALID_MANSIONI.includes(mansione)) { res.status(400).json({ error: 'Mansione non valida' }); return; }
            if (mansione === 'responsabile' && province.length === 0) {
                res.status(400).json({ error: 'Un Responsabile deve avere almeno una provincia' });
                return;
            }
        }

        try {
            // [1] Crea o recupera account Auth
            let user;
            let created = false;
            try {
                user = await admin.auth().getUserByEmail(email);
            } catch (e) {
                if (e.code !== 'auth/user-not-found') throw e;
                const tempPw = 'LM_' + require('crypto').randomBytes(12).toString('base64').replace(/[+/=]/g, '') + '!';
                user = await admin.auth().createUser({
                    email,
                    password: tempPw,
                    emailVerified: false,
                    disabled: false,
                    displayName: nome || undefined,
                });
                created = true;
            }

            // [2] Aggiorna doc utenti/{email} — solo se non è "rinvia solo email"
            if (!rinviaSoloEmail) {
                const now = admin.firestore.FieldValue.serverTimestamp();
                const docRef = db.collection('utenti').doc(email);
                const existing = await docRef.get();
                const payload = {
                    email,
                    nome,
                    mansione,
                    province,
                    attivo: true,
                    aggiornatoIl: now,
                };
                if (!existing.exists) payload.creatoIl = now;
                await docRef.set(payload, { merge: true });
            }

            // [3] Genera link password reset e manda email di invito
            const link = await admin.auth().generatePasswordResetLink(email, {
                url: 'https://dashboard.last-mile.it/auth/action/',
                handleCodeInApp: false,
            });
            const displayName = nome || email.split('@')[0];
            const mansioneLabel = { amministratore: 'Amministratore', risorse_umane: 'Risorse Umane', responsabile: 'Responsabile' }[mansione] || 'Utente';
            await sendResendInvitoEmail({
                apiKey: RESEND_API_KEY.value(),
                to: email,
                link,
                nome: displayName,
                mansione: mansioneLabel,
                province,
                nuovoAccount: created,
            });

            console.log(`[creaUtenzaGestionale] ${created ? 'creato + inviato' : (rinviaSoloEmail ? 'reinviato link' : 'aggiornato + reinviato')} per ${email} (caller=${callerEmail})`);
            res.json({ success: true, created, uid: user.uid, emailInviata: true });
        } catch (err) {
            console.error('[creaUtenzaGestionale] errore:', err.code || err.message);
            res.status(500).json({ error: err.code || err.message || 'Errore interno' });
        }
    }
);

async function sendResendInvitoEmail({ apiKey, to, link, nome, mansione, province, nuovoAccount }) {
    const html = buildInvitoEmailHtml({ link, nome, mansione, province, nuovoAccount });
    const subject = nuovoAccount
        ? 'Benvenuto/a in Last Mile — imposta la tua password'
        : 'Il tuo ruolo su Last Mile è stato aggiornato';
    const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            from: 'Last Mile <noreply@last-mile.it>',
            to: [to],
            reply_to: 'risorse.umane@last-mile.it',
            subject,
            html,
        }),
    });
    if (!r.ok) {
        const body = await r.text();
        throw new Error(`Resend error: ${r.status} ${body.substring(0, 200)}`);
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
    // Consegne del mese + tempi (durataMin registrata dall'app driver)
    const repSnap = await db.collection('reportDriver').where('mese', '==', mese).get();
    const consegnePerDriver = {};
    const tempoPerDriver = {}; // { minuti, consegneConTempo }
    repSnap.forEach(doc => {
        const d = doc.data();
        const drv = ((d.driver || '') + '').toUpperCase().trim();
        if (!drv) return;
        const n = d.numConsegne || 0;
        consegnePerDriver[drv] = (consegnePerDriver[drv] || 0) + n;
        if (d.durataMin > 0 && n > 0) {
            if (!tempoPerDriver[drv]) tempoPerDriver[drv] = { minuti: 0, consegneConTempo: 0 };
            tempoPerDriver[drv].minuti += d.durataMin;
            tempoPerDriver[drv].consegneConTempo += n;
        }
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
    // Bonus velocità: tempo medio per consegna nel mese (da orari inizio/fine
    // giro dell'app). Vale solo con almeno 10 consegne con tempo registrato,
    // per evitare medie casuali su pochi dati. I mesi/driver senza orari
    // (report vecchi) non sono penalizzati: bonus semplicemente assente.
    const SOGLIA_CONSEGNE_TEMPO = 10;
    const drivers = Object.keys(consegnePerDriver).map(drv => {
        const consegne = consegnePerDriver[drv];
        const numDanni = danniPerDriver[drv] || 0;

        const t = tempoPerDriver[drv];
        let tempoMedioMin = null;
        let bonusVelocita = 0;
        if (t && t.consegneConTempo >= SOGLIA_CONSEGNE_TEMPO) {
            tempoMedioMin = Math.round(t.minuti / t.consegneConTempo * 10) / 10;
            if (tempoMedioMin < 20) bonusVelocita = 30;
            else if (tempoMedioMin < 25) bonusVelocita = 15;
        }

        let score = consegne + bonusVelocita;
        if (numDanni === 0) score += 50;
        score -= numDanni * 30;
        return {
            driver: drv,
            consegne,
            danni: numDanni,
            bonusZeroDanni: numDanni === 0,
            tempoMedioMin,
            bonusVelocita,
            score: Math.max(0, score),
        };
    });
    drivers.sort((a, b) => b.score - a.score);

    // Attacca trend: posizione mese precedente (1-indexed)
    drivers.forEach((d, i) => {
        const posPrec = prevMesePositions ? prevMesePositions[d.driver] : null;
        d.posPrec = posPrec || null;
    });

    // Versione anonima (letta dai driver): NESSUN dato identificativo.
    // `h` = sha256(email)[0:16] — l'app calcola lo stesso hash della propria
    // email per riconoscere la riga "SEI TU" e derivare il nickname.
    // Driver senza email in anagrafica: hash del cognome con prefisso
    // (non ricostruibile lato client, quindi comunque anonimo).
    const anon = drivers.map(d => {
        const a = anagByCognome[d.driver];
        const email = a && a.email ? String(a.email).toLowerCase().trim() : null;
        const h = crypto.createHash('sha256')
            .update(email || ('cognome:' + d.driver))
            .digest('hex')
            .slice(0, 16);
        return {
            h,
            consegne: d.consegne,
            danni: d.danni,
            bonusZeroDanni: d.bonusZeroDanni,
            tempoMedioMin: d.tempoMedioMin,
            bonusVelocita: d.bonusVelocita,
            score: d.score,
            posPrec: d.posPrec,
        };
    });

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
            tempoMedioMin: d.tempoMedioMin,
            bonusVelocita: d.bonusVelocita,
            score: d.score,
            posPrec: d.posPrec,
        };
    });

    return { anon, full };
}

async function loadPrevMesePositions(mesePrec) {
    try {
        // Legge leaderboardFull (non anon): serve il cognome per il match,
        // che nella versione anonima non esiste più.
        const doc = await db.collection('leaderboardFull').doc(mesePrec).get();
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
        const ADMIN_EMAILS = ['amministrazione@avrlogisticarl.com', 'michela@avrlogisticarl.com', 'alessandra@avrlogisticarl.com', 'guido@last-mile.it'];
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

function buildInvitoEmailHtml({ link, nome, mansione, province, nuovoAccount }) {
    const provinceStr = Array.isArray(province) && province.length
        ? province.map(p => `<span style="display:inline-block;background:rgba(56,189,248,0.10);color:#38bdf8;padding:2px 10px;border-radius:6px;font-weight:600;font-size:11px;margin-right:4px">${p}</span>`).join('')
        : '';
    const titolo = nuovoAccount ? `Benvenuto/a, ${nome}` : `Ciao ${nome}`;
    const messaggio = nuovoAccount
        ? 'Il Superadmin ti ha invitato/a a usare <strong style="color:#e2e8f0">Last Mile Delivery Hub</strong>. Clicca sul bottone qui sotto per impostare la tua password ed entrare.'
        : 'Il tuo ruolo su <strong style="color:#e2e8f0">Last Mile Delivery Hub</strong> è stato aggiornato. Puoi già accedere con la tua password attuale, oppure usare il bottone qui sotto per reimpostarla.';
    const ctaLabel = nuovoAccount ? 'Imposta password ed entra' : 'Reimposta password';
    return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Last Mile Hub — Invito</title>
</head>
<body style="margin:0;padding:0;background:#060910;font-family:'Helvetica Neue',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#060910;padding:40px 16px">
  <tr><td align="center">
    <table width="100%" style="max-width:520px;background:#111620;border-radius:16px;border:1px solid rgba(148,163,184,0.10);overflow:hidden">

      <tr>
        <td style="background:#0d1117;padding:28px 40px;text-align:center;border-bottom:1px solid rgba(56,189,248,0.15)">
          <div style="font-size:13px;letter-spacing:3px;font-weight:700;color:#38bdf8;text-transform:uppercase;margin-bottom:4px">LAST MILE</div>
          <div style="font-size:11px;color:#7c8db5;letter-spacing:1px">DELIVERY HUB</div>
        </td>
      </tr>

      <tr>
        <td style="padding:36px 40px">
          <h1 style="margin:0 0 14px;font-size:22px;font-weight:700;color:#e2e8f0;line-height:1.3">${titolo}</h1>
          <p style="margin:0 0 24px;font-size:14px;color:#7c8db5;line-height:1.7">${messaggio}</p>

          <table cellpadding="0" cellspacing="0" width="100%" style="background:#0d1117;border-radius:10px;border:1px solid rgba(148,163,184,0.08);margin-bottom:28px">
            <tr>
              <td style="padding:16px 18px">
                <div style="font-size:11px;color:#4a5878;letter-spacing:1.5px;font-weight:700;text-transform:uppercase;margin-bottom:6px">Il tuo ruolo</div>
                <div style="font-size:15px;color:#e2e8f0;font-weight:600">${mansione}</div>
                ${provinceStr ? `<div style="margin-top:10px">${provinceStr}</div>` : ''}
              </td>
            </tr>
          </table>

          <table cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td align="center" style="padding-bottom:32px">
                <a href="${link}"
                   style="display:inline-block;background:linear-gradient(135deg,#38bdf8 0%,#22d3ee 100%);color:#080b12;font-weight:700;font-size:15px;text-decoration:none;border-radius:10px;padding:14px 40px;letter-spacing:0.3px">
                  ${ctaLabel}
                </a>
              </td>
            </tr>
          </table>

          <p style="margin:0 0 6px;font-size:12px;color:#7c8db5;line-height:1.6">
            Se il bottone non funziona, copia e incolla questo link nel browser:
          </p>
          <p style="margin:0 0 28px;font-size:11px;color:#4a5878;word-break:break-all;line-height:1.8;background:#0d1117;padding:10px 14px;border-radius:6px;border:1px solid rgba(148,163,184,0.08)">
            ${link}
          </p>

          <div style="border-top:1px solid rgba(148,163,184,0.08);padding-top:20px">
            <p style="margin:0;font-size:12px;color:#4a5878;line-height:1.8">
              ⏱️ Il link è valido per <strong style="color:#7c8db5">1 ora</strong>.<br>
              🔒 Se non aspettavi questo invito, ignora questa email o contatta l'amministrazione.
            </p>
          </div>
        </td>
      </tr>

      <tr>
        <td style="background:#0d1117;padding:18px 40px;text-align:center;border-top:1px solid rgba(148,163,184,0.08)">
          <p style="margin:0;font-size:11px;color:#4a5878;line-height:1.7">
            Last Mile &mdash; AVR Logistic S.r.l.<br>
            <a href="https://dashboard.last-mile.it" style="color:#38bdf8;text-decoration:none">
              dashboard.last-mile.it
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

function buildEmailHtml(link) {
    return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reimposta la tua password — Last Mile</title>
</head>
<body style="margin:0;padding:0;background:#060910;font-family:'Helvetica Neue',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#060910;padding:40px 16px">
  <tr><td align="center">
    <table width="100%" style="max-width:520px;background:#111620;border-radius:16px;border:1px solid rgba(148,163,184,0.10);overflow:hidden">

      <!-- Header -->
      <tr>
        <td style="background:#0d1117;padding:28px 40px;text-align:center;border-bottom:1px solid rgba(56,189,248,0.15)">
          <div style="font-size:13px;letter-spacing:3px;font-weight:700;color:#38bdf8;text-transform:uppercase;margin-bottom:4px">LAST MILE</div>
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
            Last Mile Delivery Hub. Clicca sul bottone qui sotto per impostarne una nuova.
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
            Last Mile &mdash; AVR Logistic S.r.l.<br>
            <a href="https://dashboard.last-mile.it" style="color:#38bdf8;text-decoration:none">
              dashboard.last-mile.it
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

// ═══════════════════════════════════════════════════════════════════
// SYNC CONSEGNE DA GOOGLE SHEETS (fogli filiale Decò)
//
// Legge i fogli "AVR FILIALE xxx" direttamente via Sheets API e
// sincronizza la collection `consegne` con la stessa logica di
// normalizzazione e dedup dell'import manuale (importa.js):
//   • upsert con docId deterministico → mai duplicati, mai perdite
//   • RITORNI esclusi (fatturati a parte dal modulo Ritorni)
//   • PRESTAZIONE (AVR/INTERNA) importata: INTERNA = consegna Decò
//   • nessuna cancellazione: solo insert/update
//
// Requisito: i fogli devono essere condivisi (lettura) con il
// service account delle functions. L'email esatta viene loggata ad
// ogni run ed è visibile in syncStatus/last.
//
// Config fogli: collection `driveSheets` (docs: {spreadsheetId, nome,
// attivo}). Se vuota si usano i DEFAULT_SHEETS qui sotto.
// ═══════════════════════════════════════════════════════════════════

const { google } = require('googleapis');

const DEFAULT_SHEETS = [
    { spreadsheetId: '1Mbog1enTD18W0r7Ie03EzBchYR9lCF5yvpW6dQL1aBM', nome: 'AVR FILIALE 300' },
    { spreadsheetId: '15dv1maX8zjteESUTi6QpQ9OnMK1tErm4qi7BytFcwrY', nome: 'AVR FILIALE 401' },
    { spreadsheetId: '1WETOk-4_G_Xc4tpHrwDHfE5HMo9cTFJTux6qK7X4bDI', nome: 'AVR FILIALE 516 (ME)' },
    { spreadsheetId: '1-4vHi9UbeWbbWpC_HmgO8DyF5NOP57bjj9HgJEIkd4A', nome: 'AVR FILIALE 533 (PA)' },
    { spreadsheetId: '1iYh1Wo428fBbtNdsZYXb0zw_EpdvUHcF6dflfUWw25w', nome: 'AVR FILIALE 940' },
    { spreadsheetId: '1ASFT3M9coo3Zuqf-iSgaoasoxThsto8hAoqojmf1Cxc', nome: 'AVR FILIALE 346 LEONE' },
];

const MESI_TAB = { GEN: 1, FEB: 2, MAR: 3, APR: 4, MAG: 5, GIU: 6, LUG: 7, AGO: 8, SET: 9, OTT: 10, NOV: 11, DIC: 12 };

// "LUG 26" / "LUG26" → "2026-07", altrimenti null
function meseFromTabName(name) {
    const m = String(name || '').toUpperCase().trim()
        .match(/^(GEN|FEB|MAR|APR|MAG|GIU|LUG|AGO|SET|OTT|NOV|DIC)\s?(\d{2})$/);
    if (!m) return null;
    return '20' + m[2] + '-' + String(MESI_TAB[m[1]]).padStart(2, '0');
}

// ── Repliche 1:1 della logica di importa.js (client) ──
function syncDetectColumns(rows) {
    for (let i = 0; i < Math.min(5, rows.length); i++) {
        const row = rows[i];
        if (!row) continue;
        const headers = row.map(h => String(h || '').toUpperCase().trim());
        const filIdx = headers.findIndex(h => h === 'FIL' || h === 'FIL.' || h === 'FIL. PARTENZA');
        const dataIdx = headers.findIndex(h => h === 'DATA');
        if (filIdx >= 0 && dataIdx >= 0) {
            return {
                headerIdx: i,
                colMap: {
                    filiale: filIdx,
                    data: dataIdx,
                    orderId: headers.findIndex(h => h.includes('ORDER ID')),
                    fascia: headers.findIndex(h => h === 'FASCIA'),
                    cognome: headers.findIndex(h => h === 'COGNOME'),
                    nome: headers.findIndex(h => h === 'NOME'),
                    provincia: headers.findIndex(h => h === 'PR'),
                    citta: headers.findIndex(h => h.includes('CITTA')),
                    indirizzo: headers.findIndex(h => h === 'INDIRIZZO'),
                    importo: headers.findIndex(h => h.includes('IMPORTO EFFETTIVO') || h === 'IMPORTO'),
                    pagamento: headers.findIndex(h => h === 'PAGAMENTO'),
                    codiceDom: headers.findIndex(h => h.includes('CODICE DOMICILIO') || h.includes('CODICE_DOM')),
                    driver: headers.findIndex(h => h === 'RIDER' || h === 'DRIVER'),
                    targa: headers.findIndex(h => h.includes('TARGA')),
                    consegnata: headers.findIndex(h => h.includes('CONSEGNATA')),
                    prestazione: headers.findIndex(h => h === 'PRESTAZIONE'),
                    richiesta: headers.findIndex(h => h.includes('RICHIESTA')),
                    oraConsegna: headers.findIndex(h => h.includes('ORA CONSEGNA')),
                },
            };
        }
    }
    return { headerIdx: -1, colMap: {} };
}

function syncGetVal(row, idx) {
    if (idx == null || idx < 0 || idx >= row.length) return null;
    const v = row[idx];
    if (v === null || v === undefined || v === '') return null;
    return String(v).trim();
}

function syncParseDate(val) {
    if (!val) return null;
    const s = String(val).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
        const d = new Date(s.slice(0, 10) + 'T12:00:00Z');
        if (!isNaN(d)) return d;
    }
    let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], 12));
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
    if (m) return new Date(Date.UTC(2000 + (+m[3]), +m[2] - 1, +m[1], 12));
    const num = parseFloat(s);
    if (!isNaN(num) && num > 40000 && num < 60000) {
        return new Date(Math.round((num - 25569) * 86400 * 1000));
    }
    return null;
}

function syncMeseFromDate(d) {
    return d.toISOString().slice(0, 7);
}

function syncAreaFromProvincia(prov) {
    const p = String(prov || '').toUpperCase().trim();
    const map = { CT: 'CT', EN: 'EN', ME: 'ME', SR: 'SR', PA: 'PA' };
    return map[p] || null;
}

function syncParseImporto(val) {
    if (val == null) return 0;
    let s = String(val).trim().replace(/[€\s]/g, '');
    // Formato italiano 1.234,56 → 1234.56
    if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
}

// Identica a consegnaDocId di importa.js → stessa chiave di dedup
function syncConsegnaDocId(c) {
    const d = c.data;
    const dateStr = d.toISOString().slice(0, 10).replace(/-/g, '');
    const fil = String(c.filiale || '').replace(/[^a-zA-Z0-9]/g, '');
    const ref = (c.orderId || c.codiceDomicilio || '').replace(/[^a-zA-Z0-9]/g, '');
    const cli = (c.cliente || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 20);
    const imp = String(Math.round((c.importo || 0) * 100));
    return `${fil}_${dateStr}_${ref || cli}_${imp}`.slice(0, 100);
}

function parseTabRows(rows, fonte, sheetName) {
    const { headerIdx, colMap } = syncDetectColumns(rows);
    if (headerIdx < 0) return { consegne: [], ritorni: 0, scarti: 0, struttura: false };

    const consegne = [];
    let ritorni = 0, scarti = 0;
    for (let i = headerIdx + 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0) continue;

        const filiale = syncGetVal(row, colMap.filiale);
        const dataRaw = syncGetVal(row, colMap.data);
        const cognome = syncGetVal(row, colMap.cognome);
        if (!filiale && !cognome) continue;
        if (!dataRaw) continue;

        const richiesta = (syncGetVal(row, colMap.richiesta) || '').toUpperCase();
        const targaRaw = (syncGetVal(row, colMap.targa) || '').toUpperCase();
        if (richiesta.includes('RITORNO') || targaRaw === 'RITORNO') { ritorni++; continue; }

        const dateObj = syncParseDate(dataRaw);
        if (!dateObj) { scarti++; continue; }

        const mese = syncMeseFromDate(dateObj);
        // Guard: una riga con data fuori dal mese della tab resta comunque
        // importata (fa fede la data), ma non deve rompere nulla.

        const consegnataRaw = (syncGetVal(row, colMap.consegnata) || '').toUpperCase();
        const provincia = syncGetVal(row, colMap.provincia);

        consegne.push({
            filiale: String(filiale || '').replace(/\.0$/, ''),
            data: dateObj,
            mese,
            cliente: [cognome, syncGetVal(row, colMap.nome)].filter(Boolean).join(' ').trim() || null,
            provincia: provincia || null,
            citta: syncGetVal(row, colMap.citta) || null,
            indirizzo: syncGetVal(row, colMap.indirizzo) || null,
            importo: syncParseImporto(syncGetVal(row, colMap.importo)),
            fascia: syncGetVal(row, colMap.fascia) || syncGetVal(row, colMap.oraConsegna) || null,
            driver: syncGetVal(row, colMap.driver) || null,
            targa: syncGetVal(row, colMap.targa) || null,
            consegnata: consegnataRaw === 'SI',
            nonConsegnata: consegnataRaw === 'NO',
            prestazione: syncGetVal(row, colMap.prestazione) || null,
            orderId: syncGetVal(row, colMap.orderId) || null,
            pagamento: syncGetVal(row, colMap.pagamento) || null,
            codiceDomicilio: syncGetVal(row, colMap.codiceDom) || null,
            area: syncAreaFromProvincia(provincia),
            fonte,
            sheetName,
        });
    }
    return { consegne, ritorni, scarti, struttura: true };
}

// Estrae lo spreadsheetId da un link Google Sheets
function sheetIdFromLink(link) {
    const m = String(link || '').match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/);
    return m ? m[1] : null;
}

// Fonte primaria: collection `filiali` (campo sheetLink, gestito dalla
// schermata Filiali della dash — è lì che sono censiti tutti i fogli).
// In aggiunta: collection `driveSheets` per fogli extra manuali.
// Fallback: DEFAULT_SHEETS se non c'è nulla.
async function loadSheetConfig() {
    const byId = {}; // dedup per spreadsheetId (più filiali possono condividere un foglio)

    try {
        const snap = await db.collection('filiali').get();
        snap.forEach(doc => {
            const d = doc.data();
            const id = sheetIdFromLink(d.sheetLink);
            if (!id) return;
            if (!byId[id]) {
                byId[id] = { spreadsheetId: id, nome: 'FILIALE ' + (d.codice || doc.id) + (d.nome ? ' — ' + d.nome : '') };
            } else {
                byId[id].nome += ' + ' + (d.codice || doc.id);
            }
        });
    } catch (e) {
        console.warn('[sync] filiali config:', e.message);
    }

    try {
        const snap = await db.collection('driveSheets').get();
        snap.forEach(doc => {
            const d = doc.data();
            if (d.spreadsheetId && d.attivo !== false && !byId[d.spreadsheetId]) {
                byId[d.spreadsheetId] = { spreadsheetId: d.spreadsheetId, nome: d.nome || doc.id };
            }
            // attivo:false su driveSheets disattiva anche un foglio da filiali
            if (d.spreadsheetId && d.attivo === false) delete byId[d.spreadsheetId];
        });
    } catch (e) {
        console.warn('[sync] driveSheets config:', e.message);
    }

    const configured = Object.values(byId);
    if (configured.length > 0) return configured;
    return DEFAULT_SHEETS;
}

async function eseguiSyncConsegne(mesiTarget) {
    const auth = new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    let saEmail = null;
    try {
        const client = await auth.getClient();
        saEmail = client.email || (await auth.getCredentials()).client_email || null;
    } catch (e) { /* best effort */ }

    const sheetsApi = google.sheets({ version: 'v4', auth });
    const fogli = await loadSheetConfig();

    const dettagli = [];
    let totUpserted = 0, totRitorni = 0, totScarti = 0;

    for (const foglio of fogli) {
        const det = { nome: foglio.nome, spreadsheetId: foglio.spreadsheetId, tabs: [], upserted: 0, errore: null };
        try {
            const meta = await sheetsApi.spreadsheets.get({
                spreadsheetId: foglio.spreadsheetId,
                fields: 'sheets.properties.title',
            });
            const tabNames = (meta.data.sheets || []).map(s => s.properties.title);
            const target = tabNames.filter(t => {
                const m = meseFromTabName(t);
                return m && mesiTarget.includes(m);
            });

            for (const tab of target) {
                const resp = await sheetsApi.spreadsheets.values.get({
                    spreadsheetId: foglio.spreadsheetId,
                    range: `'${tab.replace(/'/g, "''")}'`,
                    valueRenderOption: 'FORMATTED_VALUE',
                    dateTimeRenderOption: 'FORMATTED_STRING',
                });
                const rows = resp.data.values || [];
                const { consegne, ritorni, scarti, struttura } = parseTabRows(rows, foglio.nome, tab);

                if (!struttura) {
                    det.tabs.push({ tab, warn: 'struttura non riconosciuta' });
                    continue;
                }

                // Upsert in batch da 400
                for (let i = 0; i < consegne.length; i += 400) {
                    const batch = db.batch();
                    consegne.slice(i, i + 400).forEach(c => {
                        const docRef = db.collection('consegne').doc(syncConsegnaDocId(c));
                        batch.set(docRef, {
                            ...c,
                            data: admin.firestore.Timestamp.fromDate(c.data),
                            syncedAt: admin.firestore.FieldValue.serverTimestamp(),
                            fonteTipo: 'drive_sync',
                        }, { merge: true });
                    });
                    await batch.commit();
                }

                det.tabs.push({ tab, consegne: consegne.length, ritorniEsclusi: ritorni, scarti });
                det.upserted += consegne.length;
                totRitorni += ritorni;
                totScarti += scarti;
            }
            totUpserted += det.upserted;
        } catch (e) {
            det.errore = e.message;
            console.error(`[sync] ${foglio.nome}:`, e.message);
        }
        dettagli.push(det);
    }

    const risultato = {
        at: admin.firestore.FieldValue.serverTimestamp(),
        mesi: mesiTarget,
        serviceAccount: saEmail,
        totUpserted,
        totRitorniEsclusi: totRitorni,
        totScarti,
        dettagli: JSON.parse(JSON.stringify(dettagli)),
        errori: dettagli.filter(d => d.errore).length,
    };
    await db.collection('syncStatus').doc('last').set(risultato);
    await db.collection('syncLog').add(risultato);
    console.log('[sync] done:', JSON.stringify({ mesi: mesiTarget, totUpserted, errori: risultato.errori }));
    return risultato;
}

function mesiTargetDefault() {
    const now = meseInRome(new Date());
    const mesi = [now.mese];
    // Primi 10 giorni del mese: sincronizza anche il mese precedente
    // per catturare righe aggiunte/corrette in ritardo dalle filiali
    if (now.day <= 10) mesi.push(mesePrecedente(now.mese));
    return mesi;
}

// Sync automatica notturna (03:30 Europe/Rome, dopo la chiusura giornata)
// ⚠️ DISATTIVATO (non esportato): la pipeline di produzione è quella dei
// GAS in scripts/gas (v1 giornalieri + v4.2 mensili) che scrive su
// `consegne` con schema ID buildStableId. Riattivare questo canale solo
// dopo aver allineato syncConsegnaDocId a quello schema, altrimenti le
// stesse consegne verrebbero duplicate con ID diversi.
const _syncConsegneScheduled_disattivato = onSchedule(
    {
        schedule: '30 3 * * *',
        timeZone: 'Europe/Rome',
        region: 'europe-west1',
        memory: '512MiB',
        timeoutSeconds: 540,
    },
    async () => {
        await eseguiSyncConsegne(mesiTargetDefault());
    }
);

// Trigger manuale (admin/staff): opzionale { mese: 'YYYY-MM' } per backfill
// ⚠️ DISATTIVATO (non esportato): la pipeline di produzione è quella dei
// GAS in scripts/gas (v1 giornalieri + v4.2 mensili) che scrive su
// `consegne` con schema ID buildStableId. Riattivare questo canale solo
// dopo aver allineato syncConsegnaDocId a quello schema, altrimenti le
// stesse consegne verrebbero duplicate con ID diversi.
const _syncConsegne_disattivato = onRequest(
    {
        region: 'europe-west1',
        cors: ALLOWED_ORIGINS,
        memory: '512MiB',
        timeoutSeconds: 540,
    },
    async (req, res) => {
        const origin = req.headers.origin || '';
        const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
        res.set('Access-Control-Allow-Origin', allowedOrigin);
        res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
        if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

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
        const ADMIN_EMAILS = ['amministrazione@avrlogisticarl.com', 'michela@avrlogisticarl.com', 'alessandra@avrlogisticarl.com', 'guido@last-mile.it'];
        if (!ADMIN_EMAILS.includes(email)) { res.status(403).json({ error: 'Non autorizzato' }); return; }

        const meseSpecifico = (req.body && req.body.mese) || null;
        const mesi = (meseSpecifico && /^\d{4}-\d{2}$/.test(meseSpecifico))
            ? [meseSpecifico]
            : mesiTargetDefault();

        try {
            const r = await eseguiSyncConsegne(mesi);
            res.json({ success: true, mesi, totUpserted: r.totUpserted, errori: r.errori, dettagli: r.dettagli });
        } catch (e) {
            console.error('[syncConsegne]', e);
            res.status(500).json({ error: e.message });
        }
    }
);

// ═══════════════════════════════════════════════════════════════════
// INGEST CONSEGNE DA APPS SCRIPT (push)
//
// Alternativa alla lettura diretta via Sheets API che NON richiede di
// condividere i fogli col service account: lo script GAS
// (scripts/sync-consegne-firestore.gs) gira sull'account che ha già
// accesso ai fogli filiale e spinge i record qui.
//
// Protetto da secret condiviso (SYNC_INGEST_SECRET):
//   firebase functions:secrets:set SYNC_INGEST_SECRET
// e stesso valore nelle Script Properties del GAS (chiave SYNC_SECRET).
//
// Stesso docId di dedup del sync/import → nessun duplicato anche se
// convivono più canali di importazione.
// ═══════════════════════════════════════════════════════════════════

const SYNC_INGEST_SECRET = defineSecret('SYNC_INGEST_SECRET');

// ⚠️ DISATTIVATO (non esportato): la pipeline di produzione è quella dei
// GAS in scripts/gas (v1 giornalieri + v4.2 mensili) che scrive su
// `consegne` con schema ID buildStableId. Riattivare questo canale solo
// dopo aver allineato syncConsegnaDocId a quello schema, altrimenti le
// stesse consegne verrebbero duplicate con ID diversi.
const _ingestConsegne_disattivato = onRequest(
    {
        region: 'europe-west1',
        secrets: [SYNC_INGEST_SECRET],
        memory: '512MiB',
        timeoutSeconds: 300,
    },
    async (req, res) => {
        if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

        const secret = req.headers['x-sync-secret'] || '';
        if (!secret || secret !== SYNC_INGEST_SECRET.value()) {
            res.status(401).json({ error: 'Secret non valido' });
            return;
        }

        const body = req.body || {};

        try {
            // ── Chiusura run: salva riepilogo in syncStatus/syncLog ──
            if (body.type === 'summary') {
                const summary = {
                    at: admin.firestore.FieldValue.serverTimestamp(),
                    fonteTipo: 'apps_script',
                    mesi: Array.isArray(body.mesi) ? body.mesi.slice(0, 12) : [],
                    totUpserted: Number(body.totUpserted) || 0,
                    totRitorniEsclusi: Number(body.totRitorniEsclusi) || 0,
                    totScarti: Number(body.totScarti) || 0,
                    errori: Number(body.errori) || 0,
                    dettagli: Array.isArray(body.dettagli) ? body.dettagli.slice(0, 100) : [],
                };
                await db.collection('syncStatus').doc('last').set(summary);
                await db.collection('syncLog').add(summary);
                res.json({ success: true });
                return;
            }

            // ── Batch di record ──
            const records = Array.isArray(body.records) ? body.records : [];
            if (records.length === 0) { res.json({ success: true, upserted: 0 }); return; }
            if (records.length > 500) { res.status(400).json({ error: 'Max 500 record per richiesta' }); return; }

            const validi = [];
            let scarti = 0;
            for (const r of records) {
                // Validazione minima anti-garbage
                if (!r || typeof r !== 'object') { scarti++; continue; }
                if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.data || ''))) { scarti++; continue; }
                const filiale = String(r.filiale || '').trim().replace(/\.0$/, '');
                if (!filiale && !r.cliente) { scarti++; continue; }
                const importo = Number(r.importo);
                validi.push({
                    filiale,
                    data: new Date(r.data + 'T12:00:00Z'),
                    mese: String(r.data).slice(0, 7),
                    cliente: r.cliente ? String(r.cliente).slice(0, 120) : null,
                    provincia: r.provincia ? String(r.provincia).slice(0, 4) : null,
                    citta: r.citta ? String(r.citta).slice(0, 80) : null,
                    indirizzo: r.indirizzo ? String(r.indirizzo).slice(0, 160) : null,
                    importo: isNaN(importo) ? 0 : Math.max(0, Math.min(importo, 100000)),
                    fascia: r.fascia ? String(r.fascia).slice(0, 20) : null,
                    driver: r.driver ? String(r.driver).slice(0, 60) : null,
                    targa: r.targa ? String(r.targa).slice(0, 20) : null,
                    consegnata: r.consegnata === true,
                    nonConsegnata: r.nonConsegnata === true,
                    prestazione: r.prestazione ? String(r.prestazione).slice(0, 20) : null,
                    orderId: r.orderId ? String(r.orderId).slice(0, 40) : null,
                    pagamento: r.pagamento ? String(r.pagamento).slice(0, 30) : null,
                    codiceDomicilio: r.codiceDomicilio ? String(r.codiceDomicilio).slice(0, 40) : null,
                    area: syncAreaFromProvincia(r.provincia),
                    fonte: r.fonte ? String(r.fonte).slice(0, 80) : 'apps_script',
                    sheetName: r.sheetName ? String(r.sheetName).slice(0, 40) : null,
                });
            }

            for (let i = 0; i < validi.length; i += 400) {
                const batch = db.batch();
                validi.slice(i, i + 400).forEach(c => {
                    const docRef = db.collection('consegne').doc(syncConsegnaDocId(c));
                    batch.set(docRef, {
                        ...c,
                        data: admin.firestore.Timestamp.fromDate(c.data),
                        syncedAt: admin.firestore.FieldValue.serverTimestamp(),
                        fonteTipo: 'apps_script',
                    }, { merge: true });
                });
                await batch.commit();
            }

            res.json({ success: true, upserted: validi.length, scarti });
        } catch (e) {
            console.error('[ingestConsegne]', e);
            res.status(500).json({ error: e.message });
        }
    }
);

// ═══════════════════════════════════════════════════════════
// PUSH NOTIFICATIONS — Driver App (Web Push via VAPID)
// Il client (driveravrapp/js/push.js) salva la PushSubscription in
// pushSubscriptions/{auto} con email, driver (cognome), subscription.
// Qui si invia con web-push; subscription morte (404/410) → delete doc.
// Payload atteso dal service worker dell'app: { title, body, url? }.
// ═══════════════════════════════════════════════════════════

function giornoInRome(date) {
    const r = meseInRome(date);
    return `${r.mese}-${String(r.day).padStart(2, '0')}`;
}

function initWebpush() {
    webpush.setVapidDetails(
        'mailto:guido@last-mile.it',
        VAPID_PUBLIC_KEY.value().trim(),
        VAPID_PRIVATE_KEY.value().trim()
    );
}

// Invia il payload a una lista di doc pushSubscriptions.
// Ritorna { sent, dead }: le subscription scadute vengono eliminate.
async function inviaPushASubs(subs, payload) {
    const body = JSON.stringify(payload);
    let sent = 0, dead = 0;
    await Promise.all(subs.map(async s => {
        try {
            await webpush.sendNotification(s.subscription, body);
            sent++;
        } catch (e) {
            if (e.statusCode === 404 || e.statusCode === 410) {
                dead++;
                await db.collection('pushSubscriptions').doc(s.id).delete().catch(() => {});
            } else {
                console.warn('[push] invio fallito', s.email, e.statusCode || e.message);
            }
        }
    }));
    return { sent, dead };
}

// Carica le subscription per una lista di email (chunk da 30 per il limite 'in')
async function subsPerEmails(emails) {
    const subs = [];
    for (let i = 0; i < emails.length; i += 30) {
        const snap = await db.collection('pushSubscriptions')
            .where('email', 'in', emails.slice(i, i + 30)).get();
        snap.forEach(doc => subs.push({ id: doc.id, ...doc.data() }));
    }
    return subs;
}

// 21:00 — promemoria ai driver con turno ancora aperto oggi e nessun report
exports.pushPromemoriaReport = onSchedule(
    {
        schedule: '0 21 * * *',
        timeZone: 'Europe/Rome',
        region: 'europe-west1',
        secrets: [VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY],
    },
    async () => {
        const oggi = giornoInRome(new Date());
        const mese = oggi.slice(0, 7);

        const turniSnap = await db.collection('turniDriver').where('data', '==', oggi).get();
        const conTurnoAperto = new Set();
        turniSnap.forEach(doc => {
            const t = doc.data();
            if (t.email && !t.oraFine) conTurnoAperto.add(t.email.toLowerCase());
        });
        if (conTurnoAperto.size === 0) { console.log('[push] promemoria: nessun turno aperto'); return; }

        // Report di oggi: filtro sul mese (indice esistente) + check giorno in memoria
        const repSnap = await db.collection('reportDriver').where('mese', '==', mese).get();
        const conReport = new Set();
        repSnap.forEach(doc => {
            const r = doc.data();
            const dt = r.data && typeof r.data.toDate === 'function' ? r.data.toDate() : null;
            if (dt && giornoInRome(dt) === oggi && r.driverEmail) conReport.add(r.driverEmail.toLowerCase());
        });

        const daAvvisare = [...conTurnoAperto].filter(em => !conReport.has(em));
        if (daAvvisare.length === 0) { console.log('[push] promemoria: tutti hanno già il report'); return; }

        initWebpush();
        const subs = await subsPerEmails(daAvvisare);
        const r = await inviaPushASubs(subs, {
            title: 'Last Mile Driver',
            body: 'Ricordati di registrare le consegne di oggi 📦',
            url: './',
        });
        console.log(`[push] promemoria: ${daAvvisare.length} driver, ${subs.length} device, sent=${r.sent} dead=${r.dead}`);
    }
);

// Cambio stato ritorno (accettato/rifiutato) → notifica al driver
exports.pushEsitoRitorno = onDocumentUpdated(
    {
        document: 'ritorni/{id}',
        region: 'europe-west1',
        secrets: [VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY],
    },
    async (event) => {
        const before = event.data.before.data();
        const after = event.data.after.data();
        if (before.stato === after.stato) return;
        if (after.stato !== 'accettato' && after.stato !== 'rifiutato') return;
        const email = (after.driverEmail || '').toLowerCase();
        if (!email) return;

        const esito = after.stato === 'accettato' ? 'accettato ✓' : 'rifiutato ✕';
        initWebpush();
        const subs = await subsPerEmails([email]);
        const r = await inviaPushASubs(subs, {
            title: 'Last Mile Driver',
            body: `Il tuo ritorno per ${after.cliente || 'il cliente'} è stato ${esito}`,
            url: './',
        });
        console.log(`[push] esito ritorno ${event.params.id} → ${email}: sent=${r.sent}`);
    }
);

// Segnalazione risolta → notifica al driver
exports.pushEsitoSegnalazione = onDocumentUpdated(
    {
        document: 'segnalazioni/{id}',
        region: 'europe-west1',
        secrets: [VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY],
    },
    async (event) => {
        const before = event.data.before.data();
        const after = event.data.after.data();
        if (before.stato === after.stato || after.stato !== 'risolta') return;
        const email = (after.driverEmail || '').toLowerCase();
        if (!email) return;

        initWebpush();
        const subs = await subsPerEmails([email]);
        const r = await inviaPushASubs(subs, {
            title: 'Last Mile Driver',
            body: `La tua segnalazione «${after.tipoLabel || after.tipo || ''}» è stata risolta ✓`,
            url: './',
        });
        console.log(`[push] esito segnalazione ${event.params.id} → ${email}: sent=${r.sent}`);
    }
);

// Ultimo giorno del mese, 18:00 — podio ai top 3 della classifica.
// Cron senza supporto 'L': gira il 28-31 e scatta solo se domani è il giorno 1.
exports.pushPodioMensile = onSchedule(
    {
        schedule: '0 18 28-31 * *',
        timeZone: 'Europe/Rome',
        region: 'europe-west1',
        secrets: [VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY],
    },
    async () => {
        const now = new Date();
        const domani = meseInRome(new Date(now.getTime() + 24 * 60 * 60 * 1000));
        if (domani.day !== 1) return; // non è l'ultimo giorno del mese

        const mese = meseInRome(now).mese;
        const doc = await db.collection('leaderboardFull').doc(mese).get();
        if (!doc.exists) { console.log(`[push] podio: leaderboardFull/${mese} assente`); return; }
        const top3 = (doc.data().drivers || []).slice(0, 3);
        if (top3.length === 0) return;

        initWebpush();
        const medaglie = ['🥇', '🥈', '🥉'];
        for (let i = 0; i < top3.length; i++) {
            const cognome = (top3[i].driver || '').toUpperCase().trim();
            if (!cognome) continue;
            // Match per cognome: pushSubscriptions.driver è il cognome uppercase
            const snap = await db.collection('pushSubscriptions').where('driver', '==', cognome).get();
            const subs = [];
            snap.forEach(d => subs.push({ id: d.id, ...d.data() }));
            if (subs.length === 0) continue;
            const r = await inviaPushASubs(subs, {
                title: 'Last Mile Driver',
                body: `${medaglie[i]} Sei sul podio! Hai chiuso il mese ${i + 1}° in classifica 🏆`,
                url: './',
            });
            console.log(`[push] podio ${mese}: ${cognome} ${i + 1}° sent=${r.sent}`);
        }
    }
);


// ═══════════════════════════════════════════════════════════════════
// CONTROLLI AUTOMATICI GIORNALIERI — sentinella dati, ore 8:30.
// Verifica la giornata di ieri e manda email SOLO se trova anomalie:
//   1. sync GAS fermo (nessuna scrittura da >36h)
//   2. filiali mute (attive nei 7gg precedenti ma 0 consegne ieri)
//   3. driver con consegne Decò ma zero report app
//   4. possibili driver non censiti in anagrafica (rider ricorrente marcato interna)
//   5. consegne 'da verificare' (rider vuoto) e date future
// ═══════════════════════════════════════════════════════════════════
exports.controlliAutomatici = onSchedule(
    {
        schedule: '30 8 * * *',
        timeZone: 'Europe/Rome',
        region: 'europe-west1',
        secrets: [RESEND_API_KEY],
        timeoutSeconds: 300,
        memory: '512MiB',
    },
    async () => {
        const db = admin.firestore();
        const fmt = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(d);
        const oggi = fmt(new Date());
        const ieri = fmt(new Date(Date.now() - 86400000));
        const ieriDom = new Date(Date.now() - 86400000).getUTCDay() === 0;
        const mese = ieri.slice(0, 7);
        const dayOf = (v) => { const d = v && v.toDate ? v.toDate() : new Date(v); return isNaN(d) ? null : fmt(d); };
        const norm = (s) => String(s || '').toUpperCase().replace(/['\u2019` ]/g, '').trim();

        const [conSnap, repSnap, anagSnap, cfgSnap] = await Promise.all([
            db.collection('consegne').where('mese', '==', mese).get(),
            db.collection('reportDriver').where('mese', '==', mese).get(),
            db.collection('driverAnagrafica').get(),
            db.collection('config').doc('controlli').get(),
        ]);
        // Rider Decò noti (config/controlli.riderDecoNoti): non nostri per
        // conferma esplicita — la sentinella non li segnala come non censiti.
        const decoNoti = new Set(((cfgSnap.exists && cfgSnap.data().riderDecoNoti) || []).map((x) => String(x).toUpperCase().replace(/['\u2019` ]/g, '')));

        const cognomi = [];
        anagSnap.forEach((d) => {
            const x = d.data();
            if (!x.cognome) return;
            cognomi.push(norm(x.cognome));
            if (Array.isArray(x.alias)) x.alias.forEach((a) => { if (a) cognomi.push(norm(a)); });
        });
        const matchAnag = (rider) => { const r = norm(rider); return r && cognomi.some((c) => r.includes(c) || c.includes(r)); };

        let maxSync = '';
        const filialeIeri = {}, filialePrima = {}, decoDriverIeri = {}, riderInterniIeri = {};
        let verificaIeri = 0, dateFuture = 0;
        const importiSospetti = [];
        conSnap.forEach((d) => {
            const c = d.data();
            if (c.sync && c.sync > maxSync) maxSync = c.sync;
            if (c.tipo && c.tipo !== 'consegna') return;
            const day = dayOf(c.data);
            if (!day) return;
            if (day > oggi) dateFuture++;
            const fil = String(c.filiale || '?');
            if (day === ieri) {
                filialeIeri[fil] = (filialeIeri[fil] || 0) + 1;
                if ((c.importo || 0) > 5000) importiSospetti.push(fil + ' ' + (c.filialeNome || '') + ' — €' + c.importo.toFixed(2) + ' (' + (c.rider || c.cognome || '?') + ')');
                if (c.tipoDriver === 'verifica') verificaIeri++;
                const rider = norm(c.rider);
                if (rider && c.tipoDriver === 'avr') decoDriverIeri[rider] = (decoDriverIeri[rider] || 0) + 1;
                if (rider && c.tipoDriver === 'interna' && !matchAnag(rider) && !decoNoti.has(rider)) riderInterniIeri[rider] = (riderInterniIeri[rider] || 0) + 1;
            } else if (day < ieri && day >= fmt(new Date(Date.now() - 8 * 86400000))) {
                filialePrima[fil] = (filialePrima[fil] || 0) + 1;
            }
        });

        const appIeri = {};
        repSnap.forEach((d) => {
            const r = d.data();
            if (dayOf(r.data) !== ieri) return;
            const k = norm(r.driver);
            appIeri[k] = (appIeri[k] || 0) + (r.numConsegne || 0);
        });

        const anomalie = [];
        importiSospetti.forEach((x) => anomalie.push('🟣 <b>Scontrino sospetto</b> (>€5.000, probabile refuso — col prezziario vale €300): ' + x));
        const oreDaSync = maxSync ? (Date.now() - new Date(maxSync).getTime()) / 3600000 : 999;
        if (oreDaSync > 36) anomalie.push('🔴 <b>Sync GAS fermo</b>: ultima scrittura ' + (maxSync || 'mai') + ' (' + Math.round(oreDaSync) + ' ore fa). Controllare i trigger su script.google.com.');

        if (!ieriDom && oreDaSync <= 36) {
            Object.keys(filialePrima).forEach((fil) => {
                if (filialePrima[fil] >= 10 && !filialeIeri[fil]) anomalie.push('🟠 <b>Filiale ' + fil + ' muta</b>: ' + filialePrima[fil] + ' consegne nei 7gg precedenti, zero ieri.');
            });
        }

        Object.keys(decoDriverIeri).forEach((rider) => {
            if (decoDriverIeri[rider] >= 3 && !Object.keys(appIeri).some((a) => a.includes(rider) || rider.includes(a))) {
                anomalie.push('🟡 <b>App non usata</b>: ' + rider + ' — ' + decoDriverIeri[rider] + ' consegne Decò ieri, zero report app.');
            }
        });

        Object.keys(riderInterniIeri).forEach((rider) => {
            if (riderInterniIeri[rider] >= 5) anomalie.push('🔵 <b>Possibile driver non censito</b>: rider "' + rider + '" con ' + riderInterniIeri[rider] + ' consegne ieri, marcato interno e assente in anagrafica.');
        });

        if (verificaIeri > 0) anomalie.push('⚪ ' + verificaIeri + ' consegne di ieri <b>senza rider</b> (da verificare, escluse dal fatturato automatico).');
        if (dateFuture > 0) anomalie.push('⚪ ' + dateFuture + ' consegne nel mese con <b>data futura</b> (refuso sul foglio).');

        if (anomalie.length === 0) { console.log('[controlliAutomatici] ' + ieri + ': tutto ok'); return; }

        const html = '<div style="font-family:sans-serif;max-width:560px"><h2 style="color:#0f1d3d">Controlli automatici — ' + ieri + '</h2><ul style="line-height:1.9">' +
            anomalie.map((a) => '<li>' + a + '</li>').join('') +
            '</ul><p style="color:#64748b;font-size:13px">Report generato automaticamente ogni mattina alle 8:30 — solo quando ci sono anomalie. Dettagli su <a href="https://dashboard.last-mile.it">dashboard.last-mile.it</a></p></div>';

        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + RESEND_API_KEY.value(), 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from: 'Last Mile <noreply@last-mile.it>',
                to: ['guido@last-mile.it', 'risorse.umane@last-mile.it'],
                subject: '⚠️ Controlli Last Mile ' + ieri + ': ' + anomalie.length + ' anomalie',
                html,
            }),
        });
        if (!res.ok) throw new Error('Resend: ' + res.status + ' ' + (await res.text()).slice(0, 200));
        console.log('[controlliAutomatici] ' + ieri + ': ' + anomalie.length + ' anomalie, email inviata');
    }
);


// ═══════════════════════════════════════════════════════════════════
// STATO DRIVER → AUTH — il toggle Disattiva in anagrafica blocca DAVVERO
// l'app: alla modifica di `attivo` l'utente Firebase Auth viene
// disabilitato/riabilitato (il login smette di funzionare subito).
// ═══════════════════════════════════════════════════════════════════
exports.syncStatoDriver = onDocumentUpdated(
    { document: 'driverAnagrafica/{id}', region: 'europe-west1' },
    async (event) => {
        const prima = event.data.before.data();
        const dopo = event.data.after.data();
        if (prima.attivo === dopo.attivo) return;
        const email = (dopo.email || '').toLowerCase().trim();
        if (!email) return;
        try {
            const user = await admin.auth().getUserByEmail(email);
            const disabled = dopo.attivo === false;
            if (user.disabled !== disabled) {
                await admin.auth().updateUser(user.uid, { disabled });
                console.log('[syncStatoDriver] ' + email + ' → ' + (disabled ? 'DISABILITATO' : 'riabilitato'));
            }
        } catch (e) {
            if (e.code === 'auth/user-not-found') { console.log('[syncStatoDriver] ' + email + ': nessun utente Auth'); return; }
            throw e;
        }
    }
);

// ═══════════════════════════════════════════════════════════════════
// PULIZIA ANAGRAFICA — ogni notte: i driver disattivati da oltre 90
// giorni vengono ARCHIVIATI in driverArchivio (non eliminati: il cognome
// e gli alias servono per l'attribuzione storica delle consegne) e
// l'utente Auth viene rimosso. Email di riepilogo a HR.
// ═══════════════════════════════════════════════════════════════════
exports.pulisciAnagrafica = onSchedule(
    { schedule: '15 7 * * *', timeZone: 'Europe/Rome', region: 'europe-west1', secrets: [RESEND_API_KEY] },
    async () => {
        const db = admin.firestore();
        const soglia = new Date(Date.now() - 90 * 86400000);
        const snap = await db.collection('driverAnagrafica').where('attivo', '==', false).get();
        const archiviati = [];
        for (const doc of snap.docs) {
            const x = doc.data();
            const dis = x.disattivatoIl && x.disattivatoIl.toDate ? x.disattivatoIl.toDate() : null;
            if (!dis || dis > soglia) continue;
            await db.collection('driverArchivio').doc(doc.id).set(Object.assign({}, x, {
                archiviatoIl: admin.firestore.FieldValue.serverTimestamp(),
            }));
            await doc.ref.delete();
            if (x.email) {
                try { const u = await admin.auth().getUserByEmail(x.email.toLowerCase()); await admin.auth().deleteUser(u.uid); }
                catch (e) { if (e.code !== 'auth/user-not-found') console.warn('[pulisciAnagrafica] auth:', e.message); }
            }
            archiviati.push((x.cognome || doc.id) + ' ' + (x.nome || ''));
        }
        if (archiviati.length === 0) { console.log('[pulisciAnagrafica] niente da archiviare'); return; }
        console.log('[pulisciAnagrafica] archiviati:', archiviati.join(', '));
        const html = '<div style="font-family:sans-serif"><h3>Anagrafica driver — archiviazione automatica</h3>' +
            '<p>Driver disattivati da oltre 90 giorni, spostati in archivio (accesso app rimosso, storico consegne conservato):</p>' +
            '<ul>' + archiviati.map((n) => '<li>' + n + '</li>').join('') + '</ul></div>';
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + RESEND_API_KEY.value(), 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from: 'Last Mile <noreply@last-mile.it>',
                to: ['guido@last-mile.it', 'risorse.umane@last-mile.it'],
                subject: 'Anagrafica: ' + archiviati.length + ' driver archiviati automaticamente',
                html,
            }),
        });
        if (!res.ok) console.warn('[pulisciAnagrafica] email:', res.status);
    }
);

// ═══════════════════════════════════════════════════════════════════
// FATTURAZIONE ELETTRONICA — Fatture in Cloud (API v2)
// Secrets: FIC_TOKEN (token manuale FIC), FIC_COMPANY_ID.
// Logica in fic-handlers.js (testabile); qui solo auth/CORS/wiring.
// Chi può approvare/inviare: superadmin hardcoded + mansione 'amministratore'.
// ═══════════════════════════════════════════════════════════════════
const FIC_TOKEN = defineSecret('FIC_TOKEN');
const FIC_COMPANY_ID = defineSecret('FIC_COMPANY_ID');
const { createFicClient } = require('./fic-client.js');
const { createHandlers, HttpError: FicHttpError } = require('./fic-handlers.js');

const FIC_SUPERADMIN_EMAILS = ['amministrazione@avrlogisticarl.com', 'guido@last-mile.it'];
async function canFatturare(callerEmail) {
    if (FIC_SUPERADMIN_EMAILS.includes(callerEmail)) return true;
    try {
        const doc = await db.collection('utenti').doc(callerEmail).get();
        if (!doc.exists) return false;
        const d = doc.data();
        return d.mansione === 'amministratore' && d.attivo !== false;
    } catch (e) {
        console.error('[canFatturare] lookup error:', e.message);
        return false;
    }
}

function ficEndpoint(nome, azione) {
    return onRequest(
        { secrets: [FIC_TOKEN, FIC_COMPANY_ID], region: 'europe-west1', cors: ALLOWED_ORIGINS, timeoutSeconds: 120 },
        async (req, res) => {
            const origin = req.headers.origin || '';
            res.set('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
            res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
            res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
            if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
            if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

            const authHeader = req.headers.authorization || '';
            const idToken = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : '';
            if (!idToken) { res.status(401).json({ error: 'Token mancante' }); return; }
            let caller;
            try {
                const decoded = await admin.auth().verifyIdToken(idToken);
                caller = { uid: decoded.uid, email: (decoded.email || '').toLowerCase() };
            } catch (e) { res.status(401).json({ error: 'Sessione non valida, rifai il login' }); return; }
            if (!(await canFatturare(caller.email))) { res.status(403).json({ error: 'Solo superadmin e amministratori possono gestire la fatturazione elettronica' }); return; }
            if (!checkRateLimit('fic:' + caller.email)) { res.status(429).json({ error: 'Troppe richieste, attendi un minuto' }); return; }

            const handlers = createHandlers({
                db,
                getFic: async () => createFicClient({ token: FIC_TOKEN.value(), companyId: FIC_COMPANY_ID.value() }),
            });
            try {
                const out = await handlers[azione](req.body || {}, caller);
                // Log audit minimale: mai token, mai anagrafiche
                console.log('[' + nome + ']', caller.uid, req.body && req.body.mese, out && out.stato);
                res.status(200).json(out);
            } catch (e) {
                const status = e instanceof FicHttpError ? e.status : 500;
                if (status >= 500) console.error('[' + nome + '] ' + (e.message || e));
                res.status(status).json({ error: e.message || 'Errore interno', dettagli: e.extra || null });
            }
        }
    );
}

exports.ficCreaFattura = ficEndpoint('ficCreaFattura', 'creaFattura');
exports.ficInviaSdi = ficEndpoint('ficInviaSdi', 'inviaSdi');
exports.ficStato = ficEndpoint('ficStato', 'stato');
