import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { authService } from '../../services/authService';

import { auth, googleProvider } from '../../firebase';
import { signInWithPopup, signOut } from 'firebase/auth';
import { useAuth } from '../../context/AuthContext'; // [NEW] Import Context
import { ShieldCheck, Lock, Eye, EyeOff } from 'lucide-react';
import { useToast } from '../../context/ToastContext';

export default function AdminLogin() {
    const [formData, setFormData] = useState({ identifier: '', password: '' });
    const [showPassword, setShowPassword] = useState(false);
    
    const navigate = useNavigate();
    const toast = useToast();
    const { login, user } = useAuth(); // [NEW] Get login and user from Brain

    // [NEW] Auto-Redirect if already logged in as Admin
    useEffect(() => {
        if (user && (user.role === 'admin' || user.role === 'staff')) {
            navigate('/admin/dashboard', { replace: true });
        }
    }, [user, navigate]);

    const handleLogin = async (e) => {
        e.preventDefault();
        try {
            const res = await authService.login({ type: 'password', ...formData });
            if (res.token) {
                // Role Check
                if (res.user.role !== 'admin' && res.user.role !== 'staff') {
                    toast.error("Access Denied: You are not an Admin");
                    return;
                }

                // [FIX] Use Context Login (Updates Global State Instantly)
                login(res.token, res.user);

                toast.success(`Welcome, ${res.user.name || "Admin"}!`);
                // Navigation is handled by the useEffect above automatically
            } else {
                toast.error(res.message);
            }
        } catch {
            toast.error("Login Failed");
        }
    };

     // --- GOOGLE LOGIN HANDLER ---
        const handleGoogleLogin = async () => {
            try {
                // 1. Force Clean Slate (Prevents session conflicts)
                await signOut(auth);
    
                // 2. Open Google Popup
                const result = await signInWithPopup(auth, googleProvider);
                const firebaseToken = await result.user.getIdToken();
    
                // 3. Send to Backend
                const res = await authService.socialLogin(firebaseToken);
    
                if (res.token) {
                    // [SECURITY] 4. Strict Role Check
                    if (res.user.role !== 'admin' && res.user.role !== 'staff') {
                        toast.error("Access Denied: You are not an Admin");
                        // Force logout immediately so they aren't stuck in a 'customer' session on the admin page
                        await signOut(auth); 
                        return;
                    }
    
                    // 5. Success - Update Context & Redirect
                    login(res.token, res.user);
                    toast.success(`Welcome, ${res.user.name || "Admin"}!`);
                    // Navigation handled by useEffect
                } else {
                    toast.error(res.message || "Google Login Failed");
                }
            } catch (error) {
                console.error("Admin Google Login Error:", error);
                if (error.code !== 'auth/popup-closed-by-user') {
                    toast.error("Google Sign-In Failed");
                }
            }
        };

    return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-[#0A192F] via-[#112240] to-[#0A192F] fixed inset-0 overflow-hidden">
            <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '40px 40px' }}></div>

            <div className="bg-white/5 backdrop-blur-xl border border-white/10 p-8 rounded-2xl w-full max-w-sm shadow-2xl animate-slide-in relative z-10">
                
                {/* Header */}
                <div className="flex flex-col items-center mb-8">
                    <div className="bg-accent p-4 rounded-full shadow-lg shadow-accent/20 mb-4 animate-bounce-slow">
                        <ShieldCheck className="text-primary w-10 h-10" />
                    </div>
                    <h1 className="text-xl font-serif font-bold text-accent tracking-wide text-center uppercase">
                        SSC Impon Jewellery
                    </h1>
                    <p className="text-gray-400 text-xs tracking-widest mt-1">Administration Portal</p>
                </div>
                
                <form onSubmit={handleLogin} className="space-y-5">
                    <div className="relative group">
                        <input 
                            className="w-full bg-black/20 border border-white/10 text-white px-4 py-3.5 rounded-xl focus:border-accent focus:ring-1 focus:ring-accent outline-none placeholder-gray-500 transition-all group-hover:border-white/20"
                            placeholder="Admin Email"
                            value={formData.identifier}
                            onChange={e => setFormData({...formData, identifier: e.target.value})}
                        />
                    </div>
                    <div className="relative group">
                        <input 
                            type={showPassword ? "text" : "password"} 
                            className="w-full bg-black/20 border border-white/10 text-white px-4 py-3.5 rounded-xl focus:border-accent focus:ring-1 focus:ring-accent outline-none placeholder-gray-500 transition-all group-hover:border-white/20 pr-10" 
                            placeholder="Password"
                            value={formData.password}
                            onChange={e => setFormData({...formData, password: e.target.value})}
                        />
                        <button 
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-3.5 text-gray-500 hover:text-white transition-colors"
                        >
                            {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                        </button>
                    </div>
                    
                    <div className="text-right">
                        <Link 
                            to="/forgot-password" 
                            state={{ from: 'admin' }} 
                            className="text-xs text-accent/80 hover:text-accent hover:underline transition-colors"
                        >
                            Forgot Password?
                        </Link>
                    </div>

                    <button className="w-full bg-accent hover:bg-accent-hover text-primary font-bold py-3.5 rounded-xl shadow-lg shadow-accent/10 transition-all active:scale-95 text-sm uppercase tracking-wider">
                        Secure Login
                    </button>
                    {/* --- NEW: DIVIDER & GOOGLE BUTTON --- */}
                    <div className="relative py-2">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-white/10"></div>
                        </div>
                        <div className="relative flex justify-center text-[10px] uppercase tracking-widest text-gray-500">
                            <span className="bg-[#0f213e] px-2">Or Access Via</span>
                        </div>
                    </div>

                    <button 
                        type="button"
                        onClick={handleGoogleLogin}
                        className="w-full bg-white hover:bg-gray-50 text-gray-800 font-bold py-3.5 rounded-xl shadow-lg transition-all active:scale-95 text-sm flex items-center justify-center gap-3"
                    >
                        {/* Google SVG Icon */}
                        <svg className="w-5 h-5" viewBox="0 0 24 24">
                            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                        </svg>
                        Google Admin Access
                    </button>
                </form>

            </div>
        </div>
    );
}
