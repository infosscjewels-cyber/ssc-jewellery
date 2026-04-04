import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Phone, X } from 'lucide-react';
import { getStorefrontMobileValidationMessage, isValidStorefrontMobile, normalizeStorefrontMobileInput } from '../utils/mobileValidation';

export default function PhoneCaptureModal({
    isOpen,
    initialValue = '',
    isSaving = false,
    error = '',
    onClose,
    onSubmit
}) {
    const [mobile, setMobile] = useState(normalizeStorefrontMobileInput(initialValue));
    const validationMessage = !mobile ? '' : getStorefrontMobileValidationMessage(mobile);

    if (!isOpen) return null;

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (!isValidStorefrontMobile(mobile) || isSaving) return;
        await onSubmit?.(normalizeStorefrontMobileInput(mobile));
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
                                onChange={(event) => setMobile(normalizeStorefrontMobileInput(event.target.value))}
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

                    <div className="flex gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={isSaving}
                            className="flex-1 rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={!isValidStorefrontMobile(mobile) || isSaving}
                            className="flex-1 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-accent shadow-lg shadow-primary/20 transition-colors hover:bg-primary-light disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {isSaving ? (
                                <span className="inline-flex items-center justify-center gap-2">
                                    <Loader2 size={16} className="animate-spin" />
                                    Saving...
                                </span>
                            ) : 'Save and Continue'}
                        </button>
                    </div>
                </form>
            </div>
        </div>,
        document.body
    );
}
