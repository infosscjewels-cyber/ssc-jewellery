import { useState, useEffect } from 'react';
import { authService } from '../services/authService';
import { useNavigate, Link } from 'react-router-dom';
import { Loader2, Check, X as XIcon, AlertCircle,Eye, EyeOff } from 'lucide-react';
import { useToast } from '../context/ToastContext'; 
import { BRAND_LOGO_URL } from '../utils/branding.js'; 

export default function Register() {
  const navigate = useNavigate();
  const toast = useToast(); 
  
  const [formData, setFormData] = useState({
    name: '', email: '', mobile: '', password: '', 
    addressLine1: '', city: '', state: '', zip: '', otp: '',
    dob: ''
  });
  
  const [errors, setErrors] = useState({});
  const [otpSent, setOtpSent] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [timer, setTimer] = useState(0); 
  const [otpStatus, setOtpStatus] = useState('neutral'); 
  const [showPassword, setShowPassword] = useState(false);
  // NEW: Specific state for "User Already Exists" error
  const [userExistsError, setUserExistsError] = useState(false);

  useEffect(() => {
    let interval;
    if (timer > 0) interval = setInterval(() => setTimer((prev) => prev - 1), 1000);
    return () => clearInterval(interval);
  }, [timer]);

  // --- OTP VERIFICATION ---
  useEffect(() => {
    const verifyOtpInput = async () => {
        if (formData.otp.length === 6) {
            setOtpStatus('checking');
            try {
                const res = await authService.verifyOtp(formData.mobile, formData.otp);
                setOtpStatus(res.valid ? 'valid' : 'invalid');
            } catch (error) {
                setOtpStatus('invalid');
            }
        } else if (formData.otp.length < 6) {
            setOtpStatus('neutral'); 
        }
    };
    const timeoutId = setTimeout(verifyOtpInput, 500);
    return () => clearTimeout(timeoutId);
  }, [formData.otp, formData.mobile]);


  // --- VALIDATION HELPER ---
  const validateField = (name, value) => {
    if (name === 'mobile' && !/^[0-9]{10}$/.test(value)) return "Invalid mobile (10 digits)";
    
    // NEW: Real-time Password Validation
    if (name === 'password') {
        if (value.length > 0 && value.length < 6) return "Password must be at least 6 characters";
    }

    //Real time PIN code validation
    if (name === 'zip') {
        if (!/^\d{6}$/.test(value)) return "Invalid Pincode (6 digits required)";
    }
    return "";
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    // RESTRICTION: For Mobile and Zip, only allow numbers
    if ((name === 'mobile' || name === 'zip') && !/^\d*$/.test(value)) {
        return; // Ignore the keystroke if it's not a number
    }
    setFormData({ ...formData, [name]: value });
    
    // Clear "User Exists" error if they change email or mobile
    if (name === 'email' || name === 'mobile') setUserExistsError(false);

    // Reset OTP status if user types
    if (name === 'otp') setOtpStatus('neutral');

    const error = validateField(name, value);
    setErrors({ ...errors, [name]: error });
  };

  const handleSendOtp = async () => {
    const mobileError = validateField('mobile', formData.mobile);
    if (mobileError) {
        setErrors({ ...errors, mobile: mobileError });
        toast.error(mobileError);
        return;
    }
    setIsLoading(true);
    try {
        await authService.sendOtp(formData.mobile);
        setOtpSent(true);
        setTimer(30);
        toast.success("OTP Sent! Check Server Console.");
        setOtpStatus('neutral');
    } catch (error) {
        toast.error("Failed to send OTP.");
    } finally {
        setIsLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // 1. Check for Password Errors before submitting
    if (formData.password.length < 6) {
        setErrors({...errors, password: "Password must be at least 6 characters"});
        return;
    }

    if (otpStatus !== 'valid') return toast.error("Please enter a valid OTP first.");
    
    // Construct payload
    const addressPayload = formData.addressLine1
        ? { line1: formData.addressLine1, city: formData.city, state: formData.state, zip: formData.zip }
        : null;
    const payload = { 
        ...formData, 
        address: addressPayload,
        billingAddress: addressPayload,
        dob: formData.dob || null
    };

    try {
        const res = await authService.register(payload);
        
        if (res.token) {
            toast.success("Registration Successful!");
            setTimeout(() => navigate('/login'), 1500);
        } else {
            // Handle User Exists Error
            if (res.message === 'User already exists') {
                setUserExistsError(true);
                toast.error("Account already exists");
            } else {
                toast.error(res.message || "Registration failed");
            }
        }
    } catch (error) {
        toast.error("Error connecting to server");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-secondary p-4">
      <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-lg border-t-4 border-accent">
        
        <div className="text-center mb-6">
            <img src={BRAND_LOGO_URL} alt="SSC Impon Jewellery" className="w-24 h-auto mx-auto mb-4" />
            <h2 className="text-3xl font-serif font-bold text-primary">Create Account</h2>
        </div>

        {/* --- NEW: User Exists Warning --- */}
        {userExistsError && (
            <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3 animate-fade-in">
                <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={20} />
                <div>
                    <p className="text-red-800 font-medium text-sm">Account already exists</p>
                    <p className="text-red-600 text-xs mt-1">
                        A user with this email or mobile already exists. 
                        <Link to="/login" className="font-bold underline ml-1 hover:text-red-800">Login here</Link>
                    </p>
                </div>
            </div>
        )}
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input name="name" placeholder="Full Name" className="input-field" value={formData.name} onChange={handleChange} required />
              <input name="email" placeholder="Email Address" type="email" className="input-field" value={formData.email} onChange={handleChange} required />
              <div className="md:col-span-2">
                  <label className="text-xs font-bold text-gray-500 uppercase block mb-1">Date of Birth (Optional)</label>
                  <input name="dob" type="date" className="input-field" value={formData.dob} onChange={handleChange} />
              </div>
          </div>
          
          <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
              <p className="text-xs font-bold text-gray-400 mb-2 uppercase tracking-wide">Mobile Verification</p>
              
              <div className="flex gap-2 mb-2">
                <input name="mobile" placeholder="Mobile Number" className="input-field flex-1" value={formData.mobile} onChange={handleChange} required />
                <button 
                    type="button" onClick={handleSendOtp} disabled={isLoading || timer > 0}
                    className={`px-4 rounded-lg text-sm font-medium transition-colors min-w-[100px]
                        ${(isLoading || timer > 0) ? 'bg-gray-300 text-gray-500' : 'bg-primary text-accent hover:bg-primary-light'}`}
                >
                    {isLoading ? <Loader2 className="animate-spin w-4 h-4" /> : (timer > 0 ? `${timer}s` : "Send OTP")}
                </button>
              </div>
              
              {otpSent && (
                <div className="relative animate-fade-in mt-2">
                    <input 
                        name="otp" placeholder="Enter 6-digit OTP" maxLength={6}
                        className={`input-field pr-10 border-2 
                            ${otpStatus === 'valid' ? 'border-green-500 bg-green-50 text-green-700' : ''}
                            ${otpStatus === 'invalid' ? 'border-red-500 bg-red-50 text-red-700' : ''}
                            ${otpStatus === 'neutral' || otpStatus === 'checking' ? 'border-accent ring-1 ring-accent' : ''}
                        `}
                        value={formData.otp} onChange={handleChange} required 
                    />
                    <div className="absolute right-3 top-3">
                        {otpStatus === 'valid' && <Check className="text-green-600" size={20} />}
                        {otpStatus === 'invalid' && <XIcon className="text-red-600" size={20} />}
                        {otpStatus === 'checking' && <Loader2 className="animate-spin text-gray-400" size={20} />}
                    </div>
                </div>
              )}
          </div>

          {/* --- NEW: Password Field with Warning --- */}
          <div>
            <div className="relative">
                <input 
                    name="password" 
                    placeholder="Password" 
                    type={showPassword ? "text" : "password"} 
                    className={`input-field pr-10 ${errors.password ? 'border-red-500 ring-1 ring-red-500' : ''}`}
                    value={formData.password} 
                    onChange={handleChange} 
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
            {/* Show error immediately while typing if length < 6 and length > 0 */}
            {errors.password && (
                <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                    <AlertCircle size={12} /> {errors.password}
                </p>
            )}
          </div>

          <div className="border-t pt-4 mt-2">
            <p className="text-sm font-medium text-gray-500 mb-3">Shipping Address (Optional)</p>
            <input name="addressLine1" placeholder="Street Address" className="input-field mb-3" value={formData.addressLine1} onChange={handleChange} />
            <div className="grid grid-cols-3 gap-2">
                <input name="city" placeholder="City" className="input-field" value={formData.city} onChange={handleChange} />
                <input name="state" placeholder="State" className="input-field" value={formData.state} onChange={handleChange} />
                <input 
                    name="zip" 
                    placeholder="Zip Code" 
                    maxLength={6} // UX: Stop after 6 digits
                    className={`input-field ${errors.zip ? 'border-red-500 ring-1 ring-red-500' : ''}`} 
                    value={formData.zip} 
                    onChange={handleChange} 
                />
                {/* Optional: Show error message below field */}
                {errors.zip && <p className="text-xs text-red-500 mt-1">{errors.zip}</p>}
            </div>
          </div>

          <button 
            type="submit" 
            disabled={otpStatus !== 'valid'}
            className={`w-full mt-4 text-lg py-3 rounded-lg font-semibold transition-all flex items-center justify-center gap-2
                ${otpStatus === 'valid' 
                    ? 'bg-primary text-accent hover:bg-primary-light shadow-md' 
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'}`}
          >
            Register Account
          </button>
        </form>
        
        <p className="text-center mt-6 text-sm text-gray-600">
            Already have an account? <Link to="/login" className="text-accent-deep font-bold hover:underline">Login here</Link>
        </p>
      </div>
    </div>
  );
}
