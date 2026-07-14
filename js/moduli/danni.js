// DELIVERY HUB v2 — Multe / Danni con rateizzazione, documenti e normalizzazione accenti

function normalizzaNome(s) {
    return (s || '').toUpperCase().trim()
        .replace(/[ÀÁÂÃ]/g,'A').replace(/[ÈÉÊË]/g,'E')
        .replace(/[ÌÍÎÏ]/g,'I').replace(/[ÒÓÔÕ]/g,'O')
        .replace(/[ÙÚÛÜ]/g,'U');
}

function renderDanni() {
    var tbody = document.getElementById('tblDanni');
    var sorted = state.danniList.slice().sort(function(a, b) {
        var da = a.data instanceof Date ? a.data : new Date(a.data);
        var db2 = b.data instanceof Date ? b.data : new Date(b.data);
        return db2 - da;
    });

    if (sorted.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:40px">Nessun danno registrato</td></tr>';
        return;
    }

    tbody.innerHTML = sorted.map(function(d) {
        var statoClass = d.stato === 'pagato' ? 'badge-ok' : d.stato === 'annullato' ? 'badge-err' : d.stato === 'in corso' ? 'badge-warn' : 'badge-warn';
        var rateInfo = '';
        if (d.numRate && d.numRate > 1) {
            var ratePagate = d.ratePagate || 0;
            rateInfo = '<br><span style="font-size:11px;color:var(--text-muted)">Rata ' + ratePagate + '/' + d.numRate + ' (€' + (d.importoRata || 0).toFixed(2) + '/mese)</span>';
        }
        var docsIcon = (d.documenti && d.documenti.length > 0) ? ' 📎' : '';

        return '<tr>' +
            '<td>' + formatDate(d.data) + '</td>' +
            '<td><strong>' + (d.driver || '—') + '</strong></td>' +
            '<td>' + (d.targa || '—') + '</td>' +
            '<td>' + (d.descrizione || '—') + docsIcon + '</td>' +
            '<td style="color:var(--danger)">' + formatCurrency(d.importo) + rateInfo + '</td>' +
            '<td><span class="badge ' + statoClass + '">' + (d.stato || 'aperto') + '</span></td>' +
            '<td>' +
                '<button class="btn btn-sm" onclick="dettaglioDanno(\'' + d.id + '\')" title="Dettaglio">👁️</button> ' +
                '<button class="btn btn-sm" onclick="editDanno(\'' + d.id + '\')" title="Modifica">✏️</button> ' +
                '<button class="btn btn-sm" onclick="changeDannoStato(\'' + d.id + '\')" title="Cambia stato">🔄</button>' +
            '</td>' +
        '</tr>';
    }).join('');
}

function openAddDanno() {
    var driverOpts = state.driverList
        .filter(function(d) { return d.attivo !== false; })
        .sort(function(a, b) { return (a.cognome || '').localeCompare(b.cognome || ''); })
        .map(function(d) { return '<option value="' + d.cognome + '">' + d.cognome + ' ' + d.nome + ' (' + d.citta + ')</option>'; })
        .join('');

    openModal('Registra danno',
        '<div class="form-group"><label>Data danno</label><input type="date" id="danData" class="input" value="' + new Date().toISOString().slice(0, 10) + '"></div>' +
        '<div class="form-group"><label>Driver responsabile</label>' +
            '<select id="danDriver" class="input"><option value="">Seleziona...</option>' + driverOpts + '</select></div>' +
        '<div class="form-group"><label>Targa furgone</label><input type="text" id="danTarga" class="input" placeholder="es. GS756LX" style="text-transform:uppercase"></div>' +
        '<div class="form-group"><label>Descrizione danno</label><textarea id="danDescrizione" class="input" rows="3" placeholder="Descrivi il danno..."></textarea></div>' +
        '<div class="form-group"><label>Importo totale danno (€)</label><input type="number" id="danImporto" class="input" step="0.01" placeholder="0.00"></div>' +

        '<div style="border-top:1px solid var(--border);margin:16px 0;padding-top:16px">' +
            '<div class="form-group"><label>Rateizzazione</label>' +
                '<select id="danRate" class="input" onchange="calcolaRata()">' +
                    '<option value="1">Pagamento unico</option>' +
                    '<option value="2">2 rate</option>' +
                    '<option value="3">3 rate</option>' +
                    '<option value="4">4 rate</option>' +
                    '<option value="5">5 rate</option>' +
                    '<option value="6">6 rate</option>' +
                '</select></div>' +
            '<div id="rataPreview" style="display:none;background:rgba(34,197,94,0.05);border:1px solid rgba(34,197,94,0.2);border-radius:8px;padding:12px;margin-bottom:16px">' +
                '<span style="font-size:13px;color:var(--text-muted)">Importo per rata: </span>' +
                '<strong id="rataImporto" style="color:var(--accent)">€0,00</strong>' +
                '<span id="rataDettaglio" style="font-size:12px;color:var(--text-light);display:block;margin-top:4px"></span>' +
            '</div>' +
        '</div>' +

        '<div style="border-top:1px solid var(--border);margin:16px 0;padding-top:16px">' +
            '<div class="form-group"><label>Tipo sinistro</label>' +
                '<select id="danTipoSinistro" class="input">' +
                    '<option value="franchigia">Franchigia assicurativa</option>' +
                    '<option value="carrozzeria">Riparazione carrozzeria</option>' +
                    '<option value="meccanica">Riparazione meccanica</option>' +
                    '<option value="multa">Multa</option>' +
                    '<option value="altro">Altro</option>' +
                '</select></div>' +
            '<div class="form-group"><label>Numero sinistro / riferimento (opzionale)</label><input type="text" id="danRifSinistro" class="input" placeholder="es. SIN-2026-001"></div>' +
            '<div class="form-group"><label>Documenti (fattura, foto, perizia)</label>' +
                '<input type="file" id="danFiles" class="input" multiple accept="image/*,.pdf" style="padding:10px">' +
                '<span style="font-size:11px;color:var(--text-light)">Foto danno, fattura carrozzeria, documentazione sinistro (max 5 file)</span>' +
            '</div>' +
        '</div>' +

        '<button class="btn btn-primary" id="btnSaveDanno" onclick="saveDanno()" style="width:100%;margin-top:8px">Registra danno</button>'
    );
}

function calcolaRata() {
    var importoEl = document.getElementById('danImporto');
    var rateEl = document.getElementById('danRate');
    var preview = document.getElementById('rataPreview');
    if (!importoEl || !rateEl || !preview) return;
    var importo = parseFloat(importoEl.value) || 0;
    var numRate = parseInt(rateEl.value) || 1;
    if (numRate > 1 && importo > 0) {
        var rata = Math.ceil((importo / numRate) * 100) / 100;
        preview.style.display = 'block';
        var rataEl2 = document.getElementById('rataImporto');
        if (rataEl2) rataEl2.textContent = formatCurrency(rata);
        var now = new Date();
        var mesi = [];
        var mn = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
        for (var i = 0; i < numRate; i++) {
            var d = new Date(now.getFullYear(), now.getMonth() + i, 1);
            mesi.push(mn[d.getMonth()] + ' ' + d.getFullYear());
        }
        var detEl = document.getElementById('rataDettaglio');
        if (detEl) detEl.textContent = 'Detratto da: ' + mesi.join(', ');
    } else {
        preview.style.display = 'none';
    }
}

document.addEventListener('input', function(e) {
    if (e.target.id === 'danImporto') calcolaRata();
});

async function saveDanno(editId) {
    var btn = document.getElementById('btnSaveDanno');
    if (btn && btn.disabled) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Salvataggio...'; }
    var importo = parseFloat(document.getElementById('danImporto').value) || 0;
    var numRate = parseInt(document.getElementById('danRate').value) || 1;
    var importoRata = numRate > 1 ? Math.ceil((importo / numRate) * 100) / 100 : importo;

    var pianoRate = [];
    var now = new Date();
    for (var i = 0; i < numRate; i++) {
        var d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        var meseRata = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        pianoRate.push({
            mese: meseRata,
            importo: (i === numRate - 1) ? (importo - importoRata * (numRate - 1)) : importoRata,
            pagato: false
        });
    }

    var data = {
        data: document.getElementById('danData').value,
        driver: document.getElementById('danDriver').value,
        targa: document.getElementById('danTarga').value.trim().toUpperCase(),
        descrizione: document.getElementById('danDescrizione').value.trim(),
        importo: importo,
        numRate: numRate,
        importoRata: importoRata,
        pianoRate: pianoRate,
        ratePagate: 0,
        tipoSinistro: document.getElementById('danTipoSinistro').value,
        rifSinistro: document.getElementById('danRifSinistro').value.trim(),
        stato: numRate > 1 ? 'in corso' : 'aperto',
        mese: document.getElementById('danData').value.substring(0, 7),
        documenti: [],
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    // driverEmail permette al driver di vedere le proprie multe nell'app
    // (le rules su danni consentono read-own solo via driverEmail)
    var drSel = state.driverList.find(function(dr) { return dr.cognome === data.driver; });
    data.driverEmail = drSel && drSel.email ? String(drSel.email).toLowerCase() : null;

    if (!data.driver) { toast('Seleziona il driver', 'error'); if (btn) { btn.disabled = false; btn.textContent = editId ? 'Aggiorna' : 'Registra danno'; } return; }
    if (!data.importo) { toast('Inserisci l\'importo', 'error'); if (btn) { btn.disabled = false; btn.textContent = editId ? 'Aggiorna' : 'Registra danno'; } return; }

    try {
        var fileInput = document.getElementById('danFiles');
        if (fileInput && fileInput.files.length > 0) {
            var files = fileInput.files;
            var maxFiles = Math.min(files.length, 5);
            var uploadFalliti = 0;
            for (var f = 0; f < maxFiles; f++) {
                var file = files[f];
                if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
                    toast('File "' + file.name + '" ignorato: solo immagini o PDF', 'warning');
                    continue;
                }
                if (file.size > 5 * 1024 * 1024) {
                    toast('File "' + file.name + '" ignorato: max 5MB', 'warning');
                    continue;
                }
                try {
                    var path = 'danni/' + Date.now() + '_' + file.name;
                    var ref = firebase.storage().ref(path);
                    await ref.put(file);
                    var url = await ref.getDownloadURL();
                    data.documenti.push({
                        nome: file.name,
                        url: url,
                        tipo: file.type,
                        path: path
                    });
                } catch (uploadErr) {
                    console.warn('Upload error:', uploadErr);
                    uploadFalliti++;
                }
            }
            if (uploadFalliti > 0) {
                toast(uploadFalliti + ' file non caricati — il danno è stato salvato senza quei documenti', 'warning');
            }
        }

        if (editId) {
            await db.collection('danni').doc(editId).update(data);
        } else {
            await db.collection('danni').add(data);
        }
        toast('Danno registrato' + (numRate > 1 ? ' (' + numRate + ' rate)' : ''), 'success');
        closeModal();
        await loadDanni();
        renderDanni();
    } catch (e) {
        toast('Errore: impossibile salvare il danno — riprova', 'error');
        console.error('saveDanno error:', e);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = editId ? 'Aggiorna' : 'Registra danno'; }
    }
}

function dettaglioDanno(id) {
    var d = state.danniList.find(function(x) { return x.id === id; });
    if (!d) return;

    var html = '<div style="margin-bottom:16px">' +
        '<div style="display:flex;justify-content:space-between;margin-bottom:8px"><span style="color:var(--text-muted)">Data</span><strong>' + formatDate(d.data) + '</strong></div>' +
        '<div style="display:flex;justify-content:space-between;margin-bottom:8px"><span style="color:var(--text-muted)">Driver</span><strong>' + (d.driver || '—') + '</strong></div>' +
        '<div style="display:flex;justify-content:space-between;margin-bottom:8px"><span style="color:var(--text-muted)">Targa</span><strong>' + (d.targa || '—') + '</strong></div>' +
        '<div style="display:flex;justify-content:space-between;margin-bottom:8px"><span style="color:var(--text-muted)">Tipo</span><strong>' + (d.tipoSinistro || '—') + '</strong></div>' +
        '<div style="display:flex;justify-content:space-between;margin-bottom:8px"><span style="color:var(--text-muted)">Rif. sinistro</span><strong>' + (d.rifSinistro || '—') + '</strong></div>' +
        '<div style="display:flex;justify-content:space-between;margin-bottom:8px"><span style="color:var(--text-muted)">Importo totale</span><strong style="color:var(--danger)">' + formatCurrency(d.importo) + '</strong></div>' +
        '<div style="display:flex;justify-content:space-between;margin-bottom:8px"><span style="color:var(--text-muted)">Stato</span><strong>' + (d.stato || 'aperto') + '</strong></div>' +
    '</div>';

    if (d.descrizione) {
        html += '<div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:16px">' +
            '<div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">DESCRIZIONE</div>' +
            '<div style="font-size:13px">' + d.descrizione + '</div></div>';
    }

    if (d.numRate && d.numRate > 1 && d.pianoRate) {
        html += '<div style="border-top:1px solid var(--border);padding-top:16px;margin-bottom:16px">' +
            '<div style="font-size:13px;font-weight:700;margin-bottom:8px">Piano rateizzazione (' + d.numRate + ' rate)</div>';

        var mn = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
        d.pianoRate.forEach(function(rata, i) {
            var parts = rata.mese.split('-');
            var meseLabel = mn[parseInt(parts[1]) - 1] + ' ' + parts[0];
            var isPagato = rata.pagato;
            html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">' +
                '<span>Rata ' + (i + 1) + ' — ' + meseLabel + '</span>' +
                '<span style="display:flex;align-items:center;gap:8px">' +
                    '<strong>' + formatCurrency(rata.importo) + '</strong>' +
                    '<span class="badge ' + (isPagato ? 'badge-ok' : 'badge-warn') + '">' + (isPagato ? 'Detratta' : 'Pendente') + '</span>' +
                '</span></div>';
        });
        html += '</div>';
    }

    if (d.documenti && d.documenti.length > 0) {
        html += '<div style="border-top:1px solid var(--border);padding-top:16px">' +
            '<div style="font-size:13px;font-weight:700;margin-bottom:8px">Documenti allegati</div>';
        d.documenti.forEach(function(doc) {
            var icon = doc.tipo && doc.tipo.indexOf('image') >= 0 ? '🖼️' : '📄';
            html += '<a href="' + doc.url + '" target="_blank" style="display:flex;align-items:center;gap:8px;padding:8px;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px;margin-bottom:6px;text-decoration:none;color:var(--text)">' +
                icon + ' <span style="flex:1;font-size:13px">' + doc.nome + '</span><span style="font-size:11px;color:var(--accent)">Apri</span></a>';
        });
        html += '</div>';
    }

    openModal('Dettaglio danno — ' + (d.driver || ''), html);
}

async function editDanno(id) {
    var d = state.danniList.find(function(x) { return x.id === id; });
    if (!d) return;

    var driverOpts = state.driverList
        .filter(function(dr) { return dr.attivo !== false; })
        .map(function(dr) { return '<option value="' + dr.cognome + '" ' + (d.driver === dr.cognome ? 'selected' : '') + '>' + dr.cognome + ' ' + dr.nome + '</option>'; })
        .join('');

    var dataVal = d.data instanceof Date ? d.data.toISOString().slice(0, 10) : (d.data || '').substring(0, 10);

    var tipoOpts = ['franchigia', 'carrozzeria', 'meccanica', 'multa', 'altro'].map(function(t) {
        return '<option value="' + t + '" ' + (d.tipoSinistro === t ? 'selected' : '') + '>' + t.charAt(0).toUpperCase() + t.slice(1) + '</option>';
    }).join('');

    openModal('Modifica danno',
        '<div class="form-group"><label>Data</label><input type="date" id="danData" class="input" value="' + dataVal + '"></div>' +
        '<div class="form-group"><label>Driver</label><select id="danDriver" class="input">' + driverOpts + '</select></div>' +
        '<div class="form-group"><label>Targa</label><input type="text" id="danTarga" class="input" value="' + (d.targa || '') + '" style="text-transform:uppercase"></div>' +
        '<div class="form-group"><label>Descrizione</label><textarea id="danDescrizione" class="input" rows="3">' + (d.descrizione || '') + '</textarea></div>' +
        '<div class="form-group"><label>Importo (€)</label><input type="number" id="danImporto" class="input" value="' + (d.importo || 0) + '" step="0.01"></div>' +
        '<div class="form-group"><label>Rate</label><select id="danRate" class="input">' +
            [1,2,3,4,5,6].map(function(n) { return '<option value="' + n + '" ' + (d.numRate === n ? 'selected' : '') + '>' + (n === 1 ? 'Pagamento unico' : n + ' rate') + '</option>'; }).join('') +
        '</select></div>' +
        '<div id="rataPreview" style="display:none"></div>' +
        '<div class="form-group"><label>Tipo sinistro</label><select id="danTipoSinistro" class="input">' + tipoOpts + '</select></div>' +
        '<div class="form-group"><label>Rif. sinistro</label><input type="text" id="danRifSinistro" class="input" value="' + (d.rifSinistro || '') + '"></div>' +
        '<div class="form-group"><label>Aggiungi documenti</label><input type="file" id="danFiles" class="input" multiple accept="image/*,.pdf" style="padding:10px"></div>' +
        '<button class="btn btn-primary" id="btnSaveDanno" onclick="saveDanno(\'' + id + '\')" style="width:100%;margin-top:8px">Aggiorna</button>'
    );
    calcolaRata();
}

async function changeDannoStato(id) {
    var d = state.danniList.find(function(x) { return x.id === id; });
    if (!d) return;
    var stati = ['aperto', 'in corso', 'pagato', 'annullato'];
    var currentIdx = stati.indexOf(d.stato || 'aperto');
    var newStato = stati[(currentIdx + 1) % stati.length];
    if (!confirm('Cambia stato da "' + (d.stato || 'aperto') + '" a "' + newStato + '"?')) return;
    try {
        await db.collection('danni').doc(id).update({ stato: newStato });
        toast('Stato aggiornato: ' + newStato, 'success');
        await loadDanni();
        renderDanni();
    } catch (e) {
        toast('Errore: impossibile aggiornare lo stato del danno', 'error');
        console.error('changeDannoStato error:', e);
    }
}

function calcolaDanniMese(driverName, mese) {
    var totale = 0;
    var nomeNorm = normalizzaNome(driverName);
    state.danniList.forEach(function(d) {
        if (d.stato === 'annullato') return;
        var drvNorm = normalizzaNome(d.driver);
        if (drvNorm !== nomeNorm) return;

        if (d.numRate && d.numRate > 1) {
            if (d.pianoRate && d.pianoRate.length > 0) {
                d.pianoRate.forEach(function(rata) {
                    if (rata.mese === mese && !rata.pagato) {
                        totale += rata.importo;
                    }
                });
            }
            // pianoRate assente o vuoto: danno rateizzato senza piano → non si detrae nulla
            // (evita di addebitare l'importo intero in un solo mese)
        } else {
            var meseDanno = d.mese || (d.data ? d.data.substring(0, 7) : '');
            if (meseDanno === mese) {
                totale += (d.importo || 0);
            }
        }
    });
    return totale;
}
