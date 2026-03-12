import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useGoogleLogin } from '@react-oauth/google';
import { RecaptchaVerifier, signInWithPhoneNumber } from 'firebase/auth';
import { auth } from '../config/firebase';

const Register = () => {
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [googleLoading, setGoogleLoading] = useState(false);
    
    // Phone Auth states
    const [isPhoneMode, setIsPhoneMode] = useState(false);
    const [phoneNumber, setPhoneNumber] = useState('');
    const [otp, setOtp] = useState('');
    const [confirmationResult, setConfirmationResult] = useState(null);
    const [phoneLoading, setPhoneLoading] = useState(false);

    const { register, googleLogin, phoneLogin } = useAuth();
    const navigate = useNavigate();

    // Initialize recaptcha if not already done
    React.useEffect(() => {
        if (!window.recaptchaVerifier) {
            window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
                'size': 'invisible',
                'callback': (response) => {
                    // reCAPTCHA solved
                }
            });
        }
    }, []);

    // Get referral code from URL
    const searchParams = new URLSearchParams(window.location.search);
    const referrerId = searchParams.get('ref');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            console.log('Attempting to register user:', { username, email });
            await register(username, email, password, referrerId);
            console.log('Registration successful, navigating to home');
            navigate('/');
        } catch (err) {
            console.error('Registration failed caught in component:', err);
            setError(err.response?.data?.message || err.message || 'Registration failed');
        } finally {
            setLoading(false);
        }
    };

    const handleGoogleLogin = useGoogleLogin({
        onSuccess: async (tokenResponse) => {
            try {
                setGoogleLoading(true);
                const user = await googleLogin(tokenResponse.access_token, referrerId);
                if (user.role === 'admin') {
                    navigate('/admin/dashboard');
                } else {
                    navigate('/');
                }
            } catch (err) {
                setError('Google authentication failed');
            } finally {
                setGoogleLoading(false);
            }
        },
        onError: () => setError('Google Sign-In was cancelled or failed')
    });

    const handleSendOtp = async (e) => {
        e.preventDefault();
        setError('');
        setPhoneLoading(true);
        try {
            const formattedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+91${phoneNumber}`;
            const appVerifier = window.recaptchaVerifier;
            const confirmation = await signInWithPhoneNumber(auth, formattedPhone, appVerifier);
            setConfirmationResult(confirmation);
        } catch (err) {
            console.error(err);
            setError(err.message || 'Failed to send OTP. Please check the number.');
        } finally {
            setPhoneLoading(false);
        }
    };

    const handleVerifyOtp = async (e) => {
        e.preventDefault();
        setError('');
        setPhoneLoading(true);
        try {
            const result = await confirmationResult.confirm(otp);
            // Result contains the firebase user
            const idToken = await result.user.getIdToken();
            const user = await phoneLogin(idToken, referrerId); // Use phoneLogin and pass referrer
            if (user.role === 'admin') {
                navigate('/admin/dashboard');
            } else {
                navigate('/');
            }
        } catch (err) {
            console.error(err);
            setError(err.message || 'Invalid OTP');
        } finally {
            setPhoneLoading(false);
        }
    };

    return (
        <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center bg-gray-50 px-4">
            <div className="max-w-md w-full bg-white rounded-lg shadow-md p-8">
                <div className="text-center mb-8">
                    <h2 className="text-3xl font-bold text-gray-900">Create Account</h2>
                    <p className="text-gray-600 mt-2">Join ExamRedy today</p>
                </div>

                {error && <div className="bg-red-100 text-red-700 p-3 rounded mb-4 text-center">{error}</div>}

                <form onSubmit={handleSubmit} className="space-y-6">
                    <button
                        type="button"
                        onClick={() => handleGoogleLogin()}
                        disabled={googleLoading}
                        className="w-full flex items-center justify-center gap-3 py-2.5 px-4 border border-gray-300 rounded-xl shadow-sm text-sm font-bold text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-200 transition-all disabled:opacity-70"
                    >
                        {googleLoading ? (
                            <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-700 rounded-full animate-spin"></div>
                        ) : (
                            <svg className="w-5 h-5" viewBox="0 0 24 24">
                                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                            </svg>
                        )}
                        Continue with Google
                    </button>

                    <div className="relative my-6">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-gray-200"></div>
                        </div>
                        <div className="relative flex justify-center text-sm">
                            <span className="px-4 bg-white text-gray-400 font-bold uppercase tracking-widest text-[10px]">Or continue with</span>
                        </div>
                    </div>

                    <div className="flex gap-4 mb-6">
                        <button
                            type="button"
                            onClick={() => { setIsPhoneMode(false); setConfirmationResult(null); setError(''); }}
                            className={`flex-1 py-2 text-sm font-bold rounded-xl border ${!isPhoneMode ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-gray-200 text-gray-500'}`}
                        >
                            Email
                        </button>
                        <button
                            type="button"
                            onClick={() => { setIsPhoneMode(true); setError(''); }}
                            className={`flex-1 py-2 text-sm font-bold rounded-xl border ${isPhoneMode ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-gray-200 text-gray-500'}`}
                        >
                            Phone
                        </button>
                    </div>

                    {!isPhoneMode ? (
                        <>
                            <div>
                                <label className="block text-sm font-bold text-gray-700 uppercase tracking-widest text-[11px] mb-2">Username</label>
                                <input
                                    type="text"
                                    required
                                    className="block w-full px-4 py-3 border border-gray-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-gray-700 uppercase tracking-widest text-[11px] mb-2">Email Address</label>
                                <input
                                    type="email"
                                    required
                                    className="block w-full px-4 py-3 border border-gray-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-gray-700 uppercase tracking-widest text-[11px] mb-2">Password</label>
                                <input
                                    type="password"
                                    required
                                    className="block w-full px-4 py-3 border border-gray-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={loading || googleLoading}
                                className="w-full flex justify-center items-center gap-2 py-3 px-4 border border-transparent rounded-xl shadow-xl shadow-indigo-200 text-sm font-black uppercase tracking-widest text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all disabled:bg-indigo-400 disabled:cursor-not-allowed"
                            >
                                {loading ? (
                                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                ) : 'Sign Up'}
                            </button>
                        </>
                    ) : (
                        <div className="space-y-4">
                            {!confirmationResult ? (
                                <>
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 uppercase tracking-widest text-[11px] mb-2">Phone Number</label>
                                        <div className="flex">
                                            <span className="inline-flex items-center px-3 rounded-l-xl border border-r-0 border-gray-200 bg-gray-50 text-gray-500 sm:text-sm">
                                                +91
                                            </span>
                                            <input
                                                type="tel"
                                                required
                                                placeholder="Enter 10 digit number"
                                                className="block w-full px-4 py-3 border border-gray-200 rounded-r-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                                                value={phoneNumber.replace('+91', '')}
                                                onChange={(e) => setPhoneNumber(e.target.value)}
                                            />
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleSendOtp}
                                        disabled={phoneLoading || !phoneNumber}
                                        className="w-full flex justify-center items-center gap-2 py-3 px-4 border border-transparent rounded-xl shadow-xl shadow-indigo-200 text-sm font-black uppercase tracking-widest text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                                    >
                                        {phoneLoading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : 'Send OTP'}
                                    </button>
                                </>
                            ) : (
                                <>
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 uppercase tracking-widest text-[11px] mb-2">Enter OTP</label>
                                        <input
                                            type="text"
                                            required
                                            placeholder="6-digit OTP"
                                            className="block w-full px-4 py-3 border border-gray-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all text-center tracking-widest font-bold"
                                            value={otp}
                                            onChange={(e) => setOtp(e.target.value)}
                                            maxLength={6}
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleVerifyOtp}
                                        disabled={phoneLoading || otp.length < 6}
                                        className="w-full flex justify-center items-center gap-2 py-3 px-4 border border-transparent rounded-xl shadow-xl shadow-indigo-200 text-sm font-black uppercase tracking-widest text-white bg-green-600 hover:bg-green-700 disabled:bg-green-400 focus:outline-none"
                                    >
                                        {phoneLoading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : 'Verify & Continue'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => { setConfirmationResult(null); setOtp(''); }}
                                        className="w-full text-center text-sm text-indigo-600 font-semibold mt-2"
                                    >
                                        Change Phone Number
                                    </button>
                                </>
                            )}
                        </div>
                    )}
                </form>

                {/* reCAPTCHA container must be present in DOM */}
                <div id="recaptcha-container"></div>

                <div className="mt-6 text-center">
                    <p className="text-sm text-gray-600">
                        Already have an account?{' '}
                        <Link to="/login" className="font-medium text-primary hover:text-indigo-500">
                            Log in
                        </Link>
                    </p>
                </div>
            </div>
        </div>
    );
};

export default Register;
