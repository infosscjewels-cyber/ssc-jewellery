import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, ChevronRight, CreditCard, Download, Edit3, Home, Mail, Phone, ShoppingBag, Sparkles, Ticket, TrendingUp, UserRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { useToast } from '../context/ToastContext';
import { authService } from '../services/authService';
import { cartService } from '../services/cartService';
import { orderService } from '../services/orderService';
import { wishlistService } from '../services/wishlistService';
import { useShipping } from '../context/ShippingContext';
import { useSocket } from '../context/SocketContext';
import { useAdminCrudSync } from '../hooks/useAdminCrudSync';
import { usePublicCompanyInfo } from '../hooks/usePublicSiteShell';
import cartIllustration from '../assets/cart.svg';
import successDing from '../assets/success_ding.mp3';
import waitIllustration from '../assets/wait.svg';
import { burstConfetti, playCue } from '../utils/celebration';
import RazorpayAffordability from '../components/RazorpayAffordability';
import CheckoutFlowHeader from '../components/CheckoutFlowHeader';
import CheckoutAccountVerificationModal from '../components/CheckoutAccountVerificationModal';
import { formatTierLabel, getMembershipLabel } from '../utils/tierFormat';
import { formatMissingProfileFields } from '../utils/membershipUnlock';
import { getGstDisplayDetails } from '../utils/gst';
import { hasUnavailableCheckoutItems } from '../utils/checkoutAvailability';
import { normalizePaymentFailureReason } from '../utils/paymentFailure';
import { computeShippingPreview } from '../utils/shippingPreview';
import { BRAND_LOGO_URL } from '../utils/branding.js';
import { getAllowedShippingStates, isAllowedShippingState, isValidIndianPincode, lookupStateByPincode, normalizePincodeInput, resolveAllowedStateName } from '../utils/addressValidation';
import { billingAddressEnabled } from '../utils/billingAddressConfig';
import { getStorefrontMobileValidationMessage, isValidStorefrontMobile, normalizeStorefrontMobileInput } from '../utils/mobileValidation';
import StorefrontClosed from './StorefrontClosed';

const emptyAddress = { line1: '', landmark: '', city: '', state: '', zip: '', additionalPhone: '' };
const RAZORPAY_SCRIPT_ID = 'razorpay-checkout-js';
const RAZORPAY_SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';
const buildCheckoutCartKey = (productId = '', variantId = '') => `${String(productId || '').trim()}::${String(variantId || '').trim()}`;
const POST_OTP_PREPARE_TIMEOUT_MS = 8000;

const ensureRazorpayScript = () => {
    if (typeof window === 'undefined') return Promise.resolve(false);
    if (window.Razorpay) return Promise.resolve(true);

    const existing = document.getElementById(RAZORPAY_SCRIPT_ID);
    if (existing) {
        return new Promise((resolve) => {
            existing.addEventListener('load', () => resolve(true), { once: true });
            existing.addEventListener('error', () => resolve(false), { once: true });
        });
    }

    return new Promise((resolve) => {
        const script = document.createElement('script');
        script.id = RAZORPAY_SCRIPT_ID;
        script.src = RAZORPAY_SCRIPT_SRC;
        script.async = true;
        script.onload = () => resolve(true);
        script.onerror = () => resolve(false);
        document.body.appendChild(script);
    });
};

const hasCompleteAddress = (address = null) => {
    const value = address || {};
    return Boolean(
        String(value?.line1 || '').trim()
        && String(value?.city || '').trim()
        && String(value?.state || '').trim()
        && String(value?.zip || '').trim()
    );
};

const hasAddressFields = (address = null) => {
    const value = address || {};
    return Boolean(
        String(value?.line1 || '').trim()
        || String(value?.landmark || '').trim()
        || String(value?.city || '').trim()
        || String(value?.state || '').trim()
        || String(value?.zip || '').trim()
        || String(value?.additionalPhone || '').trim()
    );
};

const isValidEmailInput = (value = '') => {
    const raw = String(value || '').trim();
    if (!raw) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw);
};

const isValidZipInput = (value = '') => isValidIndianPincode(value);

const formatLongDate = (value) => {
    if (!value) return 'No expiry';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'No expiry';
    const day = date.getDate();
    const suffix = day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th';
    const month = date.toLocaleString('en-IN', { month: 'short' });
    const year = date.getFullYear();
    return `${day}${suffix} ${month} ${year}`;
};
const resolveProfileFieldErrors = (message = '') => {
    const safeMessage = String(message || '').trim();
    const lowered = safeMessage.toLowerCase();
    return {
        mobile: lowered.includes('mobile number already in use') ? safeMessage : '',
        email: lowered.includes('email already in use') ? safeMessage : ''
    };
};
const formatCouponOffer = (entry = {}) => {
    const type = String(entry.discountType || '').toLowerCase();
    const value = Number(entry.discountValue || 0);
    if (type === 'fixed') return `₹${value.toLocaleString('en-IN')} OFF`;
    if (type === 'shipping_full') return 'FREE SHIPPING';
    if (type === 'shipping_partial') return `${value}% SHIPPING OFF`;
    return `${value}% OFF`;
};
const getCouponEligibility = (entry = {}) => {
    const required = Number(entry?.requiredCartValue ?? entry?.minCartValue ?? 0);
    const current = Number(entry?.currentCartValue ?? 0);
    const explicit = entry?.isEligible;
    const isEligible = typeof explicit === 'boolean'
        ? explicit
        : current >= required;
    const shortfall = Math.max(0, required - current);
    return {
        isEligible,
        required,
        current,
        shortfall
    };
};
const TIER_THEME = {
    regular: { card: 'from-slate-700 via-slate-600 to-slate-700', chip: 'bg-slate-100 text-slate-700 border-slate-200', title: 'text-white', body: 'text-white/90', caption: 'text-white/80', track: 'bg-white/25', fill: 'bg-white', tag: 'bg-white/20 border-white/35 text-white' },
    bronze: { card: 'from-amber-800 via-orange-700 to-amber-800', chip: 'bg-amber-100 text-amber-800 border-amber-200', title: 'text-white', body: 'text-white/90', caption: 'text-white/80', track: 'bg-white/20', fill: 'bg-white', tag: 'bg-white/15 border-white/30 text-white' },
    silver: { card: 'from-slate-600 via-zinc-500 to-slate-600', chip: 'bg-slate-100 text-slate-700 border-slate-200', title: 'text-white', body: 'text-white/90', caption: 'text-white/80', track: 'bg-white/22', fill: 'bg-white', tag: 'bg-white/15 border-white/30 text-white' },
    gold: { card: 'from-amber-900 via-amber-800 to-amber-900', chip: 'bg-yellow-100 text-yellow-800 border-yellow-200', title: 'text-amber-50', body: 'text-amber-100', caption: 'text-amber-200', track: 'bg-amber-200/40', fill: 'bg-white', tag: 'bg-amber-200/20 border-amber-200/40 text-amber-50' },
    platinum: { card: 'from-sky-800 via-blue-700 to-sky-800', chip: 'bg-sky-100 text-sky-800 border-sky-200', title: 'text-white', body: 'text-sky-100', caption: 'text-sky-200', track: 'bg-white/22', fill: 'bg-white', tag: 'bg-white/15 border-white/30 text-white' }
};
const EXTRA_DISCOUNT_BY_TIER = {
    regular: 0,
    bronze: 1,
    silver: 2,
    gold: 3,
    platinum: 5
};

export default function Checkout() {
    const { user, login, updateUser } = useAuth();
    const { items, subtotal, itemCount, clearCart, adoptServerCart, isSyncing: isCartSyncing } = useCart();
    const { zones } = useShipping();
    const { socket } = useSocket();
    const { companyInfo } = usePublicCompanyInfo();
    const toast = useToast();
    const navigate = useNavigate();
    const location = useLocation();

    const [editing, setEditing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [coupon, setCoupon] = useState('');
    const [appliedCoupon, setAppliedCoupon] = useState(null);
    const [checkoutSummary, setCheckoutSummary] = useState(null);
    const [isSummaryLoading, setIsSummaryLoading] = useState(false);
    const [loyaltyStatus, setLoyaltyStatus] = useState(null);
    const [isApplyingCoupon, setIsApplyingCoupon] = useState(false);
    const [availableCoupons, setAvailableCoupons] = useState([]);
    const [isPlacingOrder, setIsPlacingOrder] = useState(false);
    const [isPaymentAwaitingConfirmation, setIsPaymentAwaitingConfirmation] = useState(false);
    const [pendingPaymentAmount, setPendingPaymentAmount] = useState(0);
    const [orderResult, setOrderResult] = useState(null);
    const [isDownloadingOrderInvoice, setIsDownloadingOrderInvoice] = useState(false);
    const [pricingSyncTick, setPricingSyncTick] = useState(0);
    const [guestLookup, setGuestLookup] = useState(null);
    const [isGuestLookupLoading, setIsGuestLookupLoading] = useState(false);
    const [guestCheckoutConflict, setGuestCheckoutConflict] = useState('');
    const [isAccountVerificationOpen, setIsAccountVerificationOpen] = useState(false);
    const [resumeCheckoutAfterVerification, setResumeCheckoutAfterVerification] = useState(false);
    const [postOtpCheckoutSync, setPostOtpCheckoutSync] = useState(null);
    const [isPreparingVerifiedCheckout, setIsPreparingVerifiedCheckout] = useState(false);
    const [profileFieldErrors, setProfileFieldErrors] = useState({ mobile: '', email: '' });
    const [touchedFields, setTouchedFields] = useState({ mobile: false });
    const orderCelebratedRef = useRef(false);
    const autoCouponAttemptsRef = useRef(new Set());
    const lastTierSeenRef = useRef(String(user?.loyaltyTier || 'regular').toLowerCase());
    const loyaltyHydratedRef = useRef(false);
    const preserveCheckoutAddressOnLoginRef = useRef(false);
    const forceEditableAfterOtpLoginRef = useRef(false);
    const checkoutAddressSnapshotRef = useRef({ address: { ...emptyAddress }, billingAddress: { ...emptyAddress } });
    const [form, setForm] = useState({
        name: '',
        email: '',
        mobile: '',
        address: { ...emptyAddress },
        billingAddress: { ...emptyAddress }
    });
    const [attemptedPay, setAttemptedPay] = useState(false);
    const couponFromQuery = useMemo(() => {
        const raw = new URLSearchParams(location.search).get('coupon');
        return String(raw || '').trim().toUpperCase();
    }, [location.search]);
    const liveCouponShippingAddress = useMemo(
        () => (hasCompleteAddress(form.address) ? form.address : null),
        [form.address]
    );
    const availableStates = useMemo(() => getAllowedShippingStates(zones), [zones]);
    const pricingPreviewAddress = useMemo(() => {
        const state = resolveAllowedStateName(availableStates, form.address?.state) || '';
        return state ? { state } : null;
    }, [availableStates, form.address?.state]);
    const authenticatedPricingPreviewAddress = useMemo(() => {
        if (!user) return pricingPreviewAddress;
        if (pricingPreviewAddress?.state) return pricingPreviewAddress;
        const fallbackState = resolveAllowedStateName(
            availableStates,
            user?.address?.state || (billingAddressEnabled ? user?.billingAddress?.state : '') || ''
        ) || '';
        return fallbackState ? { state: fallbackState } : null;
    }, [availableStates, pricingPreviewAddress, user, user?.address?.state, user?.billingAddress?.state]);
    const shippingZip = form.address.zip;
    const billingZip = billingAddressEnabled ? form.billingAddress.zip : form.address.zip;
    const storefrontOpen = companyInfo?.storefrontOpen !== false;
    const subCategoriesEnabled = companyInfo?.subCategoriesEnabled === true;
    const guestLockedAccount = Boolean(!user && guestLookup?.status === 'existing_account_locked');
    const showGuestLockedPrefill = guestLockedAccount;
    const isGuestCouponLoginRequired = Boolean(!user && guestLockedAccount);
    const checkoutItemsPayload = useMemo(
        () => items.map((item) => ({
            productId: item.productId,
            variantId: item.variantId || '',
            quantity: Number(item.quantity || 0)
        })),
        [items]
    );
    const pollPaymentAttemptUntilResolved = useCallback(async (attemptId, { maxAttempts = 8 } = {}) => {
        const safeAttemptId = Number(attemptId);
        if (!Number.isFinite(safeAttemptId) || safeAttemptId <= 0) {
            return { processing: false, failed: true, message: 'Payment attempt is unavailable' };
        }
        for (let index = 0; index < maxAttempts; index += 1) {
            const payload = await orderService.getPaymentAttemptStatus(safeAttemptId);
            if (payload?.order) return payload;
            if (payload?.failed) return payload;
            await new Promise((resolve) => setTimeout(resolve, 1500 + (index * 500)));
        }
        return { processing: true, attempt: { id: safeAttemptId } };
    }, []);

    const refreshAvailableCoupons = useCallback(async () => {
        const cartSubtotal = Number(subtotal || 0);
        if (itemCount <= 0 || cartSubtotal <= 0) {
            setAvailableCoupons([]);
            return;
        }
        try {
            const res = user
                ? await orderService.getAvailableCoupons({
                    shippingAddress: liveCouponShippingAddress
                })
                : await orderService.getPublicAvailableCoupons({
                    items: checkoutItemsPayload,
                    guest: { mobile: form.mobile }
                });
            const nextCoupons = Array.isArray(res?.coupons) ? res.coupons : [];
            setAvailableCoupons(nextCoupons);
            if (appliedCoupon?.code && !nextCoupons.some((entry) => String(entry.code || '').toUpperCase() === String(appliedCoupon.code || '').toUpperCase())) {
                setAppliedCoupon(null);
                setCoupon('');
                toast.info('Applied coupon was removed because it is no longer valid for the current address or cart.');
                return;
            }
            if (appliedCoupon?.code) {
                const matched = nextCoupons.find((entry) => String(entry.code || '').toUpperCase() === String(appliedCoupon.code || '').toUpperCase());
                if (matched && !getCouponEligibility(matched).isEligible) {
                    setAppliedCoupon(null);
                    setCoupon('');
                    toast.info('Applied coupon was removed because shipping or cart details changed.');
                }
            }
        } catch {
            setAvailableCoupons([]);
        }
    }, [user, itemCount, subtotal, appliedCoupon?.code, toast, liveCouponShippingAddress, checkoutItemsPayload]);

    const syncValidatedAccountCheckoutCart = useCallback(async (guestItemsSnapshot = []) => {
        const guestSelections = (Array.isArray(guestItemsSnapshot) ? guestItemsSnapshot : [])
            .map((item) => ({
                productId: String(item?.productId || '').trim(),
                variantId: String(item?.variantId || '').trim(),
                quantity: Number(item?.quantity || 0)
            }))
            .filter((item) => item.productId && item.quantity > 0);

        const existingCart = await cartService.getCart();
        const existingItems = Array.isArray(existingCart?.items) ? existingCart.items : [];
        const guestKeys = new Set(guestSelections.map((item) => buildCheckoutCartKey(item.productId, item.variantId)));
        const serverOnlyItems = existingItems.filter((item) => !guestKeys.has(buildCheckoutCartKey(item?.productId, item?.variantId)));

        if (serverOnlyItems.length > 0) {
            await Promise.all(
                serverOnlyItems.map((item) => wishlistService.addItem(item.productId, item.variantId || '').catch(() => null))
            );
        }

        await cartService.clearCart();
        if (guestSelections.length === 0) {
            adoptServerCart([]);
            return { movedToWishlistCount: serverOnlyItems.length };
        }

        const replacedCart = await cartService.bulkAdd(guestSelections);
        const nextItems = Array.isArray(replacedCart?.items) ? replacedCart.items : [];
        adoptServerCart(nextItems);
        return { movedToWishlistCount: serverOnlyItems.length, items: nextItems };
    }, [adoptServerCart]);

    const applyBestCouponForValidatedCheckout = useCallback(async (shippingAddressOverride = null) => {
        const candidateAddress = shippingAddressOverride && hasCompleteAddress(shippingAddressOverride)
            ? shippingAddressOverride
            : (hasCompleteAddress(form.address) ? form.address : null);
        if (!candidateAddress) {
            setAppliedCoupon(null);
            setCoupon('');
            return { coupon: null, summary: null };
        }
        const couponRes = await orderService.getAvailableCoupons({
            shippingAddress: candidateAddress
        });
        const candidates = (Array.isArray(couponRes?.coupons) ? couponRes.coupons : []).filter((entry) => getCouponEligibility(entry).isEligible);

        let bestCoupon = null;
        let bestDiscount = -1;
        let bestSummary = null;

        for (const entry of candidates) {
            const code = String(entry?.code || '').trim().toUpperCase();
            if (!code) continue;
            const summaryRes = await orderService.getCheckoutSummary({
                shippingAddress: candidateAddress,
                couponCode: code
            });
            const summary = summaryRes?.summary || null;
            const discountValue = Number(summary?.couponDiscountTotal || 0);
            if (discountValue > bestDiscount) {
                bestDiscount = discountValue;
                bestCoupon = entry;
                bestSummary = summary;
            }
        }

        if (bestCoupon && bestSummary) {
            setAppliedCoupon({
                ...bestCoupon,
                code: String(bestCoupon.code || '').trim().toUpperCase(),
                discountTotal: bestDiscount
            });
            setCoupon(String(bestCoupon.code || '').trim().toUpperCase());
            setCheckoutSummary(bestSummary);
            return { coupon: bestCoupon, summary: bestSummary };
        }

        setAppliedCoupon(null);
        setCoupon('');
        const summaryRes = await orderService.getCheckoutSummary({
            shippingAddress: candidateAddress,
            couponCode: null
        });
        if (summaryRes?.summary) {
            setCheckoutSummary(summaryRes.summary);
        }
        return { coupon: null, summary: summaryRes?.summary || null };
    }, [form.address]);

    const persistedLoggedInShippingMissing = Boolean(
        user && !hasCompleteAddress(user?.address)
    );
    const persistedLoggedInBillingMissing = Boolean(
        user && billingAddressEnabled && !hasCompleteAddress(user?.billingAddress)
    );
    const persistedLoggedInMobileMissing = Boolean(
        user && getStorefrontMobileValidationMessage(user?.mobile)
    );
    const hasPersistedLoggedInRequiredDetailsMissing = Boolean(
        user && (
            persistedLoggedInShippingMissing
            || persistedLoggedInBillingMissing
            || persistedLoggedInMobileMissing
        )
    );

    useEffect(() => {
        const forceEditableAfterOtpLogin = forceEditableAfterOtpLoginRef.current;
        forceEditableAfterOtpLoginRef.current = false;
        setEditing(forceEditableAfterOtpLogin || !user || hasPersistedLoggedInRequiredDetailsMissing);
        if (!user) return;
        lastTierSeenRef.current = String(user?.loyaltyTier || 'regular').toLowerCase();
        loyaltyHydratedRef.current = false;
        setForm((prev) => {
            const preserveCurrentAddresses = preserveCheckoutAddressOnLoginRef.current;
            preserveCheckoutAddressOnLoginRef.current = false;
            return {
                name: user.name || prev.name || '',
                email: user.email || prev.email || '',
                mobile: user.mobile || prev.mobile || '',
                address: preserveCurrentAddresses
                    ? {
                        ...checkoutAddressSnapshotRef.current.address,
                        state: resolveAllowedStateName(availableStates, checkoutAddressSnapshotRef.current?.address?.state) || ''
                    }
                    : {
                        ...emptyAddress,
                        ...(user.address || {}),
                        state: resolveAllowedStateName(availableStates, user?.address?.state) || ''
                    },
                billingAddress: preserveCurrentAddresses
                    ? {
                        ...checkoutAddressSnapshotRef.current.billingAddress,
                        state: resolveAllowedStateName(availableStates, checkoutAddressSnapshotRef.current?.billingAddress?.state) || ''
                    }
                    : {
                        ...emptyAddress,
                        ...(billingAddressEnabled ? (user.billingAddress || user.address || {}) : (user.address || {})),
                        state: resolveAllowedStateName(
                            availableStates,
                            billingAddressEnabled ? (user?.billingAddress?.state || user?.address?.state) : user?.address?.state
                        ) || ''
                    }
            };
        });
    }, [user, availableStates, hasPersistedLoggedInRequiredDetailsMissing]);

    useEffect(() => {
        if (billingAddressEnabled) return;
        setForm((prev) => {
            const nextBillingAddress = { ...prev.address };
            if (JSON.stringify(prev.billingAddress) === JSON.stringify(nextBillingAddress)) return prev;
            return {
                ...prev,
                billingAddress: nextBillingAddress
            };
        });
    }, [form.address]);

    const restorePersistedLoggedInForm = useCallback(() => {
        if (!user) return;
        setProfileFieldErrors({ mobile: '', email: '' });
        setGuestCheckoutConflict('');
        setForm({
            name: user.name || '',
            email: user.email || '',
            mobile: user.mobile || '',
            address: {
                ...emptyAddress,
                ...(user.address || {}),
                state: resolveAllowedStateName(availableStates, user?.address?.state) || ''
            },
            billingAddress: {
                ...emptyAddress,
                ...(billingAddressEnabled ? (user.billingAddress || user.address || {}) : (user.address || {})),
                state: resolveAllowedStateName(
                    availableStates,
                    billingAddressEnabled ? (user?.billingAddress?.state || user?.address?.state) : user?.address?.state
                ) || ''
            }
        });
        setEditing(false);
    }, [availableStates, billingAddressEnabled, user]);

    useEffect(() => {
        if (!availableStates.length) return undefined;
        const addressControllers = {
            address: new AbortController(),
            billingAddress: new AbortController()
        };
        const runLookup = async (section) => {
            const pin = normalizePincodeInput(section === 'address' ? shippingZip : billingZip);
            if (!isValidIndianPincode(pin)) return;
            try {
                const detectedState = await lookupStateByPincode(pin, availableStates, {
                    signal: addressControllers[section].signal
                });
                if (!detectedState) return;
                setForm((prev) => {
                    if (normalizePincodeInput(prev?.[section]?.zip || '') !== pin) return prev;
                    if (prev?.[section]?.state === detectedState) return prev;
                    return {
                        ...prev,
                        [section]: { ...prev[section], state: detectedState }
                    };
                });
            } catch {
                // Ignore PIN lookup failures and keep manual state selection available.
            }
        };
        runLookup('address');
        if (billingAddressEnabled) runLookup('billingAddress');
        return () => {
            addressControllers.address.abort();
            addressControllers.billingAddress.abort();
        };
    }, [availableStates, billingZip, shippingZip]);

    useEffect(() => {
        if (user) {
            setGuestLookup(null);
            setIsGuestLookupLoading(false);
            return undefined;
        }
        const normalizedMobile = normalizeStorefrontMobileInput(form.mobile);
        if (!isValidStorefrontMobile(normalizedMobile)) {
            setGuestLookup(null);
            setIsGuestLookupLoading(false);
            return undefined;
        }

        let cancelled = false;
        const timer = window.setTimeout(async () => {
            setIsGuestLookupLoading(true);
            try {
                const lookup = await orderService.lookupGuestCheckoutAccount({ mobile: normalizedMobile });
                if (cancelled) return;
                setGuestLookup(lookup || null);
                setGuestCheckoutConflict('');
            } catch (error) {
                if (cancelled) return;
                const status = String(error?.details?.status || '').trim().toLowerCase();
                if (status === 'account_unavailable' || status === 'data_conflict') {
                    setGuestLookup({ status });
                    setGuestCheckoutConflict(error?.message || 'Unable to use this mobile number for checkout.');
                } else {
                    setGuestLookup(null);
                }
            } finally {
                if (!cancelled) setIsGuestLookupLoading(false);
            }
        }, 300);

        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [form.mobile, user]);

    useEffect(() => {
        if (!couponFromQuery) return;
        if (itemCount <= 0) {
            setIsApplyingCoupon(false);
            return;
        }
        if (!user && !guestLockedAccount && !hasCompleteAddress(form.address)) {
            setIsApplyingCoupon(false);
            return;
        }
        if (appliedCoupon?.code === couponFromQuery) {
            setCoupon(couponFromQuery);
            setIsApplyingCoupon(false);
            return;
        }
        if (autoCouponAttemptsRef.current.has(couponFromQuery)) {
            setIsApplyingCoupon(false);
            return;
        }
        autoCouponAttemptsRef.current.add(couponFromQuery);

        setIsApplyingCoupon(true);
        const validateRequest = user
            ? orderService.validateRecoveryCoupon({
                code: couponFromQuery,
                shippingAddress: liveCouponShippingAddress
            })
            : orderService.validatePublicRecoveryCoupon({
                code: couponFromQuery,
                shippingAddress: form.address,
                items: checkoutItemsPayload,
                guest: { mobile: form.mobile }
            });
        validateRequest.then((data) => {
            setCoupon(couponFromQuery);
            setAppliedCoupon({
                code: couponFromQuery,
                discountTotal: Number(data?.discountTotal || 0),
                coupon: data?.coupon || null
            });
            toast.success(`Coupon applied: ${couponFromQuery}`);
        }).catch((error) => {
            toast.error(error?.message || 'Coupon is invalid or expired');
            setAppliedCoupon(null);
        }).finally(() => {
            setIsApplyingCoupon(false);
        });
    }, [user, couponFromQuery, appliedCoupon?.code, toast, itemCount, liveCouponShippingAddress, form.address, checkoutItemsPayload, guestLockedAccount]);

    const applyLoyaltyStatus = useCallback((status) => {
        setLoyaltyStatus(status || null);
        const prevTier = String(lastTierSeenRef.current || 'regular').toLowerCase();
        const nextTier = String(status?.tier || prevTier).toLowerCase();
        if (status?.profile) {
            const currentUserTier = String(user?.loyaltyTier || 'regular').toLowerCase();
            const currentProfileLabel = String(user?.loyaltyProfile?.label || '').trim().toLowerCase();
            const nextProfileLabel = String(status?.profile?.label || '').trim().toLowerCase();
            if (currentUserTier !== nextTier || currentProfileLabel !== nextProfileLabel) {
                updateUser({
                    loyaltyTier: nextTier,
                    loyaltyProfile: status.profile
                });
            }
        }
        if (!loyaltyHydratedRef.current) {
            loyaltyHydratedRef.current = true;
            lastTierSeenRef.current = nextTier;
            return;
        }
        if (prevTier !== nextTier) {
            lastTierSeenRef.current = nextTier;
            if (['bronze', 'silver', 'gold', 'platinum'].includes(nextTier)) {
                burstConfetti();
                playCue(successDing);
                toast.success(`Membership upgraded to ${formatTierLabel(status?.profile?.label || nextTier)}!`);
            }
        }
    }, [toast, updateUser, user?.loyaltyTier, user?.loyaltyProfile?.label]);

    useEffect(() => {
        if (!user) {
            setLoyaltyStatus(null);
            return;
        }
        let cancelled = false;
        authService.getLoyaltyStatus()
            .then((data) => {
                if (cancelled) return;
                applyLoyaltyStatus(data?.status || null);
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [user, applyLoyaltyStatus]);

    useEffect(() => {
        if (itemCount <= 0) {
            setCheckoutSummary(null);
            return;
        }
        if (user && (isCartSyncing || Boolean(postOtpCheckoutSync) || isPreparingVerifiedCheckout || resumeCheckoutAfterVerification)) {
            setIsSummaryLoading(false);
            return;
        }
        if (user && !authenticatedPricingPreviewAddress) {
            setIsSummaryLoading(false);
            return;
        }
        let cancelled = false;
        const timer = setTimeout(async () => {
            setIsSummaryLoading(true);
            const [summaryResult, loyaltyResult] = await Promise.allSettled([
                user
                    ? orderService.getCheckoutSummary({
                        shippingAddress: authenticatedPricingPreviewAddress,
                        couponCode: appliedCoupon?.code || null
                    })
                    : orderService.getPublicCheckoutSummary({
                        shippingAddress: pricingPreviewAddress,
                        couponCode: appliedCoupon?.code || null,
                        items: checkoutItemsPayload,
                        guest: { mobile: form.mobile }
                    }),
                user ? authService.getLoyaltyStatus() : Promise.resolve({ status: null })
            ]);

            if (cancelled) return;

            if (summaryResult.status === 'fulfilled') {
                startTransition(() => {
                    setCheckoutSummary(summaryResult.value?.summary || null);
                });
            }

            if (user && loyaltyResult.status === 'fulfilled' && loyaltyResult.value?.status) {
                startTransition(() => {
                    applyLoyaltyStatus(loyaltyResult.value.status);
                });
            }

            if (!cancelled) {
                setIsSummaryLoading(false);
            }
        }, 280);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [user, items, subtotal, itemCount, pricingPreviewAddress, authenticatedPricingPreviewAddress, appliedCoupon?.code, applyLoyaltyStatus, pricingSyncTick, checkoutItemsPayload, guestLookup?.status, guestLookup?.mobile, isCartSyncing, postOtpCheckoutSync, isPreparingVerifiedCheckout, resumeCheckoutAfterVerification]);

    useEffect(() => {
        refreshAvailableCoupons();
    }, [refreshAvailableCoupons]);

    useEffect(() => {
        if (!socket || !user?.id) return undefined;
        const handleCouponChanged = (payload = {}) => {
            const affectedUserId = payload?.userId || null;
            if (affectedUserId && String(affectedUserId) !== String(user.id)) return;
            refreshAvailableCoupons();
        };
        socket.on('coupon:changed', handleCouponChanged);
        return () => {
            socket.off('coupon:changed', handleCouponChanged);
        };
    }, [socket, user?.id, refreshAvailableCoupons]);

    useAdminCrudSync({
        'company:info_update': () => {
            setPricingSyncTick((prev) => prev + 1);
        },
        'tax:config_update': () => {
            setPricingSyncTick((prev) => prev + 1);
        },
        'shipping:update': () => {
            setPricingSyncTick((prev) => prev + 1);
            refreshAvailableCoupons();
        },
        'product:create': () => {
            setPricingSyncTick((prev) => prev + 1);
        },
        'product:update': () => {
            setPricingSyncTick((prev) => prev + 1);
        },
        'product:delete': () => {
            setPricingSyncTick((prev) => prev + 1);
        },
        'product:category_change': () => {
            setPricingSyncTick((prev) => prev + 1);
        },
        'refresh:categories': () => {
            setPricingSyncTick((prev) => prev + 1);
        }
    });

    useEffect(() => {
        if (!orderResult?.id) {
            orderCelebratedRef.current = false;
            return;
        }
        if (orderCelebratedRef.current) return;
        orderCelebratedRef.current = true;
        burstConfetti();
        playCue(successDing);
    }, [orderResult?.id]);

    const handleFieldChange = (e) => {
        const { name, value } = e.target;
        let nextValue = value;
        if (name === 'mobile') {
            nextValue = normalizeStorefrontMobileInput(value);
        }
        if (name === 'mobile' || name === 'email') {
            setProfileFieldErrors((prev) => ({ ...prev, [name]: '' }));
        }
        setGuestCheckoutConflict('');
        setIsAccountVerificationOpen(false);
        setForm((prev) => ({ ...prev, [name]: nextValue }));
    };

    const handleFieldBlur = (e) => {
        const { name } = e.target;
        if (name === 'mobile') {
            setTouchedFields((prev) => ({ ...prev, mobile: true }));
        }
    };

    const handleAddressChange = useCallback((section, field, value) => {
        let nextValue = value;
        if (field === 'zip') {
            nextValue = normalizePincodeInput(value);
        }
        if (field === 'additionalPhone') {
            nextValue = normalizeStorefrontMobileInput(value);
        }
        if (field === 'state') {
            nextValue = resolveAllowedStateName(availableStates, value);
        }
        setGuestCheckoutConflict('');
        setIsAccountVerificationOpen(false);
        setForm((prev) => ({
            ...prev,
            [section]: { ...prev[section], [field]: nextValue }
        }));
    }, [availableStates]);

    const handleSave = async () => {
        if (!user) return;
        if (isSaving) return;
        setIsSaving(true);
        try {
            setProfileFieldErrors({ mobile: '', email: '' });
            const res = await authService.updateProfile({
                name: form.name,
                email: form.email,
                mobile: form.mobile,
                address: form.address,
                billingAddress: billingAddressEnabled ? form.billingAddress : form.address
            });
            if (res?.user) {
                updateUser(res.user);
                toast.success('Address updated');
                setEditing(false);
            } else {
                toast.error(res?.message || 'Failed to update profile');
            }
        } catch (error) {
            const nextFieldErrors = resolveProfileFieldErrors(error?.message);
            if (nextFieldErrors.mobile || nextFieldErrors.email) {
                setProfileFieldErrors(nextFieldErrors);
            }
            toast.error(error?.message || 'Failed to update profile');
        } finally {
            setIsSaving(false);
        }
    };

    const openOtpLogin = () => {
        setIsAccountVerificationOpen(true);
    };

    const handleApplyCoupon = () => {
        if (isGuestCouponLoginRequired) {
            toast.info('Login via OTP to unlock account coupons.');
            openOtpLogin();
            return;
        }
        const code = String(coupon || '').trim().toUpperCase();
        if (!code) return toast.error('Enter a coupon code');
        if (!user && !guestLockedAccount && !hasCompleteAddress(form.address)) return toast.error('Please complete shipping address before applying coupon');
        const knownCoupon = availableCoupons.find((entry) => String(entry.code || '').toUpperCase() === code);
        if (knownCoupon) {
            const eligibility = getCouponEligibility(knownCoupon);
            if (!eligibility.isEligible) {
                return toast.error(`Add ₹${eligibility.shortfall.toLocaleString('en-IN')} more to unlock this coupon.`);
            }
        }
        setIsApplyingCoupon(true);
        const request = user
            ? orderService.validateRecoveryCoupon({
                code,
                shippingAddress: hasCompleteAddress(form.address) ? form.address : null
            })
            : orderService.validatePublicRecoveryCoupon({
                code,
                shippingAddress: form.address,
                items: checkoutItemsPayload,
                guest: { mobile: form.mobile }
            });
        request.then((data) => {
            setCoupon(code);
            setAppliedCoupon({
                code,
                discountTotal: Number(data?.discountTotal || 0),
                coupon: data?.coupon || null
            });
            toast.success(`Coupon applied: ${code}`);
        }).catch((error) => {
            toast.error(error?.message || 'Coupon is invalid or expired');
            setAppliedCoupon(null);
        }).finally(() => {
            setIsApplyingCoupon(false);
        });
    };

    const handleRemoveCoupon = () => {
        setAppliedCoupon(null);
        setCoupon('');
    };

    const handleApplyAvailableCoupon = (code) => {
        if (isGuestCouponLoginRequired) {
            toast.info('Login via OTP to unlock account coupons.');
            openOtpLogin();
            return;
        }
        const normalizedCode = String(code || '').toUpperCase();
        if (!user && !guestLockedAccount && !hasCompleteAddress(form.address)) {
            toast.error('Please complete shipping address before applying coupon');
            return;
        }
        const selectedCoupon = availableCoupons.find((entry) => String(entry.code || '').toUpperCase() === normalizedCode);
        if (selectedCoupon) {
            const eligibility = getCouponEligibility(selectedCoupon);
            if (!eligibility.isEligible) {
                setCoupon(normalizedCode);
                toast.error(`Add ₹${eligibility.shortfall.toLocaleString('en-IN')} more to unlock this coupon.`);
                return;
            }
        }
        setCoupon(normalizedCode);
        if (appliedCoupon?.code === normalizedCode) return;
        setIsApplyingCoupon(true);
        const request = user
            ? orderService.validateRecoveryCoupon({
                code: normalizedCode,
                shippingAddress: hasCompleteAddress(form.address) ? form.address : null
            })
            : orderService.validatePublicRecoveryCoupon({
                code: normalizedCode,
                shippingAddress: form.address,
                items: checkoutItemsPayload,
                guest: { mobile: form.mobile }
            });
        request.then((data) => {
            setAppliedCoupon({
                code: normalizedCode,
                discountTotal: Number(data?.discountTotal || 0),
                coupon: data?.coupon || null
            });
            toast.success(`Coupon applied: ${normalizedCode}`);
        }).catch((error) => {
            toast.error(error?.message || 'Coupon is invalid or expired');
            setAppliedCoupon(null);
        }).finally(() => {
            setIsApplyingCoupon(false);
        });
    };

    const lineItems = useMemo(() => items.map(item => ({
        ...item,
        lineTotal: Number(item.price || 0) * Number(item.quantity || 0),
        weightKg: Number(item.weightKg || 0)
    })), [items]);
    const fallbackProductMrpSavings = useMemo(() => lineItems.reduce((sum, item) => {
        const mrp = Number(item.compareAt || item.originalPrice || 0);
        const price = Number(item.price || 0);
        const qty = Number(item.quantity || 0);
        if (mrp <= price || qty <= 0) return sum;
        return sum + ((mrp - price) * qty);
    }, 0), [lineItems]);

    const getOrderResultItemImage = (item) => (
        item?.image_url
        || item?.imageUrl
        || item?.item_snapshot?.imageUrl
        || item?.snapshot?.imageUrl
        || null
    );
    const canDownloadInvoice = useCallback((order) => {
        const status = String(order?.payment_status || order?.paymentStatus || '').trim().toLowerCase();
        return Boolean(order?.id) && (status === 'paid' || status === 'refunded');
    }, []);
    const handleDownloadOrderInvoice = useCallback(async () => {
        if (!canDownloadInvoice(orderResult) || isDownloadingOrderInvoice) return;
        setIsDownloadingOrderInvoice(true);
        try {
            await orderService.downloadMyInvoice(orderResult.id);
        } catch (error) {
            toast.error(error?.message || 'Unable to generate invoice');
        } finally {
            setIsDownloadingOrderInvoice(false);
        }
    }, [canDownloadInvoice, orderResult, isDownloadingOrderInvoice, toast]);

    const totalWeightKg = useMemo(() => lineItems.reduce((sum, item) => {
        return sum + (Number(item.weightKg || 0) * Number(item.quantity || 0));
    }, 0), [lineItems]);

    const fallbackShippingFee = useMemo(() => Number(computeShippingPreview({
        zones,
        state: form.address?.state,
        subtotal,
        totalWeightKg,
        useDefaultZone: true
    })?.fee || 0), [zones, form.address?.state, subtotal, totalWeightKg]);
    const fallbackShippingPreview = useMemo(() => computeShippingPreview({
        zones,
        state: form.address?.state,
        subtotal,
        totalWeightKg,
        useDefaultZone: true
    }), [zones, form.address?.state, subtotal, totalWeightKg]);
    const shouldUseTentativeShippingPreview = useMemo(
        () => (
            !user
            && !hasCompleteAddress(form.address)
            && Boolean(fallbackShippingPreview?.isTentative)
            && Number(checkoutSummary?.shippingFee ?? 0) <= 0
        ),
        [user, form.address, fallbackShippingPreview?.isTentative, checkoutSummary?.shippingFee]
    );
    const shippingFee = useMemo(
        () => Number(
            shouldUseTentativeShippingPreview
                ? fallbackShippingFee
                : (checkoutSummary?.shippingFee ?? fallbackShippingFee ?? 0)
        ),
        [shouldUseTentativeShippingPreview, fallbackShippingFee, checkoutSummary?.shippingFee]
    );
    const freeShippingSavings = useMemo(
        () => Number(fallbackShippingPreview?.freeShippingSavings || 0),
        [fallbackShippingPreview?.freeShippingSavings]
    );
    const shippingHelperMessage = useMemo(
        () => (
            fallbackShippingPreview?.isTentative
                ? 'Estimated using the default delivery zone. Final shipping updates after you add the delivery address.'
                : 'Shipping will refresh automatically if the delivery address changes.'
        ),
        [fallbackShippingPreview?.isTentative]
    );
    const isShippingUnavailable = Boolean(
        hasCompleteAddress(form.address)
        && fallbackShippingPreview
        && fallbackShippingPreview.isUnavailable
        && Number(shippingFee || 0) === 0
    );
    const couponDiscount = useMemo(
        () => Number(checkoutSummary?.couponDiscountTotal ?? appliedCoupon?.discountTotal ?? 0),
        [checkoutSummary?.couponDiscountTotal, appliedCoupon?.discountTotal]
    );
    const resolvedCheckoutTier = useMemo(
        () => String((user ? (loyaltyStatus?.tier || checkoutSummary?.loyaltyTier) : checkoutSummary?.loyaltyTier) || 'regular').toLowerCase(),
        [user, loyaltyStatus?.tier, checkoutSummary?.loyaltyTier]
    );
    const resolvedCheckoutLoyaltyProfile = useMemo(
        () => (user ? (loyaltyStatus?.profile || checkoutSummary?.loyaltyMeta?.profile || null) : (checkoutSummary?.loyaltyMeta?.profile || null)),
        [user, loyaltyStatus?.profile, checkoutSummary?.loyaltyMeta?.profile]
    );
    const resolvedCheckoutEligibility = useMemo(
        () => (user ? (loyaltyStatus?.eligibility || null) : null),
        [user, loyaltyStatus?.eligibility]
    );
    const resolvedCheckoutProgress = useMemo(
        () => (user ? (loyaltyStatus?.progress || checkoutSummary?.loyaltyMeta?.progress || {}) : (checkoutSummary?.loyaltyMeta?.progress || {})),
        [user, loyaltyStatus?.progress, checkoutSummary?.loyaltyMeta?.progress]
    );
    const estimatedLoyaltyDiscount = useMemo(() => {
        const isMembershipEligible = Boolean(resolvedCheckoutEligibility?.isEligible ?? true);
        if (!isMembershipEligible) return 0;
        const tierKey = resolvedCheckoutTier;
        const memberPct = Number(
            resolvedCheckoutLoyaltyProfile?.extraDiscountPct
            ?? EXTRA_DISCOUNT_BY_TIER[tierKey]
            ?? 0
        );
        const eligibleBase = Math.max(0, Number(subtotal || 0) - Number(couponDiscount || 0));
        return Math.max(0, Number(((eligibleBase * memberPct) / 100).toFixed(2)));
    }, [resolvedCheckoutEligibility?.isEligible, resolvedCheckoutTier, resolvedCheckoutLoyaltyProfile?.extraDiscountPct, subtotal, couponDiscount]);
    const estimatedLoyaltyShippingDiscount = useMemo(() => {
        const isMembershipEligible = Boolean(resolvedCheckoutEligibility?.isEligible ?? true);
        if (!isMembershipEligible) return 0;
        const shippingPct = Number(
            resolvedCheckoutLoyaltyProfile?.shippingDiscountPct
            ?? 0
        );
        return Math.max(0, Number(((Number(shippingFee || 0) * shippingPct) / 100).toFixed(2)));
    }, [resolvedCheckoutEligibility?.isEligible, resolvedCheckoutLoyaltyProfile?.shippingDiscountPct, shippingFee]);
    const loyaltyDiscount = useMemo(
        () => Number(checkoutSummary?.loyaltyDiscountTotal ?? estimatedLoyaltyDiscount ?? 0),
        [checkoutSummary?.loyaltyDiscountTotal, estimatedLoyaltyDiscount]
    );
    const loyaltyShippingDiscount = useMemo(
        () => Number(checkoutSummary?.loyaltyShippingDiscountTotal ?? estimatedLoyaltyShippingDiscount ?? 0),
        [checkoutSummary?.loyaltyShippingDiscountTotal, estimatedLoyaltyShippingDiscount]
    );
    const taxTotal = useMemo(
        () => Number(checkoutSummary?.taxTotal ?? 0),
        [checkoutSummary?.taxTotal]
    );
    const taxPriceMode = useMemo(
        () => String(checkoutSummary?.taxPriceMode || 'exclusive').trim().toLowerCase() === 'inclusive' ? 'inclusive' : 'exclusive',
        [checkoutSummary?.taxPriceMode]
    );
    const roundOffAmount = useMemo(
        () => Number(checkoutSummary?.roundOffAmount ?? 0),
        [checkoutSummary?.roundOffAmount]
    );
    const checkoutTaxHint = useMemo(() => {
        if (taxTotal <= 0) return '';
        return `Includes ₹${Number(taxTotal || 0).toLocaleString('en-IN')} GST`;
    }, [taxTotal]);
    const hasServerLoyaltyDiscount = useMemo(
        () => Boolean(checkoutSummary && Object.prototype.hasOwnProperty.call(checkoutSummary, 'loyaltyDiscountTotal')),
        [checkoutSummary]
    );
    const hasServerLoyaltyShippingDiscount = useMemo(
        () => Boolean(checkoutSummary && Object.prototype.hasOwnProperty.call(checkoutSummary, 'loyaltyShippingDiscountTotal')),
        [checkoutSummary]
    );
    const isEstimatedLoyaltyDiscount = loyaltyDiscount > 0 && !hasServerLoyaltyDiscount;
    const isEstimatedLoyaltyShippingDiscount = loyaltyShippingDiscount > 0 && !hasServerLoyaltyShippingDiscount;
    const displayPricing = useMemo(
        () => checkoutSummary?.displayPricing && typeof checkoutSummary.displayPricing === 'object' ? checkoutSummary.displayPricing : null,
        [checkoutSummary?.displayPricing]
    );
    const summarySubtotalDisplay = useMemo(
        () => Number(
            taxPriceMode === 'inclusive'
                ? (displayPricing?.displaySubtotalGross ?? subtotal)
                : (displayPricing?.displaySubtotalBase ?? subtotal)
        ),
        [taxPriceMode, displayPricing?.displaySubtotalGross, displayPricing?.displaySubtotalBase, subtotal]
    );
    const summaryShippingDisplay = useMemo(
        () => Number(
            taxPriceMode === 'inclusive'
                ? (displayPricing?.displayShippingGross ?? shippingFee)
                : (displayPricing?.displayShippingBase ?? shippingFee)
        ),
        [taxPriceMode, displayPricing?.displayShippingGross, displayPricing?.displayShippingBase, shippingFee]
    );
    const basePriceBeforeDiscounts = useMemo(
        () => Number(
            taxPriceMode === 'inclusive'
                ? (displayPricing?.displayGrossBeforeDiscounts ?? Math.max(0, Number(subtotal || 0) + Number(shippingFee || 0)))
                : (displayPricing?.displayBaseBeforeDiscounts ?? Math.max(0, Number(subtotal || 0) + Number(shippingFee || 0)))
        ),
        [taxPriceMode, displayPricing?.displayGrossBeforeDiscounts, displayPricing?.displayBaseBeforeDiscounts, subtotal, shippingFee]
    );
    const productDiscountDisplay = useMemo(
        () => Number(
            taxPriceMode === 'inclusive'
                ? (displayPricing?.displayProductDiscountGross ?? displayPricing?.displayProductDiscountBase ?? 0)
                : (displayPricing?.displayProductDiscountBase ?? displayPricing?.displayProductDiscountGross ?? 0)
        ),
        [taxPriceMode, displayPricing?.displayProductDiscountBase, displayPricing?.displayProductDiscountGross]
    );
    const summaryValueAfterDiscounts = useMemo(
        () => Number(
            taxPriceMode === 'inclusive'
                ? (displayPricing?.displayGrossAfterDiscounts ?? Math.max(0, basePriceBeforeDiscounts - Number(productDiscountDisplay || fallbackProductMrpSavings || 0) - Number(couponDiscount || 0) - Number(loyaltyDiscount || 0) - Number(loyaltyShippingDiscount || 0)))
                : (displayPricing?.displayValueAfterDiscountsBase ?? Math.max(0, basePriceBeforeDiscounts - Number(productDiscountDisplay || fallbackProductMrpSavings || 0) - Number(couponDiscount || 0) - Number(loyaltyDiscount || 0) - Number(loyaltyShippingDiscount || 0)))
        ),
        [taxPriceMode, displayPricing?.displayGrossAfterDiscounts, displayPricing?.displayValueAfterDiscountsBase, basePriceBeforeDiscounts, productDiscountDisplay, fallbackProductMrpSavings, couponDiscount, loyaltyDiscount, loyaltyShippingDiscount]
    );
    const resolvedProductDiscount = useMemo(
        () => Number(productDiscountDisplay || fallbackProductMrpSavings || 0),
        [productDiscountDisplay, fallbackProductMrpSavings]
    );
    const totalSavings = useMemo(
        () => Number(resolvedProductDiscount || 0) + Number(couponDiscount || 0) + Number(loyaltyDiscount || 0) + Number(loyaltyShippingDiscount || 0) + Number(freeShippingSavings || 0),
        [resolvedProductDiscount, couponDiscount, loyaltyDiscount, loyaltyShippingDiscount, freeShippingSavings]
    );
    const grandTotal = useMemo(() => {
        if (checkoutSummary?.total != null) return Number(checkoutSummary.total || 0);
        const gross = taxPriceMode === 'inclusive'
            ? Number(subtotal || 0) + Number(shippingFee || 0)
            : Number(subtotal || 0) + Number(shippingFee || 0) + Number(taxTotal || 0);
        return Math.max(0, gross - Number(couponDiscount || 0) - Number(loyaltyDiscount || 0) - Number(loyaltyShippingDiscount || 0));
    }, [checkoutSummary?.total, subtotal, shippingFee, taxTotal, couponDiscount, loyaltyDiscount, loyaltyShippingDiscount, taxPriceMode]);
    const isMobileMissingOnProfile = !String(user?.mobile || '').trim();
    const hasValidMobileForPayment = isValidStorefrontMobile(form.mobile);
    const effectiveBillingAddress = billingAddressEnabled ? form.billingAddress : form.address;
    const isAddressReadyForPayment = showGuestLockedPrefill || (hasCompleteAddress(form.address) && hasCompleteAddress(effectiveBillingAddress));
    const hasUnavailableItems = useMemo(() => hasUnavailableCheckoutItems(lineItems), [lineItems]);
    const isReadyForPayment = isAddressReadyForPayment && (!isMobileMissingOnProfile || hasValidMobileForPayment) && !hasUnavailableItems;
    const isLoggedInEditingBeforePayment = Boolean(user && editing);
    const maskedShippingAddressFields = guestLookup?.maskedProfile?.shippingAddressFields || {};
    const maskedBillingAddressFields = guestLookup?.maskedProfile?.billingAddressFields || {};
    const emailValidationMessage = useMemo(() => {
        const value = String(form.email || '').trim();
        if (!value) return '';
        return isValidEmailInput(value) ? '' : 'Enter a valid email';
    }, [form.email]);
    const mobileValidationMessage = useMemo(
        () => getStorefrontMobileValidationMessage(form.mobile),
        [form.mobile]
    );
    const additionalPhoneValidationMessage = useMemo(() => {
        const value = String(form.address?.additionalPhone || '').trim();
        if (!value) return '';
        return getStorefrontMobileValidationMessage(value);
    }, [form.address?.additionalPhone]);
    const fieldErrors = useMemo(() => {
        const errors = {};
        const requiresGuestName = !user && !guestLockedAccount;
        if ((user || requiresGuestName) && !String(form.name || '').trim()) errors.name = 'Name is required';
        if (String(form.email || '').trim() && !isValidEmailInput(form.email)) errors.email = 'Enter a valid email';
        if (mobileValidationMessage) errors.mobile = mobileValidationMessage;
        if (additionalPhoneValidationMessage) errors.shippingAdditionalPhone = additionalPhoneValidationMessage;
        if (profileFieldErrors.email) errors.email = profileFieldErrors.email;
        if (profileFieldErrors.mobile) errors.mobile = profileFieldErrors.mobile;

        const shouldRequireGuestAddress = !guestLockedAccount
            || hasAddressFields(form.address)
            || (billingAddressEnabled && hasAddressFields(form.billingAddress));

        const shouldValidateAddresses = user || shouldRequireGuestAddress;
        if (!shouldValidateAddresses) {
            return errors;
        }

        ['address', ...(billingAddressEnabled ? ['billingAddress'] : [])].forEach((section) => {
            const prefix = section === 'address' ? 'shipping' : 'billing';
            const source = form[section] || {};
            if (!String(source.line1 || '').trim()) errors[`${prefix}Line1`] = 'Street address is required';
            if (!String(source.city || '').trim()) errors[`${prefix}City`] = 'City is required';
            if (!String(source.state || '').trim()) errors[`${prefix}State`] = 'State is required';
            else if (!isAllowedShippingState(availableStates, source.state)) errors[`${prefix}State`] = 'Select a valid state';
            if (!isValidZipInput(source.zip)) errors[`${prefix}Zip`] = 'Enter a valid 6-digit PIN code';
        });
        return errors;
    }, [additionalPhoneValidationMessage, availableStates, billingAddressEnabled, form, guestLockedAccount, mobileValidationMessage, profileFieldErrors, user]);
    const hasFormValidationErrors = Object.keys(fieldErrors).length > 0;
    const hasShippingFieldErrors = Boolean(fieldErrors.shippingLine1 || fieldErrors.shippingCity || fieldErrors.shippingState || fieldErrors.shippingZip || fieldErrors.shippingAdditionalPhone);
    const hasBillingFieldErrors = Boolean(fieldErrors.billingLine1 || fieldErrors.billingCity || fieldErrors.billingState || fieldErrors.billingZip);
    const hasLoggedInRequiredDetailsMissing = Boolean(
        user && (
            hasShippingFieldErrors
            || (billingAddressEnabled && hasBillingFieldErrors)
            || Boolean(fieldErrors.mobile)
        )
    );
    const shouldShowValidationHints = Boolean(attemptedPay || hasLoggedInRequiredDetailsMissing);
    const shouldShowMobileValidationHint = Boolean(fieldErrors.mobile && (attemptedPay || touchedFields.mobile || hasLoggedInRequiredDetailsMissing));
    const formInputsDisabled = Boolean(user && !editing && !hasLoggedInRequiredDetailsMissing);
    const selectedCouponForInput = useMemo(
        () => availableCoupons.find((entry) => String(entry.code || '').toUpperCase() === String(coupon || '').trim().toUpperCase()) || null,
        [availableCoupons, coupon]
    );
    const selectedCouponEligibility = useMemo(
        () => (selectedCouponForInput ? getCouponEligibility(selectedCouponForInput) : null),
        [selectedCouponForInput]
    );
    const isCouponInputDisabled = isGuestCouponLoginRequired || Boolean(selectedCouponEligibility && !selectedCouponEligibility.isEligible && !appliedCoupon);
    const visibleCoupons = useMemo(() => {
        const byCode = new Map();
        availableCoupons.forEach((entry) => {
            const code = String(entry?.code || '').trim().toUpperCase();
            if (!code) return;
            if (!byCode.has(code)) byCode.set(code, entry);
        });
        return Array.from(byCode.values());
    }, [availableCoupons]);
    useEffect(() => {
        if (user && isAccountVerificationOpen) {
            setIsAccountVerificationOpen(false);
        }
    }, [user, isAccountVerificationOpen]);

    useEffect(() => {
        if (!isGuestCouponLoginRequired) return;
        if (!appliedCoupon && !coupon) return;
        setAppliedCoupon(null);
        setCoupon('');
    }, [appliedCoupon, coupon, isGuestCouponLoginRequired]);

    useEffect(() => {
        if (!postOtpCheckoutSync || !user) return;
        let cancelled = false;
        const withTimeout = (promise, timeoutMs = POST_OTP_PREPARE_TIMEOUT_MS) => Promise.race([
            promise,
            new Promise((_, reject) => {
                window.setTimeout(() => {
                    reject(new Error('Checkout preparation took too long. Please review the form and continue manually.'));
                }, timeoutMs);
            })
        ]);

        const continueCheckout = async () => {
            try {
                const preservedShippingAddress = {
                    ...checkoutAddressSnapshotRef.current.address,
                    state: resolveAllowedStateName(availableStates, checkoutAddressSnapshotRef.current?.address?.state) || ''
                };
                const preservedBillingAddress = billingAddressEnabled
                    ? {
                        ...checkoutAddressSnapshotRef.current.billingAddress,
                        state: resolveAllowedStateName(availableStates, checkoutAddressSnapshotRef.current?.billingAddress?.state) || ''
                    }
                    : preservedShippingAddress;

                if (hasCompleteAddress(preservedShippingAddress) && hasCompleteAddress(preservedBillingAddress)) {
                    const profileRes = await withTimeout(authService.updateProfile({
                        name: form.name,
                        email: form.email,
                        mobile: form.mobile,
                        address: preservedShippingAddress,
                        billingAddress: preservedBillingAddress
                    }));
                    if (!cancelled && profileRes?.user) {
                        updateUser(profileRes.user);
                    }
                }
                if (cancelled) return;
                const syncResult = await withTimeout(syncValidatedAccountCheckoutCart(postOtpCheckoutSync.guestItems || []));
                if (cancelled) return;
                const requiresShippingCorrection = !hasCompleteAddress(preservedShippingAddress);
                const requiresBillingCorrection = billingAddressEnabled && !hasCompleteAddress(preservedBillingAddress);
                if (requiresShippingCorrection || requiresBillingCorrection) {
                    setPostOtpCheckoutSync(null);
                    setResumeCheckoutAfterVerification(false);
                    setIsPreparingVerifiedCheckout(false);
                    setEditing(true);
                    toast.info('Complete the highlighted delivery details to continue with payment.');
                    return;
                }
                const couponResult = await withTimeout(applyBestCouponForValidatedCheckout(preservedShippingAddress));
                if (cancelled) return;
                if (Number(syncResult?.movedToWishlistCount || 0) > 0) {
                    toast.info(`${Number(syncResult.movedToWishlistCount)} existing account cart item(s) were moved to wishlist. Continuing with your checkout cart.`);
                }
                if (couponResult?.coupon?.code) {
                    toast.success(`Best coupon applied: ${String(couponResult.coupon.code).trim().toUpperCase()}`);
                }
                setPostOtpCheckoutSync(null);
                setResumeCheckoutAfterVerification(true);
                window.setTimeout(() => {
                    void handlePayNow();
                }, 250);
            } catch (error) {
                if (cancelled) return;
                setPostOtpCheckoutSync(null);
                setIsPreparingVerifiedCheckout(false);
                toast.error(error?.message || 'Unable to prepare checkout after account verification');
            }
        };

        void continueCheckout();
        return () => {
            cancelled = true;
        };
    }, [applyBestCouponForValidatedCheckout, availableStates, billingAddressEnabled, form.email, form.mobile, form.name, postOtpCheckoutSync, syncValidatedAccountCheckoutCart, toast, updateUser, user]);

    useEffect(() => {
        if (!resumeCheckoutAfterVerification || !user) return;
        const effectiveCurrentBillingAddress = billingAddressEnabled ? form.billingAddress : form.address;
        if (lineItems.length === 0) {
            setResumeCheckoutAfterVerification(false);
            setIsPreparingVerifiedCheckout(false);
            return;
        }
        if (!hasCompleteAddress(form.address) || !hasCompleteAddress(effectiveCurrentBillingAddress) || hasFormValidationErrors) {
            setResumeCheckoutAfterVerification(false);
            setIsPreparingVerifiedCheckout(false);
            setEditing(true);
            return;
        }
        if (hasUnavailableItems || isPlacingOrder) {
            setResumeCheckoutAfterVerification(false);
            setIsPreparingVerifiedCheckout(false);
            return;
        }
        setResumeCheckoutAfterVerification(false);
        const timer = window.setTimeout(() => {
            void handlePayNow();
        }, 150);
        return () => window.clearTimeout(timer);
    }, [resumeCheckoutAfterVerification, user, form.address, form.billingAddress, hasFormValidationErrors, hasUnavailableItems, isPlacingOrder, lineItems.length]);

    const handlePayNow = async () => {
        setAttemptedPay(true);
        if (lineItems.length === 0) {
            setIsPreparingVerifiedCheckout(false);
            return toast.error('Your cart is empty');
        }
        if (isPlacingOrder) {
            setIsPreparingVerifiedCheckout(false);
            return;
        }
        if (hasUnavailableItems) {
            setIsPreparingVerifiedCheckout(false);
            return toast.error('Some items are unavailable. Please review your cart before payment.');
        }
        if (hasFormValidationErrors) {
            setIsPreparingVerifiedCheckout(false);
            setEditing(true);
            return toast.error('Please correct highlighted fields before payment');
        }
        if (!user && guestLookup?.status === 'account_unavailable') {
            setIsPreparingVerifiedCheckout(false);
            return toast.error(guestCheckoutConflict || 'This mobile number belongs to an unavailable account.');
        }
        if (!user && guestLookup?.status === 'data_conflict') {
            setIsPreparingVerifiedCheckout(false);
            return toast.error(guestCheckoutConflict || 'This mobile number cannot be used right now. Please contact support.');
        }
        if (isMobileMissingOnProfile && !hasValidMobileForPayment) {
            setIsPreparingVerifiedCheckout(false);
            setEditing(true);
            return toast.error(mobileValidationMessage || 'Please enter a valid mobile number before payment');
        }
        const isGuestLockedFlow = !user && guestLockedAccount;
        const hasShippingOverride = hasCompleteAddress(form.address);
        const hasBillingOverride = billingAddressEnabled ? hasCompleteAddress(form.billingAddress) : hasShippingOverride;
        const effectiveGuestShippingAddress = isGuestLockedFlow
            ? (hasShippingOverride ? form.address : null)
            : form.address;
        const effectiveGuestBillingAddress = isGuestLockedFlow
            ? (billingAddressEnabled ? (hasBillingOverride ? form.billingAddress : null) : effectiveGuestShippingAddress)
            : effectiveBillingAddress;
        if ((!isGuestLockedFlow || hasAddressFields(form.address)) && !hasCompleteAddress(form.address)) {
            setIsPreparingVerifiedCheckout(false);
            setEditing(true);
            return toast.error('Please complete shipping address before payment');
        }
        if (billingAddressEnabled && (!isGuestLockedFlow || hasAddressFields(form.billingAddress)) && !hasCompleteAddress(form.billingAddress)) {
            setIsPreparingVerifiedCheckout(false);
            setEditing(true);
            return toast.error('Please complete billing address before payment');
        }
        setIsPlacingOrder(true);
        let currentAttemptId = null;
        try {
            setGuestCheckoutConflict('');
            setProfileFieldErrors({ mobile: '', email: '' });
            const normalizedFormEmail = String(form.email || '').trim().toLowerCase();
            const normalizedUserEmail = String(user?.email || '').trim().toLowerCase();
            const normalizedFormMobile = normalizeStorefrontMobileInput(form.mobile);
            const normalizedUserMobile = normalizeStorefrontMobileInput(user?.mobile || '');
            const profileHasUniqueFieldChanges = Boolean(
                user && (
                    normalizedFormEmail !== normalizedUserEmail
                    || normalizedFormMobile !== normalizedUserMobile
                )
            );
            const profileNeedsAddressSync = user && (
                !hasCompleteAddress(user?.address)
                || (billingAddressEnabled && !hasCompleteAddress(user?.billingAddress))
                || (isMobileMissingOnProfile && hasValidMobileForPayment)
            );
            const checkoutHasAddress = hasCompleteAddress(form.address) && hasCompleteAddress(effectiveBillingAddress);
            const shouldSyncProfileBeforePayment = user && (
                profileHasUniqueFieldChanges
                || (profileNeedsAddressSync && checkoutHasAddress && (!isMobileMissingOnProfile || hasValidMobileForPayment))
            );
            if (shouldSyncProfileBeforePayment) {
                const profileRes = await authService.updateProfile({
                    name: form.name,
                    email: form.email,
                    mobile: form.mobile,
                    address: form.address,
                    billingAddress: effectiveBillingAddress
                });
                if (profileRes?.user) {
                    updateUser(profileRes.user);
                    if (profileHasUniqueFieldChanges) {
                        toast.success('Profile updated');
                    } else {
                        toast.success('Address saved to profile');
                    }
                }
            }

            const preflight = user
                ? await orderService.getCheckoutSummary({
                    shippingAddress: form.address,
                    couponCode: appliedCoupon?.code || null
                })
                : await orderService.getPublicCheckoutSummary({
                    shippingAddress: effectiveGuestShippingAddress,
                    couponCode: appliedCoupon?.code || null,
                    items: checkoutItemsPayload,
                    guest: { mobile: form.mobile }
                });
            if (!preflight?.summary || preflight.summary.total == null) {
                throw new Error('Unable to validate order summary on server. Please retry.');
            }
            setCheckoutSummary(preflight.summary);

            const scriptLoaded = await ensureRazorpayScript();
            if (!scriptLoaded || !window.Razorpay) {
                throw new Error('Unable to load Razorpay checkout');
            }

            const init = user
                ? await orderService.createRazorpayOrder({
                    billingAddress: effectiveBillingAddress,
                    shippingAddress: form.address,
                    couponCode: appliedCoupon?.code || null,
                    notes: {
                        source: 'web_checkout'
                    }
                })
                : await orderService.createPublicRazorpayOrder({
                    guest: {
                        name: form.name,
                        email: form.email,
                        mobile: form.mobile
                    },
                    billingAddress: effectiveGuestBillingAddress,
                    shippingAddress: effectiveGuestShippingAddress,
                    couponCode: appliedCoupon?.code || null,
                    notes: {
                        source: 'web_checkout'
                    },
                    items: checkoutItemsPayload
                });
            if (!init?.order?.id || !init?.keyId) {
                throw new Error(init?.message || 'Failed to initialize payment');
            }
            if (!user && init?.attempt?.id && init?.attemptToken) {
                orderService.rememberPublicAttemptAccess({
                    attemptId: init.attempt.id,
                    attemptToken: init.attemptToken
                });
            }
            setPendingPaymentAmount(Number(init?.order?.amount || 0) / 100);
            currentAttemptId = Number(init?.attempt?.id || 0) || null;
            const isPublicPaymentFlow = !user && Boolean(init?.attemptToken);

            const prefillContact = form.mobile
                ? (String(form.mobile).startsWith('+') ? String(form.mobile) : `+91${String(form.mobile).replace(/\D/g, '')}`)
                : '';

            const paidOrder = await new Promise((resolve, reject) => {
                let settled = false;
                const markSettled = () => { settled = true; };

                const rzp = new window.Razorpay({
                    key: init.keyId,
                    amount: init.order.amount,
                    currency: init.order.currency || 'INR',
                    name: 'SSC Jewellery',
                    description: `Order payment (${init.summary?.itemCount || itemCount} items)`,
                    image: BRAND_LOGO_URL,
                    order_id: init.order.id,
                    prefill: {
                        name: form.name || '',
                        email: form.email || '',
                        contact: prefillContact
                    },
                    notes: {
                        address: form.address?.line1 || ''
                    },
                    theme: {
                        color: '#1F2937'
                    },
                    modal: {
                        confirm_close: true,
                        ondismiss: () => {
                            if (!settled) {
                                markSettled();
                                reject(new Error('Payment cancelled'));
                            }
                        }
                    },
                    handler: async (response) => {
                        try {
                            setIsPaymentAwaitingConfirmation(true);
                            const verification = isPublicPaymentFlow
                                ? await orderService.verifyPublicRazorpayPayment({
                                    ...response,
                                    attemptId: init?.attempt?.id,
                                    attemptToken: init?.attemptToken
                                })
                                : await orderService.verifyRazorpayPayment(response);
                            if (verification?.order) {
                                setIsPaymentAwaitingConfirmation(false);
                                setOrderResult(verification.order);
                                await clearCart();
                                toast.success('Payment successful, order placed');
                                markSettled();
                                resolve(verification.order);
                                return;
                            }
                            if (verification?.processing && currentAttemptId) {
                                const polled = isPublicPaymentFlow
                                    ? await orderService.getPublicPaymentAttemptStatus(currentAttemptId, init.attemptToken)
                                    : await pollPaymentAttemptUntilResolved(currentAttemptId);
                                if (polled?.order) {
                                    setIsPaymentAwaitingConfirmation(false);
                                    setOrderResult(polled.order);
                                    await clearCart();
                                    toast.success('Payment successful, order placed');
                                    markSettled();
                                    resolve(polled.order);
                                    return;
                                }
                                if (polled?.failed) {
                                    throw new Error(polled?.message || 'Payment verification failed');
                                }
                                setIsPaymentAwaitingConfirmation(false);
                                markSettled();
                                navigate(`/payment/success?attemptId=${encodeURIComponent(String(currentAttemptId))}`);
                                resolve({ pending: true, attemptId: currentAttemptId });
                                return;
                            }
                            throw new Error('Payment verification is taking longer than usual');
                        } catch (error) {
                            setIsPaymentAwaitingConfirmation(false);
                            markSettled();
                            reject(error);
                        }
                    }
                });

                rzp.on('payment.failed', (response) => {
                    if (settled) return;
                    markSettled();
                    const message = response?.error?.description || 'Payment failed. Please retry.';
                    reject(new Error(message));
                });

                setIsPreparingVerifiedCheckout(false);
                rzp.open();
            });
            void paidOrder;
        } catch (error) {
            setIsPreparingVerifiedCheckout(false);
            setIsPaymentAwaitingConfirmation(false);
            const message = normalizePaymentFailureReason(error?.message || 'Failed to complete payment');
            if (user && /already in use|invalid email format|mobile must be 10 digits|enter a valid mobile number/i.test(message)) {
                const nextFieldErrors = resolveProfileFieldErrors(message);
                if (nextFieldErrors.mobile || nextFieldErrors.email) {
                    setProfileFieldErrors(nextFieldErrors);
                }
                setEditing(true);
                toast.error(message);
                return;
            }
            if (!currentAttemptId) {
                toast.error(message);
                return;
            }
            toast.error(message);
            const params = new URLSearchParams();
            params.set('reason', message);
            if (currentAttemptId) params.set('attemptId', String(currentAttemptId));
            navigate(`/payment/failed?${params.toString()}`);
        } finally {
            setIsPaymentAwaitingConfirmation(false);
            setIsPlacingOrder(false);
        }
    };

    if (!storefrontOpen) return <StorefrontClosed />;
    const tier = resolvedCheckoutTier;
    const membershipEligibility = resolvedCheckoutEligibility;
    const isMembershipEligible = Boolean(membershipEligibility?.isEligible ?? true);
    const profileCompletionPct = Number(membershipEligibility?.completionPct || 0);
    const missingProfileFields = Array.isArray(membershipEligibility?.missingFields) ? membershipEligibility.missingFields : [];
    const membershipUnlockState = formatMissingProfileFields(missingProfileFields);
    const tierTheme = TIER_THEME[tier] || TIER_THEME.regular;
    const tierLabel = formatTierLabel(resolvedCheckoutLoyaltyProfile?.label || tier);
    const progress = resolvedCheckoutProgress;
    const progressPct = Number(progress?.progressPct || 0);
    const nextTierKey = progress?.nextTier || null;
    const nextTierLabel = nextTierKey
        ? formatTierLabel(loyaltyStatus?.nextTierProfile?.label || nextTierKey)
        : '';
    const currentSpend = Number(progress?.currentSpend ?? 0);
    const neededToNext = Number(progress?.needed || 0);
    const progressMessage = String(progress?.message || '').trim();
    const isProgressMessageDuplicated = Boolean(
        nextTierLabel
        && neededToNext > 0
        && /spend/i.test(progressMessage)
        && /unlock/i.test(progressMessage)
    );
    const membershipMessage = (!isProgressMessageDuplicated && progressMessage)
        ? progressMessage
        : 'Keep shopping to unlock higher tier benefits.';

    return (
        <div className="min-h-screen bg-secondary">
            <div className="max-w-6xl mx-auto px-4 md:px-8 py-10 md:py-12">
                <div className="flex flex-col gap-6">
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                        <div className="flex flex-wrap items-center justify-between gap-4">
                            <div>
                                <h1 className="text-2xl md:text-3xl font-serif text-primary">Checkout</h1>
                                <p className="text-sm text-gray-500 mt-2">Review your order and confirm delivery details.</p>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-gray-400 uppercase tracking-widest">
                                Secure checkout
                            </div>
                        </div>

                        <div className="mt-8">
                            <CheckoutFlowHeader state="checkout" />
                        </div>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-6 items-stretch">
                        {lineItems.length === 0 ? (
                            <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-8 md:p-10">
                                <div className="flex flex-col items-center text-center">
                                    <img src={cartIllustration} alt="Empty cart" className="w-48 md:w-56" />
                                    <h2 className="mt-5 text-xl md:text-2xl font-semibold text-gray-800">Your checkout is empty</h2>
                                    <p className="mt-2 text-sm text-gray-500 max-w-md">
                                        It looks like there are no items in your cart right now. Explore products and add your favourites to continue.
                                    </p>
                                    <Link
                                        to="/shop"
                                        className="mt-6 inline-flex items-center justify-center px-6 py-3 rounded-xl bg-primary text-accent font-semibold hover:bg-primary-light"
                                    >
                                        Explore Products
                                    </Link>
                                </div>
                            </div>
                        ) : (
                        <>
                        <div className="flex flex-col gap-6 h-full">
                            {!user ? (
                                <div className="rounded-2xl p-5 bg-gradient-to-r from-slate-700 via-slate-600 to-slate-700 shadow-lg">
                                    <div className="flex items-start justify-between gap-4">
                                        <div>
                                            <p className="text-xs uppercase tracking-[0.24em] font-semibold text-white/75">Membership</p>
                                            <p className="text-xl font-semibold mt-1 text-white">Unlock Your Member View</p>
                                            <p className="text-sm mt-2 text-white/90">
                                                Verify your account to view your membership card, tier progress, and personalized benefits.
                                            </p>
                                            <p className="text-xs mt-3 text-white/80">
                                                Members can unlock extra pricing, shipping benefits, and tier-based rewards during checkout.
                                            </p>
                                        </div>
                                        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold border border-white/30 bg-white/15 text-white">
                                            <Sparkles size={14} /> Login to view
                                        </span>
                                    </div>
                                    <div className="mt-4 rounded-lg border border-white/20 bg-slate-950/20 px-3 py-3">
                                        <p className="text-xs font-semibold !mb-0 text-white">
                                            OTP verification is required before we reveal your membership card and progress details.
                                        </p>
                                        <p className="mt-2 text-[11px] text-white/95">
                                            Use {guestLockedAccount ? 'View/Edit' : 'account verification'} to log in and make this card viewable.
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <div className={`rounded-2xl p-5 bg-gradient-to-r ${tierTheme.card} shadow-lg`}>
                                    <div className="flex items-start justify-between gap-4">
                                        <div>
                                            <p className={`text-xs uppercase tracking-[0.24em] font-semibold ${tierTheme.caption}`}>Membership</p>
                                            <p className={`text-xl font-semibold mt-1 ${tierTheme.title}`}>{getMembershipLabel(tierLabel)}</p>
                                            <p className={`text-sm mt-2 ${tierTheme.body}`}>
                                                {membershipMessage}
                                            </p>
                                            <p className={`text-xs mt-2 ${tierTheme.caption}`}>
                                                Spent: ₹{currentSpend.toLocaleString('en-IN')}
                                            </p>
                                            <p className={`text-xs mt-1 ${tierTheme.caption}`}>
                                                {nextTierLabel ? `Need ₹${neededToNext.toLocaleString('en-IN')} more for ${getMembershipLabel(nextTierLabel)}` : 'You are at the highest tier.'}
                                            </p>
                                        </div>
                                        <div className="flex flex-col items-end gap-2">
                                            <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold border ${tierTheme.tag}`}>
                                                <Sparkles size={14} /> {isMembershipEligible ? 'Extra member pricing' : 'Profile completion required'}
                                            </span>
                                            {isSummaryLoading && !isPreparingVerifiedCheckout && (
                                                <span className="text-[11px] text-white/80">
                                                    Updating pricing...
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    {!isMembershipEligible && (
                                        <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-amber-900">
                                            <p className="text-xs font-semibold !mb-0">
                                                Membership benefits are locked until profile reaches 100% completion ({profileCompletionPct}% now).
                                            </p>
                                            {membershipUnlockState.items.length > 0 && (
                                                <div className="mt-2">
                                                    <p className="text-[11px] font-semibold !mb-0">{membershipUnlockState.title}</p>
                                                    <ul className="mt-1 space-y-1 text-[11px]">
                                                        {membershipUnlockState.items.map((field) => (
                                                            <li key={field}>- {field}</li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    <div className="mt-4">
                                        <div className={`h-2 rounded-full overflow-hidden ${tierTheme.track}`}>
                                            <div className={`h-full rounded-full ${tierTheme.fill}`} style={{ width: `${Math.max(0, Math.min(100, progressPct))}%` }} />
                                        </div>
                                        <div className={`mt-2 flex items-center justify-between text-xs ${tierTheme.caption}`}>
                                            <span>{progressPct}% to next tier</span>
                                            <span>{nextTierLabel ? `Next: ${getMembershipLabel(nextTierLabel)}` : 'Highest tier reached'}</span>
                                        </div>
                                    </div>
                                </div>
                            )}
                            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                                <div className="flex items-center justify-between gap-4">
                                    <div>
                                        <h2 className="text-lg font-semibold text-gray-800">Contact & Delivery</h2>
                                        <p className="text-sm text-gray-500">
                                            {user ? 'Update your billing and shipping addresses.' : 'Enter your contact, shipping, and billing details to continue securely.'}
                                        </p>
                                    </div>
                                    {!user && guestLockedAccount ? (
                                        <button
                                            type="button"
                                            onClick={openOtpLogin}
                                            className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                                        >
                                            View/Edit
                                        </button>
                                    ) : null}
                                    {user && !editing ? (
                                        <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                                            <Edit3 size={16} /> Edit
                                        </button>
                                    ) : user ? (
                                        <div className="flex items-center gap-2">
                                            {!hasPersistedLoggedInRequiredDetailsMissing && (
                                                <button type="button" onClick={restorePersistedLoggedInForm} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-500 hover:bg-gray-50">
                                                    Cancel
                                                </button>
                                            )}
                                            <button type="button" onClick={handleSave} disabled={isSaving} className="px-4 py-2 rounded-xl bg-primary text-accent text-sm font-semibold shadow-lg shadow-primary/20 hover:bg-primary-light disabled:opacity-60">
                                                {isSaving ? 'Saving...' : 'Save'}
                                            </button>
                                        </div>
                                    ) : null}
                                </div>
                                {!user && guestCheckoutConflict && (
                                    <div className={`mt-4 rounded-xl px-4 py-3 text-sm ${guestLookup?.status === 'account_unavailable' || guestLookup?.status === 'data_conflict' ? 'border border-red-200 bg-red-50 text-red-700' : 'border border-amber-200 bg-amber-50 text-amber-900'}`}>
                                        <p className="font-semibold">
                                            {guestLookup?.status === 'account_unavailable' || guestLookup?.status === 'data_conflict'
                                                ? 'Checkout unavailable for this mobile'
                                                : 'Existing account found'}
                                        </p>
                                        <p className="mt-1">{guestCheckoutConflict}</p>
                                    </div>
                                )}

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
                                    <div className="space-y-2">
                                        <label className="text-xs uppercase tracking-widest text-gray-400 font-semibold">Phone</label>
                                        <div className="relative">
                                            <input
                                                name="mobile"
                                                type="tel"
                                                inputMode="numeric"
                                                autoComplete="tel"
                                                maxLength={10}
                                                value={form.mobile}
                                                onChange={handleFieldChange}
                                                onBlur={handleFieldBlur}
                                                disabled={Boolean(user) || formInputsDisabled}
                                                placeholder="9876543210"
                                                className={`input-field pl-10 disabled:bg-gray-50 ${shouldShowMobileValidationHint ? 'border-red-400 bg-red-50/30' : ''}`}
                                            />
                                            <Phone size={16} className="absolute left-3 top-3.5 text-gray-400" />
                                        </div>
                                        {isGuestLookupLoading && !user && (
                                            <p className="text-[11px] text-gray-500">Checking this mobile number...</p>
                                        )}
                                        {shouldShowMobileValidationHint && (
                                            <p className="text-[11px] text-red-600">{fieldErrors.mobile || 'Enter a valid 10-digit mobile number.'}</p>
                                        )}
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs uppercase tracking-widest text-gray-400 font-semibold">Additional Phone</label>
                                        <div className="relative">
                                            <input
                                                type="tel"
                                                inputMode="numeric"
                                                autoComplete="tel-national"
                                                maxLength={10}
                                                value={showGuestLockedPrefill ? (guestLookup?.maskedProfile?.additionalPhone || 'Not saved') : form.address.additionalPhone}
                                                onChange={(e) => handleAddressChange('address', 'additionalPhone', e.target.value)}
                                                readOnly={showGuestLockedPrefill}
                                                disabled={formInputsDisabled}
                                                placeholder={showGuestLockedPrefill ? '' : 'Optional'}
                                                className={`input-field pl-10 disabled:bg-gray-50 ${showGuestLockedPrefill ? 'bg-gray-50 text-gray-700' : ''} ${shouldShowValidationHints && fieldErrors.shippingAdditionalPhone ? 'border-red-400 bg-red-50/30' : ''}`}
                                            />
                                            <Phone size={16} className="absolute left-3 top-3.5 text-gray-400" />
                                        </div>
                                        {!showGuestLockedPrefill && shouldShowValidationHints && fieldErrors.shippingAdditionalPhone && (
                                            <p className="text-[11px] text-red-600">{fieldErrors.shippingAdditionalPhone}</p>
                                        )}
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs uppercase tracking-widest text-gray-400 font-semibold">Name</label>
                                        <div className="relative">
                                            <input
                                                name="name"
                                                value={showGuestLockedPrefill ? (guestLookup?.maskedProfile?.name || 'Not saved') : form.name}
                                                onChange={handleFieldChange}
                                                readOnly={showGuestLockedPrefill}
                                                disabled={formInputsDisabled}
                                                className={`input-field pl-10 disabled:bg-gray-50 ${showGuestLockedPrefill ? 'bg-gray-50 text-gray-700' : ''} ${shouldShowValidationHints && fieldErrors.name ? 'border-red-400 bg-red-50/30' : ''}`}
                                            />
                                            <UserRound size={16} className="absolute left-3 top-3.5 text-gray-400" />
                                        </div>
                                        {!showGuestLockedPrefill && shouldShowValidationHints && fieldErrors.name && <p className="text-[11px] text-red-600">{fieldErrors.name}</p>}
                                    </div>
                                    <div className="space-y-2 md:col-span-2">
                                        <label className="text-xs uppercase tracking-widest text-gray-400 font-semibold">Email</label>
                                        <div className="relative">
                                            <input
                                                name="email"
                                                value={showGuestLockedPrefill ? (guestLookup?.maskedProfile?.email || 'Not saved') : (form.email || '')}
                                                onChange={handleFieldChange}
                                                readOnly={showGuestLockedPrefill}
                                                disabled={formInputsDisabled}
                                                placeholder={showGuestLockedPrefill ? '' : 'Optional'}
                                                className={`input-field pl-10 disabled:bg-gray-50 ${showGuestLockedPrefill ? 'bg-gray-50 text-gray-700' : ''} ${(emailValidationMessage && String(form.email || '').trim()) || (shouldShowValidationHints && fieldErrors.email) ? 'border-red-400 bg-red-50/30' : ''}`}
                                            />
                                            <Mail size={16} className="absolute left-3 top-3.5 text-gray-400" />
                                        </div>
                                        {!showGuestLockedPrefill && (((emailValidationMessage && String(form.email || '').trim()) || (shouldShowValidationHints && fieldErrors.email))) && (
                                            <p className="text-[11px] text-red-600">{emailValidationMessage || fieldErrors.email}</p>
                                        )}
                                    </div>
                                </div>

                                <div className={`grid grid-cols-1 ${billingAddressEnabled ? 'md:grid-cols-2' : ''} gap-5 mt-6`}>
                                    {billingAddressEnabled && (
                                        <div className={`rounded-2xl border p-5 ${hasBillingFieldErrors && shouldShowValidationHints ? 'border-red-200 bg-red-50/40' : 'border-gray-100 bg-gray-50'}`}>
                                            <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                                                <CreditCard size={16} className="text-primary" /> Billing Address
                                            </h3>
                                            {hasBillingFieldErrors && shouldShowValidationHints && (
                                                <p className="mt-2 text-[11px] font-medium text-red-600">
                                                    Complete the highlighted billing details to continue payment.
                                                </p>
                                            )}
                                            <div className="mt-4 space-y-3">
                                                <input
                                                    value={showGuestLockedPrefill ? (maskedBillingAddressFields.line1 || 'Not saved') : form.billingAddress.line1}
                                                    onChange={(e) => handleAddressChange('billingAddress', 'line1', e.target.value)}
                                                    readOnly={showGuestLockedPrefill}
                                                    disabled={formInputsDisabled}
                                                    placeholder="Street Address"
                                                    className={`input-field disabled:bg-gray-50 ${showGuestLockedPrefill ? 'bg-gray-50 text-gray-700' : ''} ${shouldShowValidationHints && fieldErrors.billingLine1 ? 'border-red-400 bg-red-50/30' : ''}`}
                                                />
                                                <div className="grid grid-cols-2 gap-3">
                                                    <input
                                                        value={showGuestLockedPrefill ? (maskedBillingAddressFields.city || 'Not saved') : form.billingAddress.city}
                                                        onChange={(e) => handleAddressChange('billingAddress', 'city', e.target.value)}
                                                        readOnly={showGuestLockedPrefill}
                                                        disabled={formInputsDisabled}
                                                        placeholder="City"
                                                        className={`input-field disabled:bg-gray-50 ${showGuestLockedPrefill ? 'bg-gray-50 text-gray-700' : ''} ${shouldShowValidationHints && fieldErrors.billingCity ? 'border-red-400 bg-red-50/30' : ''}`}
                                                    />
                                                    {showGuestLockedPrefill ? (
                                                        <input
                                                            value={maskedBillingAddressFields.state || 'Not saved'}
                                                            readOnly
                                                            disabled={formInputsDisabled}
                                                            placeholder="State"
                                                            className="input-field disabled:bg-gray-50 bg-gray-50 text-gray-700"
                                                        />
                                                    ) : (
                                                        <select
                                                            value={resolveAllowedStateName(availableStates, form.billingAddress.state) || ''}
                                                            onChange={(e) => handleAddressChange('billingAddress', 'state', e.target.value)}
                                                            disabled={formInputsDisabled || availableStates.length === 0}
                                                            className={`input-field disabled:bg-gray-50 ${shouldShowValidationHints && fieldErrors.billingState ? 'border-red-400 bg-red-50/30' : ''}`}
                                                        >
                                                            <option value="">{availableStates.length ? 'Select State' : 'No states configured'}</option>
                                                            {availableStates.map((state) => (
                                                                <option key={`billing-state-${state}`} value={state}>{state}</option>
                                                            ))}
                                                        </select>
                                                    )}
                                                </div>
                                                <input
                                                    value={showGuestLockedPrefill ? (maskedBillingAddressFields.zip || 'Not saved') : form.billingAddress.zip}
                                                    onChange={(e) => handleAddressChange('billingAddress', 'zip', e.target.value)}
                                                    readOnly={showGuestLockedPrefill}
                                                    disabled={formInputsDisabled}
                                                    placeholder="PIN code"
                                                    className={`input-field disabled:bg-gray-50 ${showGuestLockedPrefill ? 'bg-gray-50 text-gray-700' : ''} ${shouldShowValidationHints && fieldErrors.billingZip ? 'border-red-400 bg-red-50/30' : ''}`}
                                                />
                                                {!showGuestLockedPrefill && shouldShowValidationHints && (fieldErrors.billingLine1 || fieldErrors.billingCity || fieldErrors.billingState || fieldErrors.billingZip) && (
                                                    <p className="text-[11px] text-red-600">{fieldErrors.billingLine1 || fieldErrors.billingCity || fieldErrors.billingState || fieldErrors.billingZip}</p>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                    <div className={`rounded-2xl border p-5 ${hasShippingFieldErrors && shouldShowValidationHints ? 'border-red-200 bg-red-50/40' : 'border-gray-100 bg-gray-50'}`}>
                                        <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                                            <Home size={16} className="text-primary" /> Shipping Address
                                        </h3>
                                            {hasShippingFieldErrors && shouldShowValidationHints && (
                                                <p className="mt-2 text-[11px] font-medium text-red-600">
                                                    Complete the highlighted shipping details to continue payment.
                                                </p>
                                            )}
                                            <div className="mt-4 space-y-3">
                                                <input
                                                    value={showGuestLockedPrefill ? (maskedShippingAddressFields.line1 || 'Not saved') : form.address.line1}
                                                    onChange={(e) => handleAddressChange('address', 'line1', e.target.value)}
                                                    readOnly={showGuestLockedPrefill}
                                                    disabled={formInputsDisabled}
                                                    placeholder="Street Address"
                                                    className={`input-field disabled:bg-gray-50 ${showGuestLockedPrefill ? 'bg-gray-50 text-gray-700' : ''} ${shouldShowValidationHints && fieldErrors.shippingLine1 ? 'border-red-400 bg-red-50/30' : ''}`}
                                                />
                                                <input
                                                    value={showGuestLockedPrefill ? (maskedShippingAddressFields.landmark || 'Not saved') : form.address.landmark}
                                                    onChange={(e) => handleAddressChange('address', 'landmark', e.target.value)}
                                                    readOnly={showGuestLockedPrefill}
                                                    disabled={formInputsDisabled}
                                                    placeholder="Landmark (Optional)"
                                                    className={`input-field disabled:bg-gray-50 ${showGuestLockedPrefill ? 'bg-gray-50 text-gray-700' : ''}`}
                                                />
                                                <div className="grid grid-cols-2 gap-3">
                                                    <input
                                                        value={showGuestLockedPrefill ? (maskedShippingAddressFields.city || 'Not saved') : form.address.city}
                                                        onChange={(e) => handleAddressChange('address', 'city', e.target.value)}
                                                        readOnly={showGuestLockedPrefill}
                                                        disabled={formInputsDisabled}
                                                        placeholder="City"
                                                        className={`input-field disabled:bg-gray-50 ${showGuestLockedPrefill ? 'bg-gray-50 text-gray-700' : ''} ${shouldShowValidationHints && fieldErrors.shippingCity ? 'border-red-400 bg-red-50/30' : ''}`}
                                                    />
                                                    {showGuestLockedPrefill ? (
                                                        <input
                                                            value={maskedShippingAddressFields.state || 'Not saved'}
                                                            readOnly
                                                            disabled={formInputsDisabled}
                                                            placeholder="State"
                                                            className="input-field disabled:bg-gray-50 bg-gray-50 text-gray-700"
                                                        />
                                                    ) : (
                                                        <select
                                                            value={resolveAllowedStateName(availableStates, form.address.state) || ''}
                                                            onChange={(e) => handleAddressChange('address', 'state', e.target.value)}
                                                            disabled={formInputsDisabled || availableStates.length === 0}
                                                            className={`input-field disabled:bg-gray-50 ${shouldShowValidationHints && fieldErrors.shippingState ? 'border-red-400 bg-red-50/30' : ''}`}
                                                        >
                                                            <option value="">{availableStates.length ? 'Select State' : 'No states configured'}</option>
                                                            {availableStates.map((state) => (
                                                                <option key={`shipping-state-${state}`} value={state}>{state}</option>
                                                            ))}
                                                        </select>
                                                    )}
                                                </div>
                                                <input
                                                    value={showGuestLockedPrefill ? (maskedShippingAddressFields.zip || 'Not saved') : form.address.zip}
                                                    onChange={(e) => handleAddressChange('address', 'zip', e.target.value)}
                                                    readOnly={showGuestLockedPrefill}
                                                    disabled={formInputsDisabled}
                                                    placeholder="PIN code"
                                                    className={`input-field disabled:bg-gray-50 ${showGuestLockedPrefill ? 'bg-gray-50 text-gray-700' : ''} ${shouldShowValidationHints && fieldErrors.shippingZip ? 'border-red-400 bg-red-50/30' : ''}`}
                                                />
                                            {!showGuestLockedPrefill && shouldShowValidationHints && (fieldErrors.shippingLine1 || fieldErrors.shippingCity || fieldErrors.shippingState || fieldErrors.shippingZip) && (
                                                <p className="text-[11px] text-red-600">{fieldErrors.shippingLine1 || fieldErrors.shippingCity || fieldErrors.shippingState || fieldErrors.shippingZip}</p>
                                            )}
                                            {showGuestLockedPrefill && (
                                                <p className="text-[11px] text-gray-500">
                                                    Saved account details are shown in masked form. Use View/Edit to unlock the full form and continue as a logged-in account.
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                                <div className="flex items-center justify-between gap-4">
                                    <div>
                                        <h2 className="text-lg font-semibold text-gray-800">Coupon</h2>
                                        <p className="text-sm text-gray-500">Apply discounts or promotional codes.</p>
                                    </div>
                                    <Ticket className="text-primary" size={20} />
                                </div>
                                <div className="mt-4 flex flex-col md:flex-row gap-3">
                                    <input
                                        value={coupon}
                                        onChange={(e) => setCoupon(e.target.value)}
                                        placeholder={isGuestCouponLoginRequired ? 'Login via OTP to unlock coupons' : 'Enter coupon code'}
                                        className={`input-field flex-1 ${isCouponInputDisabled ? 'bg-gray-100 text-gray-500 border-gray-200 cursor-not-allowed' : ''}`}
                                        disabled={isCouponInputDisabled}
                                    />
                                    {appliedCoupon ? (
                                        <button onClick={handleRemoveCoupon} className="px-6 py-3 rounded-xl border border-gray-200 font-semibold text-gray-500 hover:bg-gray-50">
                                            Remove
                                        </button>
                                    ) : isGuestCouponLoginRequired ? (
                                        <button onClick={openOtpLogin} className="px-6 py-3 rounded-xl bg-primary text-accent font-semibold shadow-lg shadow-primary/20 hover:bg-primary-light">
                                            Login via OTP
                                        </button>
                                    ) : (
                                        <button onClick={handleApplyCoupon} disabled={isApplyingCoupon || isCouponInputDisabled} className="px-6 py-3 rounded-xl bg-primary text-accent font-semibold shadow-lg shadow-primary/20 hover:bg-primary-light disabled:opacity-60 disabled:cursor-not-allowed">
                                            {isApplyingCoupon ? 'Applying...' : 'Apply'}
                                        </button>
                                    )}
                                </div>
                                {isGuestCouponLoginRequired && (
                                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                                        <p className="text-xs font-semibold text-amber-900">
                                            Account coupons are available after OTP login.
                                        </p>
                                        <p className="mt-1 text-xs text-amber-800">
                                            Login via OTP to unlock coupons, reveal your saved form details, and continue in normal logged-in checkout mode.
                                        </p>
                                    </div>
                                )}
                                {isCouponInputDisabled && selectedCouponEligibility && (
                                    <p className="text-xs text-amber-700 mt-3">
                                        This coupon unlocks after cart reaches ₹{selectedCouponEligibility.required.toLocaleString('en-IN')}. Add ₹{selectedCouponEligibility.shortfall.toLocaleString('en-IN')} more.
                                    </p>
                                )}
                                {appliedCoupon && (
                                    <p className="text-xs text-emerald-600 mt-3">Coupon {appliedCoupon.code} applied. Discount: ₹{Number(appliedCoupon.discountTotal || 0).toLocaleString()}.</p>
                                )}
                                {visibleCoupons.length > 0 && (
                                    <div className="mt-4">
                                        <p className="text-xs uppercase tracking-[0.2em] text-gray-400 font-semibold">Available Coupons</p>
                                        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                                            {visibleCoupons.map((entry) => {
                                                const eligibility = getCouponEligibility(entry);
                                                return (
                                                <button
                                                    key={entry.id || entry.code}
                                                    type="button"
                                                    onClick={() => handleApplyAvailableCoupon(entry.code)}
                                                    disabled={isGuestCouponLoginRequired || !eligibility.isEligible}
                                                    className={`relative text-left rounded-xl transition-all ${appliedCoupon?.code === entry.code ? 'ring-2 ring-emerald-100' : ''} ${isGuestCouponLoginRequired || !eligibility.isEligible ? 'opacity-60 cursor-not-allowed' : ''}`}
                                                >
                                                    <div className={`rounded-xl border overflow-hidden grid grid-cols-[1fr_156px] h-[116px] ${appliedCoupon?.code === entry.code ? 'border-emerald-300' : 'border-gray-200 hover:border-primary/30'}`}>
                                                        <div className="bg-primary px-4 py-3 flex flex-col justify-center">
                                                            <p className="text-[10px] uppercase tracking-wider text-slate-300">Voucher Code</p>
                                                            <p className="text-sm font-bold mt-1 text-white leading-5 break-all min-h-[2.5rem] max-h-[2.5rem] line-clamp-2">{entry.code}</p>
                                                        </div>
                                                        <div className="bg-accent px-4 py-3 text-primary border-l border-dashed border-primary/30 flex flex-col justify-center">
                                                            <p className="text-[15px] font-extrabold tracking-wide">
                                                                {formatCouponOffer(entry)}
                                                            </p>
                                                            <p className="text-[11px] mt-1 text-primary/80 font-medium">
                                                                {entry.expiresAt ? `Expires ${formatLongDate(entry.expiresAt)}` : 'No expiry'}
                                                            </p>
                                                            {!eligibility.isEligible && (
                                                                <p className="text-[10px] mt-1 font-semibold text-amber-700">
                                                                    Add ₹{eligibility.shortfall.toLocaleString('en-IN')} more
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>
                                                    {isGuestCouponLoginRequired ? (
                                                        <span className="absolute top-2 right-2 inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800 shadow-sm">
                                                            Locked • Login via OTP
                                                        </span>
                                                    ) : !eligibility.isEligible && (
                                                        <span className="absolute top-2 right-2 inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800 shadow-sm">
                                                            Locked • Requires ₹{eligibility.shortfall.toLocaleString('en-IN')} more
                                                        </span>
                                                    )}
                                                    <span style={{ left: 'calc(100% - 156px)' }} className="absolute -top-[5px] h-[10px] w-[10px] -translate-x-1/2 rounded-full bg-white border border-gray-200 z-10" />
                                                    <span style={{ left: 'calc(100% - 156px)' }} className="absolute -bottom-[5px] h-[10px] w-[10px] -translate-x-1/2 rounded-full bg-white border border-gray-200 z-10" />
                                                </button>
                                            );
                                            })}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                        <div className="flex flex-col gap-6 h-full">
                            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                                <div className="flex items-center justify-between">
                                    <h2 className="text-lg font-semibold text-gray-800">Order Summary</h2>
                                    <span className="text-sm text-gray-500">{itemCount} items</span>
                                </div>
                                {lineItems.length === 0 && (
                                    <div className="py-10 text-center text-gray-400">
                                        Your cart is empty. <Link to="/shop" className="text-primary font-semibold">Shop now</Link>
                                    </div>
                                )}
                                {lineItems.length > 0 && (
                                    <div className="mt-5">
                                        <div className={`space-y-4 ${lineItems.length > 10 ? 'max-h-[680px] overflow-y-auto pr-1' : ''}`}>
                                        {lineItems.map((item) => {
                                            const price = Number(item.price || 0);
                                            const mrp = Number(item.compareAt || 0);
                                            const hasDiscount = mrp > price;
                                            const discountPct = hasDiscount ? Math.round(((mrp - price) / mrp) * 100) : 0;
                                            const displayUnitPrice = Number(price || 0);
                                            const displayLineTotal = Number(item.lineTotal || 0);
                                            const lowStockCopy = item.isLowStock
                                                ? `Only ${Number(item.availableQuantity || 0)} left. Complete payment soon.`
                                                : '';
                                            return (
                                                <div key={item.key} className={`flex gap-4 items-center ${item.isOutOfStock ? 'grayscale opacity-80' : ''}`}>
                                                    <div className="w-16 h-16 rounded-xl bg-gray-100 border border-gray-200 overflow-hidden">
                                                        {item.imageUrl && <img src={item.imageUrl} alt={item.title} className="w-full h-full object-cover" />}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm font-semibold text-gray-800 line-clamp-1">{item.title}</p>
                                                        {item.variantTitle && <p className="text-xs text-gray-500 line-clamp-1">{item.variantTitle}</p>}
                                                        {subCategoriesEnabled && item.subCategory && (
                                                            <p className="text-[11px] text-gray-400 line-clamp-1">Sub Category: {item.subCategory}</p>
                                                        )}
                                                        {item.isOutOfStock && (
                                                            <span className="inline-flex mt-1 text-[10px] px-2 py-0.5 rounded-full bg-black text-white uppercase tracking-wide">
                                                                Out of Stock
                                                            </span>
                                                        )}
                                                        {!item.isOutOfStock && lowStockCopy && (
                                                            <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                                                                {lowStockCopy}
                                                            </p>
                                                        )}
                                                        <p className="text-xs text-gray-400 mt-1">
                                                            ₹{displayUnitPrice.toLocaleString()} x {item.quantity}
                                                        </p>
                                                    </div>
                                                    <div className="text-right">
                                                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                                                            <p className="text-sm font-semibold text-gray-800">₹{displayUnitPrice.toLocaleString()}</p>
                                                            {hasDiscount && (
                                                                <>
                                                                    <p className="text-[11px] text-gray-400 line-through">₹{mrp.toLocaleString()}</p>
                                                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 font-semibold">
                                                                        {discountPct}% OFF
                                                                    </span>
                                                                </>
                                                            )}
                                                        </div>
                                                        <p className="text-xs text-gray-400 mt-1">₹{displayLineTotal.toLocaleString()}</p>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                        </div>
                                        {lineItems.length > 10 && (
                                            <p className="text-[11px] text-gray-400 mt-3">
                                                Showing {lineItems.length} products. Scroll to view all items.
                                            </p>
                                        )}
                                    </div>
                                )}

                                <div className="border-t border-gray-100 mt-6 pt-4 space-y-2 text-sm">
                                    {isSummaryLoading && !isPreparingVerifiedCheckout && (
                                        <div className="text-[11px] text-gray-500 flex items-center gap-1">
                                            <TrendingUp size={12} /> Refreshing member pricing...
                                        </div>
                                    )}
                                    <div className="flex items-center justify-between text-gray-500">
                                        <span>Subtotal</span>
                                        <span className="font-semibold text-gray-800">₹{summarySubtotalDisplay.toLocaleString()}</span>
                                    </div>
                                    <div className="flex items-center justify-between text-gray-500">
                                        <span>{shouldUseTentativeShippingPreview ? 'Tentative shipping' : 'Shipping'}</span>
                                        {isShippingUnavailable ? (
                                            <span className="font-semibold text-amber-700">Unavailable for this state</span>
                                        ) : Number(summaryShippingDisplay || 0) <= 0 ? (
                                            <span className="inline-flex items-center gap-2 font-semibold">
                                                {freeShippingSavings > 0 && (
                                                    <span className="text-gray-400 line-through">₹{freeShippingSavings.toLocaleString()}</span>
                                                )}
                                                <span className="text-emerald-600">FREE</span>
                                            </span>
                                        ) : (
                                            <span className="font-semibold text-gray-800">₹{summaryShippingDisplay.toLocaleString()}</span>
                                        )}
                                    </div>
                                    {isShippingUnavailable && (
                                        <p className="text-[11px] text-amber-700">
                                            We do not currently have a matching shipping rule for this state. Update the address or shipping configuration before placing the order.
                                        </p>
                                    )}
                                    {shouldUseTentativeShippingPreview && !isShippingUnavailable && (
                                        <p className="text-[11px] text-amber-700">
                                            {shippingHelperMessage}
                                        </p>
                                    )}
                                    <div className="flex items-start justify-between text-gray-500">
                                        <span>{taxPriceMode === 'inclusive' ? 'Price Before Discounts (Incl. GST)' : 'Base Price (Before Discounts)'}</span>
                                        <span className="font-semibold text-gray-800">₹{basePriceBeforeDiscounts.toLocaleString()}</span>
                                    </div>
                                    {resolvedProductDiscount > 0 && (
                                        <div className="flex items-center justify-between text-emerald-700">
                                            <span>Product Discount (MRP)</span>
                                            <span className="font-semibold">- ₹{Number(resolvedProductDiscount || 0).toLocaleString()}</span>
                                        </div>
                                    )}
                                    {couponDiscount > 0 && (
                                        <div className="flex items-center justify-between text-emerald-700">
                                            <span>Coupon ({appliedCoupon?.code || 'Applied'})</span>
                                            <span className="font-semibold">- ₹{Number(couponDiscount || 0).toLocaleString()}</span>
                                        </div>
                                    )}
                                    {loyaltyDiscount > 0 && (
                                        <div className="flex items-center justify-between text-blue-700">
                                            <span>{isEstimatedLoyaltyDiscount ? 'Estimated Member Discount' : 'Member Discount'} ({formatTierLabel(loyaltyStatus?.profile?.label || tier)})</span>
                                            <span className="font-semibold">- ₹{Number(loyaltyDiscount || 0).toLocaleString()}</span>
                                        </div>
                                    )}
                                    {loyaltyShippingDiscount > 0 && (
                                        <div className="flex items-center justify-between text-blue-700">
                                            <span>{isEstimatedLoyaltyShippingDiscount ? 'Estimated Member Shipping Benefit' : 'Member Shipping Benefit'}</span>
                                            <span className="font-semibold">- ₹{Number(loyaltyShippingDiscount || 0).toLocaleString()}</span>
                                        </div>
                                    )}
                                    {freeShippingSavings > 0 && (
                                        <div className="flex items-center justify-between text-emerald-700">
                                            <span>Shipping Waived</span>
                                            <span className="font-semibold">- ₹{Number(freeShippingSavings || 0).toLocaleString()}</span>
                                        </div>
                                    )}
                                    {totalSavings > 0 && (
                                        <div className="flex items-center justify-between text-emerald-700">
                                            <span>Total Savings</span>
                                            <span className="font-semibold">₹{Number(totalSavings || 0).toLocaleString()}</span>
                                        </div>
                                    )}
                                    {totalSavings > 0 && (
                                        <p className="text-[11px] text-emerald-700/80 pt-1">
                                            Savings = Product Discount + Coupon + Member Discount + Shipping Benefit + Shipping Waived.
                                        </p>
                                    )}
                                    <div className="flex items-start justify-between text-gray-500">
                                        <span>{taxPriceMode === 'inclusive' ? 'Price After Discounts (Incl. GST)' : 'Taxable Value After Discounts'}</span>
                                        <span className="font-semibold text-gray-800">₹{summaryValueAfterDiscounts.toLocaleString()}</span>
                                    </div>
                                    {roundOffAmount !== 0 && (
                                        <div className="flex items-center justify-between text-gray-500">
                                            <span>Round Off</span>
                                            <span className="font-semibold text-gray-800">₹{roundOffAmount.toLocaleString()}</span>
                                        </div>
                                    )}
                                    <div className="flex items-start justify-between text-gray-800 text-base font-semibold pt-3">
                                        <span>Total</span>
                                        <div className="text-right">
                                            <span>₹{grandTotal.toLocaleString()}</span>
                                            {checkoutTaxHint && (
                                                <p className="mt-1 text-[11px] font-normal text-gray-400">{checkoutTaxHint}</p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <RazorpayAffordability amountRupees={grandTotal} className="mt-4" />

                                <button
                                    type="button"
                                    onClick={handlePayNow}
                                    disabled={isPlacingOrder || !isReadyForPayment || isLoggedInEditingBeforePayment}
                                    className="mt-6 w-full inline-flex items-center justify-center gap-2 bg-primary text-accent font-bold py-3 rounded-xl shadow-lg shadow-primary/20 hover:bg-primary-light transition-all disabled:opacity-60"
                                >
                                    <CreditCard size={18} /> {isPlacingOrder ? 'Processing...' : 'Pay Now'}
                                </button>
                                {isLoggedInEditingBeforePayment && (
                                    <p className="text-[11px] text-amber-700 text-center mt-2">
                                        Save or cancel your profile edits before continuing to payment.
                                    </p>
                                )}
                                {isMobileMissingOnProfile && !hasValidMobileForPayment && (
                                    <p className="text-[11px] text-amber-700 text-center mt-2">
                                        Mobile number is required to continue payment.
                                    </p>
                                )}
                                {!showGuestLockedPrefill && !isAddressReadyForPayment && (
                                    <p className="text-[11px] text-amber-700 text-center mt-2">
                                        Complete {billingAddressEnabled ? 'shipping and billing address' : 'shipping address'} to continue payment.
                                    </p>
                                )}
                                {hasUnavailableItems && (
                                    <p className="text-[11px] text-red-700 text-center mt-2">
                                        Some cart items are inactive or out of stock. Remove them to continue.
                                    </p>
                                )}
                                {attemptedPay && hasFormValidationErrors && (
                                    <p className="text-[11px] text-red-700 text-center mt-2 inline-flex items-center justify-center gap-1">
                                        <AlertCircle size={12} /> Fix highlighted fields before payment.
                                    </p>
                                )}
                                <p className="text-[11px] text-gray-400 text-center mt-2">
                                    Payment powered by Razorpay.
                                </p>
                                <div className="mt-3 flex items-center justify-center gap-3 text-[11px] text-gray-500">
                                    <Link to="/shipping" className="text-primary font-semibold">Shipping Policy</Link>
                                    <span className="text-gray-300">•</span>
                                    <Link to="/refund" className="text-primary font-semibold">Refund Policy</Link>
                                </div>
                            </div>

                            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                                <h2 className="text-lg font-semibold text-gray-800">Payment & Trust</h2>
                                <p className="text-sm text-gray-500 mt-1">Secure checkout, trusted by thousands of shoppers.</p>
                                <div className="mt-4 flex flex-wrap gap-2">
                                    {['SSL Secure', 'Trusted Seller', 'Verified Payments', 'Easy Returns'].map((label) => (
                                        <span key={label} className="px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100">
                                            {label}
                                        </span>
                                    ))}
                                </div>
                                <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-gray-500">
                                    {[
                                        { name: 'Visa', logo: '/payment-logos/visa.png' },
                                        { name: 'Mastercard', logo: '/payment-logos/mastercard.png' },
                                        { name: 'American Express', logo: '/payment-logos/amex.png' },
                                        { name: 'RuPay', logo: '/payment-logos/rupay.png' },
                                        { name: 'Google Pay', logo: '/payment-logos/google-pay.png' },
                                        { name: 'Paytm', logo: '/payment-logos/paytm.png' }
                                    ].map((method) => (
                                        <div key={method.name} className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-gray-50">
                                            <img
                                                src={method.logo}
                                                alt={method.name}
                                                className="h-8 w-full max-w-[120px] object-contain"
                                                loading="lazy"
                                                onError={(e) => {
                                                    e.currentTarget.style.display = 'none';
                                                    const fallback = e.currentTarget.nextElementSibling;
                                                    if (fallback) fallback.classList.remove('hidden');
                                                }}
                                            />
                                            <span className="hidden text-xs font-bold tracking-widest text-gray-700">{method.name}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                        </>
                        )}
                    </div>
                </div>
            </div>

            {isPaymentAwaitingConfirmation && !orderResult && createPortal(
                <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
                    <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-6 text-center border border-gray-100">
                        <img src={waitIllustration} alt="Processing payment" className="w-32 h-32 mx-auto" />
                        <h3 className="mt-3 text-xl font-serif text-primary">Please Wait</h3>
                        <p className="mt-2 text-sm text-gray-600">
                            Please wait while your payment for Rs. {Number(pendingPaymentAmount || 0).toLocaleString('en-IN')} is being processed.
                        </p>
                    </div>
                </div>
                ,
                document.body
            )}

            {isPreparingVerifiedCheckout && !isPaymentAwaitingConfirmation && !orderResult && createPortal(
                <div className="fixed inset-0 z-[84] flex items-center justify-center bg-black/45 backdrop-blur-sm px-4">
                    <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-6 text-center border border-gray-100">
                        <img src={waitIllustration} alt="Preparing payment" className="w-32 h-32 mx-auto" />
                        <h3 className="mt-3 text-xl font-serif text-primary">Preparing payment...</h3>
                        <p className="mt-2 text-sm text-gray-600">
                            We&apos;re securing your account, syncing your checkout cart, and preparing the best available pricing before Razorpay opens.
                        </p>
                    </div>
                </div>,
                document.body
            )}

            {orderResult && createPortal(
                <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
                    <div className="bg-white w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl p-6 animate-fade-in border border-gray-100">
                        <img src={BRAND_LOGO_URL} alt="SSC Jewellery" className="h-10 w-auto mb-3" />
                        <h3 className="text-xl font-serif text-primary">Order Confirmed</h3>
                        <p className="text-sm text-gray-500 mt-2">
                            Thank you for shopping with us. Your order is confirmed and will be processed shortly.
                        </p>
                        <div className="mt-4 rounded-xl border border-gray-200 p-4 bg-gray-50">
                            {(() => {
                                const subtotalValue = Number(orderResult.subtotal || orderResult.sub_total || 0);
                                const shippingValue = Number(orderResult.shippingFee || orderResult.shipping_fee || 0);
                                const displayPricingValue = orderResult.display_pricing && typeof orderResult.display_pricing === 'object'
                                    ? orderResult.display_pricing
                                    : orderResult.displayPricing && typeof orderResult.displayPricing === 'object'
                                        ? orderResult.displayPricing
                                        : null;
                                const taxValue = Number(orderResult.taxTotal || orderResult.tax_total || 0);
                                const roundOffValue = Number(orderResult.roundOffAmount || orderResult.round_off_amount || 0);
                                const couponValue = Number(orderResult.coupon_discount_value || orderResult.couponDiscountValue || orderResult.couponDiscountTotal || 0);
                                const loyaltyValue = Number(orderResult.loyalty_discount_total || orderResult.loyaltyDiscountTotal || 0);
                                const loyaltyShippingValue = Number(orderResult.loyalty_shipping_discount_total || orderResult.loyaltyShippingDiscountTotal || 0);
                                const orderTaxPriceMode = String(orderResult.taxPriceMode || orderResult.tax_price_mode || displayPricingValue?.taxPriceMode || orderResult.companySnapshot?.taxPriceMode || 'exclusive').trim().toLowerCase() === 'inclusive'
                                    ? 'inclusive'
                                    : 'exclusive';
                                const productDiscountValue = Number(
                                    orderTaxPriceMode === 'inclusive'
                                        ? (displayPricingValue?.displayProductDiscountGross ?? displayPricingValue?.displayProductDiscountBase)
                                        : (displayPricingValue?.displayProductDiscountBase ?? displayPricingValue?.displayProductDiscountGross)
                                    ?? 0
                                );
                                const totalSavingsValue = Math.max(
                                    Number(productDiscountValue + couponValue + loyaltyValue + loyaltyShippingValue),
                                    Number(orderResult.discountTotal || orderResult.discount_total || 0)
                                );
                                const valueAfterDiscounts = Math.max(0, subtotalValue + shippingValue - couponValue - loyaltyValue - loyaltyShippingValue);
                                const summarySubtotalValue = Number(
                                    orderTaxPriceMode === 'inclusive'
                                        ? (displayPricingValue?.displaySubtotalGross ?? subtotalValue)
                                        : (displayPricingValue?.displaySubtotalBase ?? subtotalValue)
                                );
                                const summaryShippingValue = Number(
                                    orderTaxPriceMode === 'inclusive'
                                        ? (displayPricingValue?.displayShippingGross ?? shippingValue)
                                        : (displayPricingValue?.displayShippingBase ?? shippingValue)
                                );
                                const summaryBeforeDiscountsValue = Number(
                                    orderTaxPriceMode === 'inclusive'
                                        ? (displayPricingValue?.displayGrossBeforeDiscounts ?? Math.max(0, subtotalValue + shippingValue))
                                        : (displayPricingValue?.displayBaseBeforeDiscounts ?? Math.max(0, subtotalValue + shippingValue))
                                );
                                const summaryAfterDiscountsValue = Number(
                                    orderTaxPriceMode === 'inclusive'
                                        ? (displayPricingValue?.displayGrossAfterDiscounts ?? valueAfterDiscounts)
                                        : (displayPricingValue?.displayValueAfterDiscountsBase ?? valueAfterDiscounts)
                                );
                                return (
                                    <>
                                        <div className="flex items-center justify-between text-sm">
                                            <span className="text-gray-500">Order Ref</span>
                                            <span className="font-semibold text-gray-800">{orderResult.orderRef || orderResult.order_ref}</span>
                                        </div>
                                        {Array.isArray(orderResult.items) && orderResult.items.length > 0 && (
                                            <div className="mt-4 pt-3 border-t border-gray-200 space-y-2">
                                                {orderResult.items.slice(0, 3).map((item, idx) => {
                                                    const quantity = Number(item.quantity || item.item_snapshot?.quantity || 0);
                                                    const grossLineTotal = Number(
                                                        item.line_total
                                                        ?? item.lineTotal
                                                        ?? item.lineTotalGross
                                                        ?? item.item_snapshot?.lineTotalGross
                                                        ?? item.item_snapshot?.lineTotal
                                                        ?? 0
                                                    );
                                                    const displayLineTotal = grossLineTotal;
                                                    const imageUrl = getOrderResultItemImage(item);
                                                    return (
                                                        <div key={item.id || `${item.product_id || 'item'}-${item.variant_id || ''}-${idx}`} className="flex items-start justify-between gap-3">
                                                            <div className="flex items-center gap-2 min-w-0 flex-1">
                                                                <div className="w-10 h-10 rounded-lg border border-gray-200 bg-white overflow-hidden shrink-0">
                                                                    {imageUrl ? (
                                                                        <img src={imageUrl} alt={item.title || 'Item'} className="w-full h-full object-cover" />
                                                                    ) : null}
                                                                </div>
                                                                <div className="min-w-0">
                                                                    <p className="text-sm text-gray-700 truncate">{item.title}</p>
                                                                    {String(
                                                                        item.variantTitle
                                                                        || item.variant_title
                                                                        || item.item_snapshot?.variantTitle
                                                                        || ''
                                                                    ).trim() ? (
                                                                        <p className="text-[11px] text-gray-500 truncate">
                                                                            {item.variantTitle || item.variant_title || item.item_snapshot?.variantTitle}
                                                                        </p>
                                                                    ) : null}
                                                                    {subCategoriesEnabled && (item.sub_category || item.subCategory || item.item_snapshot?.subCategory) ? (
                                                                        <p className="text-[11px] text-gray-400 truncate">
                                                                            Sub Category: {item.sub_category || item.subCategory || item.item_snapshot?.subCategory}
                                                                        </p>
                                                                    ) : null}
                                                                    <p className="text-xs text-gray-500">Qty: {quantity}</p>
                                                                </div>
                                                            </div>
                                                            <div className="text-right shrink-0">
                                                                <p className="text-sm font-semibold text-gray-800">₹{displayLineTotal.toLocaleString()}</p>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                        <div className="mt-4 pt-3 border-t border-gray-200 space-y-2">
                                            <div className="flex items-center justify-between text-sm">
                                                <span className="text-gray-500">{orderTaxPriceMode === 'inclusive' ? 'Subtotal' : 'Subtotal (Before GST)'}</span>
                                                <span className="font-semibold text-gray-800">₹{summarySubtotalValue.toLocaleString()}</span>
                                            </div>
                                            <div className="flex items-center justify-between text-sm">
                                                <span className="text-gray-500">Shipping</span>
                                                {Number(summaryShippingValue) <= 0 ? (
                                                    <span className="font-semibold text-emerald-600">FREE</span>
                                                ) : (
                                                    <span className="font-semibold text-gray-800">₹{summaryShippingValue.toLocaleString()}</span>
                                                )}
                                            </div>
                                            <div className="flex items-center justify-between text-sm">
                                                <span className="text-gray-500">{orderTaxPriceMode === 'inclusive' ? 'Price Before Discounts (Incl. GST)' : 'Price Before Discounts'}</span>
                                                <span className="font-semibold text-gray-800">₹{summaryBeforeDiscountsValue.toLocaleString()}</span>
                                            </div>
                                            {productDiscountValue > 0 && (
                                                <div className="flex items-center justify-between text-sm text-emerald-700">
                                                    <span>Product Discount (MRP)</span>
                                                    <span className="font-semibold">-₹{productDiscountValue.toLocaleString()}</span>
                                                </div>
                                            )}
                                            {couponValue > 0 && (
                                                <div className="flex items-center justify-between text-sm text-emerald-700">
                                                    <span>Coupon{orderResult.couponCode || orderResult.coupon_code ? ` (${orderResult.couponCode || orderResult.coupon_code})` : ''}</span>
                                                    <span className="font-semibold">-₹{couponValue.toLocaleString()}</span>
                                                </div>
                                            )}
                                            {loyaltyValue > 0 && (
                                                <div className="flex items-center justify-between text-sm text-blue-700">
                                                    <span>Member Discount ({formatTierLabel(orderResult.loyalty_tier || orderResult.loyaltyTier || 'regular')})</span>
                                                    <span className="font-semibold">-₹{loyaltyValue.toLocaleString()}</span>
                                                </div>
                                            )}
                                            {loyaltyShippingValue > 0 && (
                                                <div className="flex items-center justify-between text-sm text-blue-700">
                                                    <span>Member Shipping Benefit</span>
                                                    <span className="font-semibold">-₹{loyaltyShippingValue.toLocaleString()}</span>
                                                </div>
                                            )}
                                            {totalSavingsValue > 0 && (
                                                <div className="flex items-center justify-between text-sm text-emerald-700">
                                                    <span>Total Savings</span>
                                                    <span className="font-semibold">₹{totalSavingsValue.toLocaleString()}</span>
                                                </div>
                                            )}
                                            <div className="flex items-center justify-between text-sm">
                                                <span className="text-gray-500">{orderTaxPriceMode === 'inclusive' ? 'Price After Discounts (Incl. GST)' : 'Price After Discounts'}</span>
                                                <span className="font-semibold text-gray-800">₹{summaryAfterDiscountsValue.toLocaleString()}</span>
                                            </div>
                                            {taxValue > 0 && (
                                                <div className="flex items-start justify-between text-sm">
                                                    <span className="text-gray-500">
                                                        GST Breakdown
                                                        <span className="block text-[11px] text-gray-400">
                                                            {getGstDisplayDetails({ taxAmount: taxValue }).splitAmountLabel}
                                                        </span>
                                                    </span>
                                                    <span className="font-semibold text-gray-800">₹{taxValue.toLocaleString()}</span>
                                                </div>
                                            )}
                                            {roundOffValue !== 0 && (
                                                <div className="flex items-center justify-between text-sm">
                                                    <span className="text-gray-500">Round Off</span>
                                                    <span className="font-semibold text-gray-800">₹{roundOffValue.toLocaleString()}</span>
                                                </div>
                                            )}
                                            <div className="flex items-center justify-between text-base font-semibold pt-1 text-gray-800">
                                                <span>Grand Total</span>
                                                <span>₹{Number(orderResult.total || 0).toLocaleString()}</span>
                                            </div>
                                        </div>
                                    </>
                                );
                            })()}
                        </div>
                        <p className="text-sm text-gray-600 mt-3">Your items will be shipped in 2-3 working days.</p>
                        <div className="mt-4 text-xs text-gray-500 space-y-1">
                            <p>By placing this order you agree to our policies:</p>
                            <div className="flex gap-3 flex-wrap">
                                <Link to="/shipping" className="text-primary font-semibold">Shipping Policy</Link>
                                <Link to="/refund" className="text-primary font-semibold">Refund Policy</Link>
                            </div>
                        </div>
                        <div className="mt-5 flex items-center justify-end gap-2 flex-wrap">
                            {canDownloadInvoice(orderResult) && (
                                <button
                                    type="button"
                                    onClick={handleDownloadOrderInvoice}
                                    disabled={isDownloadingOrderInvoice}
                                    className="px-4 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 font-semibold hover:bg-emerald-100 disabled:opacity-60 inline-flex items-center gap-2"
                                >
                                    <Download size={16} />
                                    {isDownloadingOrderInvoice ? 'Generating Invoice...' : 'Download Invoice'}
                                </button>
                            )}
                            <Link to="/" className="px-4 py-2 rounded-lg bg-primary text-accent font-semibold">
                                Home
                            </Link>
                            <Link to="/shop" className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 font-semibold hover:bg-gray-50">
                                Explore
                            </Link>
                        </div>
                        <p className="text-[11px] text-gray-400 mt-4">View your order in the Orders page.</p>
                    </div>
                </div>
                ,
                document.body
            )}
            <CheckoutAccountVerificationModal
                isOpen={isAccountVerificationOpen}
                checkoutMobile={form.mobile}
                maskedProfile={guestLookup?.maskedProfile || null}
                onClose={() => setIsAccountVerificationOpen(false)}
                onSuccess={async (res, resolution = {}) => {
                    const resolvedUserShippingAddress = {
                        ...emptyAddress,
                        ...(res?.user?.address || {}),
                        state: resolveAllowedStateName(availableStates, res?.user?.address?.state) || ''
                    };
                    const resolvedUserBillingAddress = {
                        ...emptyAddress,
                        ...(billingAddressEnabled ? (res?.user?.billingAddress || res?.user?.address || {}) : (res?.user?.address || {})),
                        state: resolveAllowedStateName(
                            availableStates,
                            billingAddressEnabled ? (res?.user?.billingAddress?.state || res?.user?.address?.state) : res?.user?.address?.state
                        ) || ''
                    };
                    const preservedShippingAddress = guestLockedAccount
                        ? resolvedUserShippingAddress
                        : (hasAddressFields(checkoutAddressSnapshotRef.current.address)
                            ? { ...checkoutAddressSnapshotRef.current.address }
                            : resolvedUserShippingAddress);
                    const preservedBillingAddress = guestLockedAccount
                        ? resolvedUserBillingAddress
                        : (hasAddressFields(checkoutAddressSnapshotRef.current.billingAddress)
                            ? { ...checkoutAddressSnapshotRef.current.billingAddress }
                            : resolvedUserBillingAddress);
                    checkoutAddressSnapshotRef.current = {
                        address: preservedShippingAddress,
                        billingAddress: preservedBillingAddress
                    };
                    forceEditableAfterOtpLoginRef.current = true;
                    login(res.token, res.user);
                    setGuestCheckoutConflict('');
                    setIsAccountVerificationOpen(false);
                    setResumeCheckoutAfterVerification(false);
                    setForm((prev) => ({
                        ...prev,
                        name: res?.user?.name || prev.name,
                        email: res?.user?.email || resolution?.resolvedEmail || prev.email,
                        mobile: res?.user?.mobile || resolution?.resolvedMobile || prev.mobile,
                        address: preservedShippingAddress,
                        billingAddress: preservedBillingAddress
                    }));
                    preserveCheckoutAddressOnLoginRef.current = false;
                    setIsPreparingVerifiedCheckout(false);
                    setPostOtpCheckoutSync(null);
                    setEditing(true);
                    toast.success('Account verified. You are now logged in.');
                }}
            />
        </div>
    );
}
