// DELIVERY HUB — Auth Module

function doLogin() {
    const email = document.getElementById('loginEmail').value.trim();
    const pw = document.getElementById('loginPassword').value;
    const errEl = document.getElementById('loginError');
    errEl.textContent = '';

    if (!email || !pw) {
        errEl.textContent = 'Inserisci email e password';
        return;
    }

    document.getElementById('btnLogin').disabled = true;
    document.getElementById('btnLogin').textContent = 'Accesso...';

    auth.signInWithEmailAndPassword(email, pw)
        .then(() => {
            // onAuthStateChanged handles the rest
        })
        .catch(err => {
            console.error('Login error:', err);
            errEl.textContent = err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password'
                ? 'Credenziali non valide'
                : err.code === 'auth/too-many-requests'
                    ? 'Troppi tentativi, riprova tra poco'
                    : 'Errore di accesso: ' + err.message;
        })
        .finally(() => {
            document.getElementById('btnLogin').disabled = false;
            document.getElementById('btnLogin').textContent = 'Accedi';
        });
}

function doLogout() {
    auth.signOut();
}

function initAuth() {
    auth.onAuthStateChanged(user => {
        state.user = user;
        if (user) {
            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('userEmail').textContent = user.email;
            document.getElementById('sidebar').style.display = 'flex';
            
            // Init month selector
            initMeseSelector();
            
            // Load initial data & show dashboard
            loadAllData().then(() => {
                navigateTo('dashboard');
            });
        } else {
            document.getElementById('loginScreen').style.display = 'flex';
            document.getElementById('sidebar').style.display = 'none';
            // Hide all screens
            document.querySelectorAll('.screen').forEach(s => {
                if (s.id !== 'loginScreen') s.style.display = 'none';
            });
        }
    });

    // Enter key on login
    document.getElementById('loginPassword').addEventListener('keydown', e => {
        if (e.key === 'Enter') doLogin();
    });
}

function initMeseSelector() {
    const sel = document.getElementById('meseSelector');
    sel.innerHTML = '';
    const mesi = getMesiOptions();
    
    // Default to previous month (usually what you're reconciling)
    const now = new Date();
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const defaultMese = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}`;
    
    mesi.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.value;
        opt.textContent = m.label;
        if (m.value === defaultMese) opt.selected = true;
        sel.appendChild(opt);
    });
    
    state.meseCorrente = sel.value;
}

function onMeseChange() {
    state.meseCorrente = document.getElementById('meseSelector').value;
    // Reload current module data
    refreshCurrentModule();
}
