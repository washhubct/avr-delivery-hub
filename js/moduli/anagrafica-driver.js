// DELIVERY HUB v2 — Anagrafica Driver (con ricerca)

function renderAnagraficaDriver() {
    const tbody = document.getElementById('tblAnagraficaDriver');
    if (state.driverList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:40px">Nessun driver. Clicca "Popola driver" per caricare la lista preconfigurata.</td></tr>';
        return;
    }

    var searchTerm = document.getElementById('searchAnagrafica') ? document.getElementById('searchAnagrafica').value.toUpperCase().trim() : '';

    var sorted = [...state.driverList].sort((a,b) => (a.citta||'').localeCompare(b.citta||'') || (a.cognome||'').localeCompare(b.cognome||''));

    if (searchTerm) {
        sorted = sorted.filter(function(d) {
            var full = ((d.cognome || '') + ' ' + (d.nome || '')).toUpperCase();
            return full.indexOf(searchTerm) >= 0;
        });
    }

    if (sorted.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:40px">Nessun risultato per "' + searchTerm + '"</td></tr>';
        return;
    }

    tbody.innerHTML = sorted.map(d => `<tr>
        <td><strong>${d.cognome}</strong></td>
        <td>${d.nome}</td>
        <td><span class="badge badge-info">${d.citta}</span></td>
        <td>${d.contratto || '—'}</td>
        <td>€${(d.costoConsegna || state.costoPerConsegna).toFixed(2)}</td>
        <td><span class="badge ${d.attivo !== false ? 'badge-ok' : 'badge-err'}">${d.attivo !== false ? 'Attivo' : 'Inattivo'}</span></td>
        <td>
            <button class="btn btn-sm" onclick="editDriver('${d.id}')">✏️</button>
            <button class="btn btn-sm btn-danger" onclick="toggleDriverAttivo('${d.id}')">⏸️</button>
        </td>
    </tr>`).join('');
}

function openAddDriver() {
    openModal('Aggiungi driver', `
        <div class="form-group"><label>Cognome</label><input type="text" id="drCognome" class="input"></div>
        <div class="form-group"><label>Nome</label><input type="text" id="drNome" class="input"></div>
        <div class="form-group"><label>Città</label>
            <select id="drCitta" class="input">
                <option value="CT">Catania</option><option value="ME">Messina</option>
                <option value="EN">Enna</option><option value="SR">Siracusa</option><option value="PA">Palermo</option>
            </select>
        </div>
        <div class="form-group"><label>Tipo contratto</label>
            <select id="drContratto" class="input">
                <option value="CO.CO.CO">CO.CO.CO</option><option value="P.O.">P.O.</option>
                <option value="Dipendente">Dipendente</option>
            </select>
        </div>
        <div class="form-group"><label>€ per consegna</label><input type="number" id="drCosto" class="input" value="3.50" step="0.10"></div>
        <div class="form-group"><label>Email (per accesso driver app)</label><input type="email" id="drEmail" class="input" placeholder="opzionale"></div>
        <button class="btn btn-primary" onclick="saveDriver()" style="width:100%;margin-top:8px">Salva</button>
    `);
}

async function saveDriver(editId) {
    const data = {
        cognome: document.getElementById('drCognome').value.trim().toUpperCase(),
        nome: document.getElementById('drNome').value.trim(),
        citta: document.getElementById('drCitta').value,
        contratto: document.getElementById('drContratto').value,
        costoConsegna: parseFloat(document.getElementById('drCosto').value) || 3.50,
        email: document.getElementById('drEmail')?.value.trim().toLowerCase() || null,
        attivo: true,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (!data.cognome) { toast('Inserisci il cognome', 'error'); return; }
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
    const d = state.driverList.find(x => x.id === id);
    if (!d) return;
    openModal('Modifica driver', `
        <div class="form-group"><label>Cognome</label><input type="text" id="drCognome" class="input" value="${d.cognome}"></div>
        <div class="form-group"><label>Nome</label><input type="text" id="drNome" class="input" value="${d.nome}"></div>
        <div class="form-group"><label>Città</label>
            <select id="drCitta" class="input">
                ${['CT','ME','EN','SR','PA'].map(a => `<option value="${a}" ${d.citta===a?'selected':''}>${state.aree[a]?.nome||a}</option>`).join('')}
            </select>
        </div>
        <div class="form-group"><label>Tipo contratto</label>
            <select id="drContratto" class="input">
                ${['CO.CO.CO','P.O.','Dipendente'].map(c => `<option ${d.contratto===c?'selected':''}>${c}</option>`).join('')}
            </select>
        </div>
        <div class="form-group"><label>€ per consegna</label><input type="number" id="drCosto" class="input" value="${d.costoConsegna||3.50}" step="0.10"></div>
        <div class="form-group"><label>Email</label><input type="email" id="drEmail" class="input" value="${d.email||''}"></div>
        <button class="btn btn-primary" onclick="saveDriver('${id}')" style="width:100%;margin-top:8px">Aggiorna</button>
    `);
}

async function toggleDriverAttivo(id) {
    const d = state.driverList.find(x => x.id === id);
    if (!d) return;
    const newState = d.attivo === false ? true : false;
    await db.collection('driverAnagrafica').doc(id).update({ attivo: newState });
    toast(`Driver ${newState ? 'attivato' : 'disattivato'}`, 'success');
    await loadDriverAnagrafica();
    renderAnagraficaDriver();
}

// Popola driver da lista precaricata
async function popolaDriver() {
    if (state.driverList.length > 0) {
        if (!confirm('Ci sono già driver in anagrafica. Vuoi aggiungere quelli mancanti?')) return;
    }
    const existing = state.driverList.map(d => `${d.cognome}_${d.nome}`);
    let added = 0;
    for (const d of state.driverPreload) {
        const key = `${d.cognome}_${d.nome}`;
        if (existing.includes(key)) continue;
        await db.collection('driverAnagrafica').add({
            ...d,
            costoConsegna: 3.50,
            attivo: true,
            email: null,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        added++;
    }
    toast(`${added} driver aggiunti`, 'success');
    await loadDriverAnagrafica();
    renderAnagraficaDriver();
}
