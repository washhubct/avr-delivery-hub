// DELIVERY HUB — Filiali Module

function renderFiliali() {
    const tbody = document.getElementById('tblFilialiBody');
    
    if (state.filiali.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">Nessuna filiale configurata. Importa un file per generare automaticamente l\'anagrafica.</td></tr>';
        return;
    }

    const sorted = [...state.filiali].sort((a, b) => {
        if (a.area !== b.area) return (a.area || '').localeCompare(b.area || '');
        return (a.codice || 0) - (b.codice || 0);
    });

    tbody.innerHTML = sorted.map(f => `
        <tr>
            <td><strong>${f.codice}</strong></td>
            <td>${f.nome || '—'}</td>
            <td><span class="badge badge-info">${f.area || '—'}</span></td>
            <td>${f.provincia || '—'}</td>
            <td>${f.gruppo || '—'}</td>
            <td>
                <button class="btn btn-sm" onclick="editFiliale('${f.id || f.codice}')">✏️</button>
                <button class="btn btn-sm btn-danger" onclick="deleteFiliale('${f.id || f.codice}')">🗑️</button>
            </td>
        </tr>
    `).join('');
}

function openAddFiliale() {
    openModal('Aggiungi filiale', `
        <div class="form-group">
            <label>Codice filiale</label>
            <input type="number" id="fCodice" class="input" placeholder="es. 528">
        </div>
        <div class="form-group">
            <label>Nome / Descrizione</label>
            <input type="text" id="fNome" class="input" placeholder="es. Decò Siracusa Centro">
        </div>
        <div class="form-group">
            <label>Area (provincia)</label>
            <select id="fArea" class="input">
                <option value="CT">CT — Catania</option>
                <option value="ME">ME — Messina</option>
                <option value="EN">EN — Enna</option>
                <option value="SR">SR — Siracusa</option>
                <option value="PA">PA — Palermo</option>
            </select>
        </div>
        <div class="form-group">
            <label>Gruppo</label>
            <select id="fGruppo" class="input">
                <option value="Fratelli Arena">Fratelli Arena</option>
                <option value="Palermo Retail">Palermo Retail</option>
            </select>
        </div>
        <button class="btn btn-primary" onclick="saveFiliale()" style="width:100%;margin-top:8px">Salva</button>
    `);
}

async function saveFiliale() {
    const codice = document.getElementById('fCodice').value.trim();
    const nome = document.getElementById('fNome').value.trim();
    const area = document.getElementById('fArea').value;
    const gruppo = document.getElementById('fGruppo').value;

    if (!codice) {
        toast('Inserisci il codice filiale', 'error');
        return;
    }

    const data = {
        codice: parseInt(codice),
        nome,
        area,
        provincia: area,
        gruppo,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
        await db.collection(COLLECTIONS.filiali).doc(String(codice)).set(data, { merge: true });
        toast('Filiale salvata', 'success');
        closeModal();
        await loadFiliali();
        renderFiliali();
    } catch (err) {
        console.error('Save filiale error:', err);
        toast('Errore nel salvataggio: ' + err.message, 'error');
    }
}

function editFiliale(id) {
    const f = state.filiali.find(x => (x.id || String(x.codice)) === String(id));
    if (!f) return;

    openModal('Modifica filiale ' + f.codice, `
        <div class="form-group">
            <label>Codice filiale</label>
            <input type="number" id="fCodice" class="input" value="${f.codice}" readonly style="opacity:0.6">
        </div>
        <div class="form-group">
            <label>Nome / Descrizione</label>
            <input type="text" id="fNome" class="input" value="${f.nome || ''}">
        </div>
        <div class="form-group">
            <label>Area (provincia)</label>
            <select id="fArea" class="input">
                <option value="CT" ${f.area==='CT'?'selected':''}>CT — Catania</option>
                <option value="ME" ${f.area==='ME'?'selected':''}>ME — Messina</option>
                <option value="EN" ${f.area==='EN'?'selected':''}>EN — Enna</option>
                <option value="SR" ${f.area==='SR'?'selected':''}>SR — Siracusa</option>
                <option value="PA" ${f.area==='PA'?'selected':''}>PA — Palermo</option>
            </select>
        </div>
        <div class="form-group">
            <label>Gruppo</label>
            <select id="fGruppo" class="input">
                <option value="Fratelli Arena" ${f.gruppo==='Fratelli Arena'?'selected':''}>Fratelli Arena</option>
                <option value="Palermo Retail" ${f.gruppo==='Palermo Retail'?'selected':''}>Palermo Retail</option>
            </select>
        </div>
        <button class="btn btn-primary" onclick="saveFiliale()" style="width:100%;margin-top:8px">Aggiorna</button>
    `);
}

async function deleteFiliale(id) {
    if (!confirm('Eliminare questa filiale?')) return;
    try {
        await db.collection(COLLECTIONS.filiali).doc(String(id)).delete();
        toast('Filiale eliminata', 'success');
        await loadFiliali();
        renderFiliali();
    } catch (err) {
        toast('Errore: ' + err.message, 'error');
    }
}
