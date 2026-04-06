// DELIVERY HUB v2 — Main App

async function loadAllData() {
    try {
        await Promise.all([
            loadConsegne(),
            loadFiliali(),
            loadDriverAnagrafica(),
            loadDanni()
        ]);
    } catch (e) {
        console.error('Load error:', e);
        toast('Errore nel caricamento dati', 'error');
    }
}

async function loadConsegne() {
    try {
        const snap = await db.collection('consegne').orderBy('data', 'desc').limit(10000).get();
        state.consegne = snap.docs.map(doc => {
            const d = doc.data();
            d.id = doc.id;
            if (d.data && d.data.toDate) d.data = d.data.toDate();
            return d;
        });
        console.log(`Loaded ${state.consegne.length} consegne`);
    } catch (e) {
        console.warn('Consegne load:', e);
        state.consegne = [];
    }
}

async function loadFiliali() {
    try {
        const snap = await db.collection('filiali').get();
        state.filiali = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        state.filialiMap = {};
        state.filiali.forEach(f => { state.filialiMap[String(f.codice)] = f; });
        console.log(`Loaded ${state.filiali.length} filiali`);
    } catch (e) {
        console.warn('Filiali load:', e);
        state.filiali = [];
    }
}

async function loadDriverAnagrafica() {
    try {
        const snap = await db.collection('driverAnagrafica').get();
        state.driverList = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        console.log(`Loaded ${state.driverList.length} driver`);
    } catch (e) {
        console.warn('Driver load:', e);
        state.driverList = [];
    }
}

async function loadDanni() {
    try {
        const snap = await db.collection('danni').orderBy('data', 'desc').limit(500).get();
        state.danniList = snap.docs.map(doc => {
            const d = doc.data();
            d.id = doc.id;
            if (d.data && d.data.toDate) d.data = d.data.toDate();
            return d;
        });
        console.log(`Loaded ${state.danniList.length} danni`);
    } catch (e) {
        console.warn('Danni load:', e);
        state.danniList = [];
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initAuth();
});
