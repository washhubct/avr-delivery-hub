// AVR — Verifica consegne mese: confronta cartella XLSX Sheet Decò vs Firestore
//
// Loop su TUTTI gli .xlsx in una cartella, dedup con Firestore, report aggregato
// per filiale. Default dry-run (report soltanto). Con --apply scrive i mancanti.
//
// Uso:
//   export GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/gcloud/legacy_credentials/claude-cli@avr-logistic-dashboard.iam.gserviceaccount.com/adc.json"
//   DIR="/Users/macia/Downloads/file sheet deco" MESE=2026-06 node verifica-mese.js
//   DIR="/Users/macia/Downloads/file sheet deco" MESE=2026-06 node verifica-mese.js --apply

const admin = require('firebase-admin');
const XLSX = require('xlsx');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const DIR = process.env.DIR;
const MESE = process.env.MESE || '2026-06';
const APPLY = process.argv.includes('--apply');

if (!DIR || !fs.existsSync(DIR)) {
    console.error('❌ Set DIR env var alla cartella con gli .xlsx (esiste?): ' + DIR);
    process.exit(1);
}

admin.initializeApp({ projectId: 'avr-logistic-dashboard' });
const db = admin.firestore();

const MONTH_TAB_MAP = { '01':'GEN','02':'FEB','03':'MAR','04':'APR','05':'MAG','06':'GIU','07':'LUG','08':'AGO','09':'SET','10':'OTT','11':'NOV','12':'DIC' };
const [ANNO, MM] = MESE.split('-');
const TAB_PREFIX = MONTH_TAB_MAP[MM] + ' ' + ANNO.slice(2);
// Tab giornalieri: "DD_MM" (o con spazio iniziale " DD_MM"). MM = numero mese target.
const DAILY_TAB_RE = new RegExp('^\\s*(\\d{1,2})_' + MM + '\\s*$');

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

function toCivilDate(d) { return new Date(d.getTime() + 12 * 3600 * 1000); }
function meseFromDate(d) {
    const c = toCivilDate(d);
    return c.getUTCFullYear() + '-' + String(c.getUTCMonth() + 1).padStart(2, '0');
}
function isoCivilDay(d) { return toCivilDate(d).toISOString().slice(0, 10); }

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

function processSheet(rows, filiale, tabName, dailyDate) {
    // dailyDate: Date | null. Se presente, ogni riga senza data esplicita eredita questa data (tab giornaliero)
    if (!rows || rows.length < 2) return { rows: [], skipCancellati: 0, skipNoData: 0, skipMese: 0 };
    let headerIdx = -1;
    for (let r = 0; r < Math.min(8, rows.length); r++) {
        for (let c = 0; c < (rows[r] || []).length; c++) {
            if (String(rows[r][c] || '').toUpperCase().indexOf('COGNOME') >= 0) { headerIdx = r; break; }
        }
        if (headerIdx >= 0) break;
    }
    if (headerIdx < 0) return { rows: [], skipCancellati: 0, skipNoData: 0, skipMese: 0 };
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
    // Nei tab giornalieri la colonna DATA può mancare — la ricaviamo dal nome del tab
    if (ci.cognome < 0) return { rows: [], skipCancellati: 0, skipNoData: 0, skipMese: 0 };
    if (ci.data < 0 && !dailyDate) return { rows: [], skipCancellati: 0, skipNoData: 0, skipMese: 0 };

    const out = [];
    let skipCancellati = 0, skipNoData = 0, skipMese = 0;
    for (let i = headerIdx + 1; i < rows.length; i++) {
        const row = rows[i] || [];
        const cognomeRaw = String(row[ci.cognome] || '').trim();
        if (!cognomeRaw) continue;
        if (normalizzaNome(cognomeRaw).indexOf('ANNULLAT') >= 0) { skipCancellati++; continue; }
        let dv = ci.data >= 0 ? parseDate(row[ci.data]) : null;
        if (!dv && dailyDate) dv = dailyDate;
        if (!dv) { skipNoData++; continue; }
        if (meseFromDate(dv) !== MESE) { skipMese++; continue; }

        let codFil = filiale;
        if (ci.filiale >= 0) {
            const vFil = String(row[ci.filiale] || '').trim().replace(/\.0$/, '');
            if (vFil && /^\d{2,5}$/.test(vFil)) codFil = vFil;
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
    return { rows: out, skipCancellati, skipNoData, skipMese };
}

async function loadFirestoreCountsAndKeys() {
    console.log('[1/4] Carico consegne Firestore mese=' + MESE + '...');
    const snap = await db.collection('consegne').where('mese', '==', MESE).get();
    const keys = new Set();
    const perFil = {};
    snap.forEach(doc => {
        const c = doc.data();
        const fil = String(c.filiale || '?');
        perFil[fil] = (perFil[fil] || 0) + 1;
        if (!c.data) return;
        const d = c.data.toDate ? c.data.toDate() : new Date(c.data);
        if (isNaN(d)) return;
        keys.add([
            fil,
            isoCivilDay(d),
            normalizzaNome(c.cognome || '').replace(/\s+/g, ''),
            Math.round((c.importo || 0) * 100),
            normalizzaNome(c.indirizzo || '').replace(/\s+/g, '').slice(0, 30),
        ].join('|'));
    });
    console.log('  → ' + snap.size + ' doc Firestore, ' + keys.size + ' chiavi dedup\n');
    return { keys, perFil, totFirestore: snap.size };
}

function pad(s, n) { return String(s).padEnd(n); }
function padR(s, n) { return String(s).padStart(n); }

async function main() {
    console.log('\n═════════════════════════════════════════════════');
    console.log('  VERIFICA MESE — Sheet Decò XLSX vs Firestore');
    console.log('  Cartella: ' + DIR);
    console.log('  Mese: ' + MESE + '  (tab: ' + TAB_PREFIX + ')');
    console.log('  Mode: ' + (APPLY ? '🔴 APPLY (scrive)' : '🟡 DRY-RUN (solo report)'));
    console.log('═════════════════════════════════════════════════\n');

    const { keys: fsKeys, perFil: perFilFS, totFirestore } = await loadFirestoreCountsAndKeys();

    const files = fs.readdirSync(DIR).filter(f => f.toLowerCase().endsWith('.xlsx') && !f.startsWith('~'));
    console.log('[2/4] File XLSX trovati: ' + files.length + '\n');

    console.log('[3/4] Scan tab mensili...');
    const perFilSheet = {};
    const perFilNuovi = {};
    const toWrite = [];
    const seenBatch = new Set();
    const filiCoperte = new Set();
    let totRowsSheet = 0, totNuovi = 0, totGiaPresenti = 0;

    for (const fname of files) {
        const full = path.join(DIR, fname);
        const filDefault = filialeFromFileName(fname);
        if (!filDefault) {
            console.log('  ⚠️  ' + fname + ' → skip (filiale non estraibile da nome)');
            continue;
        }
        let wb;
        try {
            wb = XLSX.read(fs.readFileSync(full), { type: 'buffer', cellDates: true });
        } catch (e) {
            console.log('  ❌ ' + fname + ': ' + e.message);
            continue;
        }
        const monthlyTabs = wb.SheetNames.filter(n => n.toUpperCase().indexOf(TAB_PREFIX) >= 0);
        const dailyTabs = wb.SheetNames.filter(n => DAILY_TAB_RE.test(n));
        const targetTabs = [...monthlyTabs, ...dailyTabs];
        if (!targetTabs.length) {
            console.log('  ⚠️  ' + pad(filDefault, 4) + ' ' + fname + ' → nessun tab per ' + MESE);
            continue;
        }
        let fileRows = 0, fileNuovi = 0, monthCount = monthlyTabs.length, dailyCount = dailyTabs.length;
        for (const tab of targetTabs) {
            const ws = wb.Sheets[tab];
            const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
            let dailyDate = null;
            const dm = tab.match(DAILY_TAB_RE);
            if (dm) {
                const g = parseInt(dm[1]);
                dailyDate = new Date(Date.UTC(parseInt(ANNO), parseInt(MM) - 1, g));
            }
            const { rows: parsed } = processSheet(rows, filDefault, tab, dailyDate);
            fileRows += parsed.length;
            for (const r of parsed) {
                perFilSheet[r.filiale] = (perFilSheet[r.filiale] || 0) + 1;
                filiCoperte.add(r.filiale);
                const k = dedupKey(r);
                if (fsKeys.has(k) || seenBatch.has(k)) { totGiaPresenti++; continue; }
                seenBatch.add(k);
                perFilNuovi[r.filiale] = (perFilNuovi[r.filiale] || 0) + 1;
                toWrite.push(r);
                totNuovi++;
                fileNuovi++;
            }
        }
        totRowsSheet += fileRows;
        const tabType = monthCount ? (dailyCount ? 'M+D' : 'M') : 'D';
        console.log('  ✓ ' + pad(filDefault, 4) + ' [' + tabType.padEnd(3) + '] ' + pad(fname.slice(0, 40), 42) + ' righe=' + padR(fileRows, 5) + ' mancanti=' + padR(fileNuovi, 5));
    }

    console.log('\n[4/4] Riepilogo per filiale (Sheet vs Firestore):');
    console.log('  ' + pad('FIL', 6) + padR('SHEET', 8) + padR('FIRESTORE', 12) + padR('MANCANTI', 10) + padR('EXTRA_FS', 10));
    const allFil = new Set([...Object.keys(perFilSheet), ...Object.keys(perFilFS)]);
    const sortedFil = Array.from(allFil).sort();
    let sumSheet = 0, sumFS = 0, sumMissing = 0, sumExtra = 0;
    for (const fil of sortedFil) {
        const s = perFilSheet[fil] || 0;
        const fS = perFilFS[fil] || 0;
        const missing = perFilNuovi[fil] || 0;
        const extra = Math.max(0, fS - (s - missing));
        console.log('  ' + pad(fil, 6) + padR(s, 8) + padR(fS, 12) + padR(missing, 10) + padR(extra, 10));
        sumSheet += s; sumFS += fS; sumMissing += missing; sumExtra += extra;
    }
    console.log('  ' + pad('TOT', 6) + padR(sumSheet, 8) + padR(sumFS, 12) + padR(sumMissing, 10) + padR(sumExtra, 10));

    console.log('\n  Sheet totali: ' + totRowsSheet);
    console.log('  Firestore totali (già presenti mese ' + MESE + '): ' + totFirestore);
    console.log('  Mancanti in Firestore (da inserire): ' + totNuovi);
    console.log('  Già presenti (match key): ' + totGiaPresenti);

    if (!APPLY) {
        console.log('\n  🟡 DRY-RUN — nessuna scrittura. Rilancia con --apply per inserire i ' + totNuovi + ' mancanti.\n');
        return;
    }

    if (!toWrite.length) {
        console.log('\n  ✅ Nulla da scrivere.\n');
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
}

main().catch(err => {
    console.error('❌ Errore:', err.message);
    console.error(err.stack);
    process.exit(1);
});
