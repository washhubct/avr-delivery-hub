// AVR — Backfill consegne mancanti da Google Sheet filiali → Firestore
//
// Legge tutti i Google Sheet in FOLDER_ID, riconosce colonne (stessa logica
// di riepilogo-avr-consegne.gs) e fa INSERT su collection `consegne` per
// le righe che NON esistono già in Firestore.
//
// Dedup: per ogni riga costruisce chiave (filiale, data, cognome, importo,
// indirizzo). Se un doc con stessa chiave esiste già → skip.
//
// Uso:
//   cd ~/Progetti/avr-delivery-hub/scripts/backfill-gas
//   npm install
//   export GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/gcloud/legacy_credentials/claude-cli@avr-logistic-dashboard.iam.gserviceaccount.com/adc.json"
//   FOLDER_ID=xxxx MESE=2026-06 node backfill.js --dry-run
//   FOLDER_ID=xxxx MESE=2026-06 node backfill.js         # scrive davvero

const admin = require('firebase-admin');
const { google } = require('googleapis');
const crypto = require('crypto');

const FOLDER_ID = process.env.FOLDER_ID;
const MESE = process.env.MESE || '2026-06';
const DRY_RUN = process.argv.includes('--dry-run');

if (!FOLDER_ID) {
    console.error('❌ Set FOLDER_ID env var (ID cartella Drive con i Sheet filiali)');
    process.exit(1);
}

admin.initializeApp({ projectId: 'avr-logistic-dashboard' });
const db = admin.firestore();

const auth = new google.auth.GoogleAuth({
    scopes: [
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/spreadsheets.readonly',
    ],
});

// Mese target come pattern tab: 'GIU 26', 'LUG 26', ecc.
const MONTH_TAB_MAP = { '01':'GEN','02':'FEB','03':'MAR','04':'APR','05':'MAG','06':'GIU','07':'LUG','08':'AGO','09':'SET','10':'OTT','11':'NOV','12':'DIC' };
const [ANNO, MM] = MESE.split('-');
const TAB_PREFIX = MONTH_TAB_MAP[MM] + ' ' + ANNO.slice(2); // es. 'GIU 26'

function normalizzaNome(s) {
    return (s || '').toString().toUpperCase().trim()
        .replace(/[ÀÁÂÃ]/g, 'A').replace(/[ÈÉÊË]/g, 'E')
        .replace(/[ÌÍÎÏ]/g, 'I').replace(/[ÒÓÔÕ]/g, 'O')
        .replace(/[ÙÚÛÜ]/g, 'U');
}

function findCol(header, names) {
    for (let i = 0; i < header.length; i++) {
        for (let j = 0; j < names.length; j++) {
            if (String(header[i] || '').toUpperCase().indexOf(names[j]) >= 0) return i;
        }
    }
    return -1;
}

// Parse data robusto (identico al GAS v4.1 semplificato)
function parseDate(val) {
    if (val === null || val === undefined || val === '') return null;
    if (val instanceof Date && !isNaN(val)) return val;
    const s = String(val).trim();

    // Fix errori tipo "08/111/2025"
    const cleaned = s.replace(/(\d{1,2})[\/\-\.](\d{3})[\/\-\.](\d{4})/, (m, d, mm, y) => d + '/' + mm.slice(0, 2) + '/' + y);

    const it = cleaned.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
    if (it) {
        let y = parseInt(it[3]);
        if (y < 100) y += 2000;
        const d = new Date(Date.UTC(y, parseInt(it[2]) - 1, parseInt(it[1])));
        if (!isNaN(d)) return d;
    }
    const iso = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) {
        const d = new Date(Date.UTC(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3])));
        if (!isNaN(d)) return d;
    }
    const num = parseFloat(cleaned);
    if (!isNaN(num) && num > 40000 && num < 60000) {
        return new Date(Math.round((num - 25569) * 86400 * 1000));
    }
    return null;
}

function filialeFromFileName(fileName) {
    const m = String(fileName || '').match(/\b(\d{3})\b/);
    return m ? m[1] : null;
}

function meseFromDate(d) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    return y + '-' + m;
}

// Dedup key: se un doc con questa chiave esiste già in Firestore, skip
function dedupKey(row) {
    return [
        row.filiale,
        row.data.toISOString().slice(0, 10),
        normalizzaNome(row.cognome).replace(/\s+/g, ''),
        Math.round((row.importo || 0) * 100),
        normalizzaNome(row.indirizzo || '').replace(/\s+/g, '').slice(0, 30),
    ].join('|');
}

function docIdBackfill(row) {
    const hash = crypto.createHash('sha1').update(dedupKey(row)).digest('hex').slice(0, 10);
    return row.filiale + '_' + row.data.toISOString().slice(0, 10).replace(/-/g, '') + '_BACKFILL_' + hash;
}

async function listSheets(drive) {
    const files = [];
    let pageToken;
    do {
        const r = await drive.files.list({
            q: `'${FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
            fields: 'nextPageToken, files(id, name)',
            pageSize: 200,
            pageToken,
        });
        files.push(...(r.data.files || []));
        pageToken = r.data.nextPageToken;
    } while (pageToken);
    return files;
}

async function readSheet(sheets, spreadsheetId) {
    const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets(properties(title,sheetId))' });
    const tabs = meta.data.sheets.map(s => s.properties.title);
    const target = tabs.filter(t => t.toUpperCase().indexOf(TAB_PREFIX) >= 0);
    const out = [];
    for (const tab of target) {
        try {
            const r = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${tab}'`, valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING' });
            out.push({ tab, values: r.data.values || [] });
        } catch (e) {
            console.warn('  ⚠️ tab ' + tab + ': ' + e.message);
        }
    }
    return out;
}

function processTab(rows, filiale, tabName) {
    if (!rows || rows.length < 2) return [];
    let headerIdx = -1;
    for (let r = 0; r < Math.min(5, rows.length); r++) {
        for (let c = 0; c < (rows[r] || []).length; c++) {
            if (String(rows[r][c] || '').toUpperCase().indexOf('COGNOME') >= 0) { headerIdx = r; break; }
        }
        if (headerIdx >= 0) break;
    }
    if (headerIdx < 0) return [];
    const header = (rows[headerIdx] || []).map(x => String(x || '').trim().toUpperCase());

    const ci = {
        data: findCol(header, ['DATA']),
        cognome: findCol(header, ['COGNOME']),
        nome: findCol(header, ['NOME']),
        indirizzo: findCol(header, ['INDIRIZZO', 'INDIR']),
        importo: findCol(header, ['IMPORTO']),
        filiale: findCol(header, ['FIL']),
        rider: findCol(header, ['RIDER', 'DRIVER']),
        citta: findCol(header, ['CITTA', 'CITTÀ']),
    };
    if (ci.cognome < 0 || ci.data < 0) return [];

    const out = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
        const row = rows[i] || [];
        const cognomeRaw = String(row[ci.cognome] || '').trim();
        if (!cognomeRaw) continue;
        if (normalizzaNome(cognomeRaw).indexOf('ANNULLAT') >= 0) continue;
        const dv = parseDate(row[ci.data]);
        if (!dv) continue;
        if (meseFromDate(dv) !== MESE) continue; // solo mese target

        let codFil = filiale;
        if (ci.filiale >= 0) {
            const vFil = String(row[ci.filiale] || '').trim().replace(/\.0$/, '');
            if (vFil) codFil = vFil;
        }

        out.push({
            filiale: String(codFil),
            data: dv,
            mese: MESE,
            cognome: cognomeRaw,
            nome: ci.nome >= 0 ? String(row[ci.nome] || '').trim() : null,
            indirizzo: ci.indirizzo >= 0 ? String(row[ci.indirizzo] || '').trim() : null,
            citta: ci.citta >= 0 ? String(row[ci.citta] || '').trim() : null,
            importo: ci.importo >= 0 ? (parseFloat(row[ci.importo]) || 0) : 0,
            rider: ci.rider >= 0 ? String(row[ci.rider] || '').trim() : null,
            sheetTab: tabName,
            sheetRow: i + 1, // 1-indexed
        });
    }
    return out;
}

async function loadExistingDedupKeys() {
    console.log('[1/4] Carico consegne esistenti mese=' + MESE + ' da Firestore...');
    const snap = await db.collection('consegne').where('mese', '==', MESE).get();
    const keys = new Set();
    snap.forEach(doc => {
        const c = doc.data();
        if (!c.data) return;
        const d = c.data.toDate ? c.data.toDate() : new Date(c.data);
        if (isNaN(d)) return;
        const key = [
            String(c.filiale || ''),
            d.toISOString().slice(0, 10),
            normalizzaNome(c.cognome || '').replace(/\s+/g, ''),
            Math.round((c.importo || 0) * 100),
            normalizzaNome(c.indirizzo || '').replace(/\s+/g, '').slice(0, 30),
        ].join('|');
        keys.add(key);
    });
    console.log('  → ' + keys.size + ' chiavi dedup indicizzate\n');
    return keys;
}

async function main() {
    console.log('\n═════════════════════════════════════════════════');
    console.log('  BACKFILL SYNC GAS — cartella ' + FOLDER_ID);
    console.log('  Mese target: ' + MESE + ' (tab prefix: ' + TAB_PREFIX + ')');
    console.log('  DRY_RUN: ' + DRY_RUN);
    console.log('═════════════════════════════════════════════════\n');

    const existing = await loadExistingDedupKeys();

    console.log('[2/4] Elenco Sheet in cartella Drive...');
    const authClient = await auth.getClient();
    const drive = google.drive({ version: 'v3', auth: authClient });
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    const files = await listSheets(drive);
    console.log('  → ' + files.length + ' Sheet trovati\n');

    console.log('[3/4] Scan tab mensili e raccolta righe candidate...');
    const candidates = [];
    let filesOk = 0, filesSkip = 0, tabsProc = 0, rowsScanned = 0;
    for (const f of files) {
        const filiale = filialeFromFileName(f.name);
        if (!filiale) { filesSkip++; continue; }
        filesOk++;
        try {
            const tabs = await readSheet(sheets, f.id);
            for (const { tab, values } of tabs) {
                const rows = processTab(values, filiale, tab);
                rowsScanned += rows.length;
                tabsProc++;
                for (const r of rows) candidates.push(r);
            }
            process.stdout.write('.');
        } catch (e) {
            console.warn('\n  ⚠️ file ' + f.name + ': ' + e.message);
        }
    }
    process.stdout.write('\n');
    console.log('  → ' + filesOk + ' file, ' + tabsProc + ' tab, ' + rowsScanned + ' righe scansionate\n');

    console.log('[4/4] Dedup + write...');
    let nuovi = 0, giaPresenti = 0;
    const toWrite = [];
    for (const r of candidates) {
        const key = dedupKey(r);
        if (existing.has(key)) { giaPresenti++; continue; }
        existing.add(key); // evita duplicati nello stesso batch
        toWrite.push(r);
        nuovi++;
    }
    console.log('  Da inserire (NUOVI): ' + nuovi);
    console.log('  Già in Firestore:    ' + giaPresenti);

    // Report per filiale
    const perFil = {};
    toWrite.forEach(r => { perFil[r.filiale] = (perFil[r.filiale] || 0) + 1; });
    console.log('\n  Nuovi per filiale:');
    Object.entries(perFil).sort((a, b) => b[1] - a[1]).slice(0, 30).forEach(([f, n]) => {
        console.log('    ' + f.padEnd(6) + ' +' + n);
    });

    if (DRY_RUN) {
        console.log('\n  🟡 DRY_RUN — nessuna scrittura. Rilancia senza --dry-run per applicare.\n');
        return;
    }

    // Scrivi in batch da 400
    console.log('\n  Scrivo ' + toWrite.length + ' doc su Firestore...');
    const now = admin.firestore.FieldValue.serverTimestamp();
    let written = 0;
    for (let i = 0; i < toWrite.length; i += 400) {
        const chunk = toWrite.slice(i, i + 400);
        const batch = db.batch();
        chunk.forEach(r => {
            const ref = db.collection('consegne').doc(docIdBackfill(r));
            batch.set(ref, {
                filiale: r.filiale,
                data: admin.firestore.Timestamp.fromDate(r.data),
                mese: r.mese,
                cognome: r.cognome,
                nome: r.nome,
                indirizzo: r.indirizzo,
                citta: r.citta,
                importo: r.importo,
                rider: r.rider,
                consegnata: true,
                fonte: 'BACKFILL_SHEET',
                sheetTab: r.sheetTab,
                sheetRow: r.sheetRow,
                sync: now,
                importedAt: now,
            }, { merge: true });
        });
        await batch.commit();
        written += chunk.length;
        process.stdout.write(`  ${written}/${toWrite.length}\r`);
    }
    console.log('\n  ✅ Scritti ' + written + ' doc.\n');
    console.log('═════════════════════════════════════════════════\n');
}

main().catch(err => {
    console.error('❌ Errore:', err.message);
    console.error(err.stack);
    process.exit(1);
});
