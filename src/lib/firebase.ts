import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  projectId: "nexo-bbbe5",
  appId: "1:133978874707:web:33df7acbce0767e05df7a6",
  apiKey: "AIzaSyC5ilHVF207qDYA90hScoIY2Oyl3qHlZvw",
  authDomain: "nexo-bbbe5.firebaseapp.com",
  storageBucket: "nexo-bbbe5.firebasestorage.app",
  messagingSenderId: "133978874707"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, "ai-studio-cbccfcf9-03ba-4abc-b8b3-aa4a1dba2a78");
export const auth = getAuth(app);
