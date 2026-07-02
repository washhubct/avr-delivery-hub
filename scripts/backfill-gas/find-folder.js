// Cerca la cartella Drive che contiene i Google Sheet delle filiali AVR.
// Usa le Application Default Credentials (gcloud auth application-default login).

const { google } = require('googleapis');

async function main() {
    const auth = new google.auth.GoogleAuth({
        scopes: [
            'https://www.googleapis.com/auth/drive.readonly',
            'https://www.googleapis.com/auth/spreadsheets.readonly',
        ],
    });
    const authClient = await auth.getClient();
    const drive = google.drive({ version: 'v3', auth: authClient });

    console.log('Cerco cartelle con "FILIALE" o "AVR" nel nome...');
    const r = await drive.files.list({
        q: "mimeType='application/vnd.google-apps.folder' and (name contains 'FILIALE' or name contains 'AVR' or name contains 'CONSEGNE') and trashed=false",
        fields: 'files(id, name, parents, owners(emailAddress))',
        pageSize: 50,
    });
    if (!r.data.files.length) {
        console.log('❌ Nessuna cartella trovata con questo pattern');
    } else {
        r.data.files.forEach(f => {
            const owner = f.owners && f.owners[0] ? f.owners[0].emailAddress : '?';
            console.log(' -', f.id, ' | ', f.name, ' | owner:', owner);
        });
    }

    console.log('\nCerco Sheet con "FILIALE" nel nome (top 15)...');
    const s = await drive.files.list({
        q: "mimeType='application/vnd.google-apps.spreadsheet' and name contains 'FILIALE' and trashed=false",
        fields: 'files(id, name, parents)',
        pageSize: 30,
    });
    if (!s.data.files.length) {
        console.log('❌ Nessun Sheet FILIALE');
    } else {
        // Estrai parents unici
        const parents = {};
        s.data.files.forEach(f => {
            (f.parents || []).forEach(p => { parents[p] = (parents[p] || 0) + 1; });
            console.log(' -', f.name, ' | parent=', (f.parents || [])[0]);
        });
        console.log('\nCartella padre più comune (candidata FOLDER_ID):');
        Object.entries(parents).sort((a, b) => b[1] - a[1]).slice(0, 5).forEach(([p, n]) => {
            console.log('  ', p, '→', n, 'sheet');
        });
    }
}

main().catch(e => { console.error(e.message); process.exit(1); });
