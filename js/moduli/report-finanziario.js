// DELIVERY HUB v2 — Report Finanziario (P&L mensile — allineato con logica alias dashboard)

var COSTI_VOCI = [
    { key: 'compensiDriver', label: 'Compensi driver (bonifici)', auto: true },
    { key: 'presidente', label: 'Presidente', default: 2500 },
    { key: 'hr', label: 'HR', default: 1000 },
    { key: 'finance', label: 'Finance', default: 2500 },
    { key: 'consulenteLavoro', label: 'Consulente del lavoro', default: 600 },
    { key: 'carburante', label: 'Carburante (netto)', default: 2000 },
    { key: 'f24', label: 'F24 / Tasse', default: 7000 },
    { key: 'costoMezzi', label: 'Costo mezzi / Noleggio', default: 854 },
    { key: 'altro', label: 'Altro', default: 0 }
];

async function renderReportFinanziario() {
    var mese = state.meseCorrente;
    if (!mese) return;

    var cm = state.consegne.filter(function(c) { return meseFromDate(c.data) === mese; });

    // Filtra solo AVR usando la stessa logica del dashboard
    var avrSet = buildDriverAvrSet();
    var cmAvr = cm.filter(function(c) {
        var rider = c.driver || c.rider || '';
        return isDriverAvr(rider, avrSet);
    });
    var totConsegne = cmAvr.length;

    // Calcola fatturato per gruppo
    var filialiPerGruppo = { arena: { sotto: 0, sopra: 0 }, palermo: { sotto: 0, sopra: 0 } };
    cmAvr.forEach(function(c) {
        var area = c.area || c.provincia || '?';
        var gruppo = (area === 'PA') ? 'palermo' : 'arena';
        var importo = parseFloat(c.importo) || 0;
        if (importo >= 250.01) {
            filialiPerGruppo[gruppo].sopra++;
        } else {
            filialiPerGruppo[gruppo].sotto++;
        }
    });

    var arenaImponibile = (filialiPerGruppo.arena.sotto * 6.90) + (filialiPerGruppo.arena.sopra * 10.00);
    var palermoImponibile = (filialiPerGruppo.palermo.sotto * 6.90) + (filialiPerGruppo.palermo.sopra * 10.00);

    // Consegne speciali (importo >= 400)
    var specialiImponibile = 0;
    cmAvr.forEach(function(c) {
        var imp = parseFloat(c.importo) || 0;
        if (imp >= 400) specialiImponibile += calcolaPrezzoSpeciale(imp);
    });

    var totImponibile = arenaImponibile + palermoImponibile + specialiImponibile;
    var totIva = totImponibile * 0.22;
    var totLordo = totImponibile + totIva;

    // Render ricavi
    var ricaviHtml = '';
    ricaviHtml += rigaRicavo('F.lli Arena', arenaImponibile);
    ricaviHtml += rigaRicavo('Palermo Retail', palermoImponibile);
    if (specialiImponibile > 0) ricaviHtml += rigaRicavo('Consegne speciali', specialiImponibile);
    document.getElementById('rfTblRicavi').innerHTML = ricaviHtml;
    document.getElementById('rfTotImponibile').innerHTML = '<strong>' + formatCurrency(totImponibile) + '</strong>';
    document.getElementById('rfTotIva').innerHTML = formatCurrency(totIva);
    document.getElementById('rfTotLordo').innerHTML = '<strong>' + formatCurrency(totLordo) + '</strong>';

    // === COSTI ===
    var costiDoc = await loadCostiMese(mese);
    var costiData = costiDoc || {};

    // Compensi driver automatici — usa stessa logica
    var compensiDriver = 0;
    var driverData = {};
    cmAvr.forEach(function(c) {
        var drv = normalizeDriverName(c.driver || c.rider);
        if (!drv) return;
        if (!driverData[drv]) driverData[drv] = 0;
        driverData[drv]++;
    });
    Object.keys(driverData).forEach(function(drv) {
        var ana = typeof findDriverAnagrafica === 'function' ? findDriverAnagrafica(drv) : null;
        var costo = ana ? (ana.costoConsegna || state.costoPerConsegna) : state.costoPerConsegna;
        compensiDriver += driverData[drv] * costo;
    });
    costiData.compensiDriver = compensiDriver;

    var totCosti = 0;
    var costiHtml = '';
    COSTI_VOCI.forEach(function(v) {
        var val = costiData[v.key] !== undefined ? costiData[v.key] : (v.default || 0);
        totCosti += val;
        var isAuto = v.auto ? ' <span style="font-size:10px;color:var(--accent)">(auto)</span>' : '';
        costiHtml += '<tr><td>' + v.label + isAuto + '</td><td style="text-align:right">' + formatCurrency(val) + '</td></tr>';
    });
    document.getElementById('rfTblCosti').innerHTML = costiHtml;
    document.getElementById('rfTotCosti').innerHTML = '<strong>' + formatCurrency(totCosti) + '</strong>';

    // === KPI ===
    var revenue = totImponibile - totCosti;
    document.getElementById('rfFatturato').textContent = formatCurrency(totImponibile);
    document.getElementById('rfCosti').textContent = formatCurrency(totCosti);
    document.getElementById('rfRevenue').textContent = formatCurrency(revenue);
    document.getElementById('rfRevenue').style.color = revenue >= 0 ? 'var(--success)' : 'var(--danger)';
    document.getElementById('rfConsegne').textContent = formatNumber(totConsegne);

    // === RIEPILOGO P&L ===
    var pct = totImponibile > 0 ? Math.round((revenue / totImponibile) * 100) : 0;
    document.getElementById('rfRiepilogo').innerHTML =
        '<div style="display:flex;flex-direction:column;gap:8px;padding:8px 0">' +
            plRow('Fatturato imponibile', totImponibile, false) +
            plRow('IVA 22%', totIva, false) +
            plRow('Fatturato lordo', totLordo, false) +
            '<div style="border-top:2px solid var(--border);margin:4px 0"></div>' +
            plRow('Compensi driver', -compensiDriver, true) +
            plRow('Presidente', -(costiData.presidente || 2500), true) +
            plRow('HR', -(costiData.hr || 1000), true) +
            plRow('Finance', -(costiData.finance || 2500), true) +
            plRow('Cons. lavoro', -(costiData.consulenteLavoro || 600), true) +
            plRow('Carburante', -(costiData.carburante || 2000), true) +
            plRow('F24 / Tasse', -(costiData.f24 || 7000), true) +
            plRow('Costo mezzi', -(costiData.costoMezzi || 854), true) +
            (costiData.altro ? plRow('Altro', -(costiData.altro), true) : '') +
            '<div style="border-top:2px solid var(--accent);margin:4px 0"></div>' +
            '<div style="display:flex;justify-content:space-between;padding:12px 0;font-size:18px">' +
                '<span style="font-weight:800;color:' + (revenue >= 0 ? 'var(--success)' : 'var(--danger)') + '">REVENUE (Utile netto)</span>' +
                '<span style="font-weight:800;color:' + (revenue >= 0 ? 'var(--success)' : 'var(--danger)') + '">' + formatCurrency(revenue) + ' (' + pct + '%)</span>' +
            '</div>' +
        '</div>';

    await renderStoricoFinanziario();
}

function rigaRicavo(label, imponibile) {
    var iva = imponibile * 0.22;
    return '<tr><td>' + label + '</td><td style="text-align:right">' + formatCurrency(imponibile) +
        '</td><td style="text-align:right">' + formatCurrency(iva) +
        '</td><td style="text-align:right"><strong>' + formatCurrency(imponibile + iva) + '</strong></td></tr>';
}

function plRow(label, value, isCosto) {
    var color = isCosto ? 'var(--danger)' : 'var(--text)';
    return '<div style="display:flex;justify-content:space-between;padding:4px 0">' +
        '<span style="color:var(--text-muted)">' + label + '</span>' +
        '<span style="color:' + color + ';font-weight:600">' + (isCosto ? formatCurrency(Math.abs(value)) : formatCurrency(value)) + '</span></div>';
}

function calcolaPrezzoSpeciale(importo) {
    var fasce = state.prezziSpeciali || [];
    for (var i = 0; i < fasce.length; i++) {
        if (importo >= fasce[i].min && importo <= fasce[i].max) return fasce[i].prezzo;
    }
    // Importo fuori da tutte le fasce: usa l'ultima fascia disponibile come fallback
    if (fasce.length > 0 && importo > fasce[fasce.length - 1].max) {
        console.warn('calcolaPrezzoSpeciale: importo ' + importo + ' supera la fascia massima, uso ultima fascia');
        return fasce[fasce.length - 1].prezzo;
    }
    return 0;
}

async function loadCostiMese(mese) {
    try {
        var doc = await db.collection('costiMensili').doc(mese).get();
        if (doc.exists) return doc.data();
    } catch(e) { console.warn('Costi load:', e); }
    return null;
}

async function saveCostiMese(mese, data) {
    try {
        await db.collection('costiMensili').doc(mese).set(data, { merge: true });
        toast('Costi salvati', 'success');
    } catch(e) { toast('Errore: ' + e.message, 'error'); }
}

function openEditCosti() {
    var mese = state.meseCorrente;
    var html = '<p style="margin-bottom:16px;color:var(--text-muted);font-size:13px">Inserisci i costi per <strong>' + meseLabel(mese) + '</strong>. I compensi driver sono calcolati automaticamente.</p>';

    COSTI_VOCI.forEach(function(v) {
        if (v.auto) return;
        html += '<div class="form-group" style="margin-bottom:10px">' +
            '<label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">' + v.label + '</label>' +
            '<input type="number" id="costo_' + v.key + '" class="input" value="' + (v.default || 0) + '" step="0.01" style="margin-bottom:0">' +
            '</div>';
    });

    html += '<button class="btn btn-primary" onclick="doSaveCosti()" style="width:100%;margin-top:12px">Salva costi</button>';

    openModal('Costi mensili — ' + meseLabel(mese), html);

    loadCostiMese(mese).then(function(data) {
        if (!data) return;
        COSTI_VOCI.forEach(function(v) {
            if (v.auto) return;
            var el = document.getElementById('costo_' + v.key);
            if (el && data[v.key] !== undefined) el.value = data[v.key];
        });
    });
}

async function doSaveCosti() {
    var btn = document.querySelector('[onclick="doSaveCosti()"]');
    if (btn && btn.disabled) return;
    if (btn) btn.disabled = true;
    var mese = state.meseCorrente;
    var data = { mese: mese, updatedAt: new Date().toISOString() };

    COSTI_VOCI.forEach(function(v) {
        if (v.auto) return;
        var el = document.getElementById('costo_' + v.key);
        if (el) data[v.key] = parseFloat(el.value) || 0;
    });

    try {
        await saveCostiMese(mese, data);
        closeModal();
        renderReportFinanziario();
    } catch (e) {
        toast('Errore salvataggio costi', 'error');
        console.error('doSaveCosti error:', e);
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function renderStoricoFinanziario() {
    try {
        var snap = await db.collection('costiMensili').orderBy('mese', 'desc').limit(12).get();
        var mesiConCosti = {};
        snap.docs.forEach(function(d) { mesiConCosti[d.id] = d.data(); });

        var mesi = [];
        var now = new Date();
        for (var i = 0; i < 12; i++) {
            var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            mesi.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
        }

        var html = '';
        var mn = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];

        for (var i = 0; i < mesi.length; i++) {
            var m = mesi[i];
            var parts = m.split('-');
            var label = mn[parseInt(parts[1]) - 1] + ' ' + parts[0];

            var costi = mesiConCosti[m] || {};
            var hasCosti = Object.keys(costi).length > 0;

            if (!hasCosti && m !== state.meseCorrente) {
                html += '<tr style="opacity:0.4"><td>' + label + '</td><td colspan="4" style="text-align:center;color:var(--text-muted);font-size:12px">Nessun dato inserito</td></tr>';
                continue;
            }

            if (m === state.meseCorrente) {
                var fatturato = document.getElementById('rfFatturato').textContent;
                var costiTot = document.getElementById('rfCosti').textContent;
                var rev = document.getElementById('rfRevenue').textContent;
                var cons = document.getElementById('rfConsegne').textContent;
                var revColor = document.getElementById('rfRevenue').style.color;
                html += '<tr style="background:rgba(34,197,94,0.05)"><td><strong>' + label + '</strong></td>' +
                    '<td style="text-align:right">' + fatturato + '</td>' +
                    '<td style="text-align:right">' + costiTot + '</td>' +
                    '<td style="text-align:right;color:' + revColor + ';font-weight:700">' + rev + '</td>' +
                    '<td style="text-align:right">' + cons + '</td></tr>';
            } else if (hasCosti) {
                var totC = 0;
                COSTI_VOCI.forEach(function(v) {
                    if (!v.auto) totC += (costi[v.key] || v.default || 0);
                });
                totC += (costi.compensiDriver || 0);
                html += '<tr><td>' + label + '</td>' +
                    '<td style="text-align:right">—</td>' +
                    '<td style="text-align:right">' + formatCurrency(totC) + '</td>' +
                    '<td style="text-align:right">—</td>' +
                    '<td style="text-align:right">—</td></tr>';
            }
        }

        document.getElementById('rfTblStorico').innerHTML = html || '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">Inserisci i costi mensili per vedere lo storico</td></tr>';
    } catch(e) {
        document.getElementById('rfTblStorico').innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">Errore caricamento storico</td></tr>';
    }
}
