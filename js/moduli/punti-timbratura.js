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
        var nfcStr = p.nfcTagUID
            ? '<span style="font-family:var(--font-mono);font-size:11px">' + escapeHtml(p.nfcTagUID) + '</span>'
            : '<span class="badge badge-warn">Tag mancante</span>';
        var pronto = geoOk && !!p.nfcTagUID && p.attivo !== false;
        var statoBadge = p.attivo === false
            ? '<span class="badge badge-err">Disattivato</span>'
            : (pronto ? '<span class="badge badge-ok">Attivo</span>' : '<span class="badge badge-warn">Incompleto</span>');
        return '<tr>' +
            '<td><strong>' + escapeHtml(p.provincia || prov) + '</strong> <span style="color:var(--text-muted)">— ' + PT_PROVINCE_LABELS[prov] + '</span></td>' +
            '<td>' + escapeHtml(p.nome || '—') + '</td>' +
            '<td style="font-size:12px">' + escapeHtml(p.indirizzo || '—') + '</td>' +
            '<td>' + geoStr + '<br><small style="color:var(--text-muted)">raggio ' + raggioStr + '</small></td>' +
            '<td>' + nfcStr + '</td>' +
            '<td>' + statoBadge + '</td>' +
            '<td style="white-space:nowrap">' +
                '<button class="btn btn-sm" onclick="openEditPuntoTimbratura(\'' + escapeHtml(prov) + '\')" title="Modifica">✏️</button> ' +
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
        '<div class="form-group"><label>NFC Tag UID</label>' +
            '<input type="text" id="ptNfcUid" class="input" placeholder="es. 04:A3:2B:1F:6E:9C:80" value="' + escapeHtml(p.nfcTagUID || '') + '" style="font-family:var(--font-mono)">' +
            '<small style="color:var(--text-muted)">L\'UID è stampato sul tag oppure lo leggi con un\'app NFC dal telefono. Univoco per punto.</small></div>' +
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
    if (!nfcUid) { toast('NFC Tag UID obbligatorio', 'error'); return; }

    // Univocità UID tra i punti
    var duplicato = (state.puntiTimbraturaList || []).find(function(x) {
        return (x.provincia || x.id) !== prov && x.nfcTagUID === nfcUid;
    });
    if (duplicato) {
        toast('Tag NFC già usato dal punto ' + duplicato.provincia, 'error');
        return;
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
