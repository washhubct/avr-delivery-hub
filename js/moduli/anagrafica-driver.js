// DELIVERY HUB v2 — Anagrafica Driver

function renderAnagraficaDriver() {
    var filterCitta = document.getElementById('filterDriverCitta') ? document.getElementById('filterDriverCitta').value : '';
    var tbody = document.getElementById('tblAnagraficaDriver');
    var list = state.driverList;
    if (filterCitta) list = list.filter(function(d) { return d.citta === filterCitta; });

    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:40px">Nessun driver trovato.</td></tr>';
        return;
    }
    var sorted = list.slice().sort(function(a, b) {
        var cmp = (a.citta || '').localeCompare(b.citta || '');
        if (cmp !== 0) return cmp;
        return (a.cognome || '').localeCompare(b.cognome || '');
    });
    tbody.innerHTML = sorted.map(function(d) {
        return '<tr>' +
            '<td><strong>' + d.cognome + '</strong></td>' +
            '<td>' + d.nome + '</td>' +
            '<td><span class="badge badge-info">' + d.citta + '</span></td>' +
            '<td>' + (d.contratto || '—') + '</td>' +
            '<td>€' + (d.costoConsegna || state.costoPerConsegna).toFixed(2) + '</td>' +
            '<td><span class="badge ' + (d.attivo !== false ? 'badge-ok' : 'badge-err') + '">' + (d.attivo !== false ? 'Attivo' : 'Inattivo') + '</span></td>' +
            '<td>' +
                '<button class="btn btn-sm" onclick="editDriver(\'' + d.id + '\')">✏️</button> ' +
                '<button class="btn btn-sm btn-danger" onclick="toggleDriverAttivo(\'' + d.id + '\')">⏸️</button>' +
            '</td>' +
        '</tr>';
    }).join('');
}

function openAddDriver() {
    openModal('Aggiungi driver', 
        '<div class="form-group"><label>Cognome</label><input type="text" id="drCognome" class="input"></div>' +
        '<div class="form-group"><label>Nome</label><input type="text" id="drNome" class="input"></div>' +
        '<div class="form-group"><label>Città</label>' +
            '<select id="drCitta" class="input">' +
                '<option value="CT">Catania</option><option value="ME">Messina</option>' +
                '<option value="EN">Enna</option><option value="SR">Siracusa</option><option value="PA">Palermo</option>' +
            '</select></div>' +
        '<div class="form-group"><label>Tipo contratto</label>' +
            '<select id="drContratto" class="input">' +
                '<option value="CO.CO.CO">CO.CO.CO</option><option value="P.O.">P.O.</option>' +
                '<option value="Dipendente">Dipendente</option>' +
            '</select></div>' +
        '<div class="form-group"><label>€ per consegna</label><input type="number" id="drCosto" class="input" value="3.50" step="0.10"></div>' +
        '<div class="form-group"><label>Email (per accesso driver app)</label><input type="email" id="drEmail" class="input" placeholder="opzionale"></div>' +
        '<button class="btn btn-primary" onclick="saveDriver()" style="width:100%;margin-top:8px">Salva</button>'
    );
}

async function saveDriver(editId) {
    var data = {
        cognome: document.getElementById('drCognome').value.trim().toUpperCase(),
        nome: document.getElementById('drNome').value.trim(),
        citta: document.getElementById('drCitta').value,
        contratto: document.getElementById('drContratto').value,
        costoConsegna: parseFloat(document.getElementById('drCosto').value) || 3.50,
        email: document.getElementById('drEmail') ? document.getElementById('drEmail').value.trim().toLowerCase() : null,
        attivo: true,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (!data.cognome) { toast('Inserisci il cognome', 'error'); return; }
    if (!data.email) data.email = null;
    try {
        if (editId) {
            await db.collection('driverAnagrafica').doc(editId).update(data);
        } else {
            await db.collection('driverAnagrafica').add(data);
        }
        toast('Driver salvato', 'success');
        closeModal();
        await loadDriverAnagrafica();
        renderAnagraficaDriver();
    } catch (e) { toast('Errore: ' + e.message, 'error'); }
}

async function editDriver(id) {
    var d = state.driverList.find(function(x) { return x.id === id; });
    if (!d) return;
    var aree = ['CT','ME','EN','SR','PA'];
    var contratti = ['CO.CO.CO','P.O.','Dipendente'];

    var areaOptions = aree.map(function(a) {
        return '<option value="' + a + '" ' + (d.citta === a ? 'selected' : '') + '>' + (state.aree[a] ? state.aree[a].nome : a) + '</option>';
    }).join('');

    var contrattoOptions = contratti.map(function(c) {
        return '<option ' + (d.contratto === c ? 'selected' : '') + '>' + c + '</option>';
    }).join('');

    openModal('Modifica driver', 
        '<div class="form-group"><label>Cognome</label><input type="text" id="drCognome" class="input" value="' + d.cognome + '"></div>' +
        '<div class="form-group"><label>Nome</label><input type="text" id="drNome" class="input" value="' + d.nome + '"></div>' +
        '<div class="form-group"><label>Città</label><select id="drCitta" class="input">' + areaOptions + '</select></div>' +
        '<div class="form-group"><label>Tipo contratto</label><select id="drContratto" class="input">' + contrattoOptions + '</select></div>' +
        '<div class="form-group"><label>€ per consegna</label><input type="number" id="drCosto" class="input" value="' + (d.costoConsegna || 3.50) + '" step="0.10"></div>' +
        '<div class="form-group"><label>Email</label><input type="email" id="drEmail" class="input" value="' + (d.email || '') + '"></div>' +
        '<button class="btn btn-primary" onclick="saveDriver(\'' + id + '\')" style="width:100%;margin-top:8px">Aggiorna</button>'
    );
}

async function toggleDriverAttivo(id) {
    var d = state.driverList.find(function(x) { return x.id === id; });
    if (!d) return;
    var newState = d.attivo === false ? true : false;
    await db.collection('driverAnagrafica').doc(id).update({ attivo: newState });
    toast('Driver ' + (newState ? 'attivato' : 'disattivato'), 'success');
    await loadDriverAnagrafica();
    renderAnagraficaDriver();
}
