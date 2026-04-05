import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Mail, ShieldCheck, X } from 'lucide-react';
import { authService } from '../services/authService';
import { orderService } from '../services/orderService';
import { useToast } from '../context/ToastContext';

const maskEmail = (value = '') => {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw.includes('@')) return raw;
    const [name, domain] = raw.split('@');
    if (!name || !domain) return raw;
    const visible = name.slice(0, 2);
    return `${visible}${'*'.repeat(Math.max(1, name.length - visible.length))}@${domain}`;
};

const maskMobile = (value = '') => {
    const digits = String(value || '').replace(/\D/g, '');
    if (digits.length < 4) return digits;
    return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
};

export default function CheckoutAccountVerificationModal({
    isOpen,
    checkoutEmail = '',
    checkoutMobile = '',
    onClose,
    onSuccess
}) {
    const toast = useToast();
    const [otp, setOtp] = useState('');
    const [otpSent, setOtpSent] = useState(false);
    const [timer, setTimer] = useState(0);
    const [isPreparing, setIsPreparing] = useState(false);
    const [isSendingOtp, setIsSendingOtp] = useState(false);
    const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
    const [resolverError, setResolverError] = useState('');
    const [otpError, setOtpError] = useState('');
    const [resolution, setResolution] = useState(null);
    const [resolverAttempted, setResolverAttempted] = useState(false);
    const [autoSendAttempted, setAutoSendAttempted] = useState(false);
    const modalActiveRef = useRef(false);
    const verificationCompletedRef = useRef(false);

    useEffect(() => {
        modalActiveRef.current = isOpen;
        if (!isOpen) verificationCompletedRef.current = false;
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        setOtp('');
        setOtpSent(false);
        setTimer(0);
        setIsPreparing(false);
        setIsSendingOtp(false);
        setIsVerifyingOtp(false);
        setResolverError('');
        setOtpError('');
        setResolution(null);
        setResolverAttempted(false);
        setAutoSendAttempted(false);
    }, [checkoutEmail, checkoutMobile, isOpen]);

    useEffect(() => {
        if (timer <= 0) return undefined;
        const intervalId = window.setInterval(() => {
            setTimer((prev) => (prev > 0 ? prev - 1 : 0));
        }, 1000);
        return () => window.clearInterval(intervalId);
    }, [timer]);

    const resolvedIdentifier = useMemo(
        () => String(resolution?.identifier || '').trim(),
        [resolution?.identifier]
    );
    const resolvedEmail = useMemo(
        () => String(resolution?.user?.email || '').trim().toLowerCase(),
        [resolution?.user?.email]
    );
    const resolvedMobile = useMemo(
        () => String(resolution?.user?.mobile || resolution?.user?.whatsapp || '').replace(/\D/g, '').trim(),
        [resolution?.user?.mobile, resolution?.user?.whatsapp]
    );
    const canVerifyOtp = Boolean(resolvedIdentifier) && String(otp || '').trim().length === 6 && !isVerifyingOtp;

    const startVerification = useCallback(async () => {
        if (!isOpen) return;
        setIsPreparing(true);
        setResolverAttempted(true);
        setResolverError('');
        setOtpError('');
        try {
            const res = await orderService.startCheckoutAccountVerification({
                email: checkoutEmail,
                mobile: checkoutMobile
            });
            if (!res?.accountExists || !res?.identifier) {
                setResolverError('No existing account was found for these checkout details.');
                return;
            }
            setResolution(res);
        } catch (error) {
            setResolverError(error?.message || 'Unable to verify the existing account for checkout.');
        } finally {
            setIsPreparing(false);
        }
    }, [checkoutEmail, checkoutMobile, isOpen]);

    const handleSendOtp = useCallback(async () => {
        if (!resolvedIdentifier || timer > 0) return;
        setResolverError('');
        setOtpError('');
        setOtpSent(true);
        setTimer(30);
        setIsSendingOtp(true);
        try {
            const res = await authService.sendOtp({ identifier: resolvedIdentifier, purpose: 'login' });
            if (!res?.ok) {
                setOtpSent(false);
                setTimer(0);
                setResolverError(res?.message || 'Failed to send OTP');
                return;
            }
            if (!modalActiveRef.current || verificationCompletedRef.current) {
                return;
            }
            const contacts = res?.delivery?.contacts || {};
            const sent = Array.isArray(res?.delivery?.sent) ? res.delivery.sent : [];
            const sentEmail = sent.includes('email') ? contacts.email : '';
            const sentWhatsApp = sent.includes('whatsapp') ? contacts.whatsapp : '';
            if (sentEmail && sentWhatsApp) {
                toast.success(`OTP sent to Email ${sentEmail} and WhatsApp ${sentWhatsApp}`);
            } else if (sentEmail) {
                toast.success(`OTP sent to your Email ${sentEmail}`);
            } else if (sentWhatsApp) {
                toast.success(`OTP sent to WhatsApp ${sentWhatsApp}`);
            } else {
                toast.success('OTP sent');
            }
        } catch (error) {
            setOtpSent(false);
            setTimer(0);
            setResolverError(error?.message || 'Failed to send OTP');
        } finally {
            setIsSendingOtp(false);
        }
    }, [resolvedIdentifier, timer, toast]);

    useEffect(() => {
        if (!isOpen || resolution || isPreparing || resolverAttempted) return;
        void startVerification();
    }, [isOpen, resolution, isPreparing, resolverAttempted, startVerification]);

    useEffect(() => {
        if (!isOpen || !resolution || autoSendAttempted || otpSent || isSendingOtp) return;
        setAutoSendAttempted(true);
        void handleSendOtp();
    }, [autoSendAttempted, handleSendOtp, isOpen, isSendingOtp, otpSent, resolution]);

    if (!isOpen) return null;

    const handleVerify = async (event) => {
        event.preventDefault();
        if (!canVerifyOtp) return;
        setResolverError('');
        setOtpError('');
        setIsVerifyingOtp(true);
        try {
            const res = await authService.login({
                type: 'otp',
                identifier: resolvedIdentifier,
                otp: String(otp || '').trim()
            });
            if (!res?.token || !res?.user) {
                setOtpError(res?.message || 'OTP verification failed');
                return;
            }
            verificationCompletedRef.current = true;
            await onSuccess?.(res, {
                identifier: resolvedIdentifier,
                resolutionType: resolution?.resolutionType || '',
                resolvedEmail,
                resolvedMobile,
                hasExistingCart: Boolean(resolution?.hasExistingCart)
            });
        } catch (error) {
            setOtpError(error?.message || 'OTP verification failed');
        } finally {
            setIsVerifyingOtp(false);
        }
    };

    return createPortal(
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h3 className="text-xl font-semibold text-gray-900">Verify your account</h3>
                        <p className="mt-2 text-sm text-gray-500">We found an existing account for these checkout details and sent login OTP to that account.</p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isPreparing || isSendingOtp || isVerifyingOtp}
                        className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label="Close account verification modal"
                    >
                        <X size={18} />
                    </button>
                </div>

                <form className="mt-6 space-y-4" onSubmit={handleVerify}>
                    <div>
                        <label className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">Matched Account Email</label>
                        <div className="relative mt-2">
                            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
                                <Mail size={16} />
                            </span>
                            <input
                                readOnly
                                value={resolvedEmail || String(checkoutEmail || '').trim().toLowerCase()}
                                className="input-field pl-10 bg-gray-50 text-gray-700"
                            />
                        </div>
                        {isPreparing ? (
                            <p className="mt-2 text-xs text-gray-500">Checking the existing account...</p>
                        ) : resolverError ? (
                            <p className="mt-2 text-xs text-red-600">{resolverError}</p>
                        ) : otpSent ? (
                            <p className="mt-2 text-xs text-emerald-700">
                                OTP sent to {maskEmail(resolvedEmail)}{resolvedMobile ? ` and ${maskMobile(resolvedMobile)}` : ''}.
                            </p>
                        ) : (
                            <p className="mt-2 text-xs text-gray-500">Preparing secure account verification…</p>
                        )}
                    </div>

                    {(otpSent || isPreparing) && (
                        <div>
                            <label className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">OTP</label>
                            <div className="relative mt-2">
                                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
                                    <ShieldCheck size={16} />
                                </span>
                                <input
                                    inputMode="numeric"
                                    maxLength={6}
                                    value={otp}
                                    onChange={(event) => setOtp(String(event.target.value || '').replace(/\D/g, '').slice(0, 6))}
                                    placeholder="Enter 6-digit OTP"
                                    disabled={isPreparing}
                                    className={`input-field pl-10 ${otpError ? 'border-red-400 bg-red-50/30' : ''}`}
                                />
                            </div>
                            {otpError ? (
                                <p className="mt-2 text-xs text-red-600">{otpError}</p>
                            ) : (
                                <p className="mt-2 text-xs text-gray-500">Enter the OTP sent to the matched account to continue checkout.</p>
                            )}
                        </div>
                    )}

                    <div className="flex gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={isPreparing || isSendingOtp || isVerifyingOtp}
                            className="flex-1 rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        {otpSent ? (
                            <button
                                type="submit"
                                disabled={!canVerifyOtp}
                                className="flex-1 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-accent shadow-lg shadow-primary/20 transition-colors hover:bg-primary-light disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {isVerifyingOtp ? (
                                    <span className="inline-flex items-center justify-center gap-2">
                                        <Loader2 size={16} className="animate-spin" />
                                        Verifying...
                                    </span>
                                ) : 'Verify and Continue'}
                            </button>
                        ) : (
                            <button
                                type="button"
                                disabled
                                className="flex-1 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-accent shadow-lg shadow-primary/20 disabled:cursor-wait disabled:opacity-60"
                            >
                                <span className="inline-flex items-center justify-center gap-2">
                                    <Loader2 size={16} className="animate-spin" />
                                    {isPreparing ? 'Checking account...' : 'Sending OTP...'}
                                </span>
                            </button>
                        )}
                    </div>
                    {(otpSent || resolverError) && (
                        <button
                            type="button"
                            onClick={handleSendOtp}
                            disabled={!resolvedIdentifier || timer > 0 || isSendingOtp || isPreparing}
                            className="w-full text-sm font-semibold text-primary underline underline-offset-4 disabled:cursor-not-allowed disabled:text-gray-400"
                        >
                            {timer > 0 ? `Resend OTP in ${timer}s` : 'Resend OTP'}
                        </button>
                    )}
                </form>
            </div>
        </div>,
        document.body
    );
}
