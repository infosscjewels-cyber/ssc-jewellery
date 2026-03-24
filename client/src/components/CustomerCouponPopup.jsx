import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { orderService } from '../services/orderService';
import { burstConfetti, playCue } from '../utils/celebration';
import couponImageFallback from '../assets/coupon.jpg';
import giftIllustration from '../assets/gift.svg';
import popCue from '../assets/pop.mp3';

const MEDIA_BASE_URL = import.meta.env.PROD
    ? ''
    : (typeof window !== 'undefined'
        ? `${window.location.protocol}//${window.location.hostname}:5000`
        : 'http://localhost:5000');
const DEFAULT_POP_CUE = popCue;
const POPUP_INITIAL_DELAY_MS = 10000;
const MOBILE_BREAKPOINT_QUERY = '(max-width: 767px)';

const resolveMediaUrl = (value, fallback = '') => {
    const raw = String(value || '').trim();
    if (!raw) return fallback;
    if (/^https?:\/\//i.test(raw) || raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
    if (raw.startsWith('/uploads/')) return `${MEDIA_BASE_URL}${raw}`;
    return raw;
};

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

const formatCouponOffer = (coupon = null) => {
    const safe = coupon && typeof coupon === 'object' ? coupon : {};
    const type = String(safe.discountType || '').toLowerCase();
    const value = Number(safe.discountValue || 0);
    if (type === 'fixed') return `₹${value.toLocaleString('en-IN')} OFF`;
    if (type === 'shipping_full') return 'FREE SHIPPING';
    if (type === 'shipping_partial') return `${value}% SHIPPING OFF`;
    return `${value}% OFF`;
};

const renderGiftPrompt = (message) => (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-6 text-sm font-semibold text-amber-800">
        {message}
    </div>
);

export default function CustomerCouponPopup() {
    const { user, loading } = useAuth();
    const { socket } = useSocket();
    const [open, setOpen] = useState(false);
    const [popup, setPopup] = useState(null);
    const [dismissed, setDismissed] = useState(false);
    const [showGiftIntro, setShowGiftIntro] = useState(false);
    const [scratchUnlocked, setScratchUnlocked] = useState(false);
    const [isScratching, setIsScratching] = useState(false);
    const [isMobileScreen, setIsMobileScreen] = useState(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
        return window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches;
    });
    const scratchCanvasRef = useRef(null);
    const isCustomer = !!user && String(user.role || '').toLowerCase() === 'customer';

    const storageKey = useMemo(() => {
        if (!popup?.key) return '';
        const owner = user?.id ? `user:${user.id}` : 'guest';
        return `customer-popup-dismissed:${owner}:${popup.key}`;
    }, [popup?.key, user?.id]);

    const loadPopupData = useCallback(async () => {
        if (loading) return;
        if (user && !isCustomer) return;
        try {
            const data = isCustomer
                ? await orderService.getCustomerPopupData()
                : await orderService.getPublicPopupData();
            const nextPopup = data?.popup || null;
            if (!nextPopup) {
                setPopup(null);
                setOpen(false);
                setDismissed(false);
                setShowGiftIntro(false);
                return;
            }
            const owner = user?.id ? `user:${user.id}` : 'guest';
            const key = `customer-popup-dismissed:${owner}:${nextPopup.key || ''}`;
            if (nextPopup.key && localStorage.getItem(key) === '1') {
                setPopup(nextPopup);
                setDismissed(true);
                setOpen(false);
                setShowGiftIntro(false);
                return;
            }
            setDismissed(false);
            setScratchUnlocked(false);
            setIsScratching(false);
            setPopup(nextPopup);
            setOpen(true);
            setShowGiftIntro(true);
        } catch {
            // ignore popup fetch errors
        }
    }, [isCustomer, loading, user]);

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
        const mediaQuery = window.matchMedia(MOBILE_BREAKPOINT_QUERY);
        const updateScreenMode = (event) => setIsMobileScreen(event.matches);

        if (typeof mediaQuery.addEventListener === 'function') {
            mediaQuery.addEventListener('change', updateScreenMode);
            return () => mediaQuery.removeEventListener('change', updateScreenMode);
        }
        mediaQuery.addListener(updateScreenMode);
        return () => mediaQuery.removeListener(updateScreenMode);
    }, []);

    useEffect(() => {
        if (loading) return;
        if (user && !isCustomer) return;
        let active = true;
        const timer = setTimeout(async () => {
            if (!active) return;
            await loadPopupData();
        }, POPUP_INITIAL_DELAY_MS);
        return () => {
            active = false;
            clearTimeout(timer);
        };
    }, [isCustomer, loadPopupData, loading, user]);

    useEffect(() => {
        if (!socket) return;
        const handlePopupUpdate = () => {
            loadPopupData().catch(() => {});
        };
        socket.on('loyalty:popup_public_update', handlePopupUpdate);
        return () => socket.off('loyalty:popup_public_update', handlePopupUpdate);
    }, [loadPopupData, socket]);

    useEffect(() => {
        if (!open || !popup || showGiftIntro) return;
        if (typeof window !== 'undefined') window.__sscPopupAudioPlayedAt = 0;
        burstConfetti();
        const customSrc = resolveMediaUrl(popup.audioUrl, '');
        if (!customSrc) {
            playCue(DEFAULT_POP_CUE, { volume: 0.9 });
            return;
        }
        const probe = new Audio(customSrc);
        let settled = false;
        const useFallback = () => {
            if (settled) return;
            settled = true;
            playCue(DEFAULT_POP_CUE, { volume: 0.9 });
        };
        const useCustom = () => {
            if (settled) return;
            settled = true;
            playCue(customSrc, { volume: 0.9 });
        };
        probe.preload = 'metadata';
        probe.addEventListener('error', useFallback, { once: true });
        probe.addEventListener('canplaythrough', useCustom, { once: true });
        probe.load();
        const timer = setTimeout(useFallback, 1800);
        return () => clearTimeout(timer);
    }, [open, popup, showGiftIntro]);

    useEffect(() => {
        if (!showGiftIntro || !isMobileScreen) return;
        const canvas = scratchCanvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return;

        const dpr = Math.max(window.devicePixelRatio || 1, 1);
        canvas.width = Math.floor(rect.width * dpr);
        canvas.height = Math.floor(rect.height * dpr);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, rect.width, rect.height);
        ctx.fillStyle = '#fff6df';
        ctx.fillRect(0, 0, rect.width, rect.height);
        const giftImg = new Image();
        giftImg.onload = () => {
            const scale = Math.min(rect.width / giftImg.width, rect.height / giftImg.height) * 0.7;
            const drawW = giftImg.width * scale;
            const drawH = giftImg.height * scale;
            const x = (rect.width - drawW) / 2;
            const y = (rect.height - drawH) / 2;
            ctx.globalAlpha = 0.95;
            ctx.drawImage(giftImg, x, y, drawW, drawH);
            ctx.globalAlpha = 1;
        };
        giftImg.src = giftIllustration;
    }, [isMobileScreen, showGiftIntro]);

    useEffect(() => {
        if (!showGiftIntro || !scratchUnlocked) return;
        const timer = setTimeout(() => {
            setShowGiftIntro(false);
        }, 700);
        return () => clearTimeout(timer);
    }, [scratchUnlocked, showGiftIntro]);

    const scratchAt = (event) => {
        const canvas = scratchCanvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const point = 'touches' in event
            ? event.touches[0] || event.changedTouches?.[0]
            : event;
        if (!point) return;
        const x = point.clientX - rect.left;
        const y = point.clientY - rect.top;

        const dpr = Math.max(window.devicePixelRatio || 1, 1);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(x, y, 18, 0, Math.PI * 2);
        ctx.fill();
    };

    const updateScratchProgress = () => {
        const canvas = scratchCanvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let transparentCount = 0;
        const totalPixels = data.length / 4;
        for (let i = 3; i < data.length; i += 4) {
            if (data[i] < 16) transparentCount += 1;
        }
        const percent = Math.min(100, Math.round((transparentCount / totalPixels) * 100));
        if (percent >= 50) setScratchUnlocked(true);
    };

    const handleScratchStart = (event) => {
        if (!isMobileScreen) return;
        setIsScratching(true);
        scratchAt(event);
        updateScratchProgress();
    };

    const handleScratchMove = (event) => {
        if (!isMobileScreen) return;
        if (!isScratching) return;
        scratchAt(event);
        updateScratchProgress();
    };

    const handleScratchEnd = () => {
        if (!isScratching) return;
        setIsScratching(false);
        updateScratchProgress();
    };

    const handleGiftIntroOpen = () => {
        if (isMobileScreen || scratchUnlocked) return;
        setScratchUnlocked(true);
    };

    const handleDontShowAgain = () => {
        if (storageKey) {
            localStorage.setItem(storageKey, '1');
        }
        setOpen(false);
        setShowGiftIntro(false);
    };

    if (!open || !popup) return null;
    if (dismissed) return null;
    const coupon = (() => {
        if (popup?.coupon && typeof popup.coupon === 'object') return popup.coupon;
        if (popup && (popup.discountType || popup.discountValue || popup.couponCode || popup.code)) {
            return {
                code: popup.couponCode || popup.code || '',
                discountType: popup.discountType || '',
                discountValue: popup.discountValue || 0,
                expiresAt: popup.expiresAt || null,
                scopeType: popup.scopeType || '',
                primaryCategoryName: popup.primaryCategoryName || '',
                categoryNames: popup.categoryNames || [],
                categoryNotice: popup.categoryNotice || ''
            };
        }
        return null;
    })();
    const categoryOnlyCoupon = String(coupon?.scopeType || '').toLowerCase() === 'category';
    const categoryName = String(coupon?.primaryCategoryName || coupon?.categoryNames?.[0] || '').trim();
    const categoryNotice = String(coupon?.categoryNotice || '').trim()
        || (categoryOnlyCoupon && categoryName ? `Valid only for ${categoryName} category products.` : '');
    const renderCouponCard = (extraClass = '') => {
        if (!coupon) return null;
        return (
        <div className={`relative inline-grid max-w-full rounded-xl border overflow-hidden grid-cols-[auto_148px] ${extraClass}`}>
            <div className="bg-primary px-5 py-4 flex flex-col justify-center">
                <p className="text-[10px] uppercase tracking-wider text-slate-300">Voucher Code</p>
                <p className="mt-1">
                    <span className="inline-flex w-fit max-w-full rounded-md bg-white/10 px-2 py-1 text-sm font-bold leading-5 text-white break-all">
                        {coupon?.code}
                    </span>
                </p>
            </div>
            <div className="bg-accent px-5 py-4 text-primary border-l border-dashed border-primary/30 flex flex-col justify-center">
                <p className="text-[15px] font-extrabold tracking-wide">
                    {formatCouponOffer(coupon)}
                </p>
                <p className="text-[11px] mt-1 text-primary/80 font-medium">
                    {coupon?.expiresAt ? `Expires ${formatLongDate(coupon.expiresAt)}` : 'No expiry'}
                </p>
            </div>
            <span style={{ left: 'calc(100% - 148px)' }} className="absolute -top-[5px] h-[10px] w-[10px] -translate-x-1/2 rounded-full bg-white border border-gray-200 z-10" />
            <span style={{ left: 'calc(100% - 148px)' }} className="absolute -bottom-[5px] h-[10px] w-[10px] -translate-x-1/2 rounded-full bg-white border border-gray-200 z-10" />
        </div>
        );
    };

    return createPortal(
        <div className="fixed inset-0 z-[240]">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
            <div className="relative z-10 min-h-full overflow-y-auto flex items-start sm:items-center justify-center p-4">
                {showGiftIntro ? (
                    <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl text-center my-auto">
                        <p className="text-lg md:text-xl font-serif text-primary font-bold">Exclusive Gift for you</p>
                        <div
                            className={`relative mt-5 mx-auto w-full max-w-[360px] touch-none transition-all duration-500 ${
                                scratchUnlocked ? 'scale-[0.94] translate-y-4 opacity-90' : ''
                            }`}
                            style={{ touchAction: isMobileScreen ? 'none' : 'auto' }}
                            role="button"
                            tabIndex={0}
                            aria-label={isMobileScreen ? 'Scratch to reveal your offer' : 'Click to open your offer'}
                            onClick={handleGiftIntroOpen}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    handleGiftIntroOpen();
                                }
                            }}
                            onMouseDown={handleScratchStart}
                            onMouseMove={handleScratchMove}
                            onMouseUp={handleScratchEnd}
                            onMouseLeave={handleScratchEnd}
                            onTouchStart={handleScratchStart}
                            onTouchMove={handleScratchMove}
                            onTouchEnd={handleScratchEnd}
                        >
                            <div className={`transition-all duration-500 ${scratchUnlocked ? 'ring-4 ring-amber-300 shadow-2xl shadow-amber-200/60' : ''}`}>
                                {isMobileScreen
                                    ? (coupon ? renderCouponCard() : renderGiftPrompt('Scratch and reveal your surprise offer'))
                                    : (
                                        <div className="flex flex-col items-center justify-center rounded-xl border border-amber-100 bg-gradient-to-br from-amber-50 via-white to-orange-50 px-6 py-8">
                                            <img src={giftIllustration} alt="Gift offer" className="w-24 md:w-28 h-auto opacity-90" />
                                        </div>
                                    )}
                            </div>
                            {isMobileScreen && (
                                <canvas
                                    ref={scratchCanvasRef}
                                    className="absolute inset-0 h-full w-full rounded-xl"
                                    style={{ pointerEvents: scratchUnlocked ? 'none' : 'auto' }}
                                />
                            )}
                        </div>
                        <p className="mt-4 text-sm font-medium text-amber-700">
                            {isMobileScreen ? 'Scratch to reveal' : 'Click to open'}
                        </p>
                    </div>
                ) : (
                <div className="w-full max-w-2xl max-h-[calc(100vh-2rem)] overflow-y-auto bg-white rounded-2xl border border-gray-200 shadow-2xl my-auto">
                    <div className="relative h-44 bg-gray-100">
                        <img src={resolveMediaUrl(popup.imageUrl, couponImageFallback)} alt="Offer" className="w-full h-full object-cover" />
                        <button type="button" onClick={() => setOpen(false)} className="absolute top-3 right-3 p-2 rounded-full bg-white/90 text-gray-600 hover:bg-white">
                            <X size={16} />
                        </button>
                    </div>
                    <div className="p-5">
                        <div className="flex flex-col md:flex-row gap-5 md:items-start">
                            <div className="flex-1 space-y-3 text-center md:text-left">
                                <p className="text-xs uppercase tracking-[0.2em] text-gray-400 font-semibold">Special Offer</p>
                                <h3 className="text-2xl font-serif text-primary font-bold">{popup.title || 'Exclusive Offer'}</h3>
                                {!!popup.summary && <p className="text-sm text-gray-700">{popup.summary}</p>}
                                {!!popup.content && <p className="text-sm text-gray-600">{popup.content}</p>}
                                {!!categoryNotice && <p className="text-sm text-amber-700 font-medium">{categoryNotice}</p>}
                                {!!popup.encouragement && <p className="text-sm text-emerald-700 font-medium">{popup.encouragement}</p>}
                            </div>
                            <div className="order-last md:order-none md:w-44 md:shrink-0 flex justify-center md:justify-end">
                                <img src={giftIllustration} alt="Gift offer" className="w-28 md:w-40 h-auto opacity-90" />
                            </div>
                        </div>
                        {coupon && (
                            <div className="mt-4 flex justify-center">
                                {renderCouponCard()}
                            </div>
                        )}

                        <div className="pt-4 flex items-center justify-between gap-3">
                            <button
                                type="button"
                                onClick={handleDontShowAgain}
                                className="text-[11px] text-gray-400 hover:text-gray-600 underline"
                            >
                                Don&apos;t show me again
                            </button>
                            <Link
                                to={popup.buttonLink || '/shop'}
                                onClick={() => setOpen(false)}
                                className="inline-flex items-center px-5 py-2.5 rounded-lg bg-primary text-accent text-sm font-semibold hover:bg-primary-light"
                            >
                                {popup.buttonLabel || 'Shop Now'}
                            </Link>
                        </div>
                    </div>
                </div>
                )}
            </div>
        </div>,
        document.body
    );
}
