import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// Check if any config is missing
const missingKeys = Object.entries(firebaseConfig)
  .filter(([_, value]) => !value || value === 'your_firebase_api_key_here')
  .map(([key]) => key);

if (missingKeys.length > 0) {
  console.warn("Firebase configuration is missing or incomplete:", missingKeys);
}

let app;
let auth;

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
} catch (error) {
  console.error("Failed to initialize Firebase:", error);
  // Provide a fallback or dummy auth object to prevent total crash if possible, 
  // though most auth operations will fail.
  auth = null; 
}

export { app, auth };
