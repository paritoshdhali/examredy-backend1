import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { BrowserRouter } from 'react-router-dom'
import { GoogleOAuthProvider } from '@react-oauth/google'
import api from './services/api' // Make sure api service is imported

const RootApp = () => {
    const [clientId, setClientId] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                // Fetch public settings from backend
                const res = await api.get('/settings');
                // The backend returns an object of key-value settings.
                setClientId(res.data.GOOGLE_CLIENT_ID || '');
            } catch (error) {
                console.error("Failed to load generic settings:", error);
                setClientId('');
            } finally {
                setLoading(false);
            }
        };
        fetchSettings();
    }, []);

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <GoogleOAuthProvider clientId={clientId || "dummy_client_id_to_prevent_crash"}>
            <BrowserRouter>
                <App />
            </BrowserRouter>
        </GoogleOAuthProvider>
    );
};

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <RootApp />
    </React.StrictMode>,
)
