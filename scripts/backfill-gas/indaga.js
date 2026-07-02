// Indagine: tab 524/940 + extra 533 (PA)
const admin = require('firebase-admin');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const DIR = process.env.DIR || '/Users/macia/Downloads/file sheet deco';
const MESE = process.env.MESE || '2026-06';

admin.initializeApp({ projectId: 'avr-logistic-dashboard' });
const db = admin.firestore();

function normalizzaNome(s) {
    return (s || '').toString().toUpperCase().trim()
        .replace(/[ÀÁÂÃ]/g, 'A').replace(/[ÈÉÊË]/g, 'E')
        .replace(/[ÌÍÎÏ]/g, 'I').replace(/[ÒÓÔÕ]/g, 'O')
        .replace(/[ÙÚÛÜ]/g, 'U');
}

function toCivilDate(d) { return new Date(d.getTime() + 12 * 3600 * 1000); }
function isoCivilDay(d) { return toCivilDate(d).toISOString().slice(0, 10); }

function dedupKey(fil, dISO, cognome, importo, indirizzo) {
    return [
        String(fil || ''),
        dISO,
        normalizzaNome(cognome).replace(/\s+/g, ''),
        Math.round((importo || 0) * 100),
        normalizzaNome(indirizzo || '').replace(/\s+/g, '').slice(0, 30),
    ].join('|');
}

async function tabsOfFile(fname) {
    const full = path.join(DIR, fname);
    if (!fs.existsSync(full)) return null;
    const wb = XLSX.read(fs.readFileSync(full), { type: 'buffer', bookSheets: true });
    return wb.SheetNames;
}

async function dumpFirestoreFiliale(fil) {
    const snap = await db.collection('consegne')
        .where('mese', '==', MESE)
        .where('filiale', '==', String(fil))
        .get();
    const rows = [];
    snap.forEach(doc => {
        const c = doc.data();
        const d = c.data && c.data.toDate ? c.data.toDate() : (c.data ? new Date(c.data) : null);
        rows.push({
            id: doc.id,
            fonte: c.fonte || '?',
            data: d ? isoCivilDay(d) : '?',
            cognome: c.cognome || '',
            nome: c.nome || '',
            importo: c.importo || 0,
            indirizzo: c.indirizzo || '',
            rider: c.rider || '',
        });
    });
    return rows;
}

function readSheetFiliale(fname, tabPrefix) {
    const full = path.join(DIR, fname);
    const wb = XLSX.read(fs.readFileSync(full), { type: 'buffer', cellDates: true });
    const tabs = wb.SheetNames.filter(n => n.toUpperCase().indexOf(tabPrefix) >= 0);
    const out = [];
    for (const tab of tabs) {
        const ws = wb.Sheets[tab];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
        if (!rows.length) continue;
        let hIdx = -1;
        for (let r = 0; r < Math.min(5, rows.length); r++) {
            for (let c = 0; c < (rows[r] || []).length; c++) {
                if (String(rows[r][c] || '').toUpperCase().indexOf('COGNOME') >= 0) { hIdx = r; break; }
            }
            if (hIdx >= 0) break;
        }
        if (hIdx < 0) continue;
        const header = (rows[hIdx] || []).map(x => String(x || '').trim().toUpperCase());
        const find = (n) => header.findIndex(h => h.includes(n));
        const ci = {
            data: header.findIndex(h => h.startsWith('DATA')),
            cognome: find('COGNOME'),
            indirizzo: find('INDIR'),
            importo: find('IMPORTO'),
        };
        for (let i = hIdx + 1; i < rows.length; i++) {
            const row = rows[i] || [];
            const cog = String(row[ci.cognome] || '').trim();
            if (!cog) continue;
            if (normalizzaNome(cog).indexOf('ANNULLAT') >= 0) continue;
            const dv = row[ci.data];
            if (!dv) continue;
            let d;
            if (dv instanceof Date) d = dv;
            else {
                const s = String(dv).trim();
                const it = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
                if (it) {
                    let y = parseInt(it[3]); if (y < 100) y += 2000;
                    d = new Date(Date.UTC(y, parseInt(it[2]) - 1, parseInt(it[1])));
                }
            }
            if (!d || isNaN(d)) continue;
            const iso = isoCivilDay(d);
            if (!iso.startsWith(MESE)) continue;
            out.push({
                data: iso,
                cognome: cog,
                indirizzo: ci.indirizzo >= 0 ? String(row[ci.indirizzo] || '').trim() : '',
                importo: ci.importo >= 0 ? (parseFloat(row[ci.importo]) || 0) : 0,
                tab,
                sheetRow: i + 1,
            });
        }
    }
    return out;
}

async function main() {
    console.log('\n═══ INDAGINE ═══════════════════════════════════\n');

    // 1) TAB DISPONIBILI 524 e 940
    console.log('[A] Tab presenti nei file 524 e 940:');
    for (const f of ['AVR FILIALE 524.xlsx', 'AVR FILIALE 940.xlsx']) {
        const tabs = await tabsOfFile(f);
        if (!tabs) { console.log('  ' + f + ' → file non trovato'); continue; }
        console.log('  ' + f + ':');
        tabs.forEach(t => console.log('    - "' + t + '"'));
    }

    // 2) Firestore 524 / 940 - fonte, sample date
    console.log('\n[B] Doc Firestore filiale 524 e 940 (mese=' + MESE + '):');
    for (const fil of ['524', '940']) {
        const rows = await dumpFirestoreFiliale(fil);
        const byFonte = {};
        const byGiorno = {};
        rows.forEach(r => {
            byFonte[r.fonte] = (byFonte[r.fonte] || 0) + 1;
            byGiorno[r.data] = (byGiorno[r.data] || 0) + 1;
        });
        console.log('  Filiale ' + fil + ': ' + rows.length + ' doc');
        console.log('    Fonti:', JSON.stringify(byFonte));
        const giorni = Object.keys(byGiorno).sort();
        console.log('    Range date: ' + giorni[0] + ' → ' + giorni[giorni.length - 1] + ' (' + giorni.length + ' giorni distinti)');
        console.log('    Sample 3:');
        rows.slice(0, 3).forEach(r => console.log('      ' + r.data + ' | ' + r.cognome + ' | €' + r.importo + ' | fonte=' + r.fonte));
    }

    // 3) 533 (PA) — chi sono i 322 extra
    console.log('\n[C] Analisi 533 (PA) — 1479 Firestore vs 1260 sheet:');
    const fsRows = await dumpFirestoreFiliale('533');
    const shRows = readSheetFiliale('AVR FILIALE 533 (PA).xlsx', 'GIU 26');
    console.log('  Firestore: ' + fsRows.length + ' | Sheet: ' + shRows.length);

    const shKeys = new Set(shRows.map(r => dedupKey('533', r.data, r.cognome, r.importo, r.indirizzo)));
    const extras = fsRows.filter(r => !shKeys.has(dedupKey('533', r.data, r.cognome, r.importo, r.indirizzo)));
    console.log('  Doc Firestore SENZA match in sheet: ' + extras.length);

    // Fonti dei 322 extra
    const extraFonte = {};
    extras.forEach(r => { extraFonte[r.fonte] = (extraFonte[r.fonte] || 0) + 1; });
    console.log('  Fonti degli extra:', JSON.stringify(extraFonte));

    // Distribuzione date extras
    const extraGiorni = {};
    extras.forEach(r => { extraGiorni[r.data] = (extraGiorni[r.data] || 0) + 1; });
    console.log('  Extras per giorno (top 10):');
    Object.entries(extraGiorni).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([d, n]) => {
        console.log('    ' + d + ' → +' + n);
    });

    // Doc duplicati (stessa dedup key ma id diverso)
    const keyToDocs = {};
    fsRows.forEach(r => {
        const k = dedupKey('533', r.data, r.cognome, r.importo, r.indirizzo);
        if (!keyToDocs[k]) keyToDocs[k] = [];
        keyToDocs[k].push(r);
    });
    const dupKeys = Object.entries(keyToDocs).filter(([, v]) => v.length > 1);
    console.log('  Chiavi dedup con più doc (duplicati in Firestore): ' + dupKeys.length);
    if (dupKeys.length) {
        console.log('  Sample 3 duplicati:');
        dupKeys.slice(0, 3).forEach(([k, v]) => {
            console.log('    key=' + k);
            v.forEach(r => console.log('      id=' + r.id + ' fonte=' + r.fonte));
        });
    }

    // Sample 5 extras "tipici"
    console.log('  Sample 5 extras:');
    extras.slice(0, 5).forEach(r => {
        console.log('    ' + r.data + ' | ' + r.cognome + ' ' + r.nome + ' | €' + r.importo + ' | fonte=' + r.fonte + ' | ' + (r.indirizzo || '').slice(0, 40));
    });

    console.log('\n═════════════════════════════════════════════════\n');
}

main().catch(err => {
    console.error('❌ Errore:', err.message);
    console.error(err.stack);
    process.exit(1);
});
