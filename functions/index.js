'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

admin.initializeApp();

const RESEND_API_KEY = defineSecret('RESEND_API_KEY');

// Rate limiting in-memory (resetta ad ogni cold start — sufficiente per uso interno)
const rateLimitMap = new Map();
const RATE_WINDOW_MS = 60 * 1000; // 1 minuto
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

exports.requestPasswordReset = onCall(
    { secrets: [RESEND_API_KEY], region: 'europe-west1' },
    async (request) => {
        const email = (request.data?.email || '').trim().toLowerCase();

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            throw new HttpsError('invalid-argument', 'Email non valida');
        }

        if (!checkRateLimit(email)) {
            // Non rivelare il rate limiting — risposta generica
            console.warn('[requestPasswordReset] rate limit raggiunto per:', email);
            return { success: true };
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
            // Non propagare al client — no user enumeration
            // Logga solo code/type, mai il link completo o l'email
            console.error('[requestPasswordReset] errore:', err.code || err.message);
        }

        // SEMPRE risposta generica — non rivela se l'utente esiste
        return { success: true };
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

          <!-- CTA Button -->
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

          <!-- Link di fallback -->
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
              🔒 Se non hai richiesto il reset della password, ignora questa email — il tuo account rimane al sicuro e la password non verrà modificata.
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
