// DELIVERY HUB v2 — Main App (ottimizzato con cache mesi chiusi)

function isMeseCorrente(mese) {
    var now = new Date();
    var meseOggi = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    return mese === meseOggi;
}

function getCacheKey(collection, mese) {
    return 'avr_' + collection + '_' + mese;
}

function getCached(collection, mese) {
    if (isMeseCorrente(mese)) return null; // Mai cachare il mese corrente
    try {
        var raw = sessionStorage.getItem(getCacheKey(collection, mese));
        if (raw) {
            var data = JSON.parse(raw);
            console.log('⚡ Cache hit: ' + collection + ' ' + mese + ' (' + data.length + ' docs)');
            return data;
        }
    } catch (e) { console.warn('Cache read error:', e.message); }
    return null;
}

function setCache(collection, mese, data) {
    if (isMeseCorrente(mese)) return; // Mai cachare il mese corrente
    try {
        sessionStorage.setItem(getCacheKey(collection, mese), JSON.stringify(data));
    } catch (e) {
        console.warn('Cache write error:', e.message);
    }
}

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

// Nota: la leaderboard è ora precalcolata dalla Cloud Function scheduled
// `precalcolaLeaderboard` (region europe-west1, every 1 hours, TZ Europe/Rome).
// Il modulo dashboard/classifica.js legge `leaderboardFull/{mese}` direttamente.

async function loadConsegnePerMese() {
    var mese = state.meseCorrente;
    if (!mese) {
        var now = new Date();
        var prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        mese = prev.getFullYear() + '-' + String(prev.getMonth() + 1).padStart(2, '0');
    }

    // Check cache per mesi chiusi
    var cached = getCached('consegne', mese);
    if (cached) {
        state.consegne = cached.map(function(d) {
            if (d.data && typeof d.data === 'string') d.data = new Date(d.data);
            return d;
        });
        return;
    }

    try {
        var t0 = performance.now();
        var snap = await db.collection('consegne')
            .where('mese', '==', mese)
            .get();
        state.consegne = snap.docs.map(function(doc) {
            var d = doc.data();
            d.id = doc.id;
            if (d.data && d.data.toDate) d.data = d.data.toDate();
            return d;
        });
        console.log('Firestore mese ' + mese + ': ' + state.consegne.length + ' consegne in ' + (performance.now() - t0).toFixed(0) + 'ms');

        // Cacha mesi chiusi
        setCache('consegne', mese, state.consegne.map(function(d) {
            var copy = Object.assign({}, d);
            if (copy.data instanceof Date) copy.data = copy.data.toISOString();
            return copy;
        }));
    } catch (e) {
        console.warn('Consegne load:', e);
        state.consegne = [];
    }
}

async function loadFiliali() {
    // Filiali cambiano raramente, cacha in sessionStorage
    var cacheKey = 'avr_filiali';
    try {
        var raw = sessionStorage.getItem(cacheKey);
        if (raw) {
            state.filiali = JSON.parse(raw);
            state.filialiMap = {};
            state.filiali.forEach(function(f) { state.filialiMap[String(f.codice)] = f; });
            console.log('⚡ Cache filiali: ' + state.filiali.length);
            return;
        }
    } catch (e) {}

    try {
        var snap = await db.collection('filiali').get();
        state.filiali = snap.docs.map(function(doc) { return Object.assign({ id: doc.id }, doc.data()); });
        state.filialiMap = {};
        state.filiali.forEach(function(f) { state.filialiMap[String(f.codice)] = f; });
        try { sessionStorage.setItem(cacheKey, JSON.stringify(state.filiali)); } catch(e) {}
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

async function loadReportDriver() {
    var mese = state.meseCorrente;
    if (!mese) return;

    var cached = getCached('reportDriver', mese);
    if (cached) {
        state.reportDriver = cached;
        return;
    }

    try {
        var snap = await db.collection('reportDriver')
            .where('mese', '==', mese)
            .limit(5000)
            .get();
        state.reportDriver = snap.docs.map(function(doc) {
            var d = doc.data();
            d.id = doc.id;
            return d;
        });
        setCache('reportDriver', mese, state.reportDriver);
        console.log('Loaded ' + state.reportDriver.length + ' report driver');
    } catch (e) {
        console.warn('ReportDriver load:', e);
        state.reportDriver = [];
    }
}

async function loadRitorniMese() {
    var mese = state.meseCorrente;
    if (!mese) return;

    var cached = getCached('ritorni', mese);
    if (cached) {
        state.ritorniMese = cached.map(function(d) {
            if (d.data && typeof d.data === 'string') d.data = new Date(d.data);
            return d;
        });
        return;
    }

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
        setCache('ritorni', mese, state.ritorniMese.map(function(d) {
            var copy = Object.assign({}, d);
            if (copy.data instanceof Date) copy.data = copy.data.toISOString();
            return copy;
        }));
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
    try { sessionStorage.clear(); } catch(e) {}
    location.reload();
}

document.addEventListener('DOMContentLoaded', function() {
    try {
        var keys = Object.keys(localStorage);
        keys.forEach(function(k) { if (k.indexOf('dhub_') === 0) localStorage.removeItem(k); });
    } catch(e) {}
    initAuth();
});
