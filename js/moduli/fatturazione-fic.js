// LAST MILE — Fattura elettronica via Fatture in Cloud
// Flusso: upload xlsx → parsing/riconciliazione (FicCore, js/fic/fic-core.js) →
// anteprima editabile → approvazione esplicita → CF ficCreaFattura →
// CF ficInviaSdi (dry-run + invio) → stato ei_status (CF ficStato).
// Nessun segreto qui: token/company id vivono solo nei secrets delle Functions.

var FIC_CF_BASE = 'https://europe-west1-avr-logistic-dashboard.cloudfunctions.net/';
var ficState = { parsed: null, righe: null, scostamenti: null, stato: null, fileName: null, cfg: null };

function ficPuoFatturare() {
    return state.userRole === 'superadmin' || state.userRole === 'amministratore';
}

async function ficLoadConfig() {
    if (ficState.cfg) return ficState.cfg;
    var core = {}, cliente = null;
    try {
        var snap = await db.collection('config').doc('fic').get();
        if (snap.exists) { core = snap.data().core || {}; cliente = snap.data().cliente || null; }
    } catch (e) { console.warn('config/fic non leggibile:', e.message); }
    ficState.cfg = { core: FicCore.mergeConfig(core), cliente: cliente };
    return ficState.cfg;
}

// ── Entry point dal tab Fatturazione ────────────────────────────────
async function renderFatturazioneFic() {
    var card = document.getElementById('cardFic');
    if (!card) return;
    if (!ficPuoFatturare() || !isSchemaFlat(state.meseCorrente || '')) { card.style.display = 'none'; return; }
    card.style.display = 'block';
    await ficLoadConfig();
    ficAggiornaStato(false);
}

// ── Upload ──────────────────────────────────────────────────────────
async function ficHandleFile(files) {
    if (!files || !files.length) return;
    var file = files[0];
    ficState.fileName = file.name;
    var box = document.getElementById('ficAnteprima');
    box.innerHTML = '<p class="card-desc">Analisi di <strong>' + escapeHtml(file.name) + '</strong>…</p>';
    try {
        var buf = await file.arrayBuffer();
        var wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
        var cfg = await ficLoadConfig();
        var parsed = FicCore.parseWorkbook(XLSX, wb, cfg.core);
        ficState.parsed = parsed;
        ficState.scostamenti = FicCore.riconcilia(parsed);
        // mese di riferimento della fattura = mese del foglio
        var meseKey = parsed.riepilogo.anno + '-' + String(parsed.riepilogo.mese).padStart(2, '0');
        ficState.meseKey = meseKey;
        // Default intestazione
        var oggi = new Date().toISOString().slice(0, 10);
        ficState.intestazione = ficState.intestazione || {};
        var it = ficState.intestazione;
        it.data = it.data || oggi;
        it.scadenza = it.scadenza || FicCore.addDays(it.data, cfg.core.scadenzaGiorni);
        it.numero = it.numero || '';
        it.metodoPagamento = it.metodoPagamento || cfg.core.metodoPagamento;
        it.acconto = it.acconto || { importo: '', riferimento: '' };
        ficRebuild();
        ficAggiornaStato(false);
    } catch (e) {
        console.error(e);
        box.innerHTML = '<div class="fic-alert fic-alert-error">❌ File non valido: ' + escapeHtml(e.message) + '</div>';
    }
}

function ficRebuild() {
    var p = ficState.parsed;
    if (!p) return;
    var it = ficState.intestazione;
    ficState.righe = FicCore.buildRighe(p, { acconto: { importo: it.acconto.importo, riferimento: it.acconto.riferimento } });
    ficRenderAnteprima();
}

function ficOnIntestazioneChange() {
    var it = ficState.intestazione;
    var g = function (id) { var el = document.getElementById(id); return el ? el.value : ''; };
    var dataPrima = it.data;
    it.numero = g('ficNumero').trim();
    it.data = g('ficData');
    it.scadenza = g('ficScadenza');
    if (it.data !== dataPrima && ficState.cfg) it.scadenza = FicCore.addDays(it.data, ficState.cfg.core.scadenzaGiorni);
    it.metodoPagamento = g('ficMetodo');
    it.acconto.importo = g('ficAccontoImporto').trim();
    it.acconto.riferimento = g('ficAccontoRif').trim();
    try { ficRebuild(); } catch (e) { toast(e.message, 'error'); }
}

// ── Anteprima ───────────────────────────────────────────────────────
function ficRenderAnteprima() {
    var p = ficState.parsed, righe = ficState.righe, sc = ficState.scostamenti, it = ficState.intestazione;
    var cfg = ficState.cfg.core, cliente = ficState.cfg.cliente || {};
    var tot = FicCore.totali(righe, cfg.ivaPercento);
    var calc = FicCore.ricalcola(p);
    var periodo = FicCore.labelMese(p.riepilogo.mese, p.riepilogo.anno);
    var euro = FicCore.centsToEuroIt;
    var bloccanti = sc.filter(function (s) { return s.livello !== 'info'; });
    var stato = ficState.stato;
    var giaCreata = stato && stato.esiste && stato.doc && stato.doc.ficDocumentId;

    var h = '';
    // KPI
    h += '<div class="kpi-grid" style="margin:12px 0">' +
        fatKpi('Consegne feriali', formatNumber(calc.feriali) + ' × ' + euro(FicCore.toCents(cfg.tariffe.feriale))) +
        fatKpi('Consegne festive', formatNumber(calc.festivi) + ' × ' + euro(FicCore.toCents(cfg.tariffe.festivo))) +
        fatKpi('Speciali', calc.nSpeciali + ' → ' + euro(calc.euroSpeciali)) +
        fatKpi('Righe fattura', righe.length, true) + '</div>';

    // Scostamenti
    if (bloccanti.length) {
        h += '<div class="fic-alert fic-alert-error"><strong>⚠️ ' + bloccanti.length + ' scostament' + (bloccanti.length === 1 ? 'o' : 'i') + ' da verificare</strong><ul style="margin:8px 0 0 18px">';
        bloccanti.forEach(function (s) {
            h += '<li style="margin:4px 0">' + escapeHtml(s.messaggio) + (s.deltaCents !== null && s.deltaCents !== undefined ? ' <strong>[impatto ' + euro(s.deltaCents) + ']</strong>' : '') + '</li>';
        });
        h += '</ul><label style="display:flex;gap:8px;align-items:center;margin-top:12px;cursor:pointer"><input type="checkbox" id="ficScostOk" onchange="ficAggiornaBottoni()"> Ho verificato gli scostamenti</label></div>';
    } else {
        h += '<div class="fic-alert fic-alert-ok">✅ Nessuno scostamento tra riepilogo, foglio speciali e ricalcolo.' +
            sc.filter(function (s) { return s.livello === 'info'; }).map(function (s) { return '<div style="font-size:12px;opacity:.8;margin-top:4px">ℹ️ ' + escapeHtml(s.messaggio) + '</div>'; }).join('') + '</div>';
    }

    // Intestazione editabile
    var dis = giaCreata ? ' disabled' : '';
    h += '<div class="fic-grid">' +
        ficField('Cliente', '<input class="fic-input" value="' + escapeHtml((cliente.ragioneSociale || 'Fratelli Arena') + (cliente.piva ? ' — P.IVA ' + cliente.piva : ' — P.IVA non configurata (config/fic)')) + '" disabled>') +
        ficField('Numero fattura', '<input class="fic-input" id="ficNumero" value="' + escapeHtml(it.numero) + '" placeholder="es. 12" onchange="ficOnIntestazioneChange()"' + dis + '>') +
        ficField('Data', '<input class="fic-input" type="date" id="ficData" value="' + it.data + '" onchange="ficOnIntestazioneChange()"' + dis + '>') +
        ficField('Scadenza (' + cfg.scadenzaGiorni + ' gg)', '<input class="fic-input" type="date" id="ficScadenza" value="' + it.scadenza + '" onchange="ficOnIntestazioneChange()"' + dis + '>') +
        ficField('Metodo di pagamento', '<input class="fic-input" id="ficMetodo" value="' + escapeHtml(it.metodoPagamento) + '" onchange="ficOnIntestazioneChange()"' + dis + '>') +
        ficField('Acconto già fatturato (€)', '<input class="fic-input" id="ficAccontoImporto" inputmode="decimal" value="' + escapeHtml(it.acconto.importo) + '" placeholder="0,00" onchange="ficOnIntestazioneChange()"' + dis + '>') +
        ficField('Riferimento acconto', '<input class="fic-input" id="ficAccontoRif" value="' + escapeHtml(it.acconto.riferimento) + '" placeholder="es. fattura n. 6 del 03/08/2026" onchange="ficOnIntestazioneChange()"' + dis + '>') +
        '</div>';

    // Tabella righe con subtotali per area
    h += '<div class="table-wrap" style="margin-top:16px"><table class="data-table"><thead><tr><th>#</th><th>Descrizione</th><th style="text-align:right">Q.tà</th><th style="text-align:right">Prezzo</th><th style="text-align:right">Totale</th></tr></thead><tbody>';
    var gruppoCorrente = null, subQty = 0, subTot = BigInt(0);
    function chiudiGruppo() {
        if (gruppoCorrente === null) return;
        h += '<tr style="background:rgba(34,197,94,0.04)"><td></td><td style="font-weight:600;color:var(--text-muted)">Subtotale ' + escapeHtml(gruppoCorrente) + '</td><td style="text-align:right;font-weight:600">' + formatNumber(subQty) + '</td><td></td><td style="text-align:right;font-weight:700">' + euro(subTot) + '</td></tr>';
        subQty = 0; subTot = BigInt(0);
    }
    righe.forEach(function (r, i) {
        var g = r.tipo === 'acconto' ? 'Acconto' : (r.tipo === 'speciali' ? 'Consegne speciali' : r.area);
        if (g !== gruppoCorrente) {
            chiudiGruppo();
            gruppoCorrente = g;
            h += '<tr style="background:rgba(34,197,94,0.05)"><td colspan="5" style="padding:8px 12px;font-weight:700;color:var(--accent);font-size:12px;text-transform:uppercase;letter-spacing:1px">' + escapeHtml(g) + '</td></tr>';
        }
        subQty += r.qty; subTot += r.totaleCents;
        var neg = r.totaleCents < BigInt(0) ? ';color:var(--danger)' : '';
        h += '<tr><td style="color:var(--text-muted)">' + (i + 1) + '</td><td>' + escapeHtml(r.descrizione) + '</td><td style="text-align:right">' + formatNumber(r.qty) + '</td><td style="text-align:right;font-family:JetBrains Mono,monospace' + neg + '">' + euro(r.prezzoCents) + '</td><td style="text-align:right;font-family:JetBrains Mono,monospace' + neg + '">' + euro(r.totaleCents) + '</td></tr>';
    });
    chiudiGruppo();
    h += '</tbody></table></div>';

    // Riepilogo IVA
    h += '<div style="margin-top:16px;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:16px 20px;max-width:420px;margin-left:auto">' +
        ficRow('Imponibile', euro(tot.imponibile)) + ficRow('IVA ' + cfg.ivaPercento + '%', euro(tot.iva)) +
        '<div style="display:flex;justify-content:space-between;padding:10px 0;font-size:18px"><span style="font-weight:700;color:var(--accent)">Totale fattura</span><span style="font-weight:800;color:var(--accent)">' + euro(tot.totale) + '</span></div>' +
        '<div style="font-size:11px;color:var(--text-muted)">Periodo: ' + escapeHtml(periodo) + ' · file: ' + escapeHtml(ficState.fileName || '') + '</div></div>';

    // Azioni
    h += '<div id="ficAzioni" style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap;align-items:center"></div>';
    document.getElementById('ficAnteprima').innerHTML = h;
    ficAggiornaBottoni();
}
function ficField(label, input) { return '<label class="fic-field"><span>' + label + '</span>' + input + '</label>'; }
function ficRow(l, v) { return '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)"><span style="color:var(--text-muted)">' + l + '</span><span style="font-weight:600">' + v + '</span></div>'; }

function ficAggiornaBottoni() {
    var az = document.getElementById('ficAzioni');
    if (!az || !ficState.righe) return;
    var stato = ficState.stato, doc = stato && stato.esiste ? stato.doc : null;
    var bloccanti = (ficState.scostamenti || []).filter(function (s) { return s.livello !== 'info'; });
    var chk = document.getElementById('ficScostOk');
    var scostOk = !bloccanti.length || (chk && chk.checked);
    var numeroOk = !!(ficState.intestazione.numero);
    var h = '';
    if (!doc || !doc.ficDocumentId) {
        h += '<button class="btn btn-primary" id="ficBtnApprova" onclick="ficApprova()"' + (scostOk && numeroOk ? '' : ' disabled') + '>✅ Approva e crea bozza su Fatture in Cloud</button>';
        if (!numeroOk) h += '<span style="font-size:12px;color:var(--text-muted)">Inserisci il numero fattura</span>';
        else if (!scostOk) h += '<span style="font-size:12px;color:var(--warning)">Spunta "Ho verificato gli scostamenti"</span>';
    } else if (doc.stato !== 'inviata') {
        h += '<button class="btn" onclick="ficInvia(true)">🔍 Solo verifica XML (dry-run)</button>';
        h += '<button class="btn btn-primary" onclick="ficInvia(false)">📤 Verifica e invia allo SDI</button>';
    }
    az.innerHTML = h;
}

// ── Chiamate CF ─────────────────────────────────────────────────────
async function ficCall(nome, body) {
    var idToken = await auth.currentUser.getIdToken();
    var resp = await fetch(FIC_CF_BASE + nome, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken }, body: JSON.stringify(body)
    });
    var json = null;
    try { json = await resp.json(); } catch (e) { json = null; }
    if (!resp.ok) {
        var err = new Error((json && json.error) || ('Errore ' + resp.status));
        err.dettagli = json && json.dettagli;
        throw err;
    }
    return json;
}

async function ficApprova() {
    if (!ficState.righe || !ficState.parsed) return;
    var it = ficState.intestazione;
    var cfg = ficState.cfg.core;
    var tot = FicCore.totali(ficState.righe, cfg.ivaPercento);
    var msg = 'Confermi l\'approvazione della fattura n. ' + it.numero + ' del ' + it.data + '?\n\n' +
        ficState.righe.length + ' righe · imponibile ' + FicCore.centsToEuroIt(tot.imponibile) + ' · totale ' + FicCore.centsToEuroIt(tot.totale) + '\n\n' +
        'Verrà creata una BOZZA su Fatture in Cloud. L\'invio allo SDI è un passaggio successivo separato.';
    if (!confirm(msg)) return;
    var btn = document.getElementById('ficBtnApprova');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Creazione bozza…'; }
    try {
        var out = await ficCall('ficCreaFattura', {
            mese: ficState.meseKey,
            approvato: true,
            scostamentiVerificati: true,
            intestazione: { numero: it.numero, data: it.data, scadenza: it.scadenza, metodoPagamento: it.metodoPagamento },
            righe: FicCore.righeToJson(ficState.righe),
            totali: { imponibile: FicCore.centsToString(tot.imponibile), iva: FicCore.centsToString(tot.iva), totale: FicCore.centsToString(tot.totale) },
            scostamenti: (ficState.scostamenti || []).map(function (s) { return { tipo: s.tipo, livello: s.livello, messaggio: s.messaggio, delta: s.deltaCents !== null && s.deltaCents !== undefined ? FicCore.centsToString(s.deltaCents) : null }; })
        });
        toast('Bozza creata su Fatture in Cloud (id ' + out.ficDocumentId + ')', 'success');
        (out.avvisi || []).forEach(function (a) { toast(a, 'error'); });
        await ficAggiornaStato(true);
    } catch (e) {
        ficMostraErrore(e);
        await ficAggiornaStato(false);
    }
}

async function ficInvia(soloVerifica) {
    var doc = ficState.stato && ficState.stato.doc;
    if (!doc) return;
    if (!soloVerifica) {
        var ok = confirm('INVIO ALLO SDI — operazione irreversibile.\n\nFattura n. ' + doc.intestazione.numero + ' del ' + doc.intestazione.data + ', totale € ' + doc.totali.totale + '.\n\nPrima dell\'invio viene eseguita la verifica XML (dry-run). Procedere?');
        if (!ok) return;
    }
    var az = document.getElementById('ficAzioni');
    if (az) az.innerHTML = '<span class="card-desc">⏳ ' + (soloVerifica ? 'Verifica XML in corso…' : 'Verifica XML e invio allo SDI in corso…') + '</span>';
    try {
        var out = await ficCall('ficInviaSdi', { mese: ficState.meseKey || (doc.mese), approvato: true, soloVerifica: !!soloVerifica });
        toast(soloVerifica ? 'Verifica XML superata' : 'Fattura inviata allo SDI (stato: ' + (out.eiStatus || 'in elaborazione') + ')', 'success');
    } catch (e) {
        ficMostraErrore(e);
    }
    await ficAggiornaStato(true);
}

function ficMostraErrore(e) {
    var msg = e.message || String(e);
    var det = e.dettagli;
    if (det && det.validation_result) {
        try { msg += '\n' + JSON.stringify(det.validation_result, null, 1).slice(0, 800); } catch (x) {}
    }
    toast(msg, 'error');
    var box = document.getElementById('ficStatoBox');
    if (box) box.insertAdjacentHTML('afterbegin', '<div class="fic-alert fic-alert-error" style="white-space:pre-wrap">❌ ' + escapeHtml(msg) + '</div>');
}

// ── Stato ───────────────────────────────────────────────────────────
async function ficAggiornaStato(refreshFic) {
    var box = document.getElementById('ficStatoBox');
    if (!box) return;
    var mese = ficState.meseKey || state.meseCorrente;
    if (!mese) { box.innerHTML = ''; return; }
    try {
        var out;
        if (refreshFic) out = await ficCall('ficStato', { mese: mese, refresh: true });
        else {
            var snap = await db.collection('fattureFic').doc(mese).get();
            out = snap.exists ? { esiste: true, doc: snap.data(), stato: snap.data().stato, eiStatus: snap.data().eiStatus, ultimoErrore: snap.data().ultimoErrore, eiErrori: snap.data().eiErrori } : { esiste: false };
        }
        ficState.stato = out;
    } catch (e) {
        box.innerHTML = '<div class="fic-alert fic-alert-error">Stato non disponibile: ' + escapeHtml(e.message) + '</div>';
        return;
    }
    var s = ficState.stato;
    if (!s.esiste) {
        box.innerHTML = '<p class="card-desc">Nessuna fattura elettronica registrata per ' + escapeHtml(meseLabel(mese)) + '.</p>';
    } else {
        var d = s.doc;
        var badge = { approvata: ['Approvata (bozza FIC non creata)', 'var(--warning)'], creata: ['Bozza creata su FIC', 'var(--accent)'], dryrun_ok: ['XML verificato — pronta per l\'invio', 'var(--accent)'], inviata: ['Inviata allo SDI', 'var(--success, #22c55e)'], errore_creazione: ['Errore creazione', 'var(--danger)'], errore_dryrun: ['Errore verifica XML', 'var(--danger)'], errore_invio: ['Errore invio SDI', 'var(--danger)'] }[d.stato] || [d.stato, 'var(--text-muted)'];
        var ei = s.eiStatus ? ' · <strong>ei_status: ' + escapeHtml(s.eiStatus) + '</strong>' : '';
        var h = '<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:8px">' +
            '<span style="padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700;border:1px solid ' + badge[1] + ';color:' + badge[1] + '">' + badge[0] + '</span>' +
            '<span class="card-desc" style="margin:0">' + escapeHtml(meseLabel(mese)) + ' · n. ' + escapeHtml(d.intestazione.numero) + ' del ' + escapeHtml(d.intestazione.data) + ' · totale € ' + escapeHtml(d.totali.totale) + ei + '</span>' +
            (d.ficUrl ? '<a class="btn btn-sm" href="' + escapeHtml(d.ficUrl) + '" target="_blank" rel="noopener">Apri su FIC</a>' : '') +
            '<button class="btn btn-sm" onclick="ficAggiornaStato(true)">🔄 Aggiorna stato</button></div>';
        h += '<div style="font-size:12px;color:var(--text-muted)">Approvata da ' + escapeHtml(d.approvataDa || '—') + ' il ' + escapeHtml((d.approvataIl || '').replace('T', ' ').slice(0, 16)) +
            (d.inviataDa ? ' · inviata da ' + escapeHtml(d.inviataDa) + ' il ' + escapeHtml((d.inviataIl || '').replace('T', ' ').slice(0, 16)) : '') + '</div>';
        if (s.ultimoErrore && s.ultimoErrore.messaggio) h += '<div class="fic-alert fic-alert-error" style="margin-top:8px;white-space:pre-wrap">❌ ' + escapeHtml(s.ultimoErrore.messaggio) + (s.ultimoErrore.dettagli ? '\n' + escapeHtml(JSON.stringify(s.ultimoErrore.dettagli, null, 1).slice(0, 1200)) : '') + '</div>';
        if (s.eiErrori) h += '<div class="fic-alert fic-alert-error" style="margin-top:8px;white-space:pre-wrap">Scarto SDI: ' + escapeHtml(JSON.stringify(s.eiErrori, null, 1).slice(0, 1200)) + '</div>';
        if (!ficState.righe && d.ficDocumentId && d.stato !== 'inviata') {
            h += '<div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap"><button class="btn" onclick="ficInvia(true)">🔍 Solo verifica XML (dry-run)</button><button class="btn btn-primary" onclick="ficInvia(false)">📤 Verifica e invia allo SDI</button></div>';
        }
        box.innerHTML = h;
    }
    ficAggiornaBottoni();
}
