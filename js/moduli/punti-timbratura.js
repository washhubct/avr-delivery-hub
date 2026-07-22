// DELIVERY HUB v2 — Punti Timbratura (5 provinciali: CT/SR/ME/PA/EN)
// Collection: puntiTimbratura/{provincia}
//   { provincia, nome, indirizzo, geo:{lat,lng,raggioMt}, nfcTagUID, attivo,
//     creatoIl, aggiornatoIl }
//
// Uso: il driver appoggia telefono al tag NFC installato in un punto provinciale
// → apre URL con {provincia, nfcTagUID} → Cloud Function valida contro questo
// doc (raggio, UID, geo). Solo 5 doc, uno per provincia (non 27 filiali).

var PT_PROVINCE = ['CT', 'SR', 'ME', 'PA', 'EN'];
var PT_PROVINCE_LABELS = {
    CT: 'Catania', SR: 'Siracusa', ME: 'Messina', PA: 'Palermo', EN: 'Enna'
};
var PT_RAGGIO_DEFAULT_MT = 100;

async function loadPuntiTimbratura() {
    try {
        var snap = await db.collection('puntiTimbratura').get();
        state.puntiTimbraturaList = snap.docs.map(function(doc) {
            var d = doc.data();
            d.id = doc.id;
            return d;
        });
    } catch (e) {
        console.warn('loadPuntiTimbratura error:', e.message);
        state.puntiTimbraturaList = [];
    }
}

function renderPuntiTimbratura() {
    var tbody = document.getElementById('tblPuntiTimbraturaBody');
    if (!tbody) return;
    var list = state.puntiTimbraturaList || [];
    var byProv = {};
    list.forEach(function(p) { byProv[p.provincia || p.id] = p; });

    // Mostra sempre tutte e 5 le province (anche se non configurate).
    tbody.innerHTML = PT_PROVINCE.map(function(prov) {
        var p = byProv[prov];
        var configurato = !!p;
        if (!configurato) {
            return '<tr>' +
                '<td><strong>' + prov + '</strong> <span style="color:var(--text-muted)">— ' + PT_PROVINCE_LABELS[prov] + '</span></td>' +
                '<td colspan="4" style="color:var(--text-muted)">Non configurato</td>' +
                '<td><span class="badge badge-warn">Da configurare</span></td>' +
                '<td><button class="btn btn-sm btn-primary" onclick="openEditPuntoTimbratura(\'' + prov + '\')">+ Configura</button></td>' +
            '</tr>';
        }
        var geo = p.geo || {};
        var geoOk = typeof geo.lat === 'number' && typeof geo.lng === 'number';
        var geoStr = geoOk
            ? '<span style="font-family:var(--font-mono);font-size:12px">' + geo.lat.toFixed(6) + ', ' + geo.lng.toFixed(6) + '</span>'
            : '<span class="badge badge-warn">GPS mancante</span>';
        var raggioStr = typeof geo.raggioMt === 'number' ? geo.raggioMt + ' m' : PT_RAGGIO_DEFAULT_MT + ' m';
        var qrStr = p.qrTokenHash
            ? '<span class="badge badge-ok">QR attivo</span>'
            : '<span class="badge badge-warn">QR mancante</span>';
        var pronto = geoOk && !!p.qrTokenHash && p.attivo !== false;
        var statoBadge = p.attivo === false
            ? '<span class="badge badge-err">Disattivato</span>'
            : (pronto ? '<span class="badge badge-ok">Attivo</span>' : '<span class="badge badge-warn">Incompleto</span>');
        return '<tr>' +
            '<td><strong>' + escapeHtml(p.provincia || prov) + '</strong> <span style="color:var(--text-muted)">— ' + PT_PROVINCE_LABELS[prov] + '</span></td>' +
            '<td>' + escapeHtml(p.nome || '—') + '</td>' +
            '<td style="font-size:12px">' + escapeHtml(p.indirizzo || '—') + '</td>' +
            '<td>' + geoStr + '<br><small style="color:var(--text-muted)">raggio ' + raggioStr + '</small></td>' +
            '<td>' + qrStr + '</td>' +
            '<td>' + statoBadge + '</td>' +
            '<td style="white-space:nowrap">' +
                '<button class="btn btn-sm" onclick="openEditPuntoTimbratura(\'' + escapeHtml(prov) + '\')" title="Modifica">✏️</button> ' +
                '<button class="btn btn-sm" onclick="rigeneraQrToken(\'' + escapeHtml(prov) + '\')" title="Genera/Rigenera token QR">🔄</button> ' +
                '<button class="btn btn-sm" onclick="stampaQrPunto(\'' + escapeHtml(prov) + '\')" title="Stampa QR">🖨️</button> ' +
                '<button class="btn btn-sm" onclick="mostraLinkNfc(\'' + escapeHtml(prov) + '\')" title="Link da scrivere sul tag NFC">📶</button> ' +
                '<button class="btn btn-sm" onclick="togglePuntoTimbratura(\'' + escapeHtml(prov) + '\')" title="' + (p.attivo === false ? 'Riattiva' : 'Disattiva') + '">' + (p.attivo === false ? '✅' : '⏸️') + '</button>' +
            '</td>' +
        '</tr>';
    }).join('');
}

function puntoTimbraturaFormHTML(prov, p) {
    p = p || {};
    var geo = p.geo || {};
    return (
        '<div class="form-group"><label>Provincia</label>' +
            '<input type="text" class="input" value="' + escapeHtml(prov) + ' — ' + PT_PROVINCE_LABELS[prov] + '" readonly style="opacity:0.6"></div>' +
        '<div class="form-group"><label>Nome punto</label>' +
            '<input type="text" id="ptNome" class="input" placeholder="es. Sede Catania" value="' + escapeHtml(p.nome || '') + '"></div>' +
        '<div class="form-group"><label>Indirizzo</label>' +
            '<input type="text" id="ptIndirizzo" class="input" placeholder="Via ..., Città" value="' + escapeHtml(p.indirizzo || '') + '"></div>' +
        '<div class="grid-2" style="gap:12px">' +
            '<div class="form-group"><label>Latitudine</label>' +
                '<input type="number" step="0.000001" id="ptLat" class="input" placeholder="37.502720" value="' + (typeof geo.lat === 'number' ? geo.lat : '') + '"></div>' +
            '<div class="form-group"><label>Longitudine</label>' +
                '<input type="number" step="0.000001" id="ptLng" class="input" placeholder="15.087269" value="' + (typeof geo.lng === 'number' ? geo.lng : '') + '"></div>' +
        '</div>' +
        '<div class="form-group"><label>Raggio validità GPS (metri)</label>' +
            '<input type="number" min="20" max="500" id="ptRaggio" class="input" placeholder="' + PT_RAGGIO_DEFAULT_MT + '" value="' + (typeof geo.raggioMt === 'number' ? geo.raggioMt : PT_RAGGIO_DEFAULT_MT) + '">' +
            '<small style="color:var(--text-muted)">Distanza massima in cui il GPS del driver è considerato valido. Consigliato 100m.</small></div>' +
        '<div class="form-group"><label>NFC Tag UID <span style="color:var(--text-light);font-weight:400">(opzionale — il metodo principale è il QR)</span></label>' +
            '<input type="text" id="ptNfcUid" class="input" placeholder="es. 04:A3:2B:1F:6E:9C:80" value="' + escapeHtml(p.nfcTagUID || '') + '" style="font-family:var(--font-mono)"></div>' +
        '<div style="background:var(--bg-elev);padding:12px;border-radius:8px;margin:12px 0;font-size:12px;color:var(--text-muted);line-height:1.5">' +
            '💡 <strong>Come trovare lat/lng:</strong> apri Google Maps, click destro sul punto esatto della sede → clicca sulle coordinate per copiarle (formato "37.502720, 15.087269").' +
        '</div>' +
        '<button class="btn btn-primary" onclick="savePuntoTimbratura(\'' + escapeHtml(prov) + '\')" style="width:100%;margin-top:8px">Salva punto ' + prov + '</button>'
    );
}

function openEditPuntoTimbratura(prov) {
    if (PT_PROVINCE.indexOf(prov) < 0) { toast('Provincia non valida', 'error'); return; }
    var p = (state.puntiTimbraturaList || []).find(function(x) { return (x.provincia || x.id) === prov; });
    openModal('Configura punto timbratura — ' + prov, puntoTimbraturaFormHTML(prov, p));
}

async function savePuntoTimbratura(prov) {
    if (PT_PROVINCE.indexOf(prov) < 0) { toast('Provincia non valida', 'error'); return; }
    var nome = (document.getElementById('ptNome').value || '').trim();
    var indirizzo = (document.getElementById('ptIndirizzo').value || '').trim();
    var lat = parseFloat(document.getElementById('ptLat').value);
    var lng = parseFloat(document.getElementById('ptLng').value);
    var raggio = parseInt(document.getElementById('ptRaggio').value || PT_RAGGIO_DEFAULT_MT, 10);
    var nfcUid = (document.getElementById('ptNfcUid').value || '').trim();

    if (!nome) { toast('Nome punto obbligatorio', 'error'); return; }
    if (!indirizzo) { toast('Indirizzo obbligatorio', 'error'); return; }
    if (isNaN(lat) || lat < 35 || lat > 47) { toast('Latitudine non valida (Italia: ~35-47)', 'error'); return; }
    if (isNaN(lng) || lng < 6 || lng > 19) { toast('Longitudine non valida (Italia: ~6-19)', 'error'); return; }
    if (isNaN(raggio) || raggio < 20 || raggio > 500) { toast('Raggio 20-500 metri', 'error'); return; }

    // Univocità UID NFC (se presente) tra i punti
    if (nfcUid) {
        var duplicato = (state.puntiTimbraturaList || []).find(function(x) {
            return (x.provincia || x.id) !== prov && x.nfcTagUID === nfcUid;
        });
        if (duplicato) {
            toast('Tag NFC già usato dal punto ' + duplicato.provincia, 'error');
            return;
        }
    }

    var btn = document.querySelector('.modal .btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'Salvataggio...'; }

    var payload = {
        provincia: prov,
        nome: nome,
        indirizzo: indirizzo,
        geo: { lat: lat, lng: lng, raggioMt: raggio },
        nfcTagUID: nfcUid,
        attivo: true,
        aggiornatoIl: firebase.firestore.FieldValue.serverTimestamp()
    };
    var doc = db.collection('puntiTimbratura').doc(prov);
    try {
        var existing = await doc.get();
        if (!existing.exists) payload.creatoIl = firebase.firestore.FieldValue.serverTimestamp();
        await doc.set(payload, { merge: true });
        toast('Punto ' + prov + ' salvato', 'success');
        closeModal();
        await loadPuntiTimbratura();
        renderPuntiTimbratura();
    } catch (e) {
        console.error('savePuntoTimbratura:', e);
        toast('Errore: ' + (e.message || 'salvataggio fallito'), 'error');
    } finally {
        if (btn) { btn.disabled = false; }
    }
}

// ══════════════════════════════════════════════════════════════
// QR TOKEN — token firmato per punto (per l'app timbratura QR).
// Nel doc puntiTimbratura va SOLO l'hash SHA-256 (leggibile dai
// driver per la verifica); il token in chiaro sta in qrTokens/{prov}
// (solo gestori) e serve per stampare il QR. Payload QR: AVRT1|prov|token
// ══════════════════════════════════════════════════════════════

function generaTokenQr() {
    var bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
}

async function sha256Hex(testo) {
    var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(testo));
    return Array.from(new Uint8Array(buf)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
}

async function rigeneraQrToken(prov) {
    if (PT_PROVINCE.indexOf(prov) < 0) { toast('Provincia non valida', 'error'); return; }
    var p = (state.puntiTimbraturaList || []).find(function(x) { return (x.provincia || x.id) === prov; });
    if (!p) { toast('Configura prima il punto ' + prov, 'error'); return; }
    var primo = !p.qrTokenHash;
    if (!primo && !confirm('Rigenerare il token QR di ' + prov + '?\n\nIl QR attualmente stampato smetterà di funzionare: dovrai ristamparlo.')) return;

    try {
        var token = generaTokenQr();
        var hash = await sha256Hex(token);
        await db.collection('qrTokens').doc(prov).set({
            token: token,
            provincia: prov,
            generatoIl: firebase.firestore.FieldValue.serverTimestamp()
        });
        await db.collection('puntiTimbratura').doc(prov).update({
            qrTokenHash: hash,
            qrGeneratoIl: firebase.firestore.FieldValue.serverTimestamp(),
            aggiornatoIl: firebase.firestore.FieldValue.serverTimestamp()
        });
        toast('Token QR ' + (primo ? 'generato' : 'rigenerato') + ' per ' + prov, 'success');
        await loadPuntiTimbratura();
        renderPuntiTimbratura();
    } catch (e) {
        console.error('rigeneraQrToken:', e);
        toast('Errore: ' + (e.message || 'generazione fallita'), 'error');
    }
}

// Pagina di stampa: QR grande su finestra dedicata, pronta per PVC.
// Download PNG dal canvas generato da qrcode.js.
async function stampaQrPunto(prov) {
    var p = (state.puntiTimbraturaList || []).find(function(x) { return (x.provincia || x.id) === prov; });
    if (!p || !p.qrTokenHash) { toast('Genera prima il token QR di ' + prov, 'error'); return; }
    var tokenDoc;
    try {
        tokenDoc = await db.collection('qrTokens').doc(prov).get();
    } catch (e) {
        toast('Errore lettura token: ' + e.message, 'error');
        return;
    }
    if (!tokenDoc.exists) { toast('Token non trovato — rigeneralo', 'error'); return; }
    var payload = 'AVRT1|' + prov + '|' + tokenDoc.data().token;
    var nome = p.nome || PT_PROVINCE_LABELS[prov];

    var w = window.open('', '_blank');
    if (!w) { toast('Popup bloccato — consenti i popup per stampare', 'error'); return; }
    w.document.write(
        '<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>QR Timbratura — ' + prov + '</title>' +
        '<style>' +
        'body{font-family:-apple-system,"DM Sans",sans-serif;display:flex;flex-direction:column;align-items:center;padding:40px;color:#0f1d3d}' +
        '.badge{background:#0f1d3d;color:#fff;padding:10px 28px;border-radius:12px;font-size:26px;font-weight:800;letter-spacing:2px;margin-bottom:8px}' +
        'h1{font-size:34px;margin:12px 0 2px}h2{font-size:20px;color:#475569;font-weight:500;margin-bottom:28px}' +
        '#qr{padding:28px;background:#fff;border:6px solid #0f1d3d;border-radius:24px}' +
        '#qr img,#qr canvas{width:420px!important;height:420px!important}' +
        'p.help{margin-top:26px;font-size:18px;color:#475569;text-align:center;max-width:460px;line-height:1.5}' +
        '.actions{margin-top:28px;display:flex;gap:12px}' +
        'button{padding:12px 24px;font-size:15px;font-weight:700;border-radius:10px;border:none;cursor:pointer}' +
        '.print{background:#0f1d3d;color:#fff}.png{background:#e2e8f0;color:#0f1d3d}' +
        '@media print{.actions{display:none}body{padding:10mm}}' +
        '</style></head><body>' +
        '<div class="badge">LAST MILE</div>' +
        '<h1>' + escapeHtml(nome) + '</h1>' +
        '<h2>Punto timbratura ' + prov + ' — ' + PT_PROVINCE_LABELS[prov] + '</h2>' +
        '<div id="qr"></div>' +
        '<p class="help">Inquadra questo codice con l\'app di timbratura per registrare entrata e uscita.</p>' +
        '<div class="actions"><button class="print" onclick="window.print()">🖨️ Stampa</button>' +
        '<button class="png" onclick="scaricaPng()">⬇️ Scarica PNG</button></div>' +
        '<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>' +
        '<script>new QRCode(document.getElementById("qr"),{text:' + JSON.stringify(payload) + ',width:420,height:420,correctLevel:QRCode.CorrectLevel.H});' +
        'function scaricaPng(){var c=document.querySelector("#qr canvas");if(!c){alert("Canvas non disponibile");return}' +
        'var a=document.createElement("a");a.download="qr-timbratura-' + prov + '.png";a.href=c.toDataURL("image/png");a.click()}' +
        '<\/script></body></html>'
    );
    w.document.close();
}

// Link da scrivere sul tag NFC (record NDEF di tipo URL): stesso token
// del QR. L'appoggio del telefono apre l'app timbratura già "armata".
// Se rigeneri il token, i tag vanno riscritti col nuovo link.
async function mostraLinkNfc(prov) {
    var p = (state.puntiTimbraturaList || []).find(function(x) { return (x.provincia || x.id) === prov; });
    if (!p || !p.qrTokenHash) { toast('Genera prima il token QR di ' + prov + ' (🔄)', 'error'); return; }
    var tokenDoc;
    try {
        tokenDoc = await db.collection('qrTokens').doc(prov).get();
    } catch (e) { toast('Errore lettura token: ' + e.message, 'error'); return; }
    if (!tokenDoc.exists) { toast('Token non trovato — rigeneralo (🔄)', 'error'); return; }

    var url = 'https://app.avrlogisticarl.com/?timbra=' + prov + '&t=' + tokenDoc.data().token + '&via=nfc';
    openModal('Tag NFC — ' + prov + ' ' + PT_PROVINCE_LABELS[prov],
        '<p style="font-size:13px;color:var(--text-muted);line-height:1.6;margin-bottom:12px">' +
            'Scrivi questo link sul tag NFC come <strong>record URL (NDEF)</strong> usando un\'app come ' +
            '<strong>NFC Tools</strong> (Android/iPhone): Scrivi → Aggiungi record → URL → incolla → Scrivi.<br>' +
            'Consigliato: dopo la scrittura, <strong>blocca il tag in sola lettura</strong> dall\'app, così nessuno può riscriverlo.' +
        '</p>' +
        '<textarea id="nfcLinkText" class="input" readonly rows="4" style="font-family:var(--font-mono);font-size:11px;word-break:break-all">' + escapeHtml(url) + '</textarea>' +
        '<button class="btn btn-primary" style="width:100%;margin-top:8px" onclick="copiaLinkNfc()">📋 Copia link</button>' +
        '<p style="font-size:11px;color:var(--text-light);margin-top:10px">⚠️ Se rigeneri il token (🔄), questo link smette di valere: riscrivi il tag e ristampa il QR.</p>'
    );
}

function copiaLinkNfc() {
    var ta = document.getElementById('nfcLinkText');
    ta.select();
    try {
        navigator.clipboard.writeText(ta.value).then(function() { toast('Link copiato', 'success'); });
    } catch (e) {
        document.execCommand('copy');
        toast('Link copiato', 'success');
    }
}

async function togglePuntoTimbratura(prov) {
    var p = (state.puntiTimbraturaList || []).find(function(x) { return (x.provincia || x.id) === prov; });
    if (!p) return;
    var nuovoStato = !(p.attivo === false) ? false : true;
    var azione = nuovoStato ? 'riattivare' : 'disattivare';
    if (!confirm('Vuoi ' + azione + ' il punto timbratura ' + prov + '?')) return;
    try {
        await db.collection('puntiTimbratura').doc(prov).update({
            attivo: nuovoStato,
            aggiornatoIl: firebase.firestore.FieldValue.serverTimestamp()
        });
        toast('Punto ' + (nuovoStato ? 'riattivato' : 'disattivato'), 'success');
        await loadPuntiTimbratura();
        renderPuntiTimbratura();
    } catch (e) {
        toast('Errore: ' + (e.message || 'aggiornamento fallito'), 'error');
    }
}
