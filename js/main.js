// DELIVERY HUB v2 — Main App (ottimizzato per velocità)

async function loadAllData() {
    try {
        await Promise.all([
            loadConsegnePerMese(),
            loadFiliali(),
            loadDriverAnagrafica(),
            loadDanni(),
            loadReportDriver(),
            loadRitorniMese()
        ]);
    } catch (e) {
        console.error('Load error:', e);
        toast('Errore nel caricamento dati', 'error');
    }
}

async function loadConsegnePerMese() {
    var mese = state.meseCorrente;
    if (!mese) {
        var now = new Date();
        var prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        mese = prev.getFullYear() + '-' + String(prev.getMonth() + 1).padStart(2, '0');
    }
    try {
        var snap = await db.collection('consegne')
            .where('mese', '==', mese)
            .get();
        state.consegne = snap.docs.map(function(doc) {
            var d = doc.data();
            d.id = doc.id;
            if (d.data && d.data.toDate) d.data = d.data.toDate();
            return d;
        });
        console.log('Firestore mese ' + mese + ': ' + state.consegne.length + ' consegne');
    } catch (e) {
        console.warn('Consegne load:', e);
        state.consegne = [];
    }
}

async function loadFiliali() {
    try {
        var snap = await db.collection('filiali').get();
        state.filiali = snap.docs.map(function(doc) { return Object.assign({ id: doc.id }, doc.data()); });
        state.filialiMap = {};
        state.filiali.forEach(function(f) { state.filialiMap[String(f.codice)] = f; });
        console.log('Loaded ' + state.filiali.length + ' filiali');
    } catch (e) {
        console.warn('Filiali load:', e);
        state.filiali = [];
    }
}

async function loadDriverAnagrafica() {
    try {
        var snap = await db.collection('driverAnagrafica').get();
        state.driverList = snap.docs.map(function(doc) { return Object.assign({ id: doc.id }, doc.data()); });
        console.log('Loaded ' + state.driverList.length + ' driver');
    } catch (e) {
        console.warn('Driver load:', e);
        state.driverList = [];
    }
}

async function loadDanni() {
    try {
        var snap = await db.collection('danni').orderBy('data', 'desc').limit(500).get();
        state.danniList = snap.docs.map(function(doc) {
            var d = doc.data();
            d.id = doc.id;
            if (d.data && d.data.toDate) d.data = d.data.toDate();
            return d;
        });
        console.log('Loaded ' + state.danniList.length + ' danni');
    } catch (e) {
        console.warn('Danni load:', e);
        state.danniList = [];
    }
}

// Pre-carica report driver per il mese (usato da compensi)
async function loadReportDriver() {
    var mese = state.meseCorrente;
    if (!mese) return;
    try {
        var snap = await db.collection('reportDriver')
            .where('mese', '==', mese)
            .get();
        state.reportDriver = snap.docs.map(function(doc) {
            var d = doc.data();
            d.id = doc.id;
            return d;
        });
        console.log('Loaded ' + state.reportDriver.length + ' report driver');
    } catch (e) {
        console.warn('ReportDriver load:', e);
        state.reportDriver = [];
    }
}

// Pre-carica ritorni per il mese
async function loadRitorniMese() {
    var mese = state.meseCorrente;
    if (!mese) return;
    try {
        var snap = await db.collection('ritorni')
            .where('mese', '==', mese)
            .get();
        state.ritorniMese = snap.docs.map(function(doc) {
            var d = doc.data();
            d.id = doc.id;
            if (d.data && d.data.toDate) d.data = d.data.toDate();
            return d;
        });
        console.log('Loaded ' + state.ritorniMese.length + ' ritorni');
    } catch (e) {
        console.warn('Ritorni load:', e);
        state.ritorniMese = [];
    }
}

async function onMeseChange() {
    state.meseCorrente = document.getElementById('meseSelector').value;
    await Promise.all([
        loadConsegnePerMese(),
        loadReportDriver(),
        loadRitorniMese()
    ]);
    refreshCurrentModule();
}

function forceRefresh() {
    location.reload();
}

document.addEventListener('DOMContentLoaded', function() {
    try {
        var keys = Object.keys(localStorage);
        keys.forEach(function(k) { if (k.indexOf('dhub_') === 0) localStorage.removeItem(k); });
    } catch(e) {}
    initAuth();
});
