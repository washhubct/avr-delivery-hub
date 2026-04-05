// DELIVERY HUB — Main App

async function loadAllData() {
    try {
        await Promise.all([
            loadConsegne(),
            loadFiliali()
        ]);
    } catch (err) {
        console.error('Error loading data:', err);
        toast('Errore nel caricamento dati', 'error');
    }
}

async function loadConsegne() {
    try {
        const snap = await db.collection(COLLECTIONS.consegne)
            .orderBy('data', 'desc')
            .limit(10000)
            .get();

        state.consegne = snap.docs.map(doc => {
            const d = doc.data();
            d.id = doc.id;
            // Convert Timestamp to Date
            if (d.data && d.data.toDate) d.data = d.data.toDate();
            return d;
        });

        console.log(`Loaded ${state.consegne.length} consegne from Firestore`);
    } catch (err) {
        console.warn('Firestore load error (may be empty):', err);
        state.consegne = [];
    }
}

async function loadFiliali() {
    try {
        const snap = await db.collection(COLLECTIONS.filiali).get();
        state.filiali = snap.docs.map(doc => {
            const d = doc.data();
            d.id = doc.id;
            return d;
        });

        // Build lookup map
        state.filialiMap = {};
        state.filiali.forEach(f => {
            state.filialiMap[String(f.codice)] = f;
        });

        console.log(`Loaded ${state.filiali.length} filiali from Firestore`);
    } catch (err) {
        console.warn('Filiali load error:', err);
        state.filiali = [];
    }
}

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
    initAuth();
});
