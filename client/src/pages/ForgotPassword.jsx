import { useState } from 'react';
import { authService } from '../services/authService';
import { useNavigate, Link, useLocation } from 'react-router-dom'; // Import useLocation
import { Loader2, ArrowLeft,Eye, EyeOff } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { BRAND_LOGO_URL } from '../utils/branding.js';

export default function ForgotPassword() {
  const navigate = useNavigate();
  const location = useLocation(); // Hook to access state
  const toast = useToast();
  
  // Determine source: 'admin' or 'customer' (default)
  const source = location.state?.from || 'customer';
  const backLink = source === 'admin' ? '/admin/login' : '/login';
  const backText = source === 'admin' ? 'Back to Admin Login' : 'Back to Login';

  const [step, setStep] = useState(1); 
  const [identifier, setIdentifier] = useState('');
  const [delivery, setDelivery] = useState(null);
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);  

  const sentChannels = (delivery?.sent || []).filter(Boolean);
  const deliveryText = (() => {
    const parts = [];
    if (delivery?.contacts?.email) parts.push(`email ${delivery.contacts.email}`);
    if (delivery?.contacts?.whatsapp) parts.push(`WhatsApp ${delivery.contacts.whatsapp}`);
    if (!parts.length) return '';
    return parts.join(' and ');
  })();

  const handleSendOtp = async (e) => {
    e.preventDefault();
    const trimmedIdentifier = identifier.trim();
    if (!trimmedIdentifier) return toast.error("Enter your registered email or mobile number");

    setIsLoading(true);
    try {
        const res = await authService.sendOtp({ identifier: trimmedIdentifier, purpose: 'password_reset' });
        if (!res?.ok) {
            throw new Error(res?.message || "Failed to send OTP");
        }
        setDelivery(res.delivery || null);
        const currentChannels = Array.isArray(res?.delivery?.sent) ? res.delivery.sent.filter(Boolean) : [];
        toast.success(
          currentChannels.length
            ? `OTP sent via ${currentChannels.join(' and ')}`
            : "OTP sent successfully"
        );
        setStep(2);
    } catch (error) {
        toast.error(error?.message || "Failed to send OTP");
    } finally {
        setIsLoading(false);
    }
  };

  const handleReset = async (e) => {
    e.preventDefault();
    if (newPassword.length < 6) return toast.error("Password too short");

    setIsLoading(true);
    try {
        const res = await authService.resetPassword({ identifier: identifier.trim(), otp, newPassword });
        if (res.message.includes('successful')) {
            toast.success("Password Reset Successfully!");
            setTimeout(() => navigate(backLink), 2000); // Redirect to correct login
        } else {
            toast.error(res.message);
        }
    } catch (error) {
        toast.error("Server Error");
    } finally {
        setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-secondary p-4">
      <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-md border-t-4 border-accent">
        
        <div className="text-center mb-6">
            <img src={BRAND_LOGO_URL} alt="SSC Impon Jewellery" className="w-20 h-auto mx-auto mb-4" />
            <h2 className="text-2xl font-serif font-bold text-primary">Reset Password</h2>
            <p className="text-gray-500 text-sm">
                {source === 'admin' ? 'Admin Security Recovery' : 'Secure account recovery'}
            </p>
        </div>

        {step === 1 ? (
            <form onSubmit={handleSendOtp} className="space-y-4 animate-fade-in">
                <div>
                    <label className="block text-sm font-medium mb-1">Enter your registered email or mobile</label>
                    <input 
                        type="text"
                        placeholder="Email address or mobile number" 
                        className="input-field" 
                        value={identifier} 
                        onChange={e => setIdentifier(e.target.value)}
                        required 
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Google users can recover with email. Users with a registered mobile may receive OTP on both email and WhatsApp.
                    </p>
                </div>
                <button type="submit" className="btn-primary w-full" disabled={isLoading}>
                    {isLoading ? <Loader2 className="animate-spin" /> : "Send OTP"}
                </button>
            </form>
        ) : (
            <form onSubmit={handleReset} className="space-y-4 animate-fade-in">
                <div className="bg-green-50 p-3 rounded text-sm text-green-800 mb-2 border border-green-200">
                    OTP sent
                    {deliveryText ? <> via <b>{deliveryText}</b></> : null}
                    {!deliveryText && sentChannels.length ? <> via <b>{sentChannels.join(' and ')}</b></> : null}
                </div>
                <input 
                    placeholder="Enter OTP" 
                    className="input-field" 
                    value={otp} 
                    onChange={e => setOtp(e.target.value)} 
                    required 
                />
                <div className="relative">
                    <input 
                        placeholder="New Password" 
                        type={showPassword ? "text" : "password"} 
                        className="input-field pr-10" 
                        value={newPassword} 
                        onChange={e => setNewPassword(e.target.value)} 
                        required 
                    />
                    <button 
                        type="button" 
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-3 text-gray-400 hover:text-primary"
                    >
                        {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                    </button>
                </div>
                <button type="submit" className="btn-primary w-full" disabled={isLoading}>
                    {isLoading ? "Resetting..." : "Set New Password"}
                </button>
            </form>
        )}

        <div className="mt-6 text-center">
            {/* Dynamic Back Link */}
            <Link to={backLink} className="text-accent-deep text-sm flex items-center justify-center gap-2 hover:text-accent font-semibold transition-colors">
                <ArrowLeft size={16} /> {backText}
            </Link>
        </div>
      </div>
    </div>
  );
}
