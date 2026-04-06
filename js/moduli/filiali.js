// DELIVERY HUB v2 — Filiali with Sheet link management

function renderFiliali() {
    const tbody = document.getElementById('tblFilialiBody');
    if (state.filiali.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:40px">Nessuna filiale. Importa dati o aggiungi manualmente.</td></tr>';
        return;
    }
    const sorted = [...state.filiali].sort((a,b) => (a.area||'').localeCompare(b.area||'') || (a.codice||0) - (b.codice||0));
    tbody.innerHTML = sorted.map(f => `<tr>
        <td><strong>${f.codice}</strong></td>
        <td>${f.nome || '—'}</td>
        <td><span class="badge badge-info">${f.area || '—'}</span></td>
        <td>${f.gruppo || '—'}</td>
        <td>${f.sheetLink ? '<span class="badge badge-ok">Collegato</span>' : '<span class="badge badge-warn">Mancante</span>'}</td>
        <td>
            <button class="btn btn-sm" onclick="editFiliale('${f.id || f.codice}')">✏️</button>
        </td>
    </tr>`).join('');
}

function openAddFiliale() {
    openModal('Aggiungi filiale', `
        <div class="form-group"><label>Codice filiale</label><input type="number" id="fCodice" class="input" placeholder="es. 528"></div>
        <div class="form-group"><label>Nome</label><input type="text" id="fNome" class="input" placeholder="es. Decò Siracusa Centro"></div>
        <div class="form-group"><label>Area</label>
            <select id="fArea" class="input">
                <option value="CT">CT — Catania</option><option value="ME">ME — Messina</option>
                <option value="EN">EN — Enna</option><option value="SR">SR — Siracusa</option><option value="PA">PA — Palermo</option>
            </select>
        </div>
        <div class="form-group"><label>Gruppo</label>
            <select id="fGruppo" class="input">
                <option value="Fratelli Arena">Fratelli Arena</option><option value="Palermo Retail">Palermo Retail</option>
            </select>
        </div>
        <div class="form-group"><label>Link Google Sheet</label><input type="url" id="fSheetLink" class="input" placeholder="https://docs.google.com/spreadsheets/d/..."></div>
        <button class="btn btn-primary" onclick="saveFiliale()" style="width:100%;margin-top:8px">Salva</button>
    `);
}

async function saveFiliale(editId) {
    const codice = document.getElementById('fCodice').value.trim();
    const data = {
        codice: parseInt(codice) || codice,
        nome: document.getElementById('fNome').value.trim(),
        area: document.getElementById('fArea').value,
        provincia: document.getElementById('fArea').value,
        gruppo: document.getElementById('fGruppo').value,
        sheetLink: document.getElementById('fSheetLink')?.value.trim() || null,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (!codice) { toast('Inserisci il codice', 'error'); return; }
    try {
        await db.collection('filiali').doc(String(codice)).set(data, { merge: true });
        toast('Filiale salvata', 'success');
        closeModal();
        await loadFiliali();
        renderFiliali();
    } catch (e) { toast('Errore: ' + e.message, 'error'); }
}

async function editFiliale(id) {
    const f = state.filiali.find(x => (x.id || String(x.codice)) === String(id));
    if (!f) return;
    openModal('Modifica filiale ' + f.codice, `
        <div class="form-group"><label>Codice</label><input type="number" id="fCodice" class="input" value="${f.codice}" readonly style="opacity:0.6"></div>
        <div class="form-group"><label>Nome</label><input type="text" id="fNome" class="input" value="${f.nome || ''}"></div>
        <div class="form-group"><label>Area</label>
            <select id="fArea" class="input">
                ${['CT','ME','EN','SR','PA'].map(a => `<option value="${a}" ${f.area===a?'selected':''}>${a}</option>`).join('')}
            </select>
        </div>
        <div class="form-group"><label>Gruppo</label>
            <select id="fGruppo" class="input">
                ${['Fratelli Arena','Palermo Retail'].map(g => `<option ${f.gruppo===g?'selected':''}>${g}</option>`).join('')}
            </select>
        </div>
        <div class="form-group"><label>Link Google Sheet</label><input type="url" id="fSheetLink" class="input" value="${f.sheetLink || ''}" placeholder="https://docs.google.com/..."></div>
        <button class="btn btn-primary" onclick="saveFiliale('${id}')" style="width:100%;margin-top:8px">Aggiorna</button>
    `);
}
