// DELIVERY HUB — Firebase Configuration
// Guido: inserisci qui la config del tuo progetto Firebase
// Puoi usare lo stesso progetto dashboard-washhub o crearne uno nuovo

const firebaseConfig = {
    apiKey: "AIzaSyCleejDdWN6w41TcBw4fvyAPr_6rxU8Bgs",
    authDomain: "avr-logistic-dashboard.firebaseapp.com",
    projectId: "avr-logistic-dashboard",
    storageBucket: "avr-logistic-dashboard.firebasestorage.app",
    messagingSenderId: "323721042739",
    appId: "1:323721042739:web:a9fa1710eeb8cfe3357c46"
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();

// Collections reference
const COLLECTIONS = {
    consegne: 'consegne',
    filiali: 'filiali',
    driver: 'driver',
    riconciliazione: 'riconciliazione',
    importDeco: 'importDeco',
    config: 'config'
};
