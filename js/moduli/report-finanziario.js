// DELIVERY HUB v2 — Report Finanziario (P&L mensile)
// Dal 05/10/2026 i numeri vengono da Fatture in Cloud (fattureMese/{mese},
// scritta dalla CF ficSyncFatture per mese di COMPETENZA): ricavi = fatture
// emesse ai clienti AVR, costi = fatture ricevute classificate per voce.
// I fogli Decò non sono più la fonte: le consegne per città arrivano dai
// rapporti dell'app driver (reportDriver) e servono solo a ripartire.
// Le voci senza fattura (buste paga, F24…) restano manuali in costiMensili.

var COSTI_VOCI = [
    { key: 'compensiDriver', label: 'Stipendi/compensi driver' },
    { key: 'nettoRizzuto', label: 'Netto busta paga — Rizzuto', default: 1500 },
    { key: 'nettoFaro', label: 'Netto busta paga — Faro', default: 2000 },
    { key: 'hr', label: 'HR', default: 1000, daFattura: true },
    { key: 'finance', label: 'Finance', default: 2500, daFattura: true },
    { key: 'consulenteLavoro', label: 'Consulente del lavoro', default: 600, daFattura: true },
    { key: 'carburante', label: 'Carburante (netto)', default: 2000, daFattura: true },
    { key: 'f24', label: 'F24 / Tasse', default: 7000 },
    { key: 'costoMezzi', label: 'Costo mezzi / Noleggio', default: 854, daFattura: true },
    { key: 'altro', label: 'Altro', default: 0, daFattura: true }
];
var VOCI_FATTURA = COSTI_VOCI.filter(function(v) { return v.daFattura; });
var VOCI_BUSTE = ['compensiDriver', 'nettoRizzuto', 'nettoFaro', 'hr']; // compilate dalla CF elaboraBustePaga
var AZIENDE_FATTURA = { avr: 'AVR / Last Mile', washhub: 'Wash Hub', da_classificare: 'Da classificare' };
var AREA_LABELS_RF = { CT: 'Catania', ME: 'Messina', EN: 'Enna', SR: 'Siracusa', PA: 'Palermo' };

var rfState = { fm: null, costi: null, mostraWashHub: false };

async function loadFattureMese(mese) {
    try {
        var doc = await db.collection('fattureMese').doc(mese).get();
        return doc.exists ? doc.data() : null;
    } catch (e) { console.warn('fattureMese load:', e); return null; }
}

async function renderReportFinanziario() {
    var mese = state.meseCorrente;
    if (!mese) return;

    var fm = await loadFattureMese(mese);
    rfState.fm = fm;
    var emesse = (fm && fm.emesse) || [];
    var ricevute = (fm && fm.ricevute) || [];
    var tot = (fm && fm.totali) || { ricaviImponibile: 0, ricaviIva: 0, ricaviLordo: 0, costiImponibile: 0, costiPerVoce: {}, nDaClassificare: 0 };

    // Avviso stato sync
    var avviso = document.getElementById('rfAvvisoFic');
    if (avviso) {
        if (!fm) {
            avviso.style.display = 'block';
            avviso.innerHTML = '⚠️ Nessun dato da Fatture in Cloud per ' + meseLabel(mese) + '. Premi <strong>Aggiorna da FIC</strong>.';
        } else if (fm.ricevuteDisponibili === false) {
            avviso.style.display = 'block';
            avviso.innerHTML = '⚠️ Fatture <strong>ricevute</strong> non disponibili: il token Fatture in Cloud non ha il permesso "Documenti ricevuti". I ricavi sono aggiornati, i costi restano manuali.' + (fm.ricevuteErrore ? ' <span style="color:var(--text-muted)">(' + escapeHtml(fm.ricevuteErrore) + ')</span>' : '');
        } else if (tot.nDaClassificare > 0) {
            avviso.style.display = 'block';
            avviso.innerHTML = '🏷️ <strong>' + tot.nDaClassificare + ' fatture ricevute da classificare</strong> (AVR o Wash Hub?): finché non le assegni contano tra i costi AVR.';
        } else {
            avviso.style.display = 'none';
        }
    }
    var agg = document.getElementById('rfAggiornatoIl');
    if (agg) agg.textContent = fm && fm.aggiornatoIl ? 'Aggiornato ' + new Date(fm.aggiornatoIl).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

    // === RICAVI: fatture emesse del mese di competenza ===
    var ricaviHtml = emesse.map(function(e) {
        var fonte = e.competenzaFonte === 'manuale' ? '✎' : e.competenzaFonte === 'testo' ? '' : '<span title="Competenza stimata: mese precedente alla data" style="color:var(--warning)">≈</span>';
        var stile = e.escludi ? 'opacity:.45;text-decoration:line-through' : '';
        return '<tr style="' + stile + '">' +
            '<td><strong>' + escapeHtml(e.numero) + '</strong><div style="font-size:11px;color:var(--text-light)">' + formatDateIt(e.data) + ' · ' + escapeHtml(e.statoSdi || '—') + '</div></td>' +
            '<td style="font-size:12px">' + escapeHtml(e.descrizione) + ' ' + fonte + '</td>' +
            '<td style="text-align:right">' + formatCurrency(e.imponibile) + '</td>' +
            '<td style="text-align:right">' + formatCurrency(e.iva) + '</td>' +
            '<td style="text-align:right"><strong>' + formatCurrency(e.lordo) + '</strong></td>' +
            '<td><button class="btn btn-sm" title="Cambia mese di competenza / escludi" onclick="rfEditEmessa(\'' + e.ficId + '\')">✏️</button></td>' +
        '</tr>';
    }).join('');
    document.getElementById('rfTblRicavi').innerHTML = ricaviHtml || '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:24px">Nessuna fattura emessa con competenza ' + meseLabel(mese) + '</td></tr>';
    document.getElementById('rfTotImponibile').innerHTML = '<strong>' + formatCurrency(tot.ricaviImponibile) + '</strong>';
    document.getElementById('rfTotIva').innerHTML = formatCurrency(tot.ricaviIva);
    document.getElementById('rfTotLordo').innerHTML = '<strong>' + formatCurrency(tot.ricaviLordo) + '</strong>';

    // === COSTI: voci da fattura (FIC) + voci manuali (costiMensili) ===
    var costiData = (await loadCostiMese(mese)) || {};
    rfState.costi = costiData;
    var perVoce = tot.costiPerVoce || {};
    var haRicevute = !!(fm && fm.ricevuteDisponibili !== false && ricevute.length);
    var compensiDriver = parseFloat(costiData.compensiDriver) || 0;
    var valori = {};
    var totCosti = 0, costiHtml = '';
    var haBuste = !!(costiData.bustePaga && costiData.bustePaga.n > 0);
    COSTI_VOCI.forEach(function(v) {
        var val, origine = '';
        if (v.daFattura && haRicevute && perVoce[v.key] !== undefined) { val = perVoce[v.key]; origine = ' <span style="font-size:10px;color:var(--accent)">(da fatture)</span>'; }
        else if (haBuste && VOCI_BUSTE.indexOf(v.key) >= 0) { val = parseFloat(costiData[v.key]) || 0; origine = ' <span style="font-size:10px;color:var(--accent)">(da buste paga)</span>'; }
        else if (v.key === 'compensiDriver') val = compensiDriver;
        else val = costiData[v.key] !== undefined ? parseFloat(costiData[v.key]) || 0 : (v.default || 0);
        valori[v.key] = val;
        totCosti += val;
        costiHtml += '<tr><td>' + v.label + origine + '</td><td style="text-align:right">' + formatCurrency(val) + '</td></tr>';
    });
    document.getElementById('rfTblCosti').innerHTML = costiHtml;
    document.getElementById('rfTotCosti').innerHTML = '<strong>' + formatCurrency(totCosti) + '</strong>';

    // === FATTURE RICEVUTE (dettaglio con classificazione) ===
    var ricEl = document.getElementById('rfTblRicevute');
    if (ricEl) {
        var selA = function(r) {
            return '<select class="input" style="padding:4px 6px;font-size:12px;margin:0" onchange="rfClassifica(\'' + r.ficId + '\',\'' + (r.fornitoreId || '') + '\',\'azienda\',this.value)">' +
                Object.keys(AZIENDE_FATTURA).map(function(k) { return '<option value="' + k + '"' + (r.azienda === k ? ' selected' : '') + '>' + AZIENDE_FATTURA[k] + '</option>'; }).join('') + '</select>';
        };
        var selV = function(r) {
            return '<select class="input" style="padding:4px 6px;font-size:12px;margin:0" onchange="rfClassifica(\'' + r.ficId + '\',\'' + (r.fornitoreId || '') + '\',\'voce\',this.value)">' +
                VOCI_FATTURA.map(function(v) { return '<option value="' + v.key + '"' + (r.voce === v.key ? ' selected' : '') + '>' + v.label + '</option>'; }).join('') + '</select>';
        };
        // Le fatture dei fornitori Wash Hub non riguardano AVR: nascoste di default
        var nWashHub = ricevute.filter(function(r) { return r.azienda === 'washhub'; }).length;
        var visibili = rfState.mostraWashHub ? ricevute : ricevute.filter(function(r) { return r.azienda !== 'washhub'; });
        var rigaWH = nWashHub ? '<tr><td colspan="6" style="font-size:12px;color:var(--text-muted);text-align:center">' + nWashHub + ' fatture di fornitori Wash Hub ' + (rfState.mostraWashHub ? 'mostrate' : 'nascoste') + ' — <a href="#" onclick="rfState.mostraWashHub=!rfState.mostraWashHub;renderReportFinanziario();return false">' + (rfState.mostraWashHub ? 'nascondi' : 'mostra') + '</a></td></tr>' : '';
        ricEl.innerHTML = rigaWH + visibili.map(function(r) {
            var stile = (r.escludi || r.azienda === 'washhub') ? 'opacity:.5' : '';
            var fonte = r.competenzaFonte === 'manuale' ? ' ✎' : '';
            return '<tr style="' + stile + '">' +
                '<td>' + formatDateIt(r.data) + fonte + '<div style="font-size:11px;color:var(--text-light)">' + escapeHtml(r.numero || '') + '</div></td>' +
                '<td><strong>' + escapeHtml(r.fornitore) + '</strong><div style="font-size:11px;color:var(--text-muted)">' + escapeHtml(r.descrizione) + '</div></td>' +
                '<td style="text-align:right">' + formatCurrency(r.imponibile) + '<div style="font-size:11px;color:var(--text-light)">lordo ' + formatCurrency(r.lordo) + '</div></td>' +
                '<td>' + selA(r) + '</td>' +
                '<td>' + selV(r) + '</td>' +
                '<td><button class="btn btn-sm" title="Cambia mese di competenza / escludi" onclick="rfEditRicevuta(\'' + r.ficId + '\')">✏️</button></td>' +
            '</tr>';
        }).join('');
        if (!ricEl.innerHTML) ricEl.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:24px">' + (fm && fm.ricevuteDisponibili === false ? 'Fatture ricevute non disponibili (permesso token FIC)' : 'Nessuna fattura ricevuta con competenza ' + meseLabel(mese)) + '</td></tr>';
    }

    await renderBustePaga(mese, costiData);

    // === CONSEGNE E MARGINE PER CITTÀ (rapporti app driver) ===
    var perCitta = {};
    var totConsegne = 0;
    (state.reportDriver || []).forEach(function(r) {
        var area = r.area || '?';
        perCitta[area] = perCitta[area] || { consegne: 0 };
        perCitta[area].consegne += r.numConsegne || 0;
        totConsegne += r.numConsegne || 0;
    });
    var cittaEl = document.getElementById('rfTblCitta');
    if (cittaEl) {
        var driverPerCitta = {}, totDriverAttivi = 0;
        (state.driverList || []).forEach(function(dr) {
            if (dr.attivo === false) return;
            driverPerCitta[dr.citta || '?'] = (driverPerCitta[dr.citta || '?'] || 0) + 1;
            totDriverAttivi++;
        });
        var costiUfficio = totCosti - valori.compensiDriver;
        // Stipendi driver per città: dalle buste paga (netti reali per città del
        // driver in anagrafica) quando ci sono, altrimenti quota fissa sui driver attivi
        var nettiCitta = (costiData.bustePaga && costiData.bustePaga.perCitta) || null;
        if (nettiCitta) Object.keys(nettiCitta).forEach(function(a) { if (!perCitta[a]) perCitta[a] = { consegne: 0 }; });
        var cittaHtml = '', tcCons = 0, tcFatt = 0, tcCosti = 0, tcMarg = 0;
        Object.keys(perCitta).sort(function(a, b) { return perCitta[b].consegne - perCitta[a].consegne; }).forEach(function(area) {
            var x = perCitta[area];
            var quotaCons = totConsegne > 0 ? x.consegne / totConsegne : 0;
            var fatt = tot.ricaviImponibile * quotaCons; // pro-quota consegne app
            var quotaDriver = nettiCitta ? (nettiCitta[area] || 0) : (totDriverAttivi > 0 ? valori.compensiDriver * ((driverPerCitta[area] || 0) / totDriverAttivi) : 0);
            var quota = quotaDriver + costiUfficio * quotaCons;
            var marg = fatt - quota;
            var margPct = fatt > 0 ? Math.round(marg / fatt * 100) : 0;
            var col = marg >= 0 ? 'var(--success)' : 'var(--danger)';
            tcCons += x.consegne; tcFatt += fatt; tcCosti += quota; tcMarg += marg;
            cittaHtml += '<tr>' +
                '<td><strong>' + area + '</strong> — ' + (AREA_LABELS_RF[area] || area) + '<div style="font-size:10px;color:var(--text-light)">' + (driverPerCitta[area] || 0) + ' driver</div></td>' +
                '<td style="text-align:right">' + x.consegne + '</td>' +
                '<td style="text-align:right">' + formatCurrency(fatt) + '</td>' +
                '<td style="text-align:right;color:var(--text-muted)" title="Driver (' + (nettiCitta ? 'netti buste paga' : 'quota fissa') + '): ' + formatCurrency(quotaDriver) + ' · Ufficio (pro-quota): ' + formatCurrency(costiUfficio * quotaCons) + '">' + formatCurrency(quota) + '</td>' +
                '<td style="text-align:right;font-weight:700;color:' + col + '">' + formatCurrency(marg) + '</td>' +
                '<td style="text-align:right;font-weight:700;color:' + col + '">' + margPct + '%</td>' +
            '</tr>';
        });
        if (cittaHtml) {
            cittaHtml += '<tr class="totals-row"><td><strong>TOTALE</strong></td>' +
                '<td style="text-align:right"><strong>' + tcCons + '</strong></td>' +
                '<td style="text-align:right"><strong>' + formatCurrency(tcFatt) + '</strong></td>' +
                '<td style="text-align:right"><strong>' + formatCurrency(tcCosti) + '</strong></td>' +
                '<td style="text-align:right"><strong style="color:' + (tcMarg >= 0 ? 'var(--success)' : 'var(--danger)') + '">' + formatCurrency(tcMarg) + '</strong></td>' +
                '<td style="text-align:right"><strong>' + (tcFatt > 0 ? Math.round(tcMarg / tcFatt * 100) : 0) + '%</strong></td></tr>';
        }
        cittaEl.innerHTML = cittaHtml || '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">Nessun rapporto driver nel mese</td></tr>';
    }

    // === KPI ===
    var revenue = tot.ricaviImponibile - totCosti;
    document.getElementById('rfFatturato').textContent = formatCurrency(tot.ricaviImponibile);
    document.getElementById('rfCosti').textContent = formatCurrency(totCosti);
    document.getElementById('rfRevenue').textContent = formatCurrency(revenue);
    document.getElementById('rfRevenue').style.color = revenue >= 0 ? 'var(--success)' : 'var(--danger)';
    document.getElementById('rfConsegne').textContent = formatNumber(totConsegne);

    // === RIEPILOGO P&L ===
    var pct = tot.ricaviImponibile > 0 ? Math.round((revenue / tot.ricaviImponibile) * 100) : 0;
    var righe = COSTI_VOCI.map(function(v) { return valori[v.key] ? plRow(v.label, -valori[v.key], true) : ''; }).join('');
    document.getElementById('rfRiepilogo').innerHTML =
        '<div style="display:flex;flex-direction:column;gap:8px;padding:8px 0">' +
            plRow('Fatturato imponibile (' + emesse.filter(function(e) { return !e.escludi; }).length + ' fatture)', tot.ricaviImponibile, false) +
            plRow('IVA', tot.ricaviIva, false) +
            plRow('Fatturato lordo', tot.ricaviLordo, false) +
            '<div style="border-top:2px solid var(--border);margin:4px 0"></div>' +
            righe +
            '<div style="border-top:2px solid var(--accent);margin:4px 0"></div>' +
            '<div style="display:flex;justify-content:space-between;padding:12px 0;font-size:18px">' +
                '<span style="font-weight:800;color:' + (revenue >= 0 ? 'var(--success)' : 'var(--danger)') + '">REVENUE (Utile netto)</span>' +
                '<span style="font-weight:800;color:' + (revenue >= 0 ? 'var(--success)' : 'var(--danger)') + '">' + formatCurrency(revenue) + ' (' + pct + '%)</span>' +
            '</div>' +
        '</div>';

    await renderStoricoFinanziario();
}

function formatDateIt(ymd) {
    if (!ymd) return '—';
    var p = String(ymd).slice(0, 10).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : ymd;
}

function plRow(label, value, isCosto) {
    var color = isCosto ? 'var(--danger)' : 'var(--text)';
    return '<div style="display:flex;justify-content:space-between;padding:4px 0">' +
        '<span style="color:var(--text-muted)">' + label + '</span>' +
        '<span style="color:' + color + ';font-weight:600">' + (isCosto ? formatCurrency(Math.abs(value)) : formatCurrency(value)) + '</span></div>';
}

// ── Sync e classificazione (scrivono override/fornitori, poi risincronizzano) ──
async function rfSyncFic() {
    var btn = document.getElementById('btnRfSync');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Sincronizzo…'; }
    try {
        var out = await ficCall('ficSyncFatture', {});
        toast('Fatture aggiornate: ' + out.emesse + ' emesse, ' + out.ricevute + ' ricevute', 'success');
        await renderReportFinanziario();
    } catch (e) {
        toast('Sync FIC fallita: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '🔄 Aggiorna da FIC'; }
    }
}

// azienda/voce: si salvano sul FORNITORE (valgono per tutte le sue fatture).
async function rfClassifica(ficId, fornitoreId, campo, valore) {
    try {
        var r = (rfState.fm && rfState.fm.ricevute || []).find(function(x) { return String(x.ficId) === String(ficId); });
        if (fornitoreId) {
            var upd = { nome: r ? r.fornitore : '', aggiornatoIl: new Date().toISOString(), aggiornatoDa: state.user.email };
            upd[campo] = valore;
            await db.collection('fornitori').doc(String(fornitoreId)).set(upd, { merge: true });
        } else {
            var ov = {}; ov[campo] = valore;
            await db.collection('fattureOverride').doc('ricevuta_' + ficId).set(ov, { merge: true });
        }
        await rfSyncFic();
    } catch (e) { toast('Errore: ' + e.message, 'error'); }
}

function rfEditEmessa(ficId) { rfEditCompetenza('emessa', ficId); }
function rfEditRicevuta(ficId) { rfEditCompetenza('ricevuta', ficId); }

function rfEditCompetenza(tipo, ficId) {
    var lista = (rfState.fm && rfState.fm[tipo === 'emessa' ? 'emesse' : 'ricevute']) || [];
    var r = lista.find(function(x) { return String(x.ficId) === String(ficId); });
    if (!r) return;
    var html = '<p style="color:var(--text-muted);font-size:13px;margin-bottom:12px">' + escapeHtml(r.descrizione || r.fornitore || r.cliente || '') + '<br>' + formatDateIt(r.data) + ' · ' + formatCurrency(r.imponibile) + '</p>' +
        '<div class="form-group"><label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Mese di competenza</label>' +
        '<input type="month" id="rfOvMese" class="input" value="' + escapeHtml(r.meseCompetenza) + '"></div>' +
        '<label style="display:flex;align-items:center;gap:8px;margin:12px 0;font-size:13px"><input type="checkbox" id="rfOvEscludi"' + (r.escludi ? ' checked' : '') + '> Escludi dal report</label>' +
        '<button class="btn btn-primary" style="width:100%" onclick="rfSalvaCompetenza(\'' + tipo + '\',\'' + ficId + '\')">Salva</button>';
    openModal('Competenza fattura ' + escapeHtml(r.numero || ''), html);
}

async function rfSalvaCompetenza(tipo, ficId) {
    var mese = document.getElementById('rfOvMese').value;
    if (!/^\d{4}-\d{2}$/.test(mese)) { toast('Mese non valido', 'error'); return; }
    try {
        await db.collection('fattureOverride').doc(tipo + '_' + ficId).set({ meseCompetenza: mese, escludi: document.getElementById('rfOvEscludi').checked, aggiornatoIl: new Date().toISOString(), aggiornatoDa: state.user.email }, { merge: true });
        closeModal();
        await rfSyncFic();
    } catch (e) { toast('Errore: ' + e.message, 'error'); }
}

// ── Costi manuali (voci senza fattura) ──
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
    var fm = rfState.fm;
    var perVoce = (fm && fm.totali && fm.totali.costiPerVoce) || {};
    var haRicevute = !!(fm && fm.ricevuteDisponibili !== false && (fm.ricevute || []).length);
    var costi = rfState.costi || {};
    var haBuste = !!(costi.bustePaga && costi.bustePaga.n > 0);
    var html = '<p style="margin-bottom:16px;color:var(--text-muted);font-size:13px">Costi manuali per <strong>' + meseLabel(mese) + '</strong>. Le voci coperte da fatture ricevute o buste paga sono già compilate e non si modificano qui.</p>';
    COSTI_VOCI.forEach(function(v) {
        var daFic = v.daFattura && haRicevute && perVoce[v.key] !== undefined;
        var daBuste = haBuste && VOCI_BUSTE.indexOf(v.key) >= 0;
        var nota = daFic ? ' <span style="color:var(--accent)">(da fatture: ' + formatCurrency(perVoce[v.key]) + ')</span>' : daBuste ? ' <span style="color:var(--accent)">(da buste paga: ' + formatCurrency(parseFloat(costi[v.key]) || 0) + ')</span>' : '';
        html += '<div class="form-group" style="margin-bottom:10px">' +
            '<label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">' + v.label + nota + '</label>' +
            '<input type="number" id="costo_' + v.key + '" class="input" value="' + (v.default || 0) + '" step="0.01" style="margin-bottom:0"' + ((daFic || daBuste) ? ' disabled' : '') + '>' +
            '</div>';
    });
    html += '<button class="btn btn-primary" onclick="doSaveCosti()" style="width:100%;margin-top:12px">Salva costi</button>';
    openModal('Costi mensili — ' + meseLabel(mese), html);
    loadCostiMese(mese).then(function(data) {
        if (!data) return;
        COSTI_VOCI.forEach(function(v) {
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
        var el = document.getElementById('costo_' + v.key);
        if (el && !el.disabled) data[v.key] = parseFloat(el.value) || 0;
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

// ── Storico: ricavi da fattureMese, costi da fattureMese (voci da fattura) + costiMensili ──
async function renderStoricoFinanziario() {
    var el = document.getElementById('rfTblStorico');
    try {
        var mesi = [];
        var now = new Date();
        for (var i = 0; i < 12; i++) {
            var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            mesi.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
        }
        var fmMap = {}, costiMap = {};
        (await db.collection('fattureMese').where('mese', '>=', mesi[mesi.length - 1]).get()).forEach(function(doc) { fmMap[doc.id] = doc.data(); });
        // costiMensili è riservata al superadmin: per gli altri lo storico mostra solo i ricavi
        try {
            (await db.collection('costiMensili').where('mese', '>=', mesi[mesi.length - 1]).get()).forEach(function(doc) { costiMap[doc.id] = doc.data(); });
        } catch (e) { console.warn('storico costi non leggibili:', e.message); }

        var html = '';
        mesi.forEach(function(m) {
            var fm = fmMap[m], costi = costiMap[m] || {};
            var tot = fm && fm.totali;
            if (!tot && !Object.keys(costi).length) {
                html += '<tr style="opacity:0.4"><td>' + meseLabel(m) + '</td><td colspan="4" style="text-align:center;color:var(--text-muted);font-size:12px">Nessun dato</td></tr>';
                return;
            }
            var perVoce = (tot && tot.costiPerVoce) || {};
            var haRicevute = !!(fm && fm.ricevuteDisponibili !== false && (fm.ricevute || []).length);
            var totC = 0;
            COSTI_VOCI.forEach(function(v) {
                if (v.daFattura && haRicevute && perVoce[v.key] !== undefined) totC += perVoce[v.key];
                else if (v.key === 'compensiDriver') totC += parseFloat(costi.compensiDriver) || 0;
                else totC += costi[v.key] !== undefined ? parseFloat(costi[v.key]) || 0 : (v.default || 0);
            });
            var ricavi = tot ? tot.ricaviImponibile : 0;
            var rev = ricavi - totC;
            html += '<tr' + (m === state.meseCorrente ? ' style="background:rgba(34,197,94,0.05)"' : '') + '><td>' + (m === state.meseCorrente ? '<strong>' + meseLabel(m) + '</strong>' : meseLabel(m)) + '</td>' +
                '<td style="text-align:right">' + (tot ? formatCurrency(ricavi) : '—') + '</td>' +
                '<td style="text-align:right">' + formatCurrency(totC) + '</td>' +
                '<td style="text-align:right;font-weight:700;color:' + (rev >= 0 ? 'var(--success)' : 'var(--danger)') + '">' + (tot ? formatCurrency(rev) : '—') + '</td>' +
                '<td style="text-align:right">' + (tot ? (tot.nEmesse || 0) + ' / ' + (tot.nRicevute || 0) : '—') + '</td></tr>';
        });
        el.innerHTML = html || '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">Nessun dato</td></tr>';
    } catch(e) {
        console.warn('storico:', e);
        el.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">Errore caricamento storico</td></tr>';
    }
}

// ── Buste paga: upload PDF in blocco → CF elaboraBustePaga (Claude legge il cedolino) ──
var CATEGORIA_BUSTA = { driver: 'Driver', rizzuto: 'Rizzuto', faro: 'Faro', ufficio: 'Ufficio / HR' };

async function renderBustePaga(mese, costiData) {
    var el = document.getElementById('rfTblBuste');
    if (!el) return;
    var riep = document.getElementById('rfBusteRiepilogo');
    try {
        var snap = await db.collection('bustePaga').where('mese', '==', mese).get();
        var buste = [];
        snap.forEach(function(d) { buste.push(Object.assign({ id: d.id }, d.data())); });
        buste.sort(function(a, b) { return (a.categoria + a.cognome).localeCompare(b.categoria + b.cognome); });
        var bp = costiData && costiData.bustePaga;
        if (riep) riep.textContent = bp && bp.n ? bp.n + ' cedolini · netti driver ' + formatCurrency(costiData.compensiDriver || 0) + ' · lordo totale ' + formatCurrency(bp.lordoTotale || 0) + (bp.costoAziendaTotale ? ' · costo azienda stampato ' + formatCurrency(bp.costoAziendaTotale) : '') : '';
        el.innerHTML = buste.map(function(b) {
            var avvisi = (b.avvisi || []).length ? '<div style="font-size:11px;color:var(--warning)">⚠️ ' + escapeHtml(b.avvisi.join(' · ')) + '</div>' : '';
            return '<tr>' +
                '<td><strong>' + escapeHtml((b.cognome + ' ' + b.nome).trim()) + '</strong><div style="font-size:11px;color:var(--text-light)">' + escapeHtml(b.codiceFiscale || '') + '</div>' + avvisi + '</td>' +
                '<td><span class="badge badge-info">' + (CATEGORIA_BUSTA[b.categoria] || b.categoria) + (b.citta ? ' · ' + escapeHtml(b.citta) : '') + '</span></td>' +
                '<td style="text-align:right"><strong>' + formatCurrency(b.netto) + '</strong></td>' +
                '<td style="text-align:right;color:var(--text-muted)">' + formatCurrency(b.lordo) + '</td>' +
                '<td style="text-align:right;color:var(--text-muted)">' + (b.costoAzienda ? formatCurrency(b.costoAzienda) : '—') + '</td>' +
                '<td><a href="#" onclick="rfApriBusta(\'' + escapeHtml(b.file) + '\');return false" title="Apri PDF">📄</a> ' +
                    '<button class="btn btn-sm btn-danger" title="Elimina cedolino" onclick="rfEliminaBusta(\'' + escapeHtml(b.id) + '\')">🗑️</button></td>' +
            '</tr>';
        }).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:24px">Nessuna busta paga caricata per ' + meseLabel(mese) + '</td></tr>';
    } catch (e) {
        console.warn('buste paga:', e);
        el.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">Errore caricamento buste paga</td></tr>';
    }
}

async function rfCaricaBuste(files) {
    var mese = state.meseCorrente;
    var lista = Array.prototype.slice.call(files || []).filter(function(f) { return /\.pdf$/i.test(f.name); });
    if (!lista.length) { toast('Seleziona uno o più PDF', 'error'); return; }
    var stato = document.getElementById('rfBusteStato');
    var input = document.getElementById('rfBusteFile');
    if (input) input.disabled = true;
    try {
        var paths = [];
        for (var i = 0; i < lista.length; i++) {
            if (stato) stato.textContent = 'Carico ' + (i + 1) + '/' + lista.length + ': ' + lista[i].name;
            var safe = lista[i].name.replace(/[^A-Za-z0-9._-]+/g, '_');
            var path = 'bustePaga/' + mese + '/' + Date.now() + '_' + safe;
            await firebase.storage().ref(path).put(lista[i], { contentType: 'application/pdf' });
            paths.push(path);
        }
        if (stato) stato.textContent = 'Lettura di ' + paths.length + ' cedolini in corso (circa ' + Math.ceil(paths.length * 12 / 60) + ' min)…';
        var out = await ficCall('elaboraBustePaga', { mese: mese, files: paths });
        var ok = out.esiti.filter(function(x) { return x.stato === 'ok'; }).length;
        var ko = out.esiti.filter(function(x) { return x.stato !== 'ok'; });
        if (stato) stato.innerHTML = ok + ' cedolini letti' + (ko.length ? ', <span style="color:var(--danger)">' + ko.length + ' non letti</span>: ' + ko.map(function(x) { return escapeHtml(x.file.split('/').pop() + ' (' + x.messaggio + ')'); }).join('; ') : '');
        toast(ok + ' buste paga elaborate', ko.length ? 'error' : 'success');
        await renderReportFinanziario();
    } catch (e) {
        if (stato) stato.textContent = 'Errore: ' + e.message;
        toast('Errore buste paga: ' + e.message, 'error');
    } finally {
        if (input) { input.disabled = false; input.value = ''; }
    }
}

async function rfApriBusta(path) {
    try { window.open(await firebase.storage().ref(path).getDownloadURL(), '_blank'); }
    catch (e) { toast('PDF non disponibile: ' + e.message, 'error'); }
}

async function rfEliminaBusta(id) {
    if (!confirm('Eliminare questo cedolino dal mese? Il PDF resta in archivio, i costi vengono ricalcolati.')) return;
    try {
        await db.collection('bustePaga').doc(id).delete();
        await ficCall('elaboraBustePaga', { mese: state.meseCorrente, files: [] });
        await renderReportFinanziario();
    } catch (e) { toast('Errore: ' + e.message, 'error'); }
}
