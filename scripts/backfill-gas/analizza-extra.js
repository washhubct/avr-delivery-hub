// Analizza i doc Firestore che NON matchano gli sheet Decò per giugno 2026
const admin = require('firebase-admin');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const DIR = process.env.DIR || '/Users/macia/Downloads/file sheet deco';
const MESE = process.env.MESE || '2026-06';
const MONTH_MAP = { '01':'GEN','02':'FEB','03':'MAR','04':'APR','05':'MAG','06':'GIU','07':'LUG','08':'AGO','09':'SET','10':'OTT','11':'NOV','12':'DIC' };
const [ANNO, MM] = MESE.split('-');
const TAB_PREFIX = MONTH_MAP[MM] + ' ' + ANNO.slice(2);
const DAILY_TAB_RE = new RegExp('^\\s*(\\d{1,2})_' + MM + '\\s*$');

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
function findCol(header, names) {
    for (let i = 0; i < header.length; i++)
        for (let j = 0; j < names.length; j++)
            if (String(header[i] || '').toUpperCase().indexOf(names[j]) >= 0) return i;
    return -1;
}
function parseDate(val) {
    if (val === null || val === undefined || val === '') return null;
    if (val instanceof Date && !isNaN(val)) return val;
    const s = String(val).trim().replace(/(\d{1,2})[\/\-\.](\d{3})[\/\-\.](\d{4})/, (m, d, mm, y) => d + '/' + mm.slice(0, 2) + '/' + y);
    const it = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
    if (it) { let y = parseInt(it[3]); if (y < 100) y += 2000; const d = new Date(Date.UTC(y, parseInt(it[2]) - 1, parseInt(it[1]))); if (!isNaN(d)) return d; }
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) { const d = new Date(Date.UTC(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]))); if (!isNaN(d)) return d; }
    const num = parseFloat(s); if (!isNaN(num) && num > 40000 && num < 60000) return new Date(Math.round((num - 25569) * 86400 * 1000));
    return null;
}

function filialeFromFileName(name) { const m = String(name || '').match(/\b(\d{3})\b/); return m ? m[1] : null; }

function readAllSheetRows(dir) {
    const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.xlsx') && !f.startsWith('~'));
    const rowsByFil = {};
    for (const fname of files) {
        const fil = filialeFromFileName(fname); if (!fil) continue;
        const wb = XLSX.read(fs.readFileSync(path.join(dir, fname)), { type: 'buffer', cellDates: true });
        const targetTabs = wb.SheetNames.filter(n => n.toUpperCase().indexOf(TAB_PREFIX) >= 0 || DAILY_TAB_RE.test(n));
        rowsByFil[fil] = rowsByFil[fil] || [];
        for (const tab of targetTabs) {
            const ws = wb.Sheets[tab];
            const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
            let hIdx = -1;
            for (let r = 0; r < Math.min(8, rows.length); r++) {
                for (let c = 0; c < (rows[r] || []).length; c++)
                    if (String(rows[r][c] || '').toUpperCase().indexOf('COGNOME') >= 0) { hIdx = r; break; }
                if (hIdx >= 0) break;
            }
            if (hIdx < 0) continue;
            const header = (rows[hIdx] || []).map(x => String(x || '').trim().toUpperCase());
            const ci = { data: findCol(header, ['DATA']), cognome: findCol(header, ['COGNOME']), indirizzo: findCol(header, ['INDIRIZZO', 'INDIR']), importo: findCol(header, ['IMPORTO']), filiale: findCol(header, ['FIL']) };
            let dailyDate = null;
            const dm = tab.match(DAILY_TAB_RE);
            if (dm) dailyDate = new Date(Date.UTC(parseInt(ANNO), parseInt(MM) - 1, parseInt(dm[1])));
            if (ci.cognome < 0) continue;
            if (ci.data < 0 && !dailyDate) continue;
            for (let i = hIdx + 1; i < rows.length; i++) {
                const row = rows[i] || [];
                const cog = String(row[ci.cognome] || '').trim();
                if (!cog) continue;
                if (normalizzaNome(cog).indexOf('ANNULLAT') >= 0) continue;
                let dv = ci.data >= 0 ? parseDate(row[ci.data]) : null;
                if (!dv && dailyDate) dv = dailyDate;
                if (!dv) continue;
                if (isoCivilDay(dv).slice(0, 7) !== MESE) continue;
                let codFil = fil;
                if (ci.filiale >= 0) {
                    const vFil = String(row[ci.filiale] || '').trim().replace(/\.0$/, '');
                    if (vFil && /^\d{2,5}$/.test(vFil)) codFil = vFil;
                }
                rowsByFil[codFil] = rowsByFil[codFil] || [];
                rowsByFil[codFil].push({
                    data: isoCivilDay(dv),
                    cognome: cog,
                    indirizzo: ci.indirizzo >= 0 ? String(row[ci.indirizzo] || '').trim() : '',
                    importo: ci.importo >= 0 ? (parseFloat(row[ci.importo]) || 0) : 0,
                });
            }
        }
    }
    return rowsByFil;
}

async function main() {
    console.log('\n═══ ANALISI 131 EXTRA — mese=' + MESE + ' ═══\n');

    console.log('[1] Leggo tutti gli sheet...');
    const sheetsByFil = readAllSheetRows(DIR);

    console.log('[2] Carico Firestore consegne mese...');
    const snap = await db.collection('consegne').where('mese', '==', MESE).get();
    console.log('  → ' + snap.size + ' doc\n');

    // Set delle chiavi dedup per filiale (dai sheet)
    const shKeysByFil = {};
    Object.keys(sheetsByFil).forEach(fil => {
        shKeysByFil[fil] = new Set(sheetsByFil[fil].map(r => dedupKey(fil, r.data, r.cognome, r.importo, r.indirizzo)));
    });

    // Costruisci indici loose per fuzzy match: (fil, data, cognomeNorm)
    const shLooseByFil = {};
    Object.keys(sheetsByFil).forEach(fil => {
        shLooseByFil[fil] = new Map();
        sheetsByFil[fil].forEach(r => {
            const k = fil + '|' + r.data + '|' + normalizzaNome(r.cognome).replace(/\s+/g, '');
            if (!shLooseByFil[fil].has(k)) shLooseByFil[fil].set(k, []);
            shLooseByFil[fil].get(k).push(r);
        });
    });

    const extras = [];
    snap.forEach(doc => {
        const c = doc.data();
        if (!c.data) return;
        const d = c.data.toDate ? c.data.toDate() : new Date(c.data);
        if (isNaN(d)) return;
        const fil = String(c.filiale || '');
        const dISO = isoCivilDay(d);
        const strictKey = dedupKey(fil, dISO, c.cognome || '', c.importo || 0, c.indirizzo || '');
        if (shKeysByFil[fil] && shKeysByFil[fil].has(strictKey)) return;
        extras.push({
            id: doc.id,
            filiale: fil,
            fonte: c.fonte || '?',
            data: dISO,
            cognome: c.cognome || '',
            nome: c.nome || '',
            importo: c.importo || 0,
            indirizzo: c.indirizzo || '',
            rider: c.rider || '',
        });
    });

    console.log('[3] Extra totali (no match sheet strict): ' + extras.length + '\n');

    // Per ogni extra, verifica se esiste un fuzzy match (stessa fil+data+cognomeNorm ma importo/indirizzo diverso)
    let fuzzyMatch = 0, unmatched = 0;
    const fuzzyExamples = [];
    const unmatchedExamples = [];
    const unmatchedPerFil = {};
    const fonteDist = {};
    extras.forEach(e => {
        fonteDist[e.fonte] = (fonteDist[e.fonte] || 0) + 1;
        const k = e.filiale + '|' + e.data + '|' + normalizzaNome(e.cognome).replace(/\s+/g, '');
        const cand = shLooseByFil[e.filiale] ? shLooseByFil[e.filiale].get(k) : null;
        if (cand && cand.length) {
            fuzzyMatch++;
            if (fuzzyExamples.length < 5) fuzzyExamples.push({ ext: e, candidati: cand });
        } else {
            unmatched++;
            unmatchedPerFil[e.filiale] = (unmatchedPerFil[e.filiale] || 0) + 1;
            if (unmatchedExamples.length < 10) unmatchedExamples.push(e);
        }
    });

    console.log('[4] Match fuzzy (stessa fil+data+cognome, indirizzo/importo diversi): ' + fuzzyMatch);
    console.log('    → probabilmente stessa consegna con differenze piccole (dedupKey rotta)');
    console.log('[5] Nessun match neanche fuzzy: ' + unmatched);
    console.log('    → veri "extra" — consegne senza corrispondenza Decò\n');

    console.log('[6] Fonti degli extra:', JSON.stringify(fonteDist));

    console.log('\n[7] Extra "veri" per filiale:');
    Object.entries(unmatchedPerFil).sort((a, b) => b[1] - a[1]).forEach(([f, n]) => {
        console.log('    ' + f.padEnd(6) + ' ' + n);
    });

    console.log('\n[8] Sample 5 fuzzy match (dedupKey rotta):');
    fuzzyExamples.forEach(f => {
        console.log('  FS: ' + f.ext.data + ' | ' + f.ext.cognome + ' | €' + f.ext.importo + ' | ' + (f.ext.indirizzo || '').slice(0, 50));
        f.candidati.slice(0, 2).forEach(c => {
            console.log('  SH: ' + c.data + ' | ' + c.cognome + ' | €' + c.importo + ' | ' + (c.indirizzo || '').slice(0, 50));
        });
        console.log('');
    });

    console.log('[9] Sample 10 unmatched (veri extra):');
    unmatchedExamples.forEach(e => {
        console.log('  ' + e.filiale + ' | ' + e.data + ' | ' + e.cognome + ' ' + e.nome + ' | €' + e.importo + ' | fonte=' + e.fonte + ' | id=' + e.id);
    });
}

main().catch(e => { console.error(e); process.exit(1); });
