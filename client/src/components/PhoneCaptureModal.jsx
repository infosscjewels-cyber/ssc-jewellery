import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Phone, ShieldCheck, X } from 'lucide-react';
import { authService } from '../services/authService';
import { getStorefrontMobileValidationMessage, isValidStorefrontMobile, normalizeStorefrontMobileInput } from '../utils/mobileValidation';

export default function PhoneCaptureModal({
    isOpen,
    initialValue = '',
    isSaving = false,
    error = '',
    onClose,
    onChange,
    onSwitchAccount,
    onSubmit
}) {
    const [mobile, setMobile] = useState(normalizeStorefrontMobileInput(initialValue));
    const [otp, setOtp] = useState('');
    const [otpSent, setOtpSent] = useState(false);
    const [otpError, setOtpError] = useState('');
    const [deliveryError, setDeliveryError] = useState('');
    const [isSendingOtp, setIsSendingOtp] = useState(false);
    const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
    const [timer, setTimer] = useState(0);
    const [mode, setMode] = useState('save');
    const validationMessage = !mobile ? '' : getStorefrontMobileValidationMessage(mobile);
    const canSubmitOtp = otp.trim().length === 6 && !isSaving && !isVerifyingOtp;
    const duplicateMobileMessage = String(deliveryError || error || '').trim();
    const isDuplicateMobileError = /mobile number already in use/i.test(duplicateMobileMessage);

    useEffect(() => {
        if (!isOpen) return;
        setMobile(normalizeStorefrontMobileInput(initialValue));
        setOtp('');
        setOtpSent(false);
        setOtpError('');
        setDeliveryError('');
        setIsSendingOtp(false);
        setIsVerifyingOtp(false);
        setTimer(0);
        setMode('save');
    }, [initialValue, isOpen]);

    useEffect(() => {
        if (timer <= 0) return undefined;
        const intervalId = window.setInterval(() => {
            setTimer((prev) => (prev > 0 ? prev - 1 : 0));
        }, 1000);
        return () => window.clearInterval(intervalId);
    }, [timer]);

    if (!isOpen) return null;

    const handleSendOtp = async () => {
        if (!isValidStorefrontMobile(mobile) || isSendingOtp || timer > 0) return;
        setDeliveryError('');
        setOtpError('');
        setIsSendingOtp(true);
        try {
            await authService.validateProfileMobile(mobile);
            const res = await authService.sendOtp({ mobile });
            if (!res?.ok) {
                setDeliveryError(res?.message || 'Failed to send OTP');
                setOtpSent(false);
                setTimer(0);
                return;
            }
            setOtpSent(true);
            setTimer(30);
            setMode('save');
        } catch (submitError) {
            setDeliveryError(submitError?.message || 'Failed to send OTP');
            setOtpSent(false);
            setTimer(0);
        } finally {
            setIsSendingOtp(false);
        }
    };

    const handleSwitchAccountOtp = async () => {
        if (!isValidStorefrontMobile(mobile) || isSendingOtp || timer > 0) return;
        setDeliveryError('');
        setOtpError('');
        setIsSendingOtp(true);
        try {
            const res = await authService.sendOtp({ identifier: mobile, purpose: 'login', otpChannel: 'mobile' });
            if (!res?.ok) {
                setDeliveryError(res?.message || 'Failed to send OTP');
                setOtpSent(false);
                setTimer(0);
                return;
            }
            setOtpSent(true);
            setTimer(30);
            setMode('switch');
        } catch (submitError) {
            setDeliveryError(submitError?.message || 'Failed to send OTP');
            setOtpSent(false);
            setTimer(0);
        } finally {
            setIsSendingOtp(false);
        }
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (!otpSent) {
            await handleSendOtp();
            return;
        }
        if (!isValidStorefrontMobile(mobile) || isSaving || isVerifyingOtp || String(otp || '').trim().length !== 6) return;
        setOtpError('');
        setDeliveryError('');
        setIsVerifyingOtp(true);
        try {
            if (mode === 'switch') {
                const res = await authService.login({
                    type: 'otp',
                    identifier: mobile,
                    otp: String(otp || '').trim(),
                    otpChannel: 'mobile'
                });
                await onSwitchAccount?.(res, normalizeStorefrontMobileInput(mobile));
                return;
            }
            await authService.verifyOtp({ mobile, otp: String(otp || '').trim() });
        } catch (verifyError) {
            setOtpError(verifyError?.message || 'OTP verification failed');
            setIsVerifyingOtp(false);
            return;
        }
        try {
            await onSubmit?.(normalizeStorefrontMobileInput(mobile));
        } finally {
            setIsVerifyingOtp(false);
        }
    };

    return createPortal(
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h3 className="text-xl font-semibold text-gray-900">Update your phone number</h3>
                        <p className="mt-2 text-sm text-gray-500">to receive order and offer updates</p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isSaving}
                        className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label="Close phone update modal"
                    >
                        <X size={18} />
                    </button>
                </div>

                <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
                    <div>
                        <label className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">Phone Number</label>
                        <div className="relative mt-2">
                            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
                                <Phone size={16} />
                            </span>
                            <input
                                autoFocus
                                inputMode="numeric"
                                autoComplete="tel"
                                maxLength={10}
                                value={mobile}
                                onChange={(event) => {
                                    const nextMobile = normalizeStorefrontMobileInput(event.target.value);
                                    setMobile(nextMobile);
                                    setOtp('');
                                    setOtpSent(false);
                                    setOtpError('');
                                    setDeliveryError('');
                                    setTimer(0);
                                    setMode('save');
                                    onChange?.(nextMobile);
                                }}
                                placeholder="9876543210"
                                className={`input-field pl-10 ${validationMessage || error ? 'border-red-400 bg-red-50/30' : ''}`}
                            />
                        </div>
                        {validationMessage ? (
                            <p className="mt-2 text-xs text-red-600">{validationMessage}</p>
                        ) : (
                            <p className="mt-2 text-xs text-gray-500">Enter your 10-digit mobile number.</p>
                        )}
                        {!validationMessage && error && <p className="mt-2 text-xs text-red-600">{error}</p>}
                    </div>

                    {otpSent && (
                        <div>
                            <label className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">OTP</label>
                            <div className="relative mt-2">
                                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
                                    <ShieldCheck size={16} />
                                </span>
                                <input
                                    inputMode="numeric"
                                    autoComplete="one-time-code"
                                    maxLength={6}
                                    value={otp}
                                    onChange={(event) => {
                                        setOtp(String(event.target.value || '').replace(/\D/g, '').slice(0, 6));
                                        setOtpError('');
                                    }}
                                    placeholder="Enter 6-digit OTP"
                                    className={`input-field pl-10 ${otpError ? 'border-red-400 bg-red-50/30' : ''}`}
                                />
                            </div>
                            {otpError ? (
                                <p className="mt-2 text-xs text-red-600">{otpError}</p>
                            ) : (
                                <div className="mt-2 flex items-center justify-between gap-3">
                                    <p className="text-xs text-gray-500">Enter the OTP sent to this mobile number.</p>
                                    <button
                                        type="button"
                                        onClick={handleSendOtp}
                                        disabled={isSendingOtp || timer > 0 || isSaving || isVerifyingOtp}
                                        className="text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {timer > 0 ? `Resend in ${timer}s` : 'Resend OTP'}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {!otpSent && deliveryError && <p className="text-xs text-red-600">{deliveryError}</p>}

                    {!otpSent && isDuplicateMobileError && (
                        <button
                            type="button"
                            onClick={handleSwitchAccountOtp}
                            disabled={isSendingOtp || isSaving || isVerifyingOtp}
                            className="w-full rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm font-semibold text-primary transition hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            Login via OTP instead
                        </button>
                    )}

                    <div className="flex gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={isSaving || isVerifyingOtp}
                            className="flex-1 rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={!isValidStorefrontMobile(mobile) || isSaving || (otpSent && !canSubmitOtp) || isSendingOtp}
                            className="flex-1 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-accent shadow-lg shadow-primary/20 transition-colors hover:bg-primary-light disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {isSaving || isVerifyingOtp ? (
                                <span className="inline-flex items-center justify-center gap-2">
                                    <Loader2 size={16} className="animate-spin" />
                                    {isSaving ? 'Saving...' : 'Verifying...'}
                                </span>
                            ) : isSendingOtp ? (
                                <span className="inline-flex items-center justify-center gap-2">
                                    <Loader2 size={16} className="animate-spin" />
                                    Sending OTP...
                                </span>
                            ) : otpSent ? (
                                mode === 'switch' ? 'Verify OTP & Switch Account' : 'Verify OTP & Continue'
                            ) : 'Save and Continue'}
                        </button>
                    </div>
                </form>
            </div>
        </div>,
        document.body
    );
}
