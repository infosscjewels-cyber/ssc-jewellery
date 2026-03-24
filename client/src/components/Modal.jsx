import { X, AlertTriangle, Key, Eye, EyeOff, Check, FolderPlus } from 'lucide-react';
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

export default function Modal({ isOpen, onClose, title, message, type = 'default', onConfirm, isLoading, confirmText }) {
  // --- STATE FIX ---
  const [showPass, setShowPass] = useState(false);
  const [inputValue, setInputValue] = useState(''); 

  // --- CONFIGURATION LOGIC ---
    let Icon = Check;
    let iconBg = 'bg-green-100';
    let iconColor = 'text-green-600';
    let btnClass = 'bg-primary text-accent hover:bg-primary-light';
    // Use confirmText if provided, otherwise default based on type
    let btnLabel = confirmText || 'Confirm';

    if (type === 'delete') {
        Icon = AlertTriangle;
        iconBg = 'bg-red-100';
        iconColor = 'text-red-600';
        btnClass = 'bg-red-600 text-white hover:bg-red-700';
        btnLabel = confirmText || 'Delete'; // Fallback to old default
    } 
    else if (type === 'password' || type === 'input') {
        Icon = Key;
        iconBg = 'bg-amber-100';
        iconColor = 'text-amber-600';
        btnLabel = confirmText || 'Update Password'; // Fallback to old default
    }
    // [NEW] Add this block for Categories
    else if (type === 'create') {
        Icon = FolderPlus;
        iconBg = 'bg-primary/10';
        iconColor = 'text-primary';
        btnLabel = confirmText || 'Create';
    }

  // Reset input when modal opens
  useEffect(() => {
    if (isOpen) {
        setInputValue('');
        setShowPass(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 animate-fade-in">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-md transition-opacity"
        onClick={onClose}
      />

      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm relative z-10 overflow-hidden transform transition-all scale-100">
        <div className={`h-2 w-full ${type === 'delete' ? 'bg-red-500' : 'bg-accent'}`}></div>

        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className={`p-3 rounded-full shrink-0 ${iconBg} ${iconColor}`}>
              <Icon size={24} />
            </div>

            <div className="flex-1">
              <h3 className="text-lg font-bold text-gray-900">{title}</h3>
              <p className="text-sm text-gray-500 mt-1">{message}</p>
              
              {(type === 'input' || type === 'password' || type === 'create') && (
                  <div className="relative mt-4">
                      <input 
                          type={type === 'password' && !showPass ? "password" : "text"}
                          className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-accent outline-none"
                          placeholder="Enter value..."
                          value={inputValue}
                          onChange={(e) => setInputValue(e.target.value)}
                          autoFocus
                      />
                      {type === 'password' && (
                          <button 
                              onClick={() => setShowPass(!showPass)}
                              className="absolute right-3 top-2.5 text-gray-400 hover:text-primary"
                          >
                              {showPass ? <EyeOff size={20} /> : <Eye size={20} />}
                          </button>
                      )}
                  </div>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <button 
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              disabled={isLoading}
            >
              Cancel
            </button>
            <button 
              onClick={() => onConfirm(inputValue)} // --- PASSES VALUE CORRECTLY ---
              disabled={isLoading}
              className={`px-4 py-2 text-sm font-medium text-white rounded-lg shadow-md transition-all active:scale-95
                ${type === 'delete' 
                  ? 'bg-red-500 hover:bg-red-600' 
                  : 'bg-primary hover:bg-primary-light'}`
              }
            >
              {isLoading ? 'Processing...' : btnLabel}
            </button>
          </div>
        </div>

        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600">
          <X size={18} />
        </button>
      </div>
    </div>,
    document.body
  );
}
