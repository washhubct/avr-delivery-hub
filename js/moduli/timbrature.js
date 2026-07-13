// DELIVERY HUB v2 — Timbrature (vista admin/staff/HR)
//
// Elenco timbrature con filtri giorno/driver/città/fonte, badge per
// origine (terminale ZKTeco vs app QR+geo) e per record sospetti.
// Riconciliazione anti-frode ON-DEMAND al caricamento della vista
// (coerente col resto della dash, che calcola al render): incrocia le
// timbrature del giorno con le consegne dei file Decò già in state —
// chi ha timbrato ma non ha consegne quel giorno viene segnalato.
//
// Schema doc timbrature (unificato terminale/app):
//   { driverId (email), driverNome, filialeId (prov punto), citta,
//     tipo 'in'|'out', timestamp, giorno 'YYYY-MM-DD', mese 'YYYY-MM',
//     fonte 'terminale'|'app', metodo, qrTokenLetto?, lat?, lng?,
//     accuracy?, idTerminale?, sospetto (bool), note }

var TIMB_PROVINCE_LABELS = { CT: 'Catania', SR: 'Siracusa', ME: 'Messina', PA: 'Palermo', EN: 'Enna' };

function timbOggiRoma() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

async function renderTimbrature() {
    var giornoEl = document.getElementById('timbFiltroGiorno');
    if (giornoEl && !giornoEl.value) giornoEl.value = timbOggiRoma();
    var giorno = giornoEl ? giornoEl.value : timbOggiRoma();

    var tbody = document.getElementById('tblTimbratureBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted)">Caricamento…</td></tr>';

    var docs = [];
    try {
        var snap = await db.collection('timbrature').where('giorno', '==', giorno).get();
        docs = snap.docs.map(function(d) {
            var x = d.data();
            x.id = d.id;
            if (x.timestamp && x.timestamp.toDate) x.timestamp = x.timestamp.toDate();
            return x;
        });
    } catch (e) {
        console.error('renderTimbrature load:', e);
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--danger)">Errore caricamento: ' + escapeHtml(e.message) + '</td></tr>';
        return;
    }

    docs.sort(function(a, b) {
        var ta = a.timestamp instanceof Date ? a.timestamp.getTime() : 0;
        var tb = b.timestamp instanceof Date ? b.timestamp.getTime() : 0;
        return tb - ta;
    });

    // ── Filtri client-side ──
    var fDriver = (document.getElementById('timbFiltroDriver')?.value || '').toUpperCase().trim();
    var fCitta = document.getElementById('timbFiltroCitta')?.value || '';
    var fFonte = document.getElementById('timbFiltroFonte')?.value || '';

    var filtrati = docs.filter(function(t) {
        if (fCitta && (t.citta || t.filialeId) !== fCitta) return false;
        if (fFonte && t.fonte !== fFonte) return false;
        if (fDriver) {
            var chi = ((t.driverNome || '') + ' ' + (t.driverId || '')).toUpperCase();
            if (chi.indexOf(fDriver) < 0) return false;
        }
        return true;
    });

    // ── KPI ──
    var driverSet = {};
    var nSospette = 0, nApp = 0, nTerminale = 0;
    docs.forEach(function(t) {
        driverSet[t.driverId] = true;
        if (t.sospetto) nSospette++;
        if (t.fonte === 'app') nApp++; else nTerminale++;
    });
    setText('timbKpiTot', docs.length);
    setText('timbKpiDriver', Object.keys(driverSet).length);
    setText('timbKpiFonti', nTerminale + ' / ' + nApp);
    var kSosp = document.getElementById('timbKpiSospette');
    if (kSosp) {
        kSosp.textContent = nSospette;
        kSosp.style.color = nSospette > 0 ? 'var(--warning)' : 'var(--text)';
    }

    // ── Riconciliazione anti-frode ──
    renderAlertRiconciliazione(docs, giorno);

    // ── Tabella ──
    tbody.innerHTML = filtrati.map(function(t) {
        var ora = t.timestamp instanceof Date
            ? t.timestamp.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' })
            : '—';
        var tipoBadge = t.tipo === 'in'
            ? '<span class="badge badge-ok">▶ Entrata</span>'
            : '<span class="badge" style="background:var(--info-bg);color:var(--info)">◀ Uscita</span>';
        var fonteBadge = t.fonte === 'terminale'
            ? '<span class="badge" style="background:rgba(148,163,184,0.12);color:var(--text-muted)" title="' + escapeHtml(t.idTerminale || '') + '">🏢 Terminale</span>'
            : '<span class="badge badge-info" title="acc. ' + (t.accuracy != null ? Math.round(t.accuracy) + 'm' : '—') + '">' + (t.metodo === 'app-nfc-geo' ? '📶 App NFC' : '📱 App QR') + '</span>';
        var sospBadge = t.sospetto
            ? '<span class="badge badge-warn" title="' + escapeHtml(t.note || 'GPS impreciso o anomalo') + '">⚠️ Sospetta</span>'
            : '';
        var geoStr = (typeof t.lat === 'number' && typeof t.lng === 'number')
            ? '<a href="https://maps.google.com/?q=' + t.lat + ',' + t.lng + '" target="_blank" rel="noopener" style="font-family:var(--font-mono);font-size:11px">' + t.lat.toFixed(5) + ',' + t.lng.toFixed(5) + '</a>'
            : '<span style="color:var(--text-light)">—</span>';
        var prov = t.citta || t.filialeId || '—';
        return '<tr' + (t.sospetto ? ' style="background:var(--warning-bg)"' : '') + '>' +
            '<td style="font-family:var(--font-mono);font-weight:700">' + ora + '</td>' +
            '<td><strong>' + escapeHtml(t.driverNome || t.driverId || '—') + '</strong>' +
                '<div style="font-size:10px;color:var(--text-light)">' + escapeHtml(t.driverId || '') + '</div></td>' +
            '<td><span class="badge badge-info">' + escapeHtml(prov) + '</span> ' +
                '<span style="font-size:11px;color:var(--text-muted)">' + escapeHtml(TIMB_PROVINCE_LABELS[prov] || '') + '</span></td>' +
            '<td>' + tipoBadge + '</td>' +
            '<td>' + fonteBadge + '</td>' +
            '<td>' + geoStr + '</td>' +
            '<td>' + sospBadge + '</td>' +
            '<td style="font-size:11px;color:var(--text-muted)">' + escapeHtml(t.note || '') + '</td>' +
        '</tr>';
    }).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--text-muted)">Nessuna timbratura ' + (docs.length ? 'con questi filtri' : 'per il ' + giorno) + '</td></tr>';
}

function setText(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val;
}

// ══════════════════════════════════════════════════════════════
// RICONCILIAZIONE — timbrature vs consegne dai file Decò.
// Un driver che risulta presente (almeno una 'in') ma con ZERO
// consegne a suo nome quel giorno è un'anomalia da verificare.
// Usa state.consegne (mese selezionato in dash): se il giorno
// scelto è fuori dal mese caricato, avvisa invece di sbagliare.
// ══════════════════════════════════════════════════════════════
function renderAlertRiconciliazione(timbrature, giorno) {
    var box = document.getElementById('timbAlertBox');
    if (!box) return;

    if (giorno.substring(0, 7) !== state.meseCorrente) {
        box.style.display = 'block';
        box.innerHTML = '<div style="padding:10px 14px;background:var(--info-bg);border-radius:8px;font-size:12px;color:var(--text-muted)">ℹ️ Riconciliazione non disponibile: seleziona il mese ' + giorno.substring(0, 7) + ' dal selettore in alto per incrociare con le consegne.</div>';
        return;
    }

    // Consegne per driver canonico nel giorno (esclude ritorni)
    var consegnePerDriver = {};
    (state.consegne || []).forEach(function(c) {
        if (c.tipo === 'ritorno') return;
        var d = c.data instanceof Date ? c.data : new Date(c.data);
        if (isNaN(d)) return;
        var day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
        if (day !== giorno) return;
        var drv = normalizeDriverName(c.driver || c.rider || '');
        if (!drv) return;
        consegnePerDriver[drv] = (consegnePerDriver[drv] || 0) + 1;
    });

    // Presenze per driver (almeno una entrata)
    var presenze = {};
    timbrature.forEach(function(t) {
        if (t.tipo !== 'in') return;
        var key = t.driverId;
        if (!presenze[key]) presenze[key] = { nome: t.driverNome || t.driverId, citta: t.citta || t.filialeId, fonte: t.fonte };
    });

    var alerts = [];
    Object.keys(presenze).forEach(function(email) {
        var p = presenze[email];
        // Cognome canonico dal profilo anagrafica (match per email)
        var ana = (state.driverList || []).find(function(d) { return (d.email || '').toLowerCase() === email.toLowerCase(); });
        var cognome = ana ? (ana.cognome || '').toUpperCase().trim() : normalizeDriverName(p.nome || '');
        var nConsegne = consegnePerDriver[cognome] || 0;
        if (nConsegne === 0) {
            alerts.push({ email: email, nome: p.nome, citta: p.citta, fonte: p.fonte });
        }
    });

    if (alerts.length === 0) {
        box.style.display = 'block';
        box.innerHTML = '<div style="padding:10px 14px;background:var(--success-bg);border-radius:8px;font-size:12px;color:var(--success)">✓ Riconciliazione OK: tutti i driver presenti hanno consegne registrate il ' + giorno + '.</div>';
        return;
    }

    box.style.display = 'block';
    box.innerHTML =
        '<div style="padding:14px 16px;background:var(--danger-bg);border:1px solid rgba(244,63,94,0.25);border-radius:10px">' +
            '<div style="font-weight:800;color:var(--danger);margin-bottom:8px">🚨 ' + alerts.length + ' timbratur' + (alerts.length === 1 ? 'a' : 'e') + ' senza consegne — da verificare</div>' +
            alerts.map(function(a) {
                return '<div style="display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-top:1px solid rgba(244,63,94,0.12);font-size:13px">' +
                    '<span><strong>' + escapeHtml(a.nome) + '</strong> <span style="color:var(--text-muted)">(' + escapeHtml(a.email) + ')</span></span>' +
                    '<span><span class="badge badge-info">' + escapeHtml(a.citta || '—') + '</span> ' +
                    (a.fonte === 'terminale' ? '🏢' : '📱') +
                    ' <span style="color:var(--text-muted)">presente, 0 consegne nei file Decò</span></span>' +
                '</div>';
            }).join('') +
        '</div>';
}
