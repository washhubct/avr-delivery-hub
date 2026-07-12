// DELIVERY HUB v2 — Auth Module with roles + auto-logout a mezzanotte + log accessi

var SUPER_ADMIN_EMAILS = [
    'amministrazione@avrlogisticarl.com'
];

var STAFF_EMAILS = [
    'michela@avrlogisticarl.com',
    'alessandra@avrlogisticarl.com'
];

function getUserRole(email) {
    var e = email.toLowerCase();
    if (SUPER_ADMIN_EMAILS.indexOf(e) >= 0) return 'superadmin';
    if (STAFF_EMAILS.indexOf(e) >= 0) return 'staff';
    return 'driver';
}

// Registra accesso in Firestore
async function logAccesso(user, role) {
    try {
        var ua = navigator.userAgent || '';
        var isMobile = /Mobile|Android|iPhone|iPad/i.test(ua);
        await db.collection('accessLog').add({
            email: user.email,
            uid: user.uid,
            ruolo: role,
            dispositivo: isMobile ? 'Mobile' : 'Desktop',
            browser: ua.length > 120 ? ua.substring(0, 120) : ua,
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            data: new Date().toLocaleDateString('it-IT', {day:'2-digit', month:'2-digit', year:'numeric'})
        });
    } catch (e) {
        console.warn('Errore log accesso:', e.message);
    }
}

function doLogin() {
    var email = document.getElementById('loginEmail').value.trim();
    var pw = document.getElementById('loginPassword').value;
    var errEl = document.getElementById('loginError');
    errEl.textContent = '';
    if (!email || !pw) { errEl.textContent = 'Inserisci email e password'; return; }
    document.getElementById('btnLogin').disabled = true;
    document.getElementById('btnLogin').textContent = 'Accesso...';

    auth.signInWithEmailAndPassword(email, pw)
        .catch(function(err) {
            var msg = 'Errore di accesso';
            if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') msg = 'Credenziali non valide';
            if (err.code === 'auth/too-many-requests') msg = 'Troppi tentativi, riprova tra poco';
            errEl.textContent = msg;
        })
        .finally(function() {
            document.getElementById('btnLogin').disabled = false;
            document.getElementById('btnLogin').textContent = 'Accedi';
        });
}

function doLogout() { auth.signOut(); }

function initAuth() {
    auth.onAuthStateChanged(async function(user) {
        state.user = user;
        if (user) {
            document.body.classList.remove('is-login');
            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('sidebar').style.display = 'flex';

            var role = getUserRole(user.email);
            state.userRole = role;

            // Log accesso
            await logAccesso(user, role);

            if (role === 'superadmin' || role === 'staff') {
                document.getElementById('navAdmin').style.display = 'block';
                document.getElementById('navDriver').style.display = 'none';

                var adminOnlyItems = document.querySelectorAll('.nav-superadmin');
                adminOnlyItems.forEach(function(el) {
                    el.style.display = role === 'superadmin' ? 'block' : 'none';
                });

                if (role === 'superadmin') {
                    document.getElementById('userName').textContent = 'Amministratore';
                    document.getElementById('userRole').textContent = user.email;
                } else {
                    var name = user.email.split('@')[0];
                    name = name.charAt(0).toUpperCase() + name.slice(1);
                    document.getElementById('userName').textContent = name;
                    document.getElementById('userRole').textContent = 'Staff';
                }
            } else {
                document.getElementById('navAdmin').style.display = 'none';
                document.getElementById('navDriver').style.display = 'block';
                var driverDoc = await db.collection('driverAnagrafica').where('email', '==', user.email).get();
                if (!driverDoc.empty) {
                    state.driverProfile = { id: driverDoc.docs[0].id, ...driverDoc.docs[0].data() };
                    document.getElementById('userName').textContent = state.driverProfile.cognome + ' ' + state.driverProfile.nome;
                    document.getElementById('userRole').textContent = 'Driver — ' + (state.aree[state.driverProfile.citta] ? state.aree[state.driverProfile.citta].nome : state.driverProfile.citta);
                } else {
                    document.getElementById('userName').textContent = user.email;
                    document.getElementById('userRole').textContent = 'Driver';
                }
            }

            initMeseSelector();
            await loadAllData();

            if (role === 'superadmin') {
                navigateTo('dashboard');
            } else if (role === 'staff') {
                navigateTo('consegne');
            } else {
                navigateTo('driver-consegne');
            }

            // Auto-logout a mezzanotte
            var now = new Date();
            var midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
            var msToMidnight = midnight - now;
            setTimeout(function() { auth.signOut(); location.reload(); }, msToMidnight);

        } else {
            document.body.classList.add('is-login');
            document.getElementById('loginScreen').style.display = 'flex';
            document.getElementById('sidebar').style.display = 'none';
            document.querySelectorAll('.screen').forEach(function(s) {
                if (s.id !== 'loginScreen') s.style.display = 'none';
            });
        }
    });

    document.getElementById('loginPassword').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') doLogin();
    });
}

function initMeseSelector() {
    var sel = document.getElementById('meseSelector');
    sel.innerHTML = '';
    var mesi = getMesiOptions();
    var now = new Date();
    var def = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    mesi.forEach(function(m) {
        var opt = document.createElement('option');
        opt.value = m.value; opt.textContent = m.label;
        if (m.value === def) opt.selected = true;
        sel.appendChild(opt);
    });
    state.meseCorrente = sel.value;
}

// onMeseChange è definita in js/main.js (carica anche reportDriver e ritorni).
