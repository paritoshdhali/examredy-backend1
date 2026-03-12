import React, { createContext, useState, useEffect, useContext } from 'react';
import api from '../services/api';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // On mount, restore session from localStorage token (for email/admin login)
        const restoreSession = async () => {
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            if (token) {
                try {
                    const res = await api.get('/auth/me');
                    setUser(res.data);
                } catch (error) {
                    console.error("Token validation failed:", error);
                    localStorage.removeItem('token');
                    localStorage.removeItem('adminToken');
                    setUser(null);
                }
            } else {
                setUser(null);
            }
            setLoading(false);
        };

        restoreSession();
    }, []);

    const setAuthData = (data) => {
        if (data.token) {
            if (data.role === 'admin') {
                localStorage.setItem('adminToken', data.token);
                localStorage.removeItem('token');
            } else {
                localStorage.setItem('token', data.token);
                localStorage.removeItem('adminToken');
            }
        }
        setUser(data.user || data);
    };

    const login = async (email, password) => {
        const res = await api.post('/auth/login', { email, password });
        setAuthData(res.data);
        return res.data;
    };

    const register = async (username, email, password, referrerId = null) => {
        const res = await api.post('/auth/register', { username, email, password, referrer_id: referrerId });
        setAuthData(res.data);
        return res.data;
    };

    const logout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('adminToken');
        setUser(null);
    };

    const googleLogin = async (credential, referrerId = null) => {
        const res = await api.post('/auth/google', { credential, referrer_id: referrerId });
        setAuthData(res.data);
        return res.data;
    };

    const phoneLogin = async (idToken, referrerId = null) => {
        const res = await api.post('/auth/phone', { idToken, referrer_id: referrerId });
        setAuthData(res.data);
        return res.data;
    };

    return (
        <AuthContext.Provider value={{ user, login, register, googleLogin, phoneLogin, logout, loading, setAuthData }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
