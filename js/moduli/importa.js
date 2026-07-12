// DELIVERY HUB — Import Module
// Handles xlsx import from filiale sheets and Decò reconciliation files

// ── Drag & drop setup ──
document.addEventListener('DOMContentLoaded', () => {
    setupDropZone('importZone', 'importFile');
    setupDropZone('importDecoZone', 'importDecFile');
});

function setupDropZone(zoneId, inputId) {
    const zone = document.getElementById(zoneId);
    if (!zone) return;

    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.classList.remove('dragover');
        const input = document.getElementById(inputId);
        if (inputId === 'importFile') handleImportFiles(e.dataTransfer.files);
        else handleImportDeco(e.dataTransfer.files);
    });
    zone.addEventListener('click', () => document.getElementById(inputId).click());
}

// ══════════════════════════════════════════════
// IMPORT FILE FILIALE (Google Sheet esportato)
// ══════════════════════════════════════════════

async function handleImportFiles(files) {
    if (!files || files.length === 0) return;

    const logEl = document.getElementById('importLog');
    const progressEl = document.getElementById('importProgress');
    const statusEl = document.getElementById('importStatus');
    const fillEl = document.getElementById('importProgressFill');

    logEl.style.display = 'block';
    progressEl.style.display = 'block';
    logEl.textContent = '';
    let totalImported = 0;

    for (let fi = 0; fi < files.length; fi++) {
        const file = files[fi];
        logEl.textContent += `\n📂 Apro file: ${file.name}\n`;
        statusEl.textContent = `Elaboro ${file.name}...`;
        fillEl.style.width = `${((fi) / files.length) * 100}%`;

        try {
            const data = await readFileAsArrayBuffer(file);
            const wb = XLSX.read(data, { type: 'array', cellDates: true });

            logEl.textContent += `   Sheet trovati: ${wb.SheetNames.join(', ')}\n`;

            // Process each monthly sheet
            const monthSheets = wb.SheetNames.filter(isMonthlySheet);
            logEl.textContent += `   Sheet mensili riconosciuti: ${monthSheets.join(', ')}\n`;

            for (const sheetName of monthSheets) {
                const ws = wb.Sheets[sheetName];
                const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false, dateNF: 'yyyy-mm-dd' });
                
                if (rows.length < 2) continue;

                // Find header row
                const { headerIdx, colMap } = detectColumns(rows);
                if (headerIdx < 0) {
                    logEl.textContent += `   ⚠️ ${sheetName}: struttura non riconosciuta, skip\n`;
                    continue;
                }

                const consegne = [];
                let ritorniSkippati = 0;
                for (let i = headerIdx + 1; i < rows.length; i++) {
                    const row = rows[i];
                    if (!row || row.length === 0) continue;

                    const filiale = getVal(row, colMap.filiale);
                    const data = getVal(row, colMap.data);
                    const cognome = getVal(row, colMap.cognome);
                    const importo = parseFloat(getVal(row, colMap.importo)) || 0;
                    const consegnata = getVal(row, colMap.consegnata);

                    // Skip empty/invalid rows
                    if (!filiale && !cognome) continue;
                    if (!data) continue;

                    // I RITORNI annotati nei fogli filiale NON sono consegne:
                    // vengono fatturati a parte (modulo Ritorni, da app driver).
                    // Importarli gonfierebbe la fattura consegne.
                    const richiesta = (getVal(row, colMap.richiesta) || '').toUpperCase();
                    const targaRaw = (getVal(row, colMap.targa) || '').toUpperCase();
                    if (richiesta.includes('RITORNO') || targaRaw === 'RITORNO') {
                        ritorniSkippati++;
                        continue;
                    }

                    // Parse date
                    let dateObj = parseExcelDate(data);
                    if (!dateObj) continue;

                    const record = {
                        filiale: String(filiale || '').replace(/\.0$/, ''),
                        data: dateObj,
                        mese: meseFromDate(dateObj),
                        cliente: [getVal(row, colMap.cognome), getVal(row, colMap.nome)].filter(Boolean).join(' ').trim() || null,
                        provincia: getVal(row, colMap.provincia) || null,
                        citta: getVal(row, colMap.citta) || null,
                        indirizzo: getVal(row, colMap.indirizzo) || null,
                        importo: importo,
                        fascia: getVal(row, colMap.fascia) || getVal(row, colMap.oraConsegna) || null,
                        driver: getVal(row, colMap.driver) || null,
                        targa: getVal(row, colMap.targa) || null,
                        consegnata: (consegnata || '').toUpperCase() === 'SI',
                        // Esplicitamente marcata NON consegnata (≠ colonna assente)
                        nonConsegnata: (consegnata || '').toUpperCase() === 'NO',
                        // PRESTAZIONE (AVR/INTERNA) dal foglio filiale: fonte
                        // autoritativa per la classificazione in fattura
                        prestazione: getVal(row, colMap.prestazione) || null,
                        orderId: getVal(row, colMap.orderId) || null,
                        pagamento: getVal(row, colMap.pagamento) || null,
                        codiceDomicilio: getVal(row, colMap.codiceDom) || null,
                        fonte: file.name,
                        sheetName: sheetName
                    };

                    // Determine area from provincia
                    record.area = areaFromProvincia(record.provincia);

                    consegne.push(record);
                }

                logEl.textContent += `   ✅ ${sheetName}: ${consegne.length} consegne estratte` + (ritorniSkippati > 0 ? ` (${ritorniSkippati} ritorni esclusi — fatturati a parte)` : '') + `\n`;

                // Save to Firestore in batches
                if (consegne.length > 0) {
                    await saveConsegneBatch(consegne);
                    totalImported += consegne.length;

                    // Also update local state
                    state.consegne.push(...consegne);
                }
            }

            // Also process special sheets: SUSHI, NATALE, etc.
            const specialSheets = wb.SheetNames.filter(s => 
                s.toUpperCase().includes('SUSHI') || 
                s.toUpperCase().includes('NATALE')
            );
            for (const sheetName of specialSheets) {
                const ws = wb.Sheets[sheetName];
                const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false });
                const { headerIdx, colMap } = detectColumns(rows);
                if (headerIdx < 0) continue;

                let count = 0;
                for (let i = headerIdx + 1; i < rows.length; i++) {
                    const row = rows[i];
                    if (!row || row.length === 0) continue;
                    const data = getVal(row, colMap.data);
                    if (!data) continue;
                    let dateObj = parseExcelDate(data);
                    if (!dateObj) continue;

                    const record = {
                        filiale: String(getVal(row, colMap.filiale) || '').replace(/\.0$/, ''),
                        data: dateObj,
                        mese: meseFromDate(dateObj),
                        cliente: sheetName,
                        provincia: getVal(row, colMap.provincia) || null,
                        citta: getVal(row, colMap.citta) || null,
                        importo: parseFloat(getVal(row, colMap.importo)) || 0,
                        driver: getVal(row, colMap.driver) || null,
                        consegnata: true,
                        tipo: 'speciale',
                        fonte: file.name,
                        sheetName: sheetName,
                        area: areaFromProvincia(getVal(row, colMap.provincia))
                    };
                    state.consegne.push(record);
                    count++;
                }
                if (count > 0) logEl.textContent += `   📌 ${sheetName}: ${count} record speciali\n`;
            }

        } catch (err) {
            logEl.textContent += `   ❌ Errore: ${err.message}\n`;
            console.error('Import error:', err);
        }
    }

    fillEl.style.width = '100%';
    statusEl.textContent = `✅ Importazione completata: ${totalImported} consegne totali`;
    logEl.textContent += `\n═══════════════════════════════\n✅ TOTALE IMPORTATO: ${totalImported} consegne\n`;
    toast(`Importate ${totalImported} consegne`, 'success');

    // Auto-generate filiali from imported data
    autoGenerateFiliali();
}

// ══════════════════════════════════════════════
// IMPORT FILE DECÒ (riepilogo mensile)
// ══════════════════════════════════════════════

async function handleImportDeco(files) {
    if (!files || files.length === 0) return;

    const logEl = document.getElementById('importDecoLog');
    logEl.style.display = 'block';
    logEl.textContent = '';

    const file = files[0];
    logEl.textContent += `📊 Apro file Decò: ${file.name}\n`;

    try {
        const data = await readFileAsArrayBuffer(file);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

        // Parse Decò format: area sections with filiale rows
        const decoData = {};
        let currentArea = null;

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length === 0) continue;

            // Detect area header
            const col5 = String(row[5] || '').toUpperCase().trim();
            
            if (['CT', 'EN', 'ME', 'SR', 'PA'].includes(col5)) {
                currentArea = col5;
                if (!decoData[currentArea]) decoData[currentArea] = {};
                continue;
            }

            // Stop al totale complessivo o alla sezione consegne speciali
            if (col5.includes('TOTALE COMPLESSIVO') || col5.includes('CONSEGNE SPECIALI')) break;

            // Skip totali e header
            if (col5.includes('TOTALI') || col5.includes('FILIALE') || col5.includes('TOTALE')) continue;

            // Filiale data row: col5=filiale code, col6=maggiori, col7=minori
            if (currentArea && row[5] && !isNaN(parseInt(row[5]))) {
                const filCode = String(parseInt(row[5]));
                const maggiori = parseInt(row[6]) || 0;
                const minori = parseInt(row[7]) || 0;
                decoData[currentArea][filCode] = { maggiori, minori };
                logEl.textContent += `   ${currentArea} → Filiale ${filCode}: ${maggiori} ≥250, ${minori} <250\n`;
            }
        }

        // Parse special deliveries section (bottom of file)
        // Look for "Consegne speciali" section
        let specialSection = false;
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (String(row?.[5] || '').toLowerCase().includes('consegne speciali')) {
                specialSection = true;
                continue;
            }
            if (specialSection && row?.[5] && row?.[6] && !isNaN(parseFloat(row[6]))) {
                logEl.textContent += `   Speciale: Filiale ${row[5]} → ${row[6]}\n`;
            }
        }

        state.dataDeco = decoData;
        
        // Count totals
        let totDecoMagg = 0, totDecoMin = 0;
        Object.values(decoData).forEach(area => {
            Object.values(area).forEach(fil => {
                totDecoMagg += fil.maggiori;
                totDecoMin += fil.minori;
            });
        });

        logEl.textContent += `\n═══════════════════════════════\n`;
        logEl.textContent += `✅ File Decò importato con successo\n`;
        logEl.textContent += `   Aree: ${Object.keys(decoData).join(', ')}\n`;
        logEl.textContent += `   Totale Decò: ${totDecoMagg} ≥€250, ${totDecoMin} <€250, ${totDecoMagg + totDecoMin} totali\n`;
        
        toast('File Decò importato — vai in Riconciliazione per il confronto', 'success');

    } catch (err) {
        logEl.textContent += `❌ Errore: ${err.message}\n`;
        console.error('Decò import error:', err);
        toast('Errore importazione file Decò', 'error');
    }
}

// ══════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════

function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}

function isMonthlySheet(name) {
    const n = name.toUpperCase().trim();
    const monthPatterns = [
        /^GEN\s?\d{2}$/, /^FEB\s?\d{2}$/, /^MAR\s?\d{2}$/,
        /^APR\s?\d{2}$/, /^MAG\s?\d{2}$/, /^GIU\s?\d{2}$/,
        /^LUG\s?\d{2}$/, /^AGO\s?\d{2}$/, /^SET\s?\d{2}$/,
        /^OTT\s?\d{2}$/, /^NOV\s?\d{2}$/, /^DIC\s?\d{2}$/
    ];
    return monthPatterns.some(p => p.test(n));
}

function detectColumns(rows) {
    // Find header row by looking for known column names
    for (let i = 0; i < Math.min(5, rows.length); i++) {
        const row = rows[i];
        if (!row) continue;

        const headers = row.map(h => String(h || '').toUpperCase().trim());
        
        // Look for FIL or FIL. in first few columns
        const filIdx = headers.findIndex(h => h === 'FIL' || h === 'FIL.' || h === 'FIL. PARTENZA');
        const dataIdx = headers.findIndex(h => h === 'DATA');
        
        if (filIdx >= 0 && dataIdx >= 0) {
            return {
                headerIdx: i,
                colMap: {
                    filiale: filIdx,
                    data: dataIdx,
                    orderId: headers.findIndex(h => h.includes('ORDER ID')),
                    fascia: headers.findIndex(h => h === 'FASCIA'),
                    cognome: headers.findIndex(h => h === 'COGNOME'),
                    nome: headers.findIndex(h => h === 'NOME'),
                    provincia: headers.findIndex(h => h === 'PR'),
                    citta: headers.findIndex(h => h.includes('CITTA')),
                    indirizzo: headers.findIndex(h => h === 'INDIRIZZO'),
                    importo: headers.findIndex(h => h.includes('IMPORTO EFFETTIVO') || h === 'IMPORTO'),
                    pagamento: headers.findIndex(h => h === 'PAGAMENTO'),
                    codiceDom: headers.findIndex(h => h.includes('CODICE DOMICILIO') || h.includes('CODICE_DOM')),
                    driver: headers.findIndex(h => h === 'RIDER' || h === 'DRIVER'),
                    targa: headers.findIndex(h => h.includes('TARGA')),
                    consegnata: headers.findIndex(h => h.includes('CONSEGNATA')),
                    // Colonne dei fogli filiale Decò più recenti
                    prestazione: headers.findIndex(h => h === 'PRESTAZIONE'),
                    richiesta: headers.findIndex(h => h.includes('RICHIESTA')),
                    oraConsegna: headers.findIndex(h => h.includes('ORA CONSEGNA'))
                }
            };
        }
    }

    return { headerIdx: -1, colMap: {} };
}

function getVal(row, idx) {
    if (idx < 0 || idx >= row.length) return null;
    const v = row[idx];
    if (v === null || v === undefined || v === '') return null;
    return String(v).trim();
}

function parseExcelDate(val) {
    if (!val) return null;
    if (val instanceof Date) return val;
    
    // Try parsing various formats
    const s = String(val).trim();
    
    // ISO format: 2025-04-01
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
        const d = new Date(s);
        if (!isNaN(d)) return d;
    }
    
    // Italian format: 01/04/2025
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
        const [day, month, year] = s.split('/');
        return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    }
    
    // Excel serial number
    const num = parseFloat(s);
    if (!isNaN(num) && num > 40000 && num < 60000) {
        return excelDateToJS(num);
    }

    // Last try
    const d = new Date(s);
    if (!isNaN(d)) return d;

    return null;
}

function consegnaDocId(c) {
    const d = c.data instanceof Date ? c.data : new Date(c.data);
    const dateStr = d.toISOString().slice(0, 10).replace(/-/g, '');
    const fil = String(c.filiale || '').replace(/[^a-zA-Z0-9]/g, '');
    const ref = (c.orderId || c.codiceDomicilio || '').replace(/[^a-zA-Z0-9]/g, '');
    // Normalize accents before stripping so "Munò" and "Muno" don't collide
    const cli = (c.cliente || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 20);
    const imp = String(Math.round((c.importo || 0) * 100));
    return `${fil}_${dateStr}_${ref || cli}_${imp}`.slice(0, 100);
}

async function saveConsegneBatch(consegne) {
    const dryRun = window.DRY_RUN_IMPORT === true;
    const batchSize = 400;
    for (let i = 0; i < consegne.length; i += batchSize) {
        const batch = db.batch();
        const chunk = consegne.slice(i, i + batchSize);

        chunk.forEach(c => {
            const docId = consegnaDocId(c);
            const docRef = db.collection(COLLECTIONS.consegne).doc(docId);
            const data = {
                ...c,
                data: firebase.firestore.Timestamp.fromDate(c.data instanceof Date ? c.data : new Date(c.data)),
                importedAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            delete data.dateObj;
            if (dryRun) {
                console.log('[DRY_RUN] set', docRef.path, JSON.stringify({ importo: c.importo, cliente: c.cliente, filiale: c.filiale, mese: c.mese }));
            } else {
                // merge:true preserva eventuali campi scritti dal GAS di produzione (sync, rider, tipoDriver)
                batch.set(docRef, data, { merge: true });
            }
        });

        if (!dryRun) {
            try {
                await batch.commit();
            } catch (batchErr) {
                console.error('Batch commit fallito (chunk ' + i + '):', batchErr);
                throw new Error('Errore durante il salvataggio — importazione interrotta al record ' + (i + 1) + '. Riprova.');
            }
        }
    }
    if (dryRun) console.log(`[DRY_RUN] ${consegne.length} record — nessuna scrittura su Firestore`);
}

async function autoGenerateFiliali() {
    // Extract unique filiali from imported data
    const filialiMap = {};
    state.consegne.forEach(c => {
        if (!c.filiale) return;
        const key = String(c.filiale);
        if (!filialiMap[key]) {
            filialiMap[key] = {
                codice: parseInt(key) || key,
                nome: '',
                area: c.area || areaFromProvincia(c.provincia),
                provincia: c.provincia,
                gruppo: ['CT','ME','EN','SR'].includes(c.area) ? 'Fratelli Arena' : 'Palermo Retail'
            };
        }
    });

    // Update state
    state.filiali = Object.values(filialiMap);

    // Save to Firestore
    var saveErrors = 0;
    await Promise.all(Object.entries(filialiMap).map(async ([key, data]) => {
        try {
            await db.collection(COLLECTIONS.filiali).doc(key).set({
                ...data,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        } catch (err) {
            saveErrors++;
            console.warn('Filiale save warn:', key, err);
        }
    }));
    if (saveErrors > 0) toast('Alcune filiali non salvate (' + saveErrors + ') — riprova', 'warning');
}
