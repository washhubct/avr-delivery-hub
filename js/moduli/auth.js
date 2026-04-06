// DELIVERY HUB v2 — Auth Module with role detection

function doLogin() {
    const email = document.getElementById('loginEmail').value.trim();
    const pw = document.getElementById('loginPassword').value;
    const errEl = document.getElementById('loginError');
    errEl.textContent = '';
    if (!email || !pw) { errEl.textContent = 'Inserisci email e password'; return; }
    document.getElementById('btnLogin').disabled = true;
    document.getElementById('btnLogin').textContent = 'Accesso...';

    auth.signInWithEmailAndPassword(email, pw)
        .catch(err => {
            errEl.textContent = err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password'
                ? 'Credenziali non valide' : 'Errore: ' + err.message;
        })
        .finally(() => {
            document.getElementById('btnLogin').disabled = false;
            document.getElementById('btnLogin').textContent = 'Accedi';
        });
}

function doLogout() { auth.signOut(); }

function initAuth() {
    auth.onAuthStateChanged(async user => {
        state.user = user;
        if (user) {
            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('sidebar').style.display = 'flex';

            // Detect role
            const isAdmin = ADMIN_EMAILS.includes(user.email.toLowerCase());
            state.userRole = isAdmin ? 'admin' : 'driver';

            if (isAdmin) {
                document.getElementById('navAdmin').style.display = 'block';
                document.getElementById('navDriver').style.display = 'none';
                document.getElementById('userName').textContent = 'Admin';
                document.getElementById('userRole').textContent = user.email;
            } else {
                document.getElementById('navAdmin').style.display = 'none';
                document.getElementById('navDriver').style.display = 'block';
                // Find driver profile by email
                const driverDoc = await db.collection('driverAnagrafica').where('email', '==', user.email).get();
                if (!driverDoc.empty) {
                    state.driverProfile = { id: driverDoc.docs[0].id, ...driverDoc.docs[0].data() };
                    document.getElementById('userName').textContent = `${state.driverProfile.cognome} ${state.driverProfile.nome}`;
                    document.getElementById('userRole').textContent = `Driver — ${state.aree[state.driverProfile.citta]?.nome || state.driverProfile.citta}`;
                } else {
                    document.getElementById('userName').textContent = user.email;
                    document.getElementById('userRole').textContent = 'Driver';
                }
            }

            initMeseSelector();
            await loadAllData();
            navigateTo(isAdmin ? 'dashboard' : 'driver-consegne');
        } else {
            document.getElementById('loginScreen').style.display = 'flex';
            document.getElementById('sidebar').style.display = 'none';
            document.querySelectorAll('.screen').forEach(s => {
                if (s.id !== 'loginScreen') s.style.display = 'none';
            });
        }
    });

    document.getElementById('loginPassword').addEventListener('keydown', e => {
        if (e.key === 'Enter') doLogin();
    });
}

function initMeseSelector() {
    const sel = document.getElementById('meseSelector');
    sel.innerHTML = '';
    const mesi = getMesiOptions();
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const def = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
    mesi.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.value; opt.textContent = m.label;
        if (m.value === def) opt.selected = true;
        sel.appendChild(opt);
    });
    state.meseCorrente = sel.value;
}

async function onMeseChange() {
    state.meseCorrente = document.getElementById('meseSelector').value;
    await loadConsegnePerMese();
    refreshCurrentModule();
}
