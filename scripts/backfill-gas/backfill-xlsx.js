// AVR — Backfill consegne mancanti da file XLSX locale → Firestore
//
// Uso:
//   cd ~/Progetti/avr-delivery-hub/scripts/backfill-gas
//   export GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/gcloud/legacy_credentials/claude-cli@avr-logistic-dashboard.iam.gserviceaccount.com/adc.json"
//   FILE="/Users/macia/Downloads/AVR FILIALE 300.xlsx" MESE=2026-06 node backfill-xlsx.js --dry-run
//   FILE="/Users/macia/Downloads/AVR FILIALE 300.xlsx" MESE=2026-06 node backfill-xlsx.js
//
// - FILE: path assoluto al .xlsx
// - MESE: 'YYYY-MM' (solo righe di quel mese vengono considerate)

const admin = require('firebase-admin');
const XLSX = require('xlsx');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const FILE = process.env.FILE;
const MESE = process.env.MESE || '2026-06';
const DRY_RUN = process.argv.includes('--dry-run');

if (!FILE || !fs.existsSync(FILE)) {
    console.error('❌ Set FILE env var to path xlsx (esiste?): ' + FILE);
    process.exit(1);
}

admin.initializeApp({ projectId: 'avr-logistic-dashboard' });
const db = admin.firestore();

const MONTH_TAB_MAP = { '01':'GEN','02':'FEB','03':'MAR','04':'APR','05':'MAG','06':'GIU','07':'LUG','08':'AGO','09':'SET','10':'OTT','11':'NOV','12':'DIC' };
const [ANNO, MM] = MESE.split('-');
const TAB_PREFIX = MONTH_TAB_MAP[MM] + ' ' + ANNO.slice(2);

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

function parseDate(val) {
    if (val === null || val === undefined || val === '') return null;
    if (val instanceof Date && !isNaN(val)) return val;
    const s = String(val).trim();
    const cleaned = s.replace(/(\d{1,2})[\/\-\.](\d{3})[\/\-\.](\d{4})/, (m, d, mm, y) => d + '/' + mm.slice(0, 2) + '/' + y);
    const it = cleaned.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
    if (it) {
        let y = parseInt(it[3]); if (y < 100) y += 2000;
        const d = new Date(Date.UTC(y, parseInt(it[2]) - 1, parseInt(it[1])));
        if (!isNaN(d)) return d;
    }
    const iso = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) {
        const d = new Date(Date.UTC(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3])));
        if (!isNaN(d)) return d;
    }
    const num = parseFloat(cleaned);
    if (!isNaN(num) && num > 40000 && num < 60000) return new Date(Math.round((num - 25569) * 86400 * 1000));
    return null;
}

function filialeFromFileName(name) {
    const m = String(name || '').match(/\b(\d{3})\b/);
    return m ? m[1] : null;
}

// Excel salva date locali italiane come UTC−1/−2 (es. 1 giugno 00:00 CEST → 2026-05-31T22:00Z).
// Shift +12h per rimanere sempre nel giorno civile locale corretto quando estraiamo mese/giorno UTC.
function toCivilDate(d) {
    return new Date(d.getTime() + 12 * 3600 * 1000);
}
function meseFromDate(d) {
    const c = toCivilDate(d);
    return c.getUTCFullYear() + '-' + String(c.getUTCMonth() + 1).padStart(2, '0');
}

function isoCivilDay(d) {
    return toCivilDate(d).toISOString().slice(0, 10);
}

function dedupKey(row) {
    return [
        row.filiale,
        isoCivilDay(row.data),
        normalizzaNome(row.cognome).replace(/\s+/g, ''),
        Math.round((row.importo || 0) * 100),
        normalizzaNome(row.indirizzo || '').replace(/\s+/g, '').slice(0, 30),
    ].join('|');
}

function docIdBackfill(row) {
    const hash = crypto.createHash('sha1').update(dedupKey(row)).digest('hex').slice(0, 10);
    return row.filiale + '_' + isoCivilDay(row.data).replace(/-/g, '') + '_BACKFILL_' + hash;
}

function processSheet(rows, filiale, tabName) {
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
    if (ci.cognome < 0 || ci.data < 0) {
        console.log('  ⚠️  ' + tabName + ': header non riconosciuto (cognome=' + ci.cognome + ' data=' + ci.data + ')');
        return [];
    }

    const out = [];
    let skipCancellati = 0, skipNoData = 0, skipMese = 0;
    const meseDist = {};
    const sampleRawDates = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
        const row = rows[i] || [];
        const cognomeRaw = String(row[ci.cognome] || '').trim();
        if (!cognomeRaw) continue;
        if (normalizzaNome(cognomeRaw).indexOf('ANNULLAT') >= 0) { skipCancellati++; continue; }
        if (sampleRawDates.length < 5) sampleRawDates.push({ raw: row[ci.data], type: typeof row[ci.data] });
        const dv = parseDate(row[ci.data]);
        if (!dv) { skipNoData++; continue; }
        const meseR = meseFromDate(dv);
        meseDist[meseR] = (meseDist[meseR] || 0) + 1;
        if (meseR !== MESE) { skipMese++; continue; }

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
            sheetRow: i + 1,
        });
    }
    console.log('  ✓ ' + tabName + ': +' + out.length + ' (skip cancellati=' + skipCancellati + ' no-data=' + skipNoData + ' altro-mese=' + skipMese + ')');
    console.log('    Distribuzione mese parsato:', JSON.stringify(meseDist));
    console.log('    Sample raw date:', JSON.stringify(sampleRawDates));
    return out;
}

async function loadExistingDedupKeys(filialeFilter) {
    console.log('[1/4] Carico consegne esistenti mese=' + MESE + (filialeFilter ? ' filiale=' + filialeFilter : '') + '...');
    let q = db.collection('consegne').where('mese', '==', MESE);
    if (filialeFilter) q = q.where('filiale', '==', filialeFilter);
    const snap = await q.get();
    const keys = new Set();
    snap.forEach(doc => {
        const c = doc.data();
        if (!c.data) return;
        const d = c.data.toDate ? c.data.toDate() : new Date(c.data);
        if (isNaN(d)) return;
        keys.add([
            String(c.filiale || ''),
            isoCivilDay(d),
            normalizzaNome(c.cognome || '').replace(/\s+/g, ''),
            Math.round((c.importo || 0) * 100),
            normalizzaNome(c.indirizzo || '').replace(/\s+/g, '').slice(0, 30),
        ].join('|'));
    });
    console.log('  → ' + keys.size + ' chiavi dedup indicizzate\n');
    return keys;
}

async function main() {
    const filialeDefault = filialeFromFileName(path.basename(FILE));
    console.log('\n═════════════════════════════════════════════════');
    console.log('  BACKFILL XLSX → FIRESTORE');
    console.log('  File: ' + FILE);
    console.log('  Filiale default (da nome file): ' + (filialeDefault || 'N/A'));
    console.log('  Mese: ' + MESE + ' (tab prefix: ' + TAB_PREFIX + ')');
    console.log('  DRY_RUN: ' + DRY_RUN);
    console.log('═════════════════════════════════════════════════\n');

    const existing = await loadExistingDedupKeys(filialeDefault);

    console.log('[2/4] Apro xlsx e cerco tab mensili...');
    const wb = XLSX.read(fs.readFileSync(FILE), { type: 'buffer', cellDates: true });
    console.log('  Sheet trovati: ' + wb.SheetNames.length);
    const target = wb.SheetNames.filter(n => n.toUpperCase().indexOf(TAB_PREFIX) >= 0);
    console.log('  Tab mensili target (' + TAB_PREFIX + '): ' + JSON.stringify(target) + '\n');

    console.log('[3/4] Estraggo righe...');
    const candidates = [];
    for (const tab of target) {
        const ws = wb.Sheets[tab];
        // raw:true + cellDates:true → Date nativi (evita parsing ambiguo M/D/YY vs D/M/YY)
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
        candidates.push(...processSheet(rows, filialeDefault, tab));
    }
    console.log('  → totale righe candidate: ' + candidates.length + '\n');

    console.log('[4/4] Dedup...');
    let nuovi = 0, giaPresenti = 0;
    const toWrite = [];
    const seen = new Set();
    for (const r of candidates) {
        const key = dedupKey(r);
        if (existing.has(key) || seen.has(key)) { giaPresenti++; continue; }
        seen.add(key);
        toWrite.push(r);
        nuovi++;
    }
    console.log('  Da inserire (NUOVI):        ' + nuovi);
    console.log('  Già in Firestore o dupli:   ' + giaPresenti);

    const perGiorno = {};
    toWrite.forEach(r => {
        const iso = isoCivilDay(r.data);
        perGiorno[iso] = (perGiorno[iso] || 0) + 1;
    });
    console.log('\n  Nuovi per giorno:');
    Object.keys(perGiorno).sort().forEach(k => console.log('    ' + k + ' +' + perGiorno[k]));

    if (DRY_RUN) {
        console.log('\n  🟡 DRY_RUN — nessuna scrittura. Rilancia senza --dry-run per applicare.\n');
        return;
    }

    console.log('\n  Scrivo ' + toWrite.length + ' doc su Firestore (batch 400)...');
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
                fonte: 'BACKFILL_XLSX',
                sheetTab: r.sheetTab,
                sheetRow: r.sheetRow,
                sync: now,
                importedAt: now,
            }, { merge: true });
        });
        await batch.commit();
        written += chunk.length;
        process.stdout.write('  ' + written + '/' + toWrite.length + '\r');
    }
    console.log('\n  ✅ Scritti ' + written + ' doc.\n');
    console.log('═════════════════════════════════════════════════\n');
}

main().catch(err => {
    console.error('❌ Errore:', err.message);
    console.error(err.stack);
    process.exit(1);
});
