import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, UserPlus, UserCog, Loader2, Eye, EyeOff, Calendar } from 'lucide-react'; // Added icons

const formatLongDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const day = date.getDate();
  const suffix = day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th';
  const month = date.toLocaleString('en-IN', { month: 'short' });
  const year = date.getFullYear();
  return `${day}${suffix} ${month} ${year}`;
};

export default function AddCustomerModal({ isOpen, onClose, onConfirm, roleToAdd = 'customer' }) {
  const [formData, setFormData] = useState({
    name: '', email: '', mobile: '', password: '',
    addressLine1: '', city: '', state: '', zip: '',
    dob: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Reset form when modal opens/closes
  useEffect(() => {
    if (isOpen) {
        setFormData({ name: '', email: '', mobile: '', password: '', addressLine1: '', city: '', state: '', zip: '', dob: '' });
        setError('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleChange = (e) => {
    const { name, value } = e.target;
    if ((name === 'mobile' && !/^\d*$/.test(value)) || (name === 'zip' && !/^\d*$/.test(value))) return;
    setFormData({ ...formData, [name]: value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Validation
    if (formData.mobile.length !== 10) return setError("Mobile must be 10 digits");
    if (formData.password.length < 6) return setError("Password must be 6+ characters");
    
    // Zip validation only if we are adding a customer (who has an address)
    if (roleToAdd === 'customer' && formData.zip && formData.zip.length !== 6) {
        return setError("Zip must be 6 digits");
    }
    setIsLoading(true);
    
    // Structure Payload
    const payload = {
        ...formData,
        // Only include address if it's a customer. For staff, send null.
        address: (roleToAdd === 'customer' && formData.addressLine1) ? {
            line1: formData.addressLine1,
            city: formData.city,
            state: formData.state,
            zip: formData.zip
        } : null,
        dob: formData.dob || null
    };

    try {
        await onConfirm(payload); 
    } catch (err) {
        setError(err.message || "Failed to create user");
    } finally {
        setIsLoading(false);
    }
  };

  const isStaff = roleToAdd === 'staff';

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 animate-fade-in">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose}></div>
      
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg relative z-10 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header (Dynamic Color & Title) */}
        <div className={`px-6 py-4 flex justify-between items-center ${isStaff ? 'bg-gray-800' : 'bg-primary'}`}>
            <h3 className="text-white font-serif font-bold flex items-center gap-2">
                {isStaff ? <UserCog size={20} className="text-blue-300" /> : <UserPlus size={20} className="text-accent" />}
                {isStaff ? 'Add New Staff Member' : 'Add New Customer'}
            </h3>
            <button onClick={onClose} className="text-white/70 hover:text-white"><X size={20}/></button>
        </div>

        {/* Form Content */}
        <div className="p-6 overflow-y-auto">
            {error && <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg mb-4 flex items-center gap-2">⚠️ {error}</div>}
            
            <form id="add-user-form" onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2 md:col-span-1">
                        <label className="text-xs font-bold text-gray-500 uppercase">Full Name *</label>
                        <input name="name" className="input-field mt-1" value={formData.name} onChange={handleChange} required placeholder="Ex: John Doe" />
                    </div>
                    <div className="col-span-2 md:col-span-1">
                        <label className="text-xs font-bold text-gray-500 uppercase">Email *</label>
                        <input name="email" type="email" className="input-field mt-1" value={formData.email} onChange={handleChange} required placeholder="name@example.com" />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2 md:col-span-1">
                        <label className="text-xs font-bold text-gray-500 uppercase">Mobile *</label>
                        <input name="mobile" maxLength={10} className="input-field mt-1" value={formData.mobile} onChange={handleChange} required placeholder="9876543210" />
                    </div>
                    <div className="col-span-2 md:col-span-1 relative">
                        <label className="text-xs font-bold text-gray-500 uppercase">Set Password *</label>
                        <div className="relative mt-1">
                            <input 
                                name="password" 
                                type={showPassword ? "text" : "password"} 
                                className="input-field pr-10" 
                                value={formData.password} 
                                onChange={handleChange} 
                                required 
                                placeholder="******" 
                            />
                            <button 
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-3 text-gray-400 hover:text-primary"
                            >
                                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                        </div>
                    </div>
                </div>

                {/* ADDRESS SECTION (Only for Customers) */}
                {!isStaff && (
                    <div className="border-t pt-4 mt-2 animate-fade-in">
                        <p className="text-sm font-bold text-primary mb-3">Address Details (Optional)</p>
                        <label className="text-xs font-bold text-gray-500 uppercase">Date of Birth (Optional)</label>
                        <div className="relative mt-1 mb-3">
                            <input
                                type="text"
                                className="input-field pr-10"
                                placeholder="18th Feb 2026"
                                value={formatLongDate(formData.dob)}
                                readOnly
                            />
                            <Calendar size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                            <input
                                name="dob"
                                type="date"
                                className="absolute inset-0 opacity-0 cursor-pointer"
                                value={formData.dob}
                                onChange={handleChange}
                            />
                        </div>
                        <input name="addressLine1" placeholder="Street Address" className="input-field mb-3" value={formData.addressLine1} onChange={handleChange} />
                        <div className="grid grid-cols-3 gap-2">
                            <input name="city" placeholder="City" className="input-field" value={formData.city} onChange={handleChange} />
                            <input name="state" placeholder="State" className="input-field" value={formData.state} onChange={handleChange} />
                            <input name="zip" placeholder="Zip" maxLength={6} className="input-field" value={formData.zip} onChange={handleChange} />
                        </div>
                    </div>
                )}
            </form>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
            <button onClick={onClose} type="button" className="px-4 py-2 text-gray-600 font-medium hover:bg-gray-200 rounded-lg">Cancel</button>
            <button 
                form="add-user-form"
                type="submit" 
                disabled={isLoading}
                className={`text-white font-bold px-6 py-2 rounded-lg shadow-md flex items-center gap-2 transition-colors
                    ${isLoading ? 'bg-gray-400 cursor-not-allowed' : (isStaff ? 'bg-gray-800 hover:bg-gray-700' : 'bg-accent text-primary hover:bg-accent-hover')}
                `}
            >
                {isLoading ? <Loader2 className="animate-spin" size={18} /> : (isStaff ? 'Create Staff' : 'Create Customer')}
            </button>
        </div>
      </div>
    </div>
    ,
    document.body
  );
}
