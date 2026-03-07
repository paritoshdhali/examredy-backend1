import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, Mail, MapPin, Twitter, Github, Linkedin, MessageCircle } from 'lucide-react';
import api from '../services/api';

const Footer = () => {
    const year = new Date().getFullYear();
    const [settings, setSettings] = useState(null);

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const res = await api.get('/settings');
                // The public /api/settings route simply returns an object map of settings directly in res.data
                if (res.data) {
                    console.log("[Footer] Loaded settings:", res.data); // Debugging log
                    setSettings(res.data);
                }
            } catch (err) {
                console.error("[Footer] Failed to load settings:", err);
            }
        };
        fetchSettings();
    }, []);

    return (
        <footer className="bg-white border-t border-gray-100 pt-20 pb-10">
            <div className="max-w-7xl mx-auto px-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 mb-16">

                    {/* Brand */}
                    <div className="space-y-6">
                        <Link to="/" className="flex items-center gap-2 group">
                            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20 group-hover:rotate-6 transition-transform">
                                <ShieldCheck className="text-white" size={20} />
                            </div>
                            <span className="text-gray-900 font-black text-xl tracking-tighter uppercase transition-colors group-hover:text-indigo-600">ExamRedy</span>
                        </Link>
                        <p className="text-gray-500 text-sm font-medium leading-relaxed">
                            Master your exams with AI-powered personalized MCQ sets and real-time competitive practice. Built for the next generation of achievers.
                        </p>
                        <div className="flex items-center gap-4">
                            {[Twitter, Github, Linkedin].map((Icon, i) => (
                                <a key={i} href="#" className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center text-gray-400 hover:bg-indigo-50 hover:text-indigo-600 transition-all">
                                    <Icon size={16} />
                                </a>
                            ))}
                        </div>
                    </div>

                    {/* Quick Links */}
                    <div>
                        <h4 className="text-gray-900 font-black text-[10px] uppercase tracking-[0.3em] mb-8">Navigation</h4>
                        <ul className="space-y-4">
                            {['Practice', 'Group Battle', 'Prime', 'About Us'].map((item) => (
                                <li key={item}>
                                    <Link
                                        to={item === 'About Us' ? '/about-us' : `/${item.toLowerCase().replace(' ', '')}`}
                                        className="text-gray-500 hover:text-indigo-600 text-sm font-bold transition-colors flex items-center gap-2 group"
                                    >
                                        <div className="w-1 h-1 bg-indigo-400 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                        {item}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Legal */}
                    <div>
                        <h4 className="text-gray-900 font-black text-[10px] uppercase tracking-[0.3em] mb-8">Legal Compliance</h4>
                        <ul className="space-y-4">
                            {[
                                { title: 'Privacy Policy', slug: 'privacy-policy' },
                                { title: 'Terms & Conditions', slug: 'terms-conditions' },
                                { title: 'Refund Policy', slug: 'refund-policy' },
                                { title: 'Disclaimer', slug: 'disclaimer' }
                            ].map((item) => (
                                <li key={item.slug}>
                                    <Link
                                        to={`/legal/${item.slug}`}
                                        className="text-gray-500 hover:text-indigo-600 text-sm font-bold transition-colors flex items-center gap-2 group"
                                    >
                                        <div className="w-1 h-1 bg-indigo-400 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                        {item.title}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Support */}
                    <div>
                        <h4 className="text-gray-900 font-black text-[10px] uppercase tracking-[0.3em] mb-8">Support & Help</h4>
                        <div className="space-y-4">
                            <div className="flex items-center gap-3 text-gray-500 text-sm font-bold group hover:text-indigo-600 transition-colors cursor-pointer">
                                <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center group-hover:bg-indigo-50 transition-colors">
                                    <Mail size={14} />
                                </div>
                                {(settings?.SUPPORT_EMAIL && settings.SUPPORT_EMAIL.trim() !== '' && settings.SUPPORT_EMAIL !== 'undefined') ? settings.SUPPORT_EMAIL : 'support@examredy.in'}
                            </div>
                            <div className="flex items-center gap-3 text-gray-500 text-sm font-bold">
                                <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center">
                                    <MapPin size={14} />
                                </div>
                                {(settings?.WHATSAPP_NUMBER && settings.WHATSAPP_NUMBER.trim() !== '' && settings.WHATSAPP_NUMBER !== 'undefined') ? settings.WHATSAPP_NUMBER : '+91 XXXX XXXX'}
                            </div>
                            <button className="w-full mt-4 flex items-center justify-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-indigo-500/20 hover:scale-105 active:scale-95 transition-all">
                                <MessageCircle size={14} /> Contact Expert
                            </button>
                        </div>
                    </div>

                </div>

                {/* Bottom */}
                <div className="pt-10 border-t border-gray-100 flex flex-col md:flex-row items-center justify-between gap-6">
                    <p className="text-gray-400 text-[10px] font-bold uppercase tracking-[0.2em]">
                        &copy; {year} ExamRedy . All rights reserved. Built with ❤️ for Students.
                    </p>
                    <div className="flex items-center gap-8">
                        <span className="text-[10px] font-black text-gray-300 uppercase tracking-widest">v1.2.5 Premium</span>
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                            <span className="text-gray-500 text-[10px] font-bold uppercase tracking-widest">Global MCQ Engine Active</span>
                        </div>
                    </div>
                </div>
            </div>
        </footer>
    );
};

export default Footer;
