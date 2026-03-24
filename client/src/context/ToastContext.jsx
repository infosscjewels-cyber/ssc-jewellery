/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import successDing from '../assets/success_ding.mp3';
import failureDing from '../assets/ubuntu_fail.mp3';

const ToastContext = createContext();

export const useToast = () => useContext(ToastContext);

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);
  const toastSeqRef = useRef(0);
  const toastTimersRef = useRef(new Map());
  const successAudioRef = useRef(null);
  const failureAudioRef = useRef(null);
  const location = useLocation();

  const playToastSound = useCallback((type) => {
    const isAdminRoute = String(location?.pathname || '').startsWith('/admin');
    if (!isAdminRoute) return;
    try {
      if (type === 'success') {
        if (!successAudioRef.current) successAudioRef.current = new Audio(successDing);
        successAudioRef.current.currentTime = 0;
        void successAudioRef.current.play().catch(() => {});
        return;
      }
      if (type === 'error') {
        if (!failureAudioRef.current) failureAudioRef.current = new Audio(failureDing);
        failureAudioRef.current.currentTime = 0;
        void failureAudioRef.current.play().catch(() => {});
      }
    } catch {
      // Ignore autoplay failures.
    }
  }, [location?.pathname]);

  const removeToast = useCallback((id) => {
    const timer = toastTimersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const addToast = useCallback((message, type = 'info') => {
    toastSeqRef.current += 1;
    const id = `${Date.now()}-${toastSeqRef.current}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    playToastSound(type);

    const timer = setTimeout(() => {
      removeToast(id);
    }, 3000);
    toastTimersRef.current.set(id, timer);
  }, [playToastSound, removeToast]);

  useEffect(() => () => {
    toastTimersRef.current.forEach((timer) => clearTimeout(timer));
    toastTimersRef.current.clear();
  }, []);

  return (
    <ToastContext.Provider value={{
      addToast,
      success: (msg) => addToast(msg, 'success'),
      error: (msg) => addToast(msg, 'error'),
      warning: (msg) => addToast(msg, 'warning'),
      info: (msg) => addToast(msg, 'info')
    }}>
      {children}
      
      {/* Toast Container - Fixed Position */}
      <div className="fixed top-5 right-5 z-[100] flex flex-col gap-3 pointer-events-none">
        {toasts.map((toast) => (
          <div 
            key={toast.id}
            className={`pointer-events-auto flex items-center gap-3 min-w-[300px] px-4 py-3 rounded-lg shadow-lg transform transition-all animate-slide-in
              ${toast.type === 'success' ? 'bg-green-50 border-l-4 border-green-500 text-green-800' : ''}
              ${toast.type === 'error' ? 'bg-red-50 border-l-4 border-red-500 text-red-800' : ''}
              ${toast.type === 'warning' ? 'bg-amber-50 border-l-4 border-amber-500 text-amber-800' : ''}
              ${toast.type === 'info' ? 'bg-blue-50 border-l-4 border-blue-500 text-blue-800' : ''}
            `}
          >
            {toast.type === 'success' && <CheckCircle size={20} />}
            {toast.type === 'error' && <AlertCircle size={20} />}
            {toast.type === 'warning' && <AlertTriangle size={20} />}
            {toast.type === 'info' && <Info size={20} />}
            <p className="flex-1 text-sm font-medium">{toast.message}</p>
            <button onClick={() => removeToast(toast.id)} className="text-gray-400 hover:text-gray-600">
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};
