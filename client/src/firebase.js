// client/src/firebase.js
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, OAuthProvider } from "firebase/auth";
import { getAnalytics } from "firebase/analytics";


const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: "ssc-impon-jewellery.firebaseapp.com",
  projectId: "ssc-impon-jewellery",
  storageBucket: "ssc-impon-jewellery.firebasestorage.app",
  messagingSenderId: "831006915410",
  appId: "1:831006915410:web:15850b4acad6ca6cd9188b",
  measurementId: "G-YD44X0T3V5"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const appleProvider = new OAuthProvider('apple.com');
const analytics = getAnalytics(app);
