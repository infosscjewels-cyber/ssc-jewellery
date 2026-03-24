import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, ChevronRight, CreditCard, Edit3, Home, Mail, Phone, ShoppingBag, Sparkles, Ticket, TrendingUp, UserRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { useToast } from '../context/ToastContext';
import { authService } from '../services/authService';
import { orderService } from '../services/orderService';
import { useShipping } from '../context/ShippingContext';
import { useSocket } from '../context/SocketContext';
import { useAdminCrudSync } from '../hooks/useAdminCrudSync';
import { usePublicCompanyInfo } from '../hooks/usePublicSiteShell';
import amexLogo from '../assets/amex.png';
import cartIllustration from '../assets/cart.svg';
import successDing from '../assets/success_ding.mp3';
import waitIllustration from '../assets/wait.svg';
import { burstConfetti, playCue } from '../utils/celebration';
import RazorpayAffordability from '../components/RazorpayAffordability';
import CheckoutFlowHeader from '../components/CheckoutFlowHeader';
import { formatTierLabel, getMembershipLabel, getNextTierFromCurrent, getTierSpendKey } from '../utils/tierFormat';
import { formatMissingProfileFields } from '../utils/membershipUnlock';
import { getGstDisplayDetails } from '../utils/gst';
import { hasUnavailableCheckoutItems } from '../utils/checkoutAvailability';
import { normalizePaymentFailureReason } from '../utils/paymentFailure';
import { computeShippingPreview } from '../utils/shippingPreview';
import { BRAND_LOGO_URL } from '../utils/branding.js';
import StorefrontClosed from './StorefrontClosed';

const emptyAddress = { line1: '', city: '', state: '', zip: '' };
const RAZORPAY_SCRIPT_ID = 'razorpay-checkout-js';
const RAZORPAY_SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

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

const isValidEmailInput = (value = '') => {
    const raw = String(value || '').trim();
    if (!raw) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw);
};

const isValidMobileInput = (value = '') => /^\d{10,14}$/.test(String(value || '').replace(/\D/g, ''));

const isValidZipInput = (value = '') => /^[0-9A-Za-z\-\s]{3,12}$/.test(String(value || '').trim());

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
    const { user, updateUser } = useAuth();
    const { items, subtotal, itemCount, clearCart } = useCart();
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
    const [activeAttemptId, setActiveAttemptId] = useState(null);
    const [pricingSyncTick, setPricingSyncTick] = useState(0);
    const orderCelebratedRef = useRef(false);
    const autoCouponAttemptsRef = useRef(new Set());
    const lastTierSeenRef = useRef(String(user?.loyaltyTier || 'regular').toLowerCase());
    const loyaltyHydratedRef = useRef(false);
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
    const storefrontOpen = companyInfo?.storefrontOpen !== false;

    const refreshAvailableCoupons = useCallback(async () => {
        const cartSubtotal = Number(subtotal || 0);
        if (!user || itemCount <= 0 || cartSubtotal <= 0) {
            setAvailableCoupons([]);
            return;
        }
        try {
            const res = await orderService.getAvailableCoupons({
                shippingAddress: liveCouponShippingAddress
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
    }, [user, itemCount, subtotal, appliedCoupon?.code, toast, liveCouponShippingAddress]);

    useEffect(() => {
        if (!user) return;
        lastTierSeenRef.current = String(user?.loyaltyTier || 'regular').toLowerCase();
        loyaltyHydratedRef.current = false;
        setForm({
            name: user.name || '',
            email: user.email || '',
            mobile: user.mobile || '',
            address: { ...emptyAddress, ...(user.address || {}) },
            billingAddress: { ...emptyAddress, ...(user.billingAddress || user.address || {}) }
        });
    }, [user]);

    useEffect(() => {
        if (!user || !couponFromQuery) return;
        if (itemCount <= 0) {
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
        orderService.validateRecoveryCoupon({
            code: couponFromQuery,
            shippingAddress: liveCouponShippingAddress
        }).then((data) => {
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
    }, [user, couponFromQuery, appliedCoupon?.code, toast, itemCount, liveCouponShippingAddress]);

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
        if (!user || itemCount <= 0) {
            setCheckoutSummary(null);
            return;
        }
        let cancelled = false;
        const timer = setTimeout(async () => {
            setIsSummaryLoading(true);
            const [summaryResult, loyaltyResult] = await Promise.allSettled([
                orderService.getCheckoutSummary({
                    shippingAddress: hasCompleteAddress(form.address) ? form.address : null,
                    couponCode: appliedCoupon?.code || null
                }),
                authService.getLoyaltyStatus()
            ]);

            if (cancelled) return;

            if (summaryResult.status === 'fulfilled') {
                setCheckoutSummary(summaryResult.value?.summary || null);
            } else {
                setCheckoutSummary(null);
            }

            if (loyaltyResult.status === 'fulfilled' && loyaltyResult.value?.status) {
                applyLoyaltyStatus(loyaltyResult.value.status);
            }

            if (!cancelled) {
                setIsSummaryLoading(false);
            }
        }, 280);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [user, items, subtotal, itemCount, form.address, appliedCoupon?.code, applyLoyaltyStatus, pricingSyncTick]);

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
            nextValue = String(value || '').replace(/\D/g, '').slice(0, 14);
        }
        setForm((prev) => ({ ...prev, [name]: nextValue }));
    };

    const handleAddressChange = (section, field, value) => {
        let nextValue = value;
        if (field === 'zip') {
            nextValue = String(value || '').replace(/[^0-9A-Za-z\-\s]/g, '').slice(0, 12);
        }
        setForm((prev) => ({
            ...prev,
            [section]: { ...prev[section], [field]: nextValue }
        }));
    };

    const handleSave = async () => {
        if (isSaving) return;
        setIsSaving(true);
        try {
            const res = await authService.updateProfile({
                name: form.name,
                email: form.email,
                mobile: form.mobile,
                address: form.address,
                billingAddress: form.billingAddress
            });
            if (res?.user) {
                updateUser(res.user);
                toast.success('Address updated');
                setEditing(false);
            } else {
                toast.error(res?.message || 'Failed to update profile');
            }
        } catch (error) {
            toast.error(error?.message || 'Failed to update profile');
        } finally {
            setIsSaving(false);
        }
    };

    const handleApplyCoupon = () => {
        const code = String(coupon || '').trim().toUpperCase();
        if (!code) return toast.error('Enter a coupon code');
        const knownCoupon = availableCoupons.find((entry) => String(entry.code || '').toUpperCase() === code);
        if (knownCoupon) {
            const eligibility = getCouponEligibility(knownCoupon);
            if (!eligibility.isEligible) {
                return toast.error(`Add ₹${eligibility.shortfall.toLocaleString('en-IN')} more to unlock this coupon.`);
            }
        }
        setIsApplyingCoupon(true);
        orderService.validateRecoveryCoupon({
            code,
            shippingAddress: hasCompleteAddress(form.address) ? form.address : null
        }).then((data) => {
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
        const normalizedCode = String(code || '').toUpperCase();
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
        orderService.validateRecoveryCoupon({
            code: normalizedCode,
            shippingAddress: hasCompleteAddress(form.address) ? form.address : null
        }).then((data) => {
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
    const productMrpSavings = useMemo(() => lineItems.reduce((sum, item) => {
        const mrp = Number(item.compareAt || 0);
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

    const totalWeightKg = useMemo(() => lineItems.reduce((sum, item) => {
        return sum + (Number(item.weightKg || 0) * Number(item.quantity || 0));
    }, 0), [lineItems]);

    const fallbackShippingFee = useMemo(() => Number(computeShippingPreview({
        zones,
        state: form.address?.state,
        subtotal,
        totalWeightKg
    })?.fee || 0), [zones, form.address?.state, subtotal, totalWeightKg]);

    const shippingFee = useMemo(
        () => Number(checkoutSummary?.shippingFee ?? fallbackShippingFee ?? 0),
        [checkoutSummary?.shippingFee, fallbackShippingFee]
    );
    const fallbackShippingPreview = useMemo(() => computeShippingPreview({
        zones,
        state: form.address?.state,
        subtotal,
        totalWeightKg
    }), [zones, form.address?.state, subtotal, totalWeightKg]);
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
    const estimatedLoyaltyDiscount = useMemo(() => {
        const isMembershipEligible = Boolean(loyaltyStatus?.eligibility?.isEligible ?? true);
        if (!isMembershipEligible) return 0;
        const tierKey = String(loyaltyStatus?.tier || user?.loyaltyTier || 'regular').toLowerCase();
        const memberPct = Number(
            loyaltyStatus?.profile?.extraDiscountPct
            ?? user?.loyaltyProfile?.extraDiscountPct
            ?? EXTRA_DISCOUNT_BY_TIER[tierKey]
            ?? 0
        );
        const eligibleBase = Math.max(0, Number(subtotal || 0) - Number(couponDiscount || 0));
        return Math.max(0, Number(((eligibleBase * memberPct) / 100).toFixed(2)));
    }, [loyaltyStatus?.eligibility?.isEligible, loyaltyStatus?.tier, loyaltyStatus?.profile?.extraDiscountPct, user?.loyaltyTier, user?.loyaltyProfile?.extraDiscountPct, subtotal, couponDiscount]);
    const estimatedLoyaltyShippingDiscount = useMemo(() => {
        const isMembershipEligible = Boolean(loyaltyStatus?.eligibility?.isEligible ?? true);
        if (!isMembershipEligible) return 0;
        const shippingPct = Number(
            loyaltyStatus?.profile?.shippingDiscountPct
            ?? user?.loyaltyProfile?.shippingDiscountPct
            ?? 0
        );
        return Math.max(0, Number(((Number(shippingFee || 0) * shippingPct) / 100).toFixed(2)));
    }, [loyaltyStatus?.eligibility?.isEligible, loyaltyStatus?.profile?.shippingDiscountPct, user?.loyaltyProfile?.shippingDiscountPct, shippingFee]);
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
    const showTaxComponents = taxTotal > 0;
    const taxByItemKey = useMemo(() => {
        const out = new Map();
        const summaryItems = Array.isArray(checkoutSummary?.items) ? checkoutSummary.items : [];
        summaryItems.forEach((item) => {
            const key = `${String(item?.productId || '')}::${String(item?.variantId || '')}`;
            out.set(key, {
                taxAmount: Number(item?.taxAmount || 0),
                taxRatePercent: Number(item?.taxRatePercent || 0),
                taxName: item?.taxName || '',
                taxCode: item?.taxCode || ''
            });
        });
        return out;
    }, [checkoutSummary?.items]);
    const taxRateSummary = useMemo(() => {
        const rates = new Set();
        const summaryItems = Array.isArray(checkoutSummary?.items) ? checkoutSummary.items : [];
        summaryItems.forEach((item) => {
            const rate = Number(item?.taxRatePercent || 0);
            rates.add(Number(rate.toFixed(2)));
        });
        const uniqueRates = Array.from(rates.values()).sort((a, b) => a - b);
        return {
            uniqueRates,
            hasMultipleRates: uniqueRates.length > 1,
            hasSingleRate: uniqueRates.length === 1,
            singleRate: uniqueRates.length === 1 ? uniqueRates[0] : 0
        };
    }, [checkoutSummary?.items]);
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
    const totalSavings = useMemo(
        () => Number(productMrpSavings || 0) + Number(couponDiscount || 0) + Number(loyaltyDiscount || 0) + Number(loyaltyShippingDiscount || 0),
        [productMrpSavings, couponDiscount, loyaltyDiscount, loyaltyShippingDiscount]
    );
    const grandTotal = useMemo(() => {
        if (checkoutSummary?.total != null) return Number(checkoutSummary.total || 0);
        const gross = Number(subtotal || 0) + Number(shippingFee || 0) + Number(taxTotal || 0);
        return Math.max(0, gross - Number(couponDiscount || 0) - Number(loyaltyDiscount || 0) - Number(loyaltyShippingDiscount || 0));
    }, [checkoutSummary?.total, subtotal, shippingFee, taxTotal, couponDiscount, loyaltyDiscount, loyaltyShippingDiscount]);
    const isMobileMissingOnProfile = !String(user?.mobile || '').trim();
    const hasMobileForPayment = Boolean(String(form.mobile || '').trim());
    const isAddressReadyForPayment = hasCompleteAddress(form.address) && hasCompleteAddress(form.billingAddress);
    const hasUnavailableItems = useMemo(() => hasUnavailableCheckoutItems(lineItems), [lineItems]);
    const isReadyForPayment = isAddressReadyForPayment && (!isMobileMissingOnProfile || hasMobileForPayment) && !hasUnavailableItems;
    const fieldErrors = useMemo(() => {
        const errors = {};
        if (!String(form.name || '').trim()) errors.name = 'Name is required';
        if (!isValidEmailInput(form.email)) errors.email = 'Enter a valid email';
        if (!isValidMobileInput(form.mobile)) errors.mobile = 'Enter a valid mobile number';

        ['address', 'billingAddress'].forEach((section) => {
            const prefix = section === 'address' ? 'shipping' : 'billing';
            const source = form[section] || {};
            if (!String(source.line1 || '').trim()) errors[`${prefix}Line1`] = 'Street address is required';
            if (!String(source.city || '').trim()) errors[`${prefix}City`] = 'City is required';
            if (!String(source.state || '').trim()) errors[`${prefix}State`] = 'State is required';
            if (!isValidZipInput(source.zip)) errors[`${prefix}Zip`] = 'Enter a valid zip code';
        });
        return errors;
    }, [form]);
    const hasFormValidationErrors = Object.keys(fieldErrors).length > 0;
    const selectedCouponForInput = useMemo(
        () => availableCoupons.find((entry) => String(entry.code || '').toUpperCase() === String(coupon || '').trim().toUpperCase()) || null,
        [availableCoupons, coupon]
    );
    const selectedCouponEligibility = useMemo(
        () => (selectedCouponForInput ? getCouponEligibility(selectedCouponForInput) : null),
        [selectedCouponForInput]
    );
    const isCouponInputDisabled = Boolean(selectedCouponEligibility && !selectedCouponEligibility.isEligible && !appliedCoupon);
    const visibleCoupons = useMemo(() => {
        const byCode = new Map();
        availableCoupons.forEach((entry) => {
            const code = String(entry?.code || '').trim().toUpperCase();
            if (!code) return;
            if (!byCode.has(code)) byCode.set(code, entry);
        });
        return Array.from(byCode.values());
    }, [availableCoupons]);

    const handlePayNow = async () => {
        setAttemptedPay(true);
        if (lineItems.length === 0) return toast.error('Your cart is empty');
        if (isPlacingOrder) return;
        if (hasUnavailableItems) return toast.error('Some items are unavailable. Please review your cart before payment.');
        if (hasFormValidationErrors) return toast.error('Please correct highlighted fields before payment');
        if (isMobileMissingOnProfile && !hasMobileForPayment) return toast.error('Please add mobile number before payment');
        if (!hasCompleteAddress(form.address)) return toast.error('Please complete shipping address before payment');
        if (!hasCompleteAddress(form.billingAddress)) return toast.error('Please complete billing address before payment');
        setIsPlacingOrder(true);
        try {
            const profileNeedsAddressSync = (
                !hasCompleteAddress(user?.address)
                || !hasCompleteAddress(user?.billingAddress)
                || (isMobileMissingOnProfile && hasMobileForPayment)
            );
            const checkoutHasAddress = hasCompleteAddress(form.address) && hasCompleteAddress(form.billingAddress);
            if (profileNeedsAddressSync && checkoutHasAddress && (!isMobileMissingOnProfile || hasMobileForPayment)) {
                const profileRes = await authService.updateProfile({
                    name: form.name,
                    email: form.email,
                    mobile: form.mobile,
                    address: form.address,
                    billingAddress: form.billingAddress
                });
                if (profileRes?.user) {
                    updateUser(profileRes.user);
                    toast.success('Address saved to profile');
                }
            }

            // Hard preflight: refuse payment flow if server summary cannot be computed.
            const preflight = await orderService.getCheckoutSummary({
                shippingAddress: form.address,
                couponCode: appliedCoupon?.code || null
            });
            if (!preflight?.summary || preflight.summary.total == null) {
                throw new Error('Unable to validate order summary on server. Please retry.');
            }
            setCheckoutSummary(preflight.summary);

            const scriptLoaded = await ensureRazorpayScript();
            if (!scriptLoaded || !window.Razorpay) {
                throw new Error('Unable to load Razorpay checkout');
            }

            const init = await orderService.createRazorpayOrder({
                billingAddress: form.billingAddress,
                shippingAddress: form.address,
                couponCode: appliedCoupon?.code || null,
                notes: {
                    source: 'web_checkout'
                }
            });
            if (!init?.order?.id || !init?.keyId) {
                throw new Error(init?.message || 'Failed to initialize payment');
            }
            setPendingPaymentAmount(Number(init?.order?.amount || 0) / 100);
            setActiveAttemptId(init?.attempt?.id || null);

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
                            const verification = await orderService.verifyRazorpayPayment(response);
                            if (!verification?.order) {
                                throw new Error('Payment verified but order was not created');
                            }
                            setIsPaymentAwaitingConfirmation(false);
                            setOrderResult(verification.order);
                            setActiveAttemptId(null);
                            await clearCart();
                            toast.success('Payment successful, order placed');
                            markSettled();
                            resolve(verification.order);
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

                rzp.open();
            });
            void paidOrder;
        } catch (error) {
            setIsPaymentAwaitingConfirmation(false);
            const message = normalizePaymentFailureReason(error?.message || 'Failed to complete payment');
            toast.error(message);
            const params = new URLSearchParams();
            params.set('reason', message);
            if (activeAttemptId) params.set('attemptId', String(activeAttemptId));
            navigate(`/payment/failed?${params.toString()}`);
        } finally {
            setIsPaymentAwaitingConfirmation(false);
            setIsPlacingOrder(false);
        }
    };

    if (!user) return null;
    if (!storefrontOpen) return <StorefrontClosed />;
    const tier = String(loyaltyStatus?.tier || checkoutSummary?.loyaltyTier || user?.loyaltyTier || 'regular').toLowerCase();
    const membershipEligibility = loyaltyStatus?.eligibility || null;
    const isMembershipEligible = Boolean(membershipEligibility?.isEligible ?? true);
    const profileCompletionPct = Number(membershipEligibility?.completionPct || 0);
    const missingProfileFields = Array.isArray(membershipEligibility?.missingFields) ? membershipEligibility.missingFields : [];
    const membershipUnlockState = formatMissingProfileFields(missingProfileFields);
    const tierTheme = TIER_THEME[tier] || TIER_THEME.regular;
    const tierLabel = formatTierLabel(loyaltyStatus?.profile?.label || tier);
    const progress = loyaltyStatus?.progress || checkoutSummary?.loyaltyMeta?.progress || {};
    const progressPct = Number(progress?.progressPct || 0);
    const nextTierKey = progress?.nextTier || getNextTierFromCurrent(tier);
    const nextTierLabel = nextTierKey
        ? formatTierLabel(loyaltyStatus?.nextTierProfile?.label || nextTierKey)
        : '';
    const spends = loyaltyStatus?.spends || checkoutSummary?.loyaltyMeta?.spends || {};
    const spendKey = getTierSpendKey(tier);
    const currentSpend = Number(spends?.[spendKey] || 0);
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
                            <div className={`rounded-2xl p-5 bg-gradient-to-r ${tierTheme.card} shadow-lg`}>
                                {!loyaltyStatus && isSummaryLoading ? (
                                    <div className="text-white/90 text-sm">Loading membership benefits...</div>
                                ) : (
                                    <>
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
                                            <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold border ${tierTheme.tag}`}>
                                                <Sparkles size={14} /> {isMembershipEligible ? 'Extra member pricing' : 'Profile completion required'}
                                            </span>
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
                                    </>
                                )}
                            </div>
                            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                                <div className="flex items-center justify-between gap-4">
                                    <div>
                                        <h2 className="text-lg font-semibold text-gray-800">Contact & Delivery</h2>
                                        <p className="text-sm text-gray-500">Update your billing and shipping addresses.</p>
                                    </div>
                                    {!editing ? (
                                        <button onClick={() => setEditing(true)} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                                            <Edit3 size={16} /> Edit
                                        </button>
                                    ) : (
                                        <div className="flex items-center gap-2">
                                            <button onClick={() => setEditing(false)} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-500 hover:bg-gray-50">
                                                Cancel
                                            </button>
                                            <button onClick={handleSave} disabled={isSaving} className="px-4 py-2 rounded-xl bg-primary text-accent text-sm font-semibold shadow-lg shadow-primary/20 hover:bg-primary-light disabled:opacity-60">
                                                {isSaving ? 'Saving...' : 'Save'}
                                            </button>
                                        </div>
                                    )}
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
                                    <div className="space-y-2">
                                        <label className="text-xs uppercase tracking-widest text-gray-400 font-semibold">Name</label>
                                        <div className="relative">
                                            <input
                                                name="name"
                                                value={form.name}
                                                onChange={handleFieldChange}
                                                disabled={!editing}
                                                className={`input-field pl-10 disabled:bg-gray-50 ${attemptedPay && fieldErrors.name ? 'border-red-400 bg-red-50/30' : ''}`}
                                            />
                                            <UserRound size={16} className="absolute left-3 top-3.5 text-gray-400" />
                                        </div>
                                        {attemptedPay && fieldErrors.name && <p className="text-[11px] text-red-600">{fieldErrors.name}</p>}
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs uppercase tracking-widest text-gray-400 font-semibold">Email</label>
                                        <div className="relative">
                                            <input
                                                name="email"
                                                value={form.email}
                                                onChange={handleFieldChange}
                                                disabled={!editing}
                                                className={`input-field pl-10 disabled:bg-gray-50 ${attemptedPay && fieldErrors.email ? 'border-red-400 bg-red-50/30' : ''}`}
                                            />
                                            <Mail size={16} className="absolute left-3 top-3.5 text-gray-400" />
                                        </div>
                                        {attemptedPay && fieldErrors.email && <p className="text-[11px] text-red-600">{fieldErrors.email}</p>}
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs uppercase tracking-widest text-gray-400 font-semibold">Phone</label>
                                        <div className="relative">
                                            <input
                                                name="mobile"
                                                value={form.mobile}
                                                onChange={handleFieldChange}
                                                disabled={!editing}
                                                className={`input-field pl-10 disabled:bg-gray-50 ${attemptedPay && fieldErrors.mobile ? 'border-red-400 bg-red-50/30' : ''}`}
                                            />
                                            <Phone size={16} className="absolute left-3 top-3.5 text-gray-400" />
                                        </div>
                                        {attemptedPay && fieldErrors.mobile && <p className="text-[11px] text-red-600">{fieldErrors.mobile}</p>}
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-6">
                                    <div className="bg-gray-50 rounded-2xl border border-gray-100 p-5">
                                        <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                                            <CreditCard size={16} className="text-primary" /> Billing Address
                                        </h3>
                                        <div className="mt-4 space-y-3">
                                            <input
                                                value={form.billingAddress.line1}
                                                onChange={(e) => handleAddressChange('billingAddress', 'line1', e.target.value)}
                                                disabled={!editing}
                                                placeholder="Street Address"
                                                className={`input-field disabled:bg-gray-50 ${attemptedPay && fieldErrors.billingLine1 ? 'border-red-400 bg-red-50/30' : ''}`}
                                            />
                                            <div className="grid grid-cols-2 gap-3">
                                                <input
                                                    value={form.billingAddress.city}
                                                    onChange={(e) => handleAddressChange('billingAddress', 'city', e.target.value)}
                                                    disabled={!editing}
                                                    placeholder="City"
                                                    className={`input-field disabled:bg-gray-50 ${attemptedPay && fieldErrors.billingCity ? 'border-red-400 bg-red-50/30' : ''}`}
                                                />
                                                <input
                                                    value={form.billingAddress.state}
                                                    onChange={(e) => handleAddressChange('billingAddress', 'state', e.target.value)}
                                                    disabled={!editing}
                                                    placeholder="State"
                                                    className={`input-field disabled:bg-gray-50 ${attemptedPay && fieldErrors.billingState ? 'border-red-400 bg-red-50/30' : ''}`}
                                                />
                                            </div>
                                            <input
                                                value={form.billingAddress.zip}
                                                onChange={(e) => handleAddressChange('billingAddress', 'zip', e.target.value)}
                                                disabled={!editing}
                                                placeholder="Zip"
                                                className={`input-field disabled:bg-gray-50 ${attemptedPay && fieldErrors.billingZip ? 'border-red-400 bg-red-50/30' : ''}`}
                                            />
                                            {attemptedPay && (fieldErrors.billingLine1 || fieldErrors.billingCity || fieldErrors.billingState || fieldErrors.billingZip) && (
                                                <p className="text-[11px] text-red-600">{fieldErrors.billingLine1 || fieldErrors.billingCity || fieldErrors.billingState || fieldErrors.billingZip}</p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="bg-gray-50 rounded-2xl border border-gray-100 p-5">
                                        <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                                            <Home size={16} className="text-primary" /> Shipping Address
                                        </h3>
                                        <div className="mt-4 space-y-3">
                                            <input
                                                value={form.address.line1}
                                                onChange={(e) => handleAddressChange('address', 'line1', e.target.value)}
                                                disabled={!editing}
                                                placeholder="Street Address"
                                                className={`input-field disabled:bg-gray-50 ${attemptedPay && fieldErrors.shippingLine1 ? 'border-red-400 bg-red-50/30' : ''}`}
                                            />
                                            <div className="grid grid-cols-2 gap-3">
                                                <input
                                                    value={form.address.city}
                                                    onChange={(e) => handleAddressChange('address', 'city', e.target.value)}
                                                    disabled={!editing}
                                                    placeholder="City"
                                                    className={`input-field disabled:bg-gray-50 ${attemptedPay && fieldErrors.shippingCity ? 'border-red-400 bg-red-50/30' : ''}`}
                                                />
                                                <input
                                                    value={form.address.state}
                                                    onChange={(e) => handleAddressChange('address', 'state', e.target.value)}
                                                    disabled={!editing}
                                                    placeholder="State"
                                                    className={`input-field disabled:bg-gray-50 ${attemptedPay && fieldErrors.shippingState ? 'border-red-400 bg-red-50/30' : ''}`}
                                                />
                                            </div>
                                            <input
                                                value={form.address.zip}
                                                onChange={(e) => handleAddressChange('address', 'zip', e.target.value)}
                                                disabled={!editing}
                                                placeholder="Zip"
                                                className={`input-field disabled:bg-gray-50 ${attemptedPay && fieldErrors.shippingZip ? 'border-red-400 bg-red-50/30' : ''}`}
                                            />
                                            {attemptedPay && (fieldErrors.shippingLine1 || fieldErrors.shippingCity || fieldErrors.shippingState || fieldErrors.shippingZip) && (
                                                <p className="text-[11px] text-red-600">{fieldErrors.shippingLine1 || fieldErrors.shippingCity || fieldErrors.shippingState || fieldErrors.shippingZip}</p>
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
                                        placeholder="Enter coupon code"
                                        className={`input-field flex-1 ${isCouponInputDisabled ? 'bg-gray-100 text-gray-500 border-gray-200 cursor-not-allowed' : ''}`}
                                        disabled={isCouponInputDisabled}
                                    />
                                    {appliedCoupon ? (
                                        <button onClick={handleRemoveCoupon} className="px-6 py-3 rounded-xl border border-gray-200 font-semibold text-gray-500 hover:bg-gray-50">
                                            Remove
                                        </button>
                                    ) : (
                                        <button onClick={handleApplyCoupon} disabled={isApplyingCoupon || isCouponInputDisabled} className="px-6 py-3 rounded-xl bg-primary text-accent font-semibold shadow-lg shadow-primary/20 hover:bg-primary-light disabled:opacity-60 disabled:cursor-not-allowed">
                                            {isApplyingCoupon ? 'Applying...' : 'Apply'}
                                        </button>
                                    )}
                                </div>
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
                                                    disabled={!eligibility.isEligible}
                                                    className={`relative text-left rounded-xl transition-all ${appliedCoupon?.code === entry.code ? 'ring-2 ring-emerald-100' : ''} ${!eligibility.isEligible ? 'opacity-60 cursor-not-allowed' : ''}`}
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
                                                    {!eligibility.isEligible && (
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
                                            const taxKey = `${String(item.productId || item.product_id || '')}::${String(item.variantId || item.variant_id || '')}`;
                                            const itemTax = taxByItemKey.get(taxKey) || null;
                                            const itemGst = itemTax
                                                ? getGstDisplayDetails({
                                                    taxAmount: Number(itemTax.taxAmount || 0),
                                                    taxRatePercent: Number(itemTax.taxRatePercent || 0),
                                                    taxLabel: itemTax.taxCode || itemTax.taxName || ''
                                                })
                                                : null;
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
                                                            ₹{price.toLocaleString()} x {item.quantity}
                                                        </p>
                                                        {taxRateSummary.hasMultipleRates && itemTax && Number(itemTax.taxAmount || 0) > 0 && itemGst && (
                                                            <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
                                                                {itemGst.title}: {itemGst.totalAmountLabel}
                                                                <span className="block text-[10px] text-gray-400">{itemGst.splitRateLabel}; {itemGst.splitAmountLabel}</span>
                                                            </p>
                                                        )}
                                                    </div>
                                                    <div className="text-right">
                                                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                                                            <p className="text-sm font-semibold text-gray-800">₹{price.toLocaleString()}</p>
                                                            {hasDiscount && (
                                                                <>
                                                                    <p className="text-[11px] text-gray-400 line-through">₹{mrp.toLocaleString()}</p>
                                                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 font-semibold">
                                                                        {discountPct}% OFF
                                                                    </span>
                                                                </>
                                                            )}
                                                        </div>
                                                        <p className="text-xs text-gray-400 mt-1">₹{item.lineTotal.toLocaleString()}</p>
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
                                    {isSummaryLoading && (
                                        <div className="text-[11px] text-gray-500 flex items-center gap-1">
                                            <TrendingUp size={12} /> Refreshing member pricing...
                                        </div>
                                    )}
                                    <div className="flex items-center justify-between text-gray-500">
                                        <span>Subtotal</span>
                                        <span className="font-semibold text-gray-800">₹{subtotal.toLocaleString()}</span>
                                    </div>
                                    <div className="flex items-center justify-between text-gray-500">
                                        <span>Shipping</span>
                                        {isShippingUnavailable ? (
                                            <span className="font-semibold text-amber-700">Unavailable for this state</span>
                                        ) : (
                                            <span className="font-semibold text-gray-800">₹{Number(shippingFee || 0).toLocaleString()}</span>
                                        )}
                                    </div>
                                    {isShippingUnavailable && (
                                        <p className="text-[11px] text-amber-700">
                                            We do not currently have a matching shipping rule for this state. Update the address or shipping configuration before placing the order.
                                        </p>
                                    )}
                                    <div className="flex items-start justify-between text-gray-500">
                                        <span>Base Price (Before Discounts)</span>
                                        <span className="font-semibold text-gray-800">₹{Math.max(0, Number(subtotal || 0) + Number(shippingFee || 0)).toLocaleString()}</span>
                                    </div>
                                    {productMrpSavings > 0 && (
                                        <div className="flex items-center justify-between text-emerald-700">
                                            <span>Product Discount (MRP)</span>
                                            <span className="font-semibold">- ₹{Number(productMrpSavings || 0).toLocaleString()}</span>
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
                                    {totalSavings > 0 && (
                                        <div className="flex items-center justify-between text-emerald-700">
                                            <span>Total Savings</span>
                                            <span className="font-semibold">₹{Number(totalSavings || 0).toLocaleString()}</span>
                                        </div>
                                    )}
                                    {totalSavings > 0 && (
                                        <p className="text-[11px] text-emerald-700/80 pt-1">
                                            Savings = Product Discount + Coupon + Member Discount + Shipping Benefit.
                                        </p>
                                    )}
                                    <div className="flex items-start justify-between text-gray-500">
                                        <span>Taxable Value After Discounts</span>
                                        <span className="font-semibold text-gray-800">₹{Math.max(0, Number(subtotal || 0) + Number(shippingFee || 0) - Number(couponDiscount || 0) - Number(loyaltyDiscount || 0) - Number(loyaltyShippingDiscount || 0)).toLocaleString()}</span>
                                    </div>
                                    {showTaxComponents && (
                                        <div className="flex items-start justify-between text-gray-500">
                                            <span>
                                                GST
                                                <span className="block text-[11px] text-gray-400">{getGstDisplayDetails({ taxAmount: Number(taxTotal || 0) }).splitAmountLabel}</span>
                                            </span>
                                            <span className="font-semibold text-gray-800">₹{Number(taxTotal || 0).toLocaleString()}</span>
                                        </div>
                                    )}
                                    <div className="flex items-center justify-between text-gray-800 text-base font-semibold pt-3">
                                        <span>Total</span>
                                        <span>₹{grandTotal.toLocaleString()}</span>
                                    </div>
                                </div>
                                <RazorpayAffordability amountRupees={grandTotal} className="mt-4" />

                                <button
                                    type="button"
                                    onClick={handlePayNow}
                                    disabled={isPlacingOrder || !isReadyForPayment}
                                    className="mt-6 w-full inline-flex items-center justify-center gap-2 bg-primary text-accent font-bold py-3 rounded-xl shadow-lg shadow-primary/20 hover:bg-primary-light transition-all disabled:opacity-60"
                                >
                                    <CreditCard size={18} /> {isPlacingOrder ? 'Processing...' : 'Pay Now'}
                                </button>
                                {isMobileMissingOnProfile && !hasMobileForPayment && (
                                    <p className="text-[11px] text-amber-700 text-center mt-2">
                                        Mobile number is required to continue payment.
                                    </p>
                                )}
                                {!isAddressReadyForPayment && (
                                    <p className="text-[11px] text-amber-700 text-center mt-2">
                                        Complete shipping and billing address to continue payment.
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
                                        { name: 'Visa', logo: '/payment-logos/visa.svg' },
                                        { name: 'Mastercard', logo: '/payment-logos/mastercard.svg' },
                                        { name: 'Amex', logo: amexLogo },
                                        { name: 'RuPay', logo: '/payment-logos/rupay.svg' },
                                        { name: 'UPI', logo: '/payment-logos/upi.svg' },
                                        { name: 'EMI', logo: '/payment-logos/emi.svg' },
                                        { name: 'NetBanking', logo: '/payment-logos/netbanking.svg' },
                                        { name: 'Wallets', logo: '/payment-logos/wallets.svg' }
                                    ].map((method) => (
                                        <div key={method.name} className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-gray-50">
                                            <img
                                                src={method.logo}
                                                alt={method.name}
                                                className={`${method.name === 'Amex' ? 'h-8 w-full max-w-[150px]' : 'h-6 w-full max-w-[72px]'} object-contain`}
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

            {orderResult && createPortal(
                <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
                    <div className="bg-white w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl p-6 animate-fade-in border border-gray-100">
                        <img src={BRAND_LOGO_URL} alt="SSC Jewellery" className="h-10 w-auto mb-3" />
                        <h3 className="text-xl font-serif text-primary">Order Confirmed</h3>
                        <p className="text-sm text-gray-500 mt-2">
                            Thank you for shopping with us. Your order is confirmed and will be processed shortly.
                        </p>
                        <div className="mt-4 rounded-xl border border-gray-200 p-4 bg-gray-50">
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-gray-500">Order Ref</span>
                                <span className="font-semibold text-gray-800">{orderResult.orderRef || orderResult.order_ref}</span>
                            </div>
                            <div className="flex items-center justify-between text-sm mt-2">
                                <span className="text-gray-500">Subtotal</span>
                                <span className="font-semibold text-gray-800">₹{Number(orderResult.subtotal || orderResult.sub_total || 0).toLocaleString()}</span>
                            </div>
                            {(() => {
                                const subtotalValue = Number(orderResult.subtotal || orderResult.sub_total || 0);
                                const shippingValue = Number(orderResult.shippingFee || orderResult.shipping_fee || 0);
                                const taxValue = Number(orderResult.taxTotal || orderResult.tax_total || 0);
                                const couponValue = Number(orderResult.coupon_discount_value || orderResult.couponDiscountValue || orderResult.couponDiscountTotal || 0);
                                const loyaltyValue = Number(orderResult.loyalty_discount_total || orderResult.loyaltyDiscountTotal || 0);
                                const loyaltyShippingValue = Number(orderResult.loyalty_shipping_discount_total || orderResult.loyaltyShippingDiscountTotal || 0);
                                const totalSavingsValue = Number(orderResult.discountTotal || orderResult.discount_total || (couponValue + loyaltyValue + loyaltyShippingValue));
                                return (
                                    <>
                                        <div className="flex items-center justify-between text-sm mt-2">
                                            <span className="text-gray-500">Shipping</span>
                                            <span className="font-semibold text-gray-800">₹{shippingValue.toLocaleString()}</span>
                                        </div>
                                        <div className="flex items-center justify-between text-sm mt-2">
                                            <span className="text-gray-500">Base Price (Before Discounts)</span>
                                            <span className="font-semibold text-gray-800">₹{Math.max(0, subtotalValue + shippingValue).toLocaleString()}</span>
                                        </div>
                                        {couponValue > 0 && (
                                            <div className="flex items-center justify-between text-sm mt-2 text-emerald-700">
                                                <span>Coupon{orderResult.couponCode || orderResult.coupon_code ? ` (${orderResult.couponCode || orderResult.coupon_code})` : ''}</span>
                                                <span className="font-semibold">-₹{couponValue.toLocaleString()}</span>
                                            </div>
                                        )}
                                        {loyaltyValue > 0 && (
                                            <div className="flex items-center justify-between text-sm mt-2 text-blue-700">
                                                <span>Member Discount ({formatTierLabel(orderResult.loyalty_tier || orderResult.loyaltyTier || 'regular')})</span>
                                                <span className="font-semibold">-₹{loyaltyValue.toLocaleString()}</span>
                                            </div>
                                        )}
                                        {loyaltyShippingValue > 0 && (
                                            <div className="flex items-center justify-between text-sm mt-2 text-blue-700">
                                                <span>Member Shipping Benefit</span>
                                                <span className="font-semibold">-₹{loyaltyShippingValue.toLocaleString()}</span>
                                            </div>
                                        )}
                                        {totalSavingsValue > 0 && (
                                            <div className="flex items-center justify-between text-sm mt-2 text-emerald-700">
                                                <span>Total Savings</span>
                                                <span className="font-semibold">₹{totalSavingsValue.toLocaleString()}</span>
                                            </div>
                                        )}
                                        <div className="flex items-center justify-between text-sm mt-2">
                                            <span className="text-gray-500">Taxable Value After Discounts</span>
                                            <span className="font-semibold text-gray-800">₹{Math.max(0, subtotalValue + shippingValue - couponValue - loyaltyValue - loyaltyShippingValue).toLocaleString()}</span>
                                        </div>
                                        {taxValue > 0 && (
                                            <div className="flex items-start justify-between text-sm mt-2">
                                                <span className="text-gray-500">
                                                    GST
                                                    <span className="block text-[11px] text-gray-400">
                                                        {getGstDisplayDetails({ taxAmount: taxValue }).splitAmountLabel}
                                                    </span>
                                                </span>
                                                <span className="font-semibold text-gray-800">₹{taxValue.toLocaleString()}</span>
                                            </div>
                                        )}
                                    </>
                                );
                            })()}
                            <div className="flex items-center justify-between text-base font-semibold mt-3 text-gray-800">
                                <span>Total</span>
                                <span>₹{Number(orderResult.total || 0).toLocaleString()}</span>
                            </div>
                            {Array.isArray(orderResult.items) && orderResult.items.length > 0 && (
                                <div className="mt-4 pt-3 border-t border-gray-200 space-y-2">
                                    {orderResult.items.slice(0, 3).map((item, idx) => (
                                        <div key={item.id || `${item.product_id || 'item'}-${item.variant_id || ''}-${idx}`} className="flex items-center justify-between gap-3">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <div className="w-10 h-10 rounded-lg border border-gray-200 bg-white overflow-hidden shrink-0">
                                                    {getOrderResultItemImage(item) ? (
                                                        <img src={getOrderResultItemImage(item)} alt={item.title || 'Item'} className="w-full h-full object-cover" />
                                                    ) : null}
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="text-sm text-gray-700 truncate">{item.title}</p>
                                                    <p className="text-xs text-gray-500">Qty: {Number(item.quantity || 0)}</p>
                                                </div>
                                            </div>
                                            <p className="text-sm font-semibold text-gray-800">₹{Number(item.line_total || item.lineTotal || 0).toLocaleString()}</p>
                                            {Number(item.tax_amount || item.taxAmount || item.item_snapshot?.taxAmount || 0) > 0 && (
                                                <p className="text-[11px] text-gray-500 text-right">
                                                    {(() => {
                                                        const gst = getGstDisplayDetails({
                                                            taxAmount: Number(item.tax_amount || item.taxAmount || item.item_snapshot?.taxAmount || 0),
                                                            taxRatePercent: Number(item.tax_rate_percent || item.taxRatePercent || item.item_snapshot?.taxRatePercent || 0),
                                                            taxLabel: item.tax_code || item.taxCode || item.tax_name || item.taxName || item.item_snapshot?.taxCode || item.item_snapshot?.taxName || ''
                                                        });
                                                        return `${gst.title}: ${gst.totalAmountLabel} (${gst.splitAmountLabel})`;
                                                    })()}
                                                </p>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <p className="text-sm text-gray-600 mt-3">Your items will be shipped in 2-3 working days.</p>
                        <div className="mt-4 text-xs text-gray-500 space-y-1">
                            <p>By placing this order you agree to our policies:</p>
                            <div className="flex gap-3 flex-wrap">
                                <Link to="/shipping" className="text-primary font-semibold">Shipping Policy</Link>
                                <Link to="/refund" className="text-primary font-semibold">Refund Policy</Link>
                            </div>
                        </div>
                        <div className="mt-5 flex items-center justify-end gap-2">
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
        </div>
    );
}
