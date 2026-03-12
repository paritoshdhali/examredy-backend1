import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

// Firebase client-side config is safe to hardcode (it's public/visible in browser)
const firebaseConfig = {
  apiKey: "AIzaSyD7l7G3rQl6JG7QxA9aEKjYPL3cNf0XOHs",
  authDomain: "n8n-ai-news-agent.firebaseapp.com",
  projectId: "n8n-ai-news-agent",
  storageBucket: "n8n-ai-news-agent.firebasestorage.app",
  messagingSenderId: "1067421029126",
  appId: "1:1067421029126:web:3ff0bdf26ef3f977bd0487"
};

let app;
let auth;

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  console.log("Firebase initialized successfully");
} catch (error) {
  console.error("Failed to initialize Firebase:", error);
  auth = null;
}

export { app, auth };
